import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { buildSchoolFiles, validateSchoolBundle, schoolAliases, SCHOOL_FILE_KEY } from "./zbschools.mjs";

function fixture() {
  const collections = ["Primitives", "Colour", "Font Size", "Size", "Breakpoints"].map((name, i) => ({
    id: `c${i}`, key: `key${i}`, name, normalizedName: name.toLowerCase().replaceAll(" ", "-"),
    defaultModeId: `m${i}`, modes: [{ id: `m${i}`, name: "Light", normalizedName: "light" }], variableIds: []
  }));
  return { schemaVersion: "1.0.0", source: { tool: "figma-mcp", fileKey: SCHOOL_FILE_KEY, fileName: "School", exportedAt: "2026-11-03T00:00:00.000Z", complete: true }, collections, variables: [], aliases: [], validation: { errors: [], warnings: [] } };
}
function add(bundle, collectionIndex, id, name, type, value, modes = {}) {
  const c = bundle.collections[collectionIndex];
  c.variableIds.push(id);
  bundle.variables.push({ id, key: id, name, collectionId: c.id, resolvedType: type, valuesByMode: { [c.defaultModeId]: value, ...modes } });
}
function complete(bundle) {
  bundle.source.retrieval = { collectionCount: bundle.collections.length, variableCount: bundle.variables.length,
    collectionVariableCounts: Object.fromEntries(bundle.collections.map(c => [c.id, c.variableIds.length])) };
  bundle.aliases = schoolAliases(bundle.variables);
  return bundle;
}
const ref = id => ({ type: "VARIABLE_ALIAS", id });

test("School output preserves all collections and modes, imports every stylesheet and uses its actual widths", () => {
  const b = fixture();
  b.collections[4].modes.push({ id: "desktop", name: "1024" });
  add(b, 4, "width", "page-width", "FLOAT", 390, { desktop: 1024 });
  add(b, 4, "height", "page-height", "FLOAT", 844, { desktop: 768 });
  add(b, 2, "body", "Body 1", "FLOAT", 18);
  add(b, 3, "button", "Button/button-padding-md", "FLOAT", 24);
  const files = buildSchoolFiles(complete(b));
  assert.match(files["tailwind4/breakpoint.css"], /--breakpoint-xs: 390px;/);
  assert.match(files["tailwind4/breakpoint.css"], /--breakpoint-lg: 1024px;/);
  assert.doesNotMatch(files["tailwind4/breakpoint.css"], /768px|1200px/);
  assert.match(files["tailwind4/typography.css"], /@utility text-body1/);
  assert.doesNotMatch(files["tailwind4/typography.css"], /line-height:|font-weight:|letter-spacing:/);
  assert.match(files["tailwind4/size.css"], /--spacing-button-padding-md: 24px;/);
  assert.doesNotMatch(files["tailwind4/size.css"], /--token-/);
  const imports = [...files["tailwind4/index.css"].matchAll(/@import "\.\/(.+)";/g)].map(m => m[1]);
  assert.deepEqual(imports, ["base.css", "breakpoint.css", "colour-token.css", "typography.css", "size.css"]);
  for (const name of imports) assert.ok(files[`tailwind4/${name}`]);
  const source = JSON.parse(files["tokens/figma-variables.json"]);
  assert.deepEqual(source.collections.find(c => c.id === "c4").modes, b.collections[4].modes);
  assert.deepEqual(source.variables.find(v => v.id === "width").valuesByMode, { m4: 390, desktop: 1024 });
});

