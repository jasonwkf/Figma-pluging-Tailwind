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
