import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { buildTailwind3Files } from "./figmatotailwind3.mjs";

function configFor(variables) {
  const bundle = {
    collections: [{ id: "b", name: "Breakpoints", modes: [{ id: "mobile" }, { id: "tablet" }, { id: "desktop" }, { id: "other" }] }],
    variables
  };
  const source = buildTailwind3Files(bundle)["tailwind.config.js"];
  return vm.runInNewContext(source.replace("export default", "globalThis.config ="));
}

test("emits selected page widths as screens inside theme.extend", () => {
  const config = configFor([
    { collectionId: "b", name: "page-width", valuesByMode: { mobile: 390, tablet: 768, desktop: 1200, other: 992 } },
    { collectionId: "b", name: "page-height", valuesByMode: { mobile: 1440 } },
    { collectionId: "unrelated", name: "page-width", valuesByMode: { mobile: 1440 } }
  ]);
  assert.deepEqual(JSON.parse(JSON.stringify(config.theme.extend.screens)), { xs: "390px", md: "768px", lg: "1200px" });
  assert.equal(config.theme.screens, undefined);
  assert.ok(config.theme.extend.backgroundColor);
});

test("only emits widths present in page-width mode values", () => {
  const config = configFor([
    { collectionId: "b", name: "page-width", valuesByMode: { mobile: { kind: "number", value: 390 } } },
    { collectionId: "b", name: "page-height", valuesByMode: { tablet: 768, desktop: 1200 } }
  ]);
  assert.deepEqual(JSON.parse(JSON.stringify(config.theme.extend.screens)), { xs: "390px" });
});

function typographyFixture() {
  const primitive = (id, name, value) => ({ id, name, collectionId: "p", resolvedType: typeof value === "string" ? "STRING" : "FLOAT", valuesByMode: { p: value } });
  return {
    collections: [
      { id: "p", name: "Primitives", defaultModeId: "p", modes: [{ id: "p", name: "Default" }] },
      { id: "t", name: "Font Adjustment", defaultModeId: "standard", modes: [{ id: "standard", name: "Standard" }, { id: "large", name: "L" }] },
    ],
    variables: [
      primitive("lh-sm", "Typography/Line Height/line-height-sm", 150),
      primitive("lh-md", "Typography/Line Height/line-height-md", 180),
      primitive("regular", "Typography/Weight/font-weight-regular", "400"),
      primitive("medium", "Typography/Weight/font-weight-medium", "500"),
      primitive("light", "Typography/Weight/font-weight-light", "300"),
      primitive("ls-sm", "Typography/Letter Spacing/letter-spacing-sm", 0.5),
      primitive("ls-md", "Typography/Letter Spacing/letter-spacing-md", 1),
      primitive("ls-none", "Typography/Letter Spacing/letter-spacing-none", 0),
      { id: "body1", name: "Body 1", collectionId: "t", resolvedType: "FLOAT", valuesByMode: { standard: 18, large: 24 } },
      { id: "body2", name: "Body 2", collectionId: "t", resolvedType: "FLOAT", valuesByMode: { standard: 16, large: 22 } },
      { id: "subheader2", name: "Subheader 2", collectionId: "t", resolvedType: "FLOAT", valuesByMode: { standard: 20, large: 26 } },
    ],
  };
}

function compileTypography(bundle) {
  const warnings = [];
  const source = buildTailwind3Files(bundle, { onWarning: w => warnings.push(w) })["tailwind.config.js"];
  const config = vm.runInNewContext(source.replace("export default", "globalThis.config ="));
  return { fontSize: JSON.parse(JSON.stringify(config.theme.extend.fontSize)), warnings, source, config };
}