test("all non-opacity Size tokens use spacing names and aliases follow renamed targets", () => {
  const b = fixture();
  add(b, 0, "radius", "Border/border-radius-md", "FLOAT", 8);
  add(b, 3, "rounded", "Button/button-br-rounded", "FLOAT", ref("radius"));
  add(b, 3, "container", "Container/container-br-md", "FLOAT", ref("rounded"));
  add(b, 3, "padding", "Button/button-padding-3xs", "FLOAT", 3);
  add(b, 3, "gap", "Container/container-gap-md", "FLOAT", 16);
  add(b, 3, "bw", "Container/container-bw-sm", "FLOAT", 1);
  add(b, 3, "icon", "Icon/icon-md", "FLOAT", 20);
  add(b, 3, "elevation", "Button/button-elevation-md", "FLOAT", 6);
  add(b, 3, "overlay", "Overlay/overlay-width", "FLOAT", 80);
  add(b, 3, "illustration", "Illustration/Avatar/avatar-md", "FLOAT", 30);
  add(b, 3, "indicator", "Indicator/indicator-xs", "FLOAT", 0);
  add(b, 3, "spacing", "Spacing/spacing-1.5", "FLOAT", 1.5);
  add(b, 3, "opacity", "Opacity/opacity-none", "FLOAT", 0);
  b.collections[3].modes.push({ id: "large", name: "Large" });
  for (const v of b.variables.filter(v => v.collectionId === "c3")) v.valuesByMode.large = v.valuesByMode.m3;
  b.variables.find(v => v.id === "icon").valuesByMode.large = 24;
  const css = buildSchoolFiles(complete(b))["tailwind4/size.css"];
  assert.match(css, /--spacing-button-br-rounded: var\(--border-radius-md\);/);
  assert.match(css, /--spacing-container-br-md: var\(--spacing-button-br-rounded\);/);
  assert.match(css, /--spacing-button-padding-3xs: 3px;/);
  assert.match(css, /--spacing-container-gap-md: 16px;/);
  assert.match(css, /--spacing-container-bw-sm: 1px;/);
  assert.match(css, /--spacing-icon-md: 20px;/);
  assert.match(css, /--spacing-button-elevation-md: 6px;/);
  assert.match(css, /--spacing-overlay-width: 80px;/);
  assert.match(css, /--spacing-illustration-avatar-md: 30px;/);
  assert.match(css, /--spacing-indicator-xs: 0;/);
  assert.match(css, /--spacing-1-5: 1.5px;/);
  assert.match(css, /--opacity-none: 0;/);
  assert.match(css, /data-size-mode="large"/);
  assert.match(css, /--spacing-icon-md: 24px;/);
  for (const match of css.matchAll(/^  (--[\w-]+):/gm)) assert.match(match[1], /^--(?:spacing|opacity)-/);
  const subset = JSON.parse(buildSchoolFiles(b)["tokens/size.json"]);
  assert.deepEqual(subset.variables.find(v => v.id === "container").valuesByMode.m3, ref("rounded"));
  assert.equal(subset.variables.find(v => v.id === "icon").name, "Icon/icon-md");
  assert.doesNotMatch(css, /--token-|--button-br-rounded|--container-br-md|--button-padding-3xs:/);
});

test("aliases, transparent nested colours, units, repeated names and escaping produce valid declarations", () => {
  const b = fixture();
  add(b, 0, "white", "Colour/Grey/grey-white", "COLOR", { r: 1, g: 1, b: 1, a: 0 });
  add(b, 0, "twenty", "Size/size-20", "FLOAT", 20);
  add(b, 3, "opacity", "Opacity/opacity-sm", "FLOAT", ref("twenty"));
  add(b, 0, "composite", "Colour/Grey/grey-overlay", "COLOR", { color: { r: 0, g: 0, b: 0, a: 1 }, opacity: ref("opacity") });
  add(b, 1, "bg", "Background/background-primary", "COLOR", ref("composite"));
  add(b, 0, "spacing", "Spacing/spacing-1.5", "FLOAT", 1.5);
  add(b, 0, "weight", "Typography/Weight/font-weight-regular", "STRING", "400");
  add(b, 0, "height", "Typography/Line Height/line-height-md", "FLOAT", 150);
  add(b, 0, "family", "Typography/Family/font-family", "STRING", 'Noto "Sans"\\SC\n');
  const files = buildSchoolFiles(complete(b));
  const css = files["tailwind4/base.css"];
  assert.match(css, /--color-grey-white: rgb\(255 255 255 \/ 0\);/);
  assert.match(css, /--color-grey-overlay: rgb\(0 0 0 \/ 0.2\);/);
  assert.match(css, /--spacing-1-5: 1.5px;/);
  assert.match(css, /--font-weight-regular: 400;/);
  assert.match(css, /--line-height-md: 150%;/);
  assert.ok(css.includes('"Noto \\22 Sans\\22 \\5c SC\\a "'));
  assert.match(files["tailwind4/size.css"], /--opacity-sm: 20%;/);
  assert.match(files["tailwind4/colour-token.css"], /--color-background-primary: var\(--color-grey-overlay\);/);
  assert.ok(schoolAliases(b.variables).some(a => a.valuePath === "opacity" && a.toVariableId === "opacity"));
});

