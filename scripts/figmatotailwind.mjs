#!/usr/bin/env node

import fs from "node:fs/promises";
import { readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const desktopPath = path.join(os.homedir(), "Desktop");
const defaultOutputPath = path.resolve("tailwind");
const defaultTokenPath = path.resolve("tokens/figma-variables.json");

function loadDotEnv() {
  try {
    const contents = readFileSync(".env", "utf8");
    for (const line of contents.split(/\r?\n/)) {
      const match = line.match(/^\s*(?:export\s+)?([A-Z][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
      if (!match || process.env[match[1]]) continue;
      process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, "");
    }
  } catch (_error) {
    // Shell environment variables are also supported.
  }
}

function toTokenPath(name) {
  return String(name || "unnamed").split("/").map((segment) => segment.trim()
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "").toLowerCase()).filter(Boolean);
}

function isAlias(value) {
  return value && typeof value === "object" && value.type === "VARIABLE_ALIAS";
}

function colorToCss(color) {
  const channel = (value) => Math.max(0, Math.min(255, Math.round(value * 255)));
  const rgb = [color.r, color.g, color.b].map(channel);
  const alpha = typeof color.a === "number" ? color.a : 1;
  if (alpha >= 1) return `#${rgb.map((value) => value.toString(16).padStart(2, "0")).join("")}`;
  return `rgb(${rgb.join(" ")} / ${Math.round(alpha * 1000) / 1000})`;
}

function cssName(variable) {
  const rawParts = toTokenPath(variable.name);
  const parts = normalizeCssSegments(rawParts);
  const category = rawParts[0];
  const rest = normalizeCssSegments(rawParts.slice(1));
  const last = rest.at(-1) || "unnamed";
  const stripPrefix = (value, prefix) => value.startsWith(`${prefix}-`) ? value.slice(prefix.length + 1) : value;

  if (variable.resolvedType === "COLOR") return `--color-${rest.join("-") || "unnamed"}`;
  if (["spacing", "space", "gap", "spacings", "spaces", "gaps"].includes(category)) {
    return `--spacing-${stripPrefix(last, "spacing") || "unnamed"}`;
  }
  if (category === "border" || category === "radius" || category === "border-radius") {
    if (last.startsWith("border-radius-")) return `--border-radius-${last.slice("border-radius-".length)}`;
    return `--border-${stripPrefix(last, "border") || "unnamed"}`;
  }
  if (category === "size") return `--size-${stripPrefix(last, "size") || "unnamed"}`;
  if (["font", "font-family", "family"].includes(category)) return `--font-${stripPrefix(last, "font") || "unnamed"}`;
  if (["typography", "type"].includes(category)) {
    const typographyCategory = rest[0];
    const namespaces = { "letter-spacing": "letter-spacing", "line-height": "line-height", family: "family", weight: "font-weight" };
    const namespace = namespaces[typographyCategory];
    if (namespace) return `--${namespace}-${stripPrefix(last, namespace) || "unnamed"}`;
    return `--type-${rest.slice(1).join("-") || "unnamed"}`;
  }
  return `--token-${parts.join("-") || "unnamed"}`;
}

function normalizeCssSegments(parts) {
  const normalized = [];
  for (const part of parts) {
    const current = part.split("-").filter(Boolean);
    if (!current.length) continue;
    const previous = normalized.at(-1);
    if (previous && current.length === 1 && previous === current[0]) continue;
    if (previous && current.length > 1 && current[0] === previous) {
      normalized[normalized.length - 1] = current.join("-");
      continue;
    }
    normalized.push(current.join("-"));
  }
  return normalized;
}

function valueToCss(variable, value, variablesById) {
  if (isAlias(value)) {
    const target = variablesById[value.id];
    return target ? `var(${cssName(target)})` : null;
  }
  if (variable.resolvedType === "COLOR" && value && typeof value.r === "number") return colorToCss(value);
  if (typeof value === "number" && Number.isFinite(value)) {
    if (value === 0) return "0";
    const parts = toTokenPath(variable.name);
    if (parts.includes("font-weight") || (parts.includes("line-height") && value <= 10)) return String(value);
    return `${value}px`;
  }
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "string" && value.trim()) return value.includes(" ") ? `"${value.replaceAll('"', '\\"')}"` : value;
  return null;
}

async function fetchFigmaVariables(fileKey, token) {
  const url = `https://api.figma.com/v1/files/${encodeURIComponent(fileKey)}/variables/local`;
  const response = await fetch(url, { headers: { "X-Figma-Token": token } });
  const body = await response.json();
  if (!response.ok || body.error) throw new Error(body.message || `Figma API request failed (${response.status}).`);
  return {
    variables: Object.values(body.meta?.variables || {}),
    collections: Object.values(body.meta?.variableCollections || {}),
  };
}

function getFigmaFileKey(figmaUrl) {
  let parsedUrl;
  try {
    parsedUrl = new URL(figmaUrl);
  } catch (_error) {
    throw new Error(`Invalid Figma URL: ${figmaUrl}`);
  }

  const match = parsedUrl.pathname.match(/^\/design\/([^/]+)/);
  if (!match) {
    throw new Error("Figma URL must use the /design/:fileKey/... format.");
  }
  return decodeURIComponent(match[1]);
}

/**
 * Fetch local variables as JSON from a Figma design URL.
 *
 * The URL may include a node-id, but variables are fetched at file scope, so
 * the node-id is intentionally ignored.
 */
async function fetchFigmaVariablesFromUrl(figmaUrl, token) {
  const fileKey = getFigmaFileKey(figmaUrl);
  const data = await fetchFigmaVariables(fileKey, token);
  return { ...data, fileKey, sourceUrl: figmaUrl };
}

function makeUniqueName(name, variable, usedNames) {
  if (!usedNames[name]) { usedNames[name] = 1; return name; }
  usedNames[name] += 1;
  const suffix = toTokenPath(variable.key || variable.id).join("-").slice(0, 16) || usedNames[name];
  return `${name}-${suffix}`;
}

function buildArtifacts(collections, variables, variablesById) {
  const theme = [];
  const colors = [];
  const utilities = new Map();
  const usedNames = {};
  const collectionById = Object.fromEntries(collections.map((collection) => [collection.id, collection]));

  for (const variable of [...variables].sort((a, b) => a.name.localeCompare(b.name))) {
    const collection = collectionById[variable.variableCollectionId];
    if (!collection) continue;
    const value = variable.valuesByMode?.[collection.defaultModeId];
    const cssValue = valueToCss(variable, value, variablesById);
    if (!cssValue) continue;
    const name = makeUniqueName(cssName(variable), variable, usedNames);
    const parts = toTokenPath(variable.name);
    const isTypography = parts.includes("typography") || parts.includes("type");
    if (variable.resolvedType === "COLOR") colors.push(`  ${name}: ${cssValue};`);
    else theme.push(`  ${name}: ${cssValue};`);

    const properties = { "font-family": "font-family", "font-size": "font-size", "line-height": "line-height", "font-weight": "font-weight", "letter-spacing": "letter-spacing", "text-case": "text-transform", "text-transform": "text-transform" };
    const property = isTypography ? properties[parts.at(-1)] : null;
    if (property) {
      const selector = `.type-${parts.slice(1, -1).join("-") || "unnamed"}`;
      if (!utilities.has(selector)) utilities.set(selector, []);
      utilities.get(selector).push(`    ${property}: ${cssValue};`);
    }
  }

  const header = "/* Generated from Figma Variables REST API */\n\n";
  const baseCss = `${header}@theme {\n${theme.join("\n")}\n}\n`;
  const colorTokensCss = `${header}@theme {\n${colors.join("\n")}\n}\n`;
  const typographyCss = `${header}@layer utilities {\n${[...utilities].map(([selector, declarations]) => `  ${selector} {\n${declarations.join("\n")}\n  }`).join("\n\n")}\n}\n`;
  const indexCss = `${header}:root {\n${[...theme, ...colors].join("\n")}\n}\n`;
  const tailwindConfig = `/** Generated from Figma Variables REST API */\nmodule.exports = {\n  theme: { extend: {} }\n};\n`;
  return { baseCss, colorTokensCss, typographyCss, indexCss, tailwindConfig };
}

function round(value, digits = 4) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function numberToTailwindCss(variable, value) {
  if (value === 0) return "0";
  const parts = toTokenPath(variable.name);
  if (parts.includes("font-weight") || parts.includes("weight")) return String(value);
  if (parts.includes("line-height")) return `${round(value)}%`;
  if (parts.includes("opacity") || parts.includes("percent") || parts.includes("percentage")) return `${round(value)}%`;
  if (parts.includes("duration") || parts.includes("delay") || parts.includes("millisecond")) return `${round(value)}ms`;
  return `${round(value)}px`;
}

function valueToTailwindCss(variable, value, variablesById, cssNames) {
  if (isAlias(value)) {
    const target = variablesById[value.id];
    return target ? `var(${cssNames.get(target.id) || cssName(target)})` : null;
  }
  if (variable.resolvedType === "COLOR" && value && typeof value.r === "number") return colorToCss(value);
  if (typeof value === "number" && Number.isFinite(value)) return numberToTailwindCss(variable, value);
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "string" && value.trim()) return value.includes(" ") ? `"${value.replaceAll('"', '\\"')}"` : value;
  return null;
}

