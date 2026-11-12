import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { SCHOOL_FILE_KEY } from "./zbschools.mjs";

// Output contracts live here; token conversion belongs to each compiler's suite.
const cssFiles = ["base.css", "breakpoint.css", "colour-token.css", "index.css", "typography.css"];
const masterViews = ["colour-token.json", "primitives.json", "typography.json"];
const profiles = [
  {
    name: "Master v4", script: "figmatotailwind.mjs", input: "variables/figma-zb.json",
    inputEnv: "FIGMA_VARIABLES_JSON", outputEnv: "FIGMA_OUTPUT_DIR",
    output: "dist/zb/tailwind4", json: "dist/zb/tokens", views: masterViews,
    files: cssFiles, entry: "./zb/tailwind4", entryFile: "index.css",
  },
  {
    name: "Master v3", script: "figmatotailwind3.mjs", input: "variables/figma-zb.json",
    inputEnv: "FIGMA_VARIABLES_JSON", outputEnv: "FIGMA_TAILWIND3_OUTPUT_DIR",
    output: "dist/zb/tailwind3", files: ["tailwind.config.js"],
    entry: "./zb/tailwind3", entryFile: "tailwind.config.js",
  },
  {
    name: "School v4", script: "zbschools.mjs", input: "variables/figma-zbschools.json",
    inputEnv: "ZBSCHOOLS_VARIABLES_JSON", outputEnv: "ZBSCHOOLS_OUTPUT_DIR",
    output: "dist/zbschools/tailwind4", json: "dist/zbschools/tokens",
    views: [...masterViews, "breakpoints.json", "size.json"],
    files: [...cssFiles, "size.css"], entry: "./zbschools/tailwind4", entryFile: "index.css",
  },
];
const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
const outputEnvKeys = ["FIGMA_VARIABLES_JSON", "FIGMA_OUTPUT_DIR", "FIGMA_TAILWIND3_OUTPUT_DIR", "ZBSCHOOLS_VARIABLES_JSON", "ZBSCHOOLS_OUTPUT_DIR"];

function fixture(profile) {
  if (profile.script !== "zbschools.mjs") return { collections: [], variables: [], source: { complete: true } };
  const collections = ["Primitives", "Colour", "Font Size", "Size", "Breakpoints"].map((name, i) => ({
    id: `c${i}`, key: `key${i}`, name, normalizedName: name.toLowerCase().replaceAll(" ", "-"),
    defaultModeId: `m${i}`, modes: [{ id: `m${i}`, name: "Default" }], variableIds: [],
  }));
  return {
    schemaVersion: "1.0.0",
    source: {
      tool: "figma-mcp", fileKey: SCHOOL_FILE_KEY, fileName: "School fixture",
      exportedAt: "2026-11-04T00:00:00.000Z", complete: true,
      retrieval: { collectionCount: collections.length, variableCount: 0,
        collectionVariableCounts: Object.fromEntries(collections.map(c => [c.id, 0])) },
    },
    collections, variables: [], aliases: [], validation: { errors: [], warnings: [] },
  };
}