test("cross-collection aliases match mode names and fall back to the target default, not unrelated IDs", () => {
  const b = fixture();
  b.collections[0].modes.push({ id: "primitive-dark", name: "Dark" });
  b.collections[1].modes.push({ id: "semantic-dark", name: "Dark" }, { id: "other", name: "Other" });
  add(b, 0, "color", "Colour/Grey/grey-base", "COLOR", { r: 1, g: 1, b: 1 }, { "primitive-dark": { r: 0, g: 0, b: 0 } });
  add(b, 1, "semantic", "Background/background-primary", "COLOR", ref("color"), { "semantic-dark": ref("color"), other: ref("color") });
  const files = buildSchoolFiles(complete(b));
  assert.match(files["tailwind4/colour-token.css"], /\[data-colour-mode="dark"\] \{\n  --color-background-primary: #000000;/);
  assert.match(files["tailwind4/colour-token.css"], /\[data-colour-mode="other"\] \{\n  --color-background-primary: var\(--color-grey-base\);/);
  assert.match(files["tailwind4/base.css"], /data-primitives-mode="dark"/);
});

test("collisions receive stable unique suffixes and output is independent of input order", () => {
  const b = fixture();
  add(b, 0, "one", "Spacing/spacing-1.5", "FLOAT", 1.5);
  add(b, 0, "two", "Spacing/spacing-1-5", "FLOAT", 2);
  const first = buildSchoolFiles(complete(b));
  assert.match(first["tailwind4/base.css"], /--spacing-1-5-[a-f0-9]{12}:/);
  assert.ok(validateSchoolBundle(b).warnings.some(w => w.code === "NAME_COLLISION"));
  b.variables.reverse(); b.collections.reverse();
  assert.deepEqual(buildSchoolFiles(b), first);
});

test("invalid bundles are rejected before generation", () => {
  const cases = [
    ["INCOMPLETE_SOURCE", b => { b.source.complete = false; }],
    ["INVALID_SOURCE", b => { b.source.fileKey = "wrong-file"; }],
    ["RETRIEVAL_COUNT_MISMATCH", b => { b.source.retrieval.variableCount = 99; }],
    ["MISSING_MODE_VALUE", b => { b.variables[0].valuesByMode = {}; }],
    ["UNRESOLVED_ALIAS", b => { b.variables[0].valuesByMode.m0 = ref("missing"); }],
    ["CIRCULAR_ALIAS", b => { b.variables[0].valuesByMode.m0 = ref("a"); }],
    ["UNSUPPORTED_TYPE", b => { b.variables[0].valuesByMode.m0 = "bad-number"; }],
    ["UNSUPPORTED_TYPE", b => { b.variables[0].valuesByMode.m0 = ref("c"); }],
    ["COLLECTION_MEMBERSHIP", b => { b.collections[0].variableIds = []; }],
    ["REMOTE_VARIABLE_UNSUPPORTED", b => { b.variables[0].remote = true; }],
  ];
  for (const [code, mutate] of cases) {
    const b = fixture(); add(b, 0, "a", "Size/size-1", "FLOAT", 1);
    add(b, 1, "c", "Text/text-primary", "COLOR", { r: 0, g: 0, b: 0 });
    complete(b); mutate(b);
    assert.ok(validateSchoolBundle(b).errors.some(e => e.code === code), code);
    assert.throws(() => buildSchoolFiles(b), new RegExp(code));
  }
});

test("CLI writes CSS directly to the default, environment or positional directory and keeps generated JSON in dist/zbschools/tokens", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "zbschools-test-"));
  try {
    const script = new URL("./zbschools.mjs", import.meta.url);
    const pkg = JSON.parse(await fs.readFile(new URL("../package.json", import.meta.url), "utf8"));
    for (const kind of ["default", "environment", "positional"]) {
      const cwd = path.join(root, kind);
      // 使用 variables 下的 School 源文件验证 CLI。
      const input = path.join(cwd, "variables/figma-zbschools.json");
      await fs.mkdir(path.dirname(input), { recursive: true });
      await fs.writeFile(input, JSON.stringify(complete(fixture())));
      const env = { ...process.env };
      delete env.ZBSCHOOLS_VARIABLES_JSON;
      delete env.ZBSCHOOLS_OUTPUT_DIR;
      const args = [script.pathname];
      const output = path.join(cwd, kind === "default" ? "dist/zbschools/tailwind4" : "custom-css");
      if (kind === "environment") env.ZBSCHOOLS_OUTPUT_DIR = output;
      if (kind === "positional") {
        env.ZBSCHOOLS_OUTPUT_DIR = path.join(cwd, "ignored");
        args.push(input, output);
      }
      execFileSync(process.execPath, args, { cwd, env, stdio: "pipe" });
      assert.deepEqual(JSON.parse(await fs.readFile(path.join(cwd, "dist/zbschools/tokens/primitives.json"), "utf8")).variables, []);
      assert.deepEqual((await fs.readdir(path.join(cwd, "variables"))).sort(), ["figma-zbschools.json"]);
      // 默认与自定义 CSS 目录都只包含样式文件。
      assert.deepEqual((await fs.readdir(output)).sort(), ["base.css", "breakpoint.css", "colour-token.css", "index.css", "size.css", "typography.css"].sort());
      const index = await fs.readFile(path.join(output, "index.css"), "utf8");
      for (const [, name] of index.matchAll(/@import "\.\/(.+)";/g)) assert.ok((await fs.readFile(path.join(output, name), "utf8")).length);
      if (kind === "default") assert.equal(path.resolve(cwd, pkg.exports["./zbschools/tailwind4"]), path.join(output, "index.css"));
      if (kind === "positional") await assert.rejects(fs.access(env.ZBSCHOOLS_OUTPUT_DIR), { code: "ENOENT" });
    }
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

function typographyFixture() {
  const b = fixture();
  add(b, 0, "size16", "Size/size-16", "FLOAT", 16);
  add(b, 0, "height", "Typography/Line Height/line-height-lg", "FLOAT", 180);
  add(b, 0, "weight", "Typography/Weight/font-weight-regular", "STRING", "400");
  add(b, 0, "spacing", "Typography/Letter Spacing/letter-spacing-paragraph", "FLOAT", 2);
  add(b, 0, "family", "Typography/Family/noto-sans-sc", "STRING", "Noto Sans SC");
  add(b, 0, "indent", "Size/size-40", "FLOAT", 40);
  add(b, 2, "body", "Body 1", "FLOAT", 16);
  const style = { name: "body-1", nodeId: "sample", fontSize: 16, fontWeight: 400, fontFamily: "Noto Sans SC",
    lineHeight: { unit: "PERCENT", value: 179.999995 }, letterSpacing: { unit: "PIXELS", value: 2 }, paragraphIndent: 0,
    annotation: "letter-spacing-0", boundVariables: { fontSize: [ref("body")], fontStyle: [ref("weight")], letterSpacing: [ref("spacing")], fontFamily: [ref("family")] } };
  b.typography = { source: { tool: "figma-mcp", fileKey: SCHOOL_FILE_KEY, nodeId: "1:26752", exportedAt: b.source.exportedAt }, styles: [style] };
  complete(b);
  b.source.retrieval.typographyStyleCount = 1;
  return b;
}

test("complete typography uses applied properties and primitives, preserves snapshots and paragraph indents", () => {
  const b = typographyFixture();
  b.typography.styles.push({ ...b.typography.styles[0], name: "paragraph-1", nodeId: "paragraph", paragraphIndent: 40,
    boundVariables: { ...b.typography.styles[0].boundVariables, paragraphIndent: [ref("indent")] } });
  b.source.retrieval.typographyStyleCount = 2;
  const files = buildSchoolFiles(b);
  const css = files["tailwind4/typography.css"];
  assert.match(css, /@utility text-body1 \{\n    font-size: var\(--size-16\);\n    line-height: var\(--line-height-lg\);\n    font-weight: var\(--font-weight-regular\);\n    letter-spacing: var\(--letter-spacing-paragraph\);\n    font-family: var\(--family-noto-sans-sc\);/);
  assert.match(css, /@utility text-paragraph1 \{[^}]*text-indent: var\(--size-40\);/);
  assert.ok(validateSchoolBundle(b).warnings.some(w => w.code === "TYPOGRAPHY_ANNOTATION_MISMATCH"));
  assert.ok(!validateSchoolBundle(b).warnings.some(w => w.code === "INCOMPLETE_TYPOGRAPHY_GROUP"));
  assert.deepEqual(JSON.parse(files["tokens/typography.json"]).typography, b.typography);
});

test("typography emits valid literal sizes when primitives are absent and preserves mode changes", () => {
  const b = typographyFixture();
  b.collections[2].modes.push({ id: "large", name: "Large" });
  b.variables.find(v => v.id === "body").valuesByMode.large = 22;
  const css = buildSchoolFiles(b)["tailwind4/typography.css"];
  assert.match(css, /\[data-font-size-mode="large"\] & \{\n        font-size: 22px;/);
  assert.doesNotMatch(css, /undefined|NaN|regularpx|lgpx/);
});

test("incomplete typography snapshots, missing bindings and unsupported units block generation", () => {
  for (const mutate of [
    b => { b.source.retrieval.typographyStyleCount = 99; },
    b => { delete b.typography.styles[0].boundVariables.fontSize; },
    b => { b.typography.styles[0].boundVariables.letterSpacing = [ref("missing")]; },
    b => { b.typography.styles[0].lineHeight = { unit: "AUTO" }; },
    b => { b.typography.styles.push({ ...b.typography.styles[0] }); b.source.retrieval.typographyStyleCount++; },
  ]) {
    const b = typographyFixture(); mutate(b);
    assert.throws(() => buildSchoolFiles(b), /INCOMPLETE_TYPOGRAPHY_GROUP/);
  }
});