function buildTailwindFiles(bundle) {
  const { collections, variables } = bundle;
  const variablesById = Object.fromEntries(variables.map((variable) => [variable.id, variable]));
  const usedNames = {};
  const cssNames = new Map();
  for (const variable of [...variables].sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id))) {
    cssNames.set(variable.id, makeUniqueName(cssName(variable), variable, usedNames));
  }

  const declarationsForMode = (collection, modeId) => variables
    .filter((variable) => variable.collectionId === collection.id)
    .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id))
    .map((variable) => {
      const value = variable.valuesByMode?.[modeId];
      const cssValue = valueToTailwindCss(variable, value, variablesById, cssNames);
      return cssValue ? `  ${cssNames.get(variable.id)}: ${cssValue};` : null;
    })
    .filter(Boolean);

  const themeBlocks = [];
  for (const collection of [...collections].sort((a, b) => a.name.localeCompare(b.name))) {
    for (const mode of collection.modes) {
      const declarations = declarationsForMode(collection, mode.id);
      if (!declarations.length) continue;
      const isDefault = mode.id === collection.defaultModeId;
      const selector = `[data-${collection.normalizedName}-mode="${mode.normalizedName}"]`;
      themeBlocks.push(`${isDefault ? "@theme" : selector} {\n${declarations.join("\n")}\n}`);
    }
  }

  const typographyGroups = new Map();
  const typographyProperties = {
    "font-family": "font-family", "font-size": "font-size", "line-height": "line-height",
    "font-weight": "font-weight", "letter-spacing": "letter-spacing", "text-case": "text-transform",
    "text-transform": "text-transform", "paragraph-indent": "text-indent"
  };
  for (const variable of variables) {
    const parts = toTokenPath(variable.name);
    const property = typographyProperties[parts.at(-1)];
    const typographyIndex = parts.findIndex((part) => ["typography", "type"].includes(part));
    if (!property || typographyIndex < 0 || parts.length < typographyIndex + 2) continue;
    const selector = `.type-${parts.slice(typographyIndex + 1, -1).join("-") || "unnamed"}`;
    if (!typographyGroups.has(selector)) typographyGroups.set(selector, []);
    const collection = collections.find((item) => item.id === variable.collectionId);
    const value = collection && variable.valuesByMode?.[collection.defaultModeId];
    const cssValue = valueToTailwindCss(variable, value, variablesById, cssNames);
    if (cssValue) typographyGroups.get(selector).push(`    ${property}: ${cssValue};`);
  }

  const header = "/* Generated from tokens/figma-variables.json via Figma MCP */\n\n";
  const tokensCss = `${header}@import "tailwindcss";\n\n${themeBlocks.join("\n\n")}\n\n@layer utilities {\n${[...typographyGroups].map(([selector, declarations]) => `  ${selector} {\n${declarations.join("\n")}\n  }`).join("\n\n")}\n}\n`;
  const themeCss = `${header}@theme {\n${themeBlocks.filter((block) => block.startsWith("@theme")).flatMap((block) => block.split("\n").slice(1, -1)).join("\n")}\n}\n`;
  const utilitiesCss = `${header}@layer utilities {\n${[...typographyGroups].map(([selector, declarations]) => `  ${selector} {\n${declarations.join("\n")}\n  }`).join("\n\n")}\n}\n`;
  const primitiveCollection = collections.find((collection) => collection.name.toLowerCase() === "primitives");
  const primitiveVariables = primitiveCollection ? variables.filter((variable) => variable.collectionId === primitiveCollection.id) : [];
  const primitiveBundle = {
    ...bundle,
    collections: primitiveCollection ? [primitiveCollection] : [],
    variables: primitiveVariables,
    aliases: (bundle.aliases || []).filter((alias) => primitiveVariables.some((variable) => variable.id === alias.fromVariableId))
  };
  const primitiveUsedNames = {};
  const primitiveNames = new Map(primitiveVariables
    .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id))
    .map((variable) => [variable.id, makeUniqueName(cssName(variable), variable, primitiveUsedNames)]));
  const primitiveDeclarations = primitiveVariables
    .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id))
    .map((variable) => {
      const value = variable.valuesByMode?.[primitiveCollection.defaultModeId];
      const cssValue = valueToTailwindCss(variable, value, variablesById, new Map([...cssNames, ...primitiveNames]));
      return cssValue ? `  ${primitiveNames.get(variable.id)}: ${cssValue};` : null;
    })
    .filter(Boolean);
  const baseCss = `${header}@theme {\n${primitiveDeclarations.join("\n")}\n}\n`;

  return {
    "tokens/figma-tokens.json": JSON.stringify(bundle, null, 2),
    "tokens/collections.json": JSON.stringify(collections, null, 2),
    "tokens/variables.json": JSON.stringify(variables, null, 2),
    "tokens/primitives.json": JSON.stringify(primitiveBundle, null, 2),
    "tokens/aliases.json": JSON.stringify(bundle.aliases || [], null, 2),
    "tokens/validation.json": JSON.stringify(bundle.validation || { errors: [], warnings: [] }, null, 2),
    "tailwind/tokens.css": tokensCss,
    "tailwind/tokens.theme.css": themeCss,
    "tailwind/tokens.utilities.css": utilitiesCss,
    "tailwind/base.css": baseCss
  };
}

