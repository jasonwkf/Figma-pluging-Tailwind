import assert from "node:assert/strict";
import fs from "node:fs/promises";
import vm from "node:vm";
import test from "node:test";
import { buildTailwind3Files as compile } from "./figmatotailwind3.mjs";

const validations = new WeakMap();
function buildTailwind3Files(bundle) {
  const warnings = [];
  const files = compile(bundle, { onWarning: issue => warnings.push(issue) });
  validations.set(files, { errors: [], warnings });
  return files;
}
const validationOf = files => validations.get(files);

const collection = { id: "c", name: "Colours", defaultModeId: "light", modes: [{ id: "light", name: "Light" }, { id: "dark", name: "Dark" }] };
const color = (id, name, values, key = id) => ({ id, key, name, collectionId: "c", resolvedType: "COLOR", valuesByMode: values });
const red = { r: 1, g: 0, b: 0, a: 1 };
const alias = id => ({ type: "VARIABLE_ALIAS", id });
const bundle = variables => ({ collections: [collection], variables });
const configOf = files => {
  const context = { module: { exports: {} } };
  vm.runInNewContext(files["tailwind.config.js"], context);
  return JSON.parse(JSON.stringify(context.module.exports));
};

test("groups palettes, collapses repeated segments, and extends background colours", () => {
  const files = buildTailwind3Files(bundle([
    color("p", "Colour / Red / red-500", { light: red, dark: red }),
    color("s", "Button/button-primary-default", { light: alias("p"), dark: alias("p") }),
    color("b", "Background/background-primary", { light: alias("p"), dark: alias("s") })
  ]));
  const config = configOf(files);
  assert.equal(config.darkMode, "class");
  assert.equal(config.theme.colors.red[500], "var(--color-red-500)");
  assert.equal(config.theme.colors["button-primary-default"], "var(--color-button-primary-default)");
  assert.equal(config.theme.extend.backgroundColor.primary, "var(--color-background-primary)");
  assert.match(files["tailwind.config.js"], /\n  content:/);
  assert.match(files["tailwind.config.js"], /\n      red: \{/);
  assert.match(files["tailwind.config.js"], /\n        500:/);
  assert.match(files["tailwind.config.js"], /"button-primary-default":/);
  assert.doesNotMatch(files["tailwind.config.js"], /"(?:content|theme|colors|red|500)":/);
});

test("accepts typed values and alpha zero", () => {
  const family = { id: "f", name: "Typography/Family/family-noto-sans", collectionId: "c", resolvedType: "STRING", valuesByMode: { light: { kind: "string", value: 'Noto "Sans"' }, dark: "Noto Sans" } };
  const files = buildTailwind3Files(bundle([family, color("p", "Color/Red/500", { light: { kind: "color", value: { ...red, a: 0 } }, dark: red })]));
  assert.deepEqual(configOf(files).theme.fontFamily.sans, ["var(--family-noto-sans)", "Arial", "sans-serif"]);
  assert.deepEqual(validationOf(files).warnings, []);
});

test("warns and skips missing aliases, cycles, and missing mode values", () => {
  const files = buildTailwind3Files(bundle([
    color("a", "Color/A", { light: alias("b"), dark: alias("b") }),
    color("b", "Color/B", { light: alias("a"), dark: alias("a") }),
    color("missing", "Color/Missing", { light: alias("deleted") }),
    color("partial", "Color/Partial", { light: red })
  ]));
  const codes = validationOf(files).warnings.map(w => w.code);
  for (const code of ["CIRCULAR_ALIAS", "UNRESOLVED_ALIAS", "MISSING_MODE_VALUE"]) assert.ok(codes.includes(code));
  assert.equal(configOf(files).theme.colors.missing, undefined);
});

test("preserves colliding tokens even when keys share a prefix and is deterministic", () => {
  const variables = ["abcdefghijklmnopX", "abcdefghijklmnopY", "abcdefghijklmnopZ"].map((key, i) => color(String(i), "Color/Red/500", { light: red, dark: red }, key));
  const files = buildTailwind3Files(bundle(variables));
  assert.equal(Object.keys(configOf(files).theme.colors.red).length, 3);
  assert.equal(validationOf(files).warnings.filter(w => w.code === "NAME_COLLISION").length, 2);
  assert.deepEqual(buildTailwind3Files(bundle([...variables].reverse())), files);
});

test("validates aliases across collections and modes", () => {
  const p = { ...collection, id: "p", name: "Primitives", defaultModeId: "p-default", modes: [{ id: "p-default", name: "Mode 1" }] };
  const files = buildTailwind3Files({ collections: [collection, p], variables: [
    { ...color("p1", "Colour/Red/red-500", { "p-default": red }), collectionId: "p" },
    color("s", "Button/button-primary", { light: alias("p1"), dark: alias("p1") })
  ] });
  assert.deepEqual(validationOf(files).warnings, []);
});

test("current bundle emits loadable config without CSS and no warnings", async () => {
  const source = JSON.parse(await fs.readFile(new URL("../tokens/figma-variables.json", import.meta.url), "utf8"));
  const files = buildTailwind3Files(source);
  const config = configOf(files);
  assert.deepEqual(Object.keys(files).sort(), ["tailwind.config.js"]);
  assert.equal(config.theme.colors.red[500], "var(--color-red-500)");
  assert.ok(config.theme.extend.backgroundColor.primary);
  assert.deepEqual(config.theme.fontFamily.sans, ["var(--family-noto-sans)", "var(--family-noto-sans-sc)", "var(--family-nunito)", "Arial", "sans-serif"]);
  assert.deepEqual(validationOf(files), { errors: [], warnings: [] });
});

test("empty bundle produces usable fallbacks", () => {
  const config = configOf(buildTailwind3Files({ collections: [], variables: [] }));
  assert.deepEqual(config.theme.fontFamily.sans, ["Arial", "sans-serif"]);
});