test("v3 config emits literal composite font sizes and preserves existing config fields", () => {
  const { fontSize, warnings, config } = compileTypography(typographyFixture());
  assert.deepEqual(fontSize.body1, ["18px", { lineHeight: "150%", fontWeight: "400", letterSpacing: "0.5px" }]);
  assert.deepEqual(fontSize.body2, ["16px", { lineHeight: "150%", fontWeight: "400", letterSpacing: "0px" }]);
  assert.deepEqual(fontSize.subheader2, ["20px", { lineHeight: "180%", fontWeight: "500", letterSpacing: "0.5px" }]);
  assert.equal(config.darkMode, "class");
  assert.equal(config.plugins.length, 1);
  assert.ok(config.theme.extend.backgroundColor);
  assert.ok(warnings.some(w => w.code === "TYPOGRAPHY_MODE_SCOPE"));
});

test("typography resolves aliases using mode names and selects Light over default", () => {
  const b = typographyFixture();
  b.collections[1].modes = [{ id: "standard", name: "Default" }, { id: "large", name: "Light" }];
  b.collections[0].modes.push({ id: "p-light", name: "Light" });
  for (const v of b.variables.filter(v => v.collectionId === "p")) v.valuesByMode["p-light"] = v.valuesByMode.p;
  b.variables.find(v => v.id === "ls-sm").valuesByMode["p-light"] = 0.75;
  b.variables.push({ id: "size", name: "Size/size-18", collectionId: "p", resolvedType: "FLOAT", valuesByMode: { p: 18, "p-light": 20 } });
  b.variables.find(v => v.id === "body1").valuesByMode.large = { type: "VARIABLE_ALIAS", id: "size" };
  assert.deepEqual(compileTypography(b).fontSize.body1, ["20px", { lineHeight: "150%", fontWeight: "400", letterSpacing: "0.75px" }]);
});

test("missing primitives and unsupported values omit styles without symbolic CSS fallbacks", () => {
  const b = typographyFixture();
  b.variables = b.variables.filter(v => v.id !== "regular");
  const { fontSize, warnings, source } = compileTypography(b);
  assert.equal(fontSize.body1, undefined);
  assert.ok(fontSize.subheader2);
  assert.ok(warnings.some(w => w.code === "INCOMPLETE_TYPOGRAPHY_GROUP" && w.variableId === "body1"));
  assert.doesNotMatch(source, /font-weight-regularpx/);
  const invalid = typographyFixture();
  invalid.variables.find(v => v.id === "lh-sm").valuesByMode.p = "150";
  assert.equal(compileTypography(invalid).fontSize.body1, undefined);
  assert.ok(compileTypography(invalid).warnings.some(w => w.code === "UNSUPPORTED_TYPE"));
});

test("typography reports missing targets, cycles, mismatched types and missing non-default modes", () => {
  for (const [id, value, code] of [
    ["absent", null, "UNRESOLVED_ALIAS"],
    ["body1", null, "CIRCULAR_ALIAS"],
    ["regular", null, "UNSUPPORTED_TYPE"],
  ]) {
    const b = typographyFixture();
    b.variables.find(v => v.id === "body1").valuesByMode.standard = { type: "VARIABLE_ALIAS", id };
    const output = compileTypography(b);
    assert.equal(output.fontSize.body1, undefined);
    assert.ok(output.warnings.some(w => w.code === code));
  }
  const b = typographyFixture();
  delete b.variables.find(v => v.id === "body1").valuesByMode.large;
  const result = compileTypography(b);
  assert.ok(result.fontSize.body1);
  assert.ok(result.warnings.some(w => w.code === "MISSING_MODE_VALUE" && w.modeId === "large"));
});

test("typography name collisions get stable suffixes and output is deterministic", () => {
  const b = typographyFixture();
  b.variables.push({ ...b.variables.find(v => v.id === "body1"), id: "duplicate", name: "Body-1" });
  const first = compileTypography(b);
  b.variables.reverse();
  const second = compileTypography(b);
  assert.deepEqual(second.fontSize, first.fontSize);
  assert.deepEqual(Object.keys(first.fontSize).filter(k => k.startsWith("body1")), ["body1", "body1-duplicate"]);
  assert.ok(first.warnings.some(w => w.code === "NAME_COLLISION"));
});
