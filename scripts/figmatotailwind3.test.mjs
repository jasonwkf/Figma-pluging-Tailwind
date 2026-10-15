import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { buildTailwind3Files, copyTailwind3Config } from "./figmatotailwind3.mjs";

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

test("copies the generated config and replaces the destination contents", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "tailwind3-copy-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const output = path.join(directory, "tailwind3");
  const destination = path.join(directory, "packages", "zb-ui");
  await fs.mkdir(output);
  const source = path.join(output, "tailwind.config.js");
  await fs.writeFile(source, "export default { theme: {} };\n");
  const copied = await copyTailwind3Config(output, destination);
  assert.equal(copied, path.join(destination, "tailwind.config.js"));
  assert.equal(await fs.readFile(copied, "utf8"), await fs.readFile(source, "utf8"));
  await fs.writeFile(source, "export default { theme: { extend: {} } };\n");
  await copyTailwind3Config(output, destination);
  assert.equal(await fs.readFile(copied, "utf8"), await fs.readFile(source, "utf8"));
  assert.equal(await copyTailwind3Config(output, output), source);
});
