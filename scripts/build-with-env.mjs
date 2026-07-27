import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

function parseEnv(envText) {
  const result = {};
  const lines = envText.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const idx = trimmed.indexOf("=");
    if (idx === -1) continue;
    const key = trimmed.slice(0, idx).trim();
    const value = trimmed.slice(idx + 1).trim();
    result[key] = value;
  }
  return result;
}

function escapeForTsStringLiteral(value) {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\r/g, "\\r")
    .replace(/\n/g, "\\n")
    .replace(/\t/g, "\\t");
}

const repoRoot = process.cwd();
const envPath = path.join(repoRoot, ".env");
const codeTsPath = path.join(repoRoot, "code.ts");

const tscArgs = process.argv.slice(2);

let originalCodeTs = null;
let didInject = false;
let tscExitCode = 1;

try {
  if (fs.existsSync(envPath) && fs.existsSync(codeTsPath)) {
    const envText = fs.readFileSync(envPath, "utf8");
    const env = parseEnv(envText);
    const apiKey = env.GOOGLE_TRANSLATE_API_KEY;

    if (apiKey && apiKey.trim()) {
      originalCodeTs = fs.readFileSync(codeTsPath, "utf8");
      const escaped = escapeForTsStringLiteral(apiKey.trim());

      const injectedCodeTs = originalCodeTs.replace(
        "__GOOGLE_TRANSLATE_API_KEY__",
        escaped
      );

      if (injectedCodeTs !== originalCodeTs) {
        fs.writeFileSync(codeTsPath, injectedCodeTs, "utf8");
        didInject = true;
        console.log(
          "[build-with-env] Injected GOOGLE_TRANSLATE_API_KEY into code.ts for this build."
        );
      }
    }
  }

  const tscPath = path.join(repoRoot, "node_modules", ".bin", "tsc");
  const result = spawnSync(
    tscPath,
    ["-p", "tsconfig.json", ...tscArgs],
    { stdio: "inherit", shell: false }
  );
  tscExitCode = result.status ?? 1;
} finally {
  if (didInject && originalCodeTs != null) {
    fs.writeFileSync(codeTsPath, originalCodeTs, "utf8");
    console.log("[build-with-env] Restored code.ts after build.");
  }
}

if (tscExitCode !== 0) {
  process.exit(tscExitCode);
}