function createTokenBundle(collections, source = {}) {
  return {
    schemaVersion: "1.0.0",
    source: {
      tool: "figma-mcp",
      ...source,
      exportedAt: source.exportedAt || new Date().toISOString()
    },
    collections: [...collections],
    variables: [],
    aliases: [],
    validation: { errors: [], warnings: [] }
  };
}

function mergeVariableBatch(bundle, batch) {
  const variablesById = new Map(bundle.variables.map((variable) => [variable.id, variable]));
  for (const variable of batch) {
    if (!variable?.id) continue;
    variablesById.set(variable.id, variable);
  }
  bundle.variables = [...variablesById.values()].sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  bundle.aliases = bundle.variables.flatMap((variable) => Object.entries(variable.valuesByMode || {})
    .filter(([, value]) => isAlias(value))
    .map(([modeId, value]) => ({
      fromVariableId: variable.id,
      fromModeId: modeId,
      toVariableId: value.id
    })));
  return bundle;
}

/**
 * Assemble a token JSON file from batches. `batches` can be an array or an
 * async iterable, so callers can yield each Figma MCP response as it arrives.
 * The file is checkpointed after every batch and is always valid JSON.
 */
async function writeTokenBundleInBatches({ collections, batches, outputPath = defaultTokenPath, source = {} }) {
  const bundle = createTokenBundle(collections, source);
  const target = path.resolve(outputPath);
  await fs.mkdir(path.dirname(target), { recursive: true });
  let batchCount = 0;
  for await (const batch of batches) {
    mergeVariableBatch(bundle, batch);
    batchCount += 1;
    await fs.writeFile(target, JSON.stringify(bundle, null, 2), "utf8");
  }
  return { outputPath: target, batchCount, variableCount: bundle.variables.length, aliasCount: bundle.aliases.length };
}

