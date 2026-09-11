#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const defaultOutputPath = path.resolve("tailwind");
const defaultTokenPath = path.resolve("tokens/figma-variables.json");

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


function makeUniqueName(name, variable, usedNames) {
  if (!usedNames[name]) { usedNames[name] = 1; return name; }
  usedNames[name] += 1;
  const suffix = toTokenPath(variable.key || variable.id).join("-").slice(0, 16) || usedNames[name];
  return `${name}-${suffix}`;
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
  const header = "/* Generated from tokens/figma-variables.json via Figma MCP */\n\n";
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
  const colours = buildColourTokenFiles(bundle, cssNames, variablesById, header);
  const typography = buildTypographyFiles(bundle, cssNames, variablesById, header);

  return {
    "tokens/primitives.json": JSON.stringify(primitiveBundle, null, 2),
    "tailwind/base.css": baseCss,
    ...colours,
    ...typography
  };
}

function buildColourTokenFiles(bundle, cssNames, variablesById, header = "") {
  const collection = bundle.collections.find((item) => item.name.toLowerCase() === "colours" || item.name.toLowerCase() === "colors");
  const variables = collection
    ? bundle.variables.filter((variable) => variable.collectionId === collection.id).sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id))
    : [];
  const colourBundle = {
    ...bundle,
    collections: collection ? [collection] : [],
    variables,
    aliases: (bundle.aliases || []).filter((alias) => variables.some((variable) => variable.id === alias.fromVariableId))
  };
  const declarations = variables.map((variable) => {
    const value = variable.valuesByMode?.[collection.defaultModeId];
    const cssValue = valueToTailwindCss(variable, value, variablesById, cssNames);
    return cssValue ? `  ${cssNames.get(variable.id)}: ${cssValue};` : null;
  }).filter(Boolean);
  const css = `${header}@theme {\n${declarations.join("\n")}\n}\n`;
  return {
    "tokens/colour-token.json": JSON.stringify(colourBundle, null, 2),
    "tailwind/colour-token.css": css
  };
}

function buildTypographyFiles(bundle, cssNames, variablesById, header = "") {
  const collection = bundle.collections.find((item) => item.name.toLowerCase() === "font adjustment");
  const variables = collection
    ? bundle.variables.filter((variable) => variable.collectionId === collection.id).sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id))
    : [];
  const typographyBundle = {
    ...bundle,
    collections: collection ? [collection] : [],
    variables,
    aliases: (bundle.aliases || []).filter((alias) => variables.some((variable) => variable.id === alias.fromVariableId))
  };
  const primitiveVariables = bundle.variables.filter((variable) => bundle.collections.find((item) => item.name.toLowerCase() === "primitives")?.id === variable.collectionId);
  const primitiveValueReference = (tokenPrefix, value) => {
    const normalizedValue = String(value).toLowerCase();
    const expectedSuffix = `/${normalizedValue.startsWith(`${tokenPrefix}-`) ? normalizedValue : `${tokenPrefix}-${normalizedValue}`}`;
    const match = primitiveVariables.find((variable) => variable.name.toLowerCase().endsWith(expectedSuffix));
    return match ? `var(${cssNames.get(match.id) || cssName(match)})` : `${value}px`;
  };
  const styles = {
    body: ["line-height-md", "font-weight-regular", "letter-spacing-sm"],
    button: ["line-height-sm", "font-weight-medium", "letter-spacing-md"],
    display: ["line-height-sm", "font-weight-medium", "letter-spacing-none"],
    header: ["line-height-sm", "font-weight-medium", "letter-spacing-none"],
    label: ["line-height-sm", "font-weight-regular", "letter-spacing-none"],
    subheader: ["line-height-sm", "font-weight-medium", "letter-spacing-sm"]
  };
  const overrides = {
    "body 2": ["line-height-sm", "font-weight-regular", "letter-spacing-none"],
    "button 2": ["line-height-sm", "font-weight-regular", "letter-spacing-md"],
    "button 3": ["line-height-sm", "font-weight-medium", "letter-spacing-none"],
    "button 4": ["line-height-sm", "font-weight-medium", "letter-spacing-md"],
    "header 3": ["line-height-sm", "font-weight-regular", "letter-spacing-none"],
    "label 1": ["line-height-sm", "font-weight-medium", "letter-spacing-md"],
    "label 3": ["line-height-sm", "font-weight-medium", "letter-spacing-none"],
    "label 5": ["line-height-sm", "font-weight-medium", "letter-spacing-none"],
    "label 7": ["line-height-sm", "font-weight-medium", "letter-spacing-md"],
    "label 8": ["line-height-sm", "font-weight-regular", "letter-spacing-md"],
    "label 9": ["line-height-sm", "font-weight-medium", "letter-spacing-none"],
    "subheader 1": ["line-height-sm", "font-weight-light", "letter-spacing-none"],
    "subheader 2": ["line-height-md", "font-weight-medium", "letter-spacing-sm"],
    "subheader 3": ["line-height-sm", "font-weight-medium", "letter-spacing-sm"]
  };
  const utilityBlocks = variables.map((variable) => {
    const value = variable.valuesByMode?.[collection.defaultModeId];
    if (typeof value !== "number") return null;
    const name = variable.name.trim();
    const key = name.toLowerCase();
    const family = key.split(" ")[0];
    const [lineHeight, weight, letterSpacing] = overrides[key] || styles[family] || styles.label;
    const className = `text-${toTokenPath(name).join("").replace(/-(?=\d)/g, "").replace(/[^a-z0-9-]/g, "")}`;
    return `@utility ${className} {\n    font-size: ${primitiveValueReference("size", value)};\n    line-height: ${primitiveValueReference("line-height", lineHeight)};\n    font-weight: ${primitiveValueReference("font-weight", weight)};\n    letter-spacing: ${primitiveValueReference("letter-spacing", letterSpacing)};\n}`;
  }).filter(Boolean);
  const css = `${header}${utilityBlocks.join("\n\n")}\n`;
  return {
    "tokens/typography.json": JSON.stringify(typographyBundle, null, 2),
    "tailwind/typography.css": css
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
  const tokenPath = path.resolve(process.argv[2] || process.env.FIGMA_VARIABLES_JSON || defaultTokenPath);
  const outputPath = path.resolve(process.env.FIGMA_OUTPUT_DIR || defaultOutputPath);
  const bundle = JSON.parse(await fs.readFile(tokenPath, "utf8"));
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
