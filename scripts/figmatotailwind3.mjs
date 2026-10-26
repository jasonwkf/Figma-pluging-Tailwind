#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const defaultCopyDirectory = fileURLToPath(new URL("../../zb-ui/", import.meta.url));

const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const kebab = (value) => String(value).trim().replace(/([a-z0-9])([A-Z])/g, "$1-$2")
  .replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "").toLowerCase();

function tokenParts(name) {
  const result = [];
  for (const part of String(name).split("/").map(kebab).filter(Boolean)) {
    const previous = result.at(-1);
    if (part === previous) continue;
    if (previous && part.startsWith(`${previous}-`)) result[result.length - 1] = part;
    else result.push(part);
  }
  return result;
}

function tokenName(variable) {
  const parts = tokenParts(variable.name);
  if (variable.resolvedType === "COLOR") {
    if (/^(colour|colours|color|colors)$/.test(parts[0])) parts.shift();
    return `--color-${parts.join("-") || "unnamed"}`;
  }
  const rawParts = String(variable.name).split("/").map(kebab).filter(Boolean);
  const familyCategory = rawParts[0] === "typography" ? rawParts[1] : rawParts[0];
  if (!["family", "font-family", "font"].includes(familyCategory)) return null;
  if (parts[0] === "typography") parts.shift();
  if (/^(family|font-family|font)-/.test(parts[0])) {
    return `--family-${parts.join("-").replace(/^(family|font-family|font)-/, "")}`;
  }
  if (["family", "font-family", "font"].includes(parts[0])) {
    return `--family-${parts.slice(1).join("-") || "unnamed"}`;
  }
  return null;
}

function aliasId(value) {
  return value?.type === "VARIABLE_ALIAS" ? value.id : value?.kind === "alias" ? value.aliasTo?.id : null;
}

function toJsLiteral(value, depth = 0) {
  const indent = "  ".repeat(depth);
  const childIndent = `${indent}  `;
  if (typeof value === "function") return value.toString();
  if (Array.isArray(value)) {
    return value.length ? `[\n${value.map(item => `${childIndent}${toJsLiteral(item, depth + 1)},`).join("\n")}\n${indent}]` : "[]";
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value).map(([key, item]) => {
      const safeKey = /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key)
        || (/^(0|[1-9]\d*)$/.test(key) && Number.isSafeInteger(Number(key)));
      // __proto__ must be computed to remain an own property in an object literal.
      const jsKey = key === "__proto__" ? `[${JSON.stringify(key)}]` : safeKey ? key : JSON.stringify(key);
      return `${childIndent}${jsKey}: ${toJsLiteral(item, depth + 1)},`;
    });
    return entries.length ? `{\n${entries.join("\n")}\n${indent}}` : "{}";
  }
  return JSON.stringify(value);
}

function literalCss(variable, value) {
  if (value?.kind === "color" || value?.kind === "string") value = value.value;
  if (variable.resolvedType === "COLOR") {
    if (!value || ![value.r, value.g, value.b, value.a ?? 1].every(n => typeof n === "number" && Number.isFinite(n) && n >= 0 && n <= 1)) return null;
    const rgb = [value.r, value.g, value.b].map(n => Math.round(n * 255));
    const alpha = value.a ?? 1;
    return alpha === 1 ? `#${rgb.map(n => n.toString(16).padStart(2, "0")).join("")}`
      : `rgb(${rgb.join(" ")} / ${Math.round(alpha * 1000) / 1000})`;
  }
  // A CSS string safely quotes family names including whitespace and punctuation.
  if (typeof value === "string" && value.trim()) {
    return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/[\n\r\f]/g, c => `\\${c.charCodeAt(0).toString(16)} `)}"`;
  }
  return null;
}

function buildBreakpointScreens(bundle) {
  const widths = new Set();
  for (const collection of bundle.collections) {
    if (kebab(collection.name) !== "breakpoints") continue;
    for (const variable of bundle.variables) {
      if (variable.collectionId !== collection.id || tokenParts(variable.name).at(-1) !== "page-width") continue;
      for (const mode of collection.modes) {
        const raw = variable.valuesByMode?.[mode.id];
        const value = raw?.kind === "number" ? raw.value : raw;
        if (typeof value === "number" && Number.isFinite(value)) widths.add(value);
      }
    }
  }
  return Object.fromEntries([[390, "xs"], [768, "md"], [1200, "lg"]]
    .filter(([width]) => widths.has(width))
    .map(([width, name]) => [name, `${width}px`]));
}