async function main() {
  loadDotEnv();
  const token = process.env.FIGMA_TOKEN;
  const fileKey = process.env.FIGMA_FILE_KEY;
  const fileUrl = process.env.FIGMA_FILE_URL;
  const tokenPath = path.resolve(process.argv[2] || process.env.FIGMA_VARIABLES_JSON || defaultTokenPath);
  const outputPath = path.resolve(process.env.FIGMA_OUTPUT_DIR || defaultOutputPath);
  let bundle;
  if (token && (fileUrl || fileKey) && process.env.FIGMA_REFRESH === "true") {
    const raw = fileUrl ? await fetchFigmaVariablesFromUrl(fileUrl, token) : await fetchFigmaVariables(fileKey, token);
    bundle = { ...raw, schemaVersion: "1.0.0", source: { tool: "figma-rest-variables", fileKey: raw.fileKey || fileKey, fileUrl: raw.sourceUrl || fileUrl, exportedAt: new Date().toISOString() }, aliases: [], validation: { errors: [], warnings: [] } };
    await fs.mkdir(path.dirname(tokenPath), { recursive: true });
    await fs.writeFile(tokenPath, JSON.stringify(bundle, null, 2), "utf8");
  } else {
    bundle = JSON.parse(await fs.readFile(tokenPath, "utf8"));
  }
  const files = buildTailwindFiles(bundle);
  await Promise.all(Object.entries(files).map(async ([fileName, contents]) => {
    const target = path.join(path.dirname(outputPath), fileName);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, contents, "utf8");
  }));
  console.log(`Processed ${bundle.variables.length} variables from ${tokenPath} into Tailwind files under ${path.dirname(outputPath)}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => { console.error(`\nTailwind export failed: ${error.message}`); process.exitCode = 1; });
}

export { buildTailwindFiles, createTokenBundle, mergeVariableBatch, writeTokenBundleInBatches };