async function workspace(t) {
  const directory = await mkdtemp(path.join(tmpdir(), "zaobao-theme-paths-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

async function seed(directory, profile, relative = profile.input) {
  const target = path.join(directory, relative);
  const source = JSON.stringify(fixture(profile));
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, source);
  return { target, source };
}

function run(directory, profile, args = [], overrides = {}) {
  const env = { ...process.env };
  for (const key of outputEnvKeys) delete env[key];
  Object.assign(env, overrides);
  execFileSync(process.execPath, [fileURLToPath(new URL(profile.script, import.meta.url)), ...args], {
    cwd: directory, env, stdio: "pipe",
  });
}

async function snapshot(directory) {
  const files = {};
  async function visit(relative) {
    for (const entry of await readdir(path.join(directory, relative), { withFileTypes: true })) {
      const name = path.posix.join(relative, entry.name);
      if (entry.isDirectory()) await visit(name);
      else files[name] = await readFile(path.join(directory, name), "utf8");
    }
  }
  await visit("");
  return files;
}

async function verifyOutput(directory, profile, output = profile.output, jsonDir = profile.json) {
  // CSS 目录只包含样式文件，token 使用独立目录。
  assert.deepEqual((await readdir(path.join(directory, output))).sort(), [...profile.files].sort());
  for (const name of profile.files) assert.ok((await readFile(path.join(directory, output, name), "utf8")).length, name);
  if (profile.entryFile === "index.css") {
    const index = await readFile(path.join(directory, output, "index.css"), "utf8");
    const imports = [...index.matchAll(/@import "\.\/(.+)";/g)].map(m => m[1]);
    assert.deepEqual(imports, profile.files.filter(name => name !== "index.css"));
  }
  if (jsonDir) {
    const names = [...profile.views, ...(profile.script === "zbschools.mjs" ? ["figma-variables.json"] : [])].sort();
    assert.deepEqual((await readdir(path.join(directory, jsonDir))).sort(), names);
    for (const name of names) JSON.parse(await readFile(path.join(directory, jsonDir, name), "utf8"));
  }
}

for (const profile of profiles) {
  test(`${profile.name}: default output, JSON location and package entry match the contract`, async t => {
    const directory = await workspace(t);
    const { target, source } = await seed(directory, profile);
    run(directory, profile);
    await verifyOutput(directory, profile);
    assert.equal(pkg.exports[profile.entry], `./${profile.output}/${profile.entryFile}`);
    // 旧 ZB 入口继续指向相同产物，保证现有调用方兼容。
    if (profile.entry.startsWith("./zb/")) {
      assert.equal(pkg.exports[profile.entry.replace("./zb/", "./")], pkg.exports[profile.entry]);
    }
    assert.ok((await readFile(path.resolve(directory, pkg.exports[profile.entry]), "utf8")).length);
    // 统一使用 zbschools 命名，生成文件与各产品输入源文件隔离。
    assert.equal(await readFile(target, "utf8"), source);
    const expected = [profile.input, ...profile.files.map(name => `${profile.output}/${name}`),
      ...(profile.views || []).map(name => `${profile.json}/${name}`),
      ...(profile.script === "zbschools.mjs" ? [`${profile.json}/figma-variables.json`] : [])];
    assert.deepEqual(Object.keys(await snapshot(directory)).sort(), expected.sort());
  });

  test(`${profile.name}: input/output overrides and positional precedence stay isolated`, async t => {
    const directory = await workspace(t);
    for (const kind of ["environment", "positional"]) {
      const cwd = path.join(directory, kind);
      const { target, source } = await seed(cwd, profile, "input/source.json");
      const customOutput = profile.script === "figmatotailwind.mjs" ? "custom/zb/tailwind4" : "custom/css";
      const overrides = { [profile.inputEnv]: target, [profile.outputEnv]: customOutput };
      const args = [];
      if (kind === "positional") {
        overrides[profile.inputEnv] = "missing-input.json";
        args.push(target);
        // Master v4 通过环境变量指定输出，其上两级为产物根目录。
        if (profile.script !== "figmatotailwind.mjs") {
          overrides[profile.outputEnv] = "ignored-output";
          args.push(customOutput);
        }
      }
      run(cwd, profile, args, overrides);
      const jsonDir = profile.script === "figmatotailwind.mjs" ? "custom/zb/tokens" : profile.json;
      await verifyOutput(cwd, profile, customOutput, jsonDir);
      assert.equal(await readFile(target, "utf8"), source);
      const expected = ["input/source.json", ...profile.files.map(name => `${customOutput}/${name}`),
        ...(profile.views || []).map(name => `${jsonDir}/${name}`),
        ...(profile.script === "zbschools.mjs" ? [`${jsonDir}/figma-variables.json`] : [])];
      assert.deepEqual(Object.keys(await snapshot(cwd)).sort(), expected.sort());
    }
  });
}

test("product generation preserves all previously generated products and unrelated files", async t => {
  const directory = await workspace(t);
  for (const profile of profiles) await seed(directory, profile);
  await writeFile(path.join(directory, "keep.txt"), "unrelated file\n");
  let previous = await snapshot(directory);
  for (const profile of profiles) {
    run(directory, profile);
    await verifyOutput(directory, profile);
    const current = await snapshot(directory);
    for (const [name, content] of Object.entries(previous)) {
      assert.equal(current[name], content, `${profile.name} changed ${name}`);
    }
    previous = current;
  }
});