/** Compile the colour, family and breakpoint tokens used by a Tailwind v3 config. */
function buildTailwind3Files(bundle, { onWarning = () => {} } = {}) {
  if (!Array.isArray(bundle.collections) || !Array.isArray(bundle.variables)) {
    throw new Error("Token bundle must contain collections and variables arrays");
  }
  const collections = new Map(bundle.collections.map(c => [c.id, c]));
  const byId = new Map(bundle.variables.map(v => [v.id, v]));
  const issueKeys = new Set();
  const warn = (code, message, variable, modeId) => {
    const issue = { code, message, variableId: variable.id, collectionId: variable.collectionId, ...(modeId ? { modeId } : {}) };
    const key = JSON.stringify(issue);
    if (!issueKeys.has(key)) { issueKeys.add(key); onWarning(issue); }
  };
  const variables = bundle.variables.filter(v => v.resolvedType === "COLOR" || (v.resolvedType === "STRING" && tokenName(v)))
    .sort((a, b) => compare(collections.get(a.collectionId)?.name || "", collections.get(b.collectionId)?.name || "") || compare(a.name, b.name) || compare(a.id, b.id));
  const names = new Map();
  const used = new Set();
  for (const variable of variables) {
    const base = tokenName(variable);
    let name = base;
    if (used.has(name)) {
      const suffix = kebab(variable.key || variable.id) || "duplicate";
      name = `${base}-${suffix}`;
      let count = 2;
      while (used.has(name)) name = `${base}-${suffix}-${count++}`;
      warn("NAME_COLLISION", `Renamed ${base} to ${name}`, variable);
    }
    names.set(variable.id, name);
    used.add(name);
  }
  const defaultMode = c => c.modes.find(m => kebab(m.name) === "light")?.id || c.defaultModeId;
  function cssValue(variable, modeId, stack = new Set()) {
    const key = `${variable.id}:${modeId}`;
    if (stack.has(key)) { warn("CIRCULAR_ALIAS", "Circular alias skipped", variable, modeId); return null; }
    const value = variable.valuesByMode?.[modeId];
    if (value === undefined) { warn("MISSING_MODE_VALUE", "No value for collection mode", variable, modeId); return null; }
    const targetId = aliasId(value);
    if (targetId) {
      const target = byId.get(targetId);
      const collection = target && collections.get(target.collectionId);
      if (!target || !collection || !names.has(targetId)) {
        warn("UNRESOLVED_ALIAS", `Unavailable colour or family target: ${targetId}`, variable, modeId);
        return null;
      }
      if (target.resolvedType !== variable.resolvedType) {
        warn("UNSUPPORTED_TYPE", "Alias target has a different token type", variable, modeId);
        return null;
      }
      const sourceMode = collections.get(variable.collectionId)?.modes.find(m => m.id === modeId);
      const targetMode = collection.id === variable.collectionId ? modeId
        : collection.modes.find(m => kebab(m.name) === kebab(sourceMode?.name || ""))?.id || defaultMode(collection);
      const next = new Set(stack); next.add(key);
      return cssValue(target, targetMode, next) === null ? null : `var(${names.get(targetId)})`;
    }
    const css = literalCss(variable, value);
    if (css === null) warn("UNSUPPORTED_TYPE", "Unsupported colour or family value", variable, modeId);
    return css;
  }
  const colors = Object.create(null);
  const backgrounds = Object.create(null);
  const families = [];
  for (const variable of variables) {
    const c = collections.get(variable.collectionId);
    if (!c) { warn("MISSING_COLLECTION", "Collection not found", variable); continue; }
    if (cssValue(variable, defaultMode(c)) === null) continue;
    const name = names.get(variable.id);
    const reference = `var(${name})`;
    if (variable.resolvedType === "STRING") { families.push(reference); continue; }
    const key = name.slice("--color-".length);
    if (/^background(?:-|$)/.test(key)) {
      backgrounds[key.replace(/^background-?/, "") || "DEFAULT"] = reference;
    } else {
      const parts = tokenParts(variable.name);
      const primitive = /^(colour|colours|color|colors)$/.test(parts[0]);
      const split = key.indexOf("-");
      if (primitive && split > 0) {
        const group = key.slice(0, split);
        const shade = key.slice(split + 1);
        if (!colors[group]) colors[group] = Object.create(null);
        if (typeof colors[group] === "string") colors[group] = { DEFAULT: colors[group] };
        colors[group][shade] = reference;
      } else {
        if (colors[key] && typeof colors[key] === "object") colors[key].DEFAULT = reference;
        else colors[key] = reference;
      }
    }
  }
  const config = {
    content: ["./src/**/*.{astro,html,js,jsx,ts,tsx,vue}"],
    darkMode: "class",
    theme: {
      fontFamily: { sans: [...new Set(families), "Arial", "sans-serif"] },
      colors,
      // Extend backgroundColor so palette and semantic colours remain usable for bg-*.
      extend: { backgroundColor: backgrounds, screens: buildBreakpointScreens(bundle) }
    },
    plugins: [function ({ addVariant }) { addVariant('no-hover', '@media (hover: none)'); }]
  };
  // Validate every source mode; the config references CSS variables supplied by the app.
  for (const variable of variables) {
    const collection = collections.get(variable.collectionId);
    if (collection) for (const mode of collection.modes) cssValue(variable, mode.id);
  }
  return {
    "tailwind.config.js": `// Generated on ${new Date().toISOString()}\nexport default ${toJsLiteral(config)};\n`
  };
}

async function copyTailwind3Config(outputDirectory, destinationDirectory = defaultCopyDirectory) {
  const source = path.resolve(outputDirectory, "tailwind.config.js");
  const destination = path.resolve(destinationDirectory, "tailwind.config.js");
  if (source !== destination) {
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.copyFile(source, destination);
  }
  return destination;
}

async function main() {
  const tokenPath = path.resolve(process.argv[2] || process.env.FIGMA_VARIABLES_JSON || "tokens/figma-variables.json");
  const outputPath = path.resolve(process.argv[3] || process.env.FIGMA_TAILWIND3_OUTPUT_DIR || "tailwind3");
  const warnings = [];
  const files = buildTailwind3Files(JSON.parse(await fs.readFile(tokenPath, "utf8")), {
    onWarning: issue => warnings.push(issue)
  });
  await fs.mkdir(outputPath, { recursive: true });
  for (const [name, contents] of Object.entries(files)) await fs.writeFile(path.join(outputPath, name), contents, "utf8");
  const copiedPath = await copyTailwind3Config(outputPath);
  for (const issue of warnings) console.warn(`[${issue.code}] ${issue.message} (${issue.variableId})`);
  console.log(`Generated Tailwind v3 config in ${outputPath} (${warnings.length} warnings)`);
  console.log(`Copied Tailwind v3 config to ${copiedPath}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => { console.error(`Tailwind v3 export failed: ${error.message}`); process.exitCode = 1; });
}

export { buildTailwind3Files, copyTailwind3Config };
