#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createHash } from "node:crypto";

export const SCHOOL_FILE_KEY = "MEN3cpvdA1YxUi29dHnHsc";
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const slug = (value) => String(value).replace(/([a-z0-9])([A-Z])/g, "$1-$2")
  .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
const alias = (value) => value?.type === "VARIABLE_ALIAS";
const round = (value) => String(Math.round(value * 10000) / 10000);
const json = (value) => JSON.stringify(value, null, 2) + "\n";
const ordered = (items) => [...items].sort((a, b) => compare(a.name, b.name) || compare(a.id, b.id));

function normalizedPath(name) {
  const result = [];
  for (const part of String(name).split("/").map(slug).filter(Boolean)) {
    const previous = result.at(-1);
    if (part === previous) continue;
    if (previous && part.startsWith(previous + "-")) result[result.length - 1] = part;
    else result.push(part);
  }
  return result.join("-");
}

function tokenName(variable, collection) {
  const name = normalizedPath(variable.name);
  if (variable.resolvedType === "COLOR") return "--color-" + name.replace(/^colou?rs?-/, "");
  if (slug(collection.name) === "font-size") return "--text-" + name.replace(/-(?=\d)/g, "");
  if (slug(collection.name) === "size") {
    if (/(^|-)opacity(-|$)/.test(name)) return "--" + name;
    return "--spacing-" + name.replace(/^spacing-/, "");
  }
  const prefixes = [
    [/^typography-family-/, "family-"], [/^typography-weight-/, ""],
    [/^typography-letter-spacing-/, "letter-spacing-"], [/^typography-line-height-/, "line-height-"],
  ];
  for (const [pattern, replacement] of prefixes) if (pattern.test(name)) return "--" + name.replace(pattern, replacement);
  return "--" + (/^(size|spacing|border)-/.test(name) ? name : "token-" + name);
}

function numericUnit(variable) {
  const name = normalizedPath(variable.name);
  if (/font-weight|typography-weight/.test(name)) return "";
  if (/line-height|(^|-)opacity(-|$)|percentage/.test(name)) return "%";
  if (/(^|-)(duration|delay)(-|$)/.test(name)) return "ms";
  return "px";
}

// Includes the nested colour/opacity aliases returned by School's MCP export.
export function schoolAliases(variables) {
  const result = [];
  function visit(value, variableId, modeId, valuePath) {
    if (alias(value)) result.push({ fromVariableId: variableId, fromModeId: modeId, toVariableId: value.id, ...(valuePath ? { valuePath } : {}) });
    else if (value && typeof value === "object") for (const [key, child] of Object.entries(value)) visit(child, variableId, modeId, valuePath ? `${valuePath}.${key}` : key);
  }
  for (const variable of ordered(variables)) for (const [modeId, value] of Object.entries(variable.valuesByMode || {})) visit(value, variable.id, modeId, "");
  return result;
}

function context(bundle, warnings) {
  const collections = new Map(bundle.collections.map(c => [c.id, c]));
  const variables = new Map(bundle.variables.map(v => [v.id, v]));
  const names = new Map();
  const used = new Set();
  for (const variable of ordered(bundle.variables)) {
    const base = tokenName(variable, collections.get(variable.collectionId));
    let name = base;
    let suffix = 0;
    while (used.has(name)) name = `${base}-${createHash("sha256").update(variable.id).digest("hex").slice(0, 12)}${suffix++ ? `-${suffix}` : ""}`;
    if (name !== base) warnings.push({ code: "NAME_COLLISION", variableId: variable.id, name: base, emittedName: name });
    used.add(name);
    names.set(variable.id, name);
  }
  function targetMode(sourceCollection, sourceMode, targetCollection) {
    if (sourceCollection.id === targetCollection.id) return sourceMode;
    const name = slug(sourceCollection.modes.find(m => m.id === sourceMode)?.name || "");
    return targetCollection.modes.find(m => slug(m.name) === name)?.id || targetCollection.defaultModeId;
  }
  function resolve(value, type, collection, modeId, seen = new Set()) {
    if (alias(value)) {
      const target = variables.get(value.id);
      if (!target) throw new Error(`UNRESOLVED_ALIAS: ${value.id}`);
      if (target.resolvedType !== type) throw new Error(`UNSUPPORTED_TYPE: alias ${value.id} expects ${type}`);
      const tc = collections.get(target.collectionId);
      const tm = targetMode(collection, modeId, tc);
      const key = `${target.id}@${tm}`;
      if (seen.has(key)) throw new Error(`CIRCULAR_ALIAS: ${key}`);
      return resolve(target.valuesByMode?.[tm], type, tc, tm, new Set([...seen, key]));
    }
    if (type === "COLOR") {
      if (value?.color && value.opacity !== undefined) {
        const color = resolve(value.color, "COLOR", collection, modeId, seen);
        const opacity = resolve(value.opacity, "FLOAT", collection, modeId, seen);
        if (opacity < 0 || opacity > 100) throw new Error("UNSUPPORTED_TYPE: opacity must be a percentage between 0 and 100");
        return { ...color, a: (color.a ?? 1) * opacity / 100 };
      }
      if (value && [value.r, value.g, value.b, value.a ?? 1].every(n => typeof n === "number" && Number.isFinite(n) && n >= 0 && n <= 1)) return value;
    } else if ((type === "FLOAT" && typeof value === "number" && Number.isFinite(value)) ||
      (type === "STRING" && typeof value === "string") || (type === "BOOLEAN" && typeof value === "boolean")) return value;
    throw new Error(`UNSUPPORTED_TYPE: invalid ${type} value`);
  }
  function css(variable, collection, modeId) {
    const raw = variable.valuesByMode[modeId];
    const value = resolve(raw, variable.resolvedType, collection, modeId);
    if (alias(raw)) {
      const target = variables.get(raw.id);
      const tc = collections.get(target.collectionId);
      const tm = targetMode(collection, modeId, tc);
      // Numeric aliases must carry the receiving token's unit (e.g. opacity -> size).
      // A source mode cannot activate a different collection's mode selector.
      const modeSafe = tc.id === collection.id || tm === tc.defaultModeId;
      if (modeSafe && (variable.resolvedType !== "FLOAT" || numericUnit(variable) === numericUnit(target))) return `var(${names.get(target.id)})`;
    }
    if (variable.resolvedType === "COLOR") {
      const rgb = [value.r, value.g, value.b].map(n => Math.round(n * 255));
      return (value.a ?? 1) === 1 ? "#" + rgb.map(n => n.toString(16).padStart(2, "0")).join("") : `rgb(${rgb.join(" ")} / ${round(value.a)})`;
    }
    if (typeof value === "number") return value === 0 ? "0" : round(value) + numericUnit(variable);
    if (typeof value === "boolean") return String(value);
    if (/^\d+$/.test(value) && numericUnit(variable) === "") return value;
    // CSS strings: escape quotes, backslashes, controls and line terminators.
    return '"' + value.replace(/["\\\x00-\x1f\x7f]/g, ch => `\\${ch.codePointAt(0).toString(16)} `) + '"';
  }
  return { collections, variables, names, resolve, css };
}

export function validateSchoolBundle(bundle, { requireComplete = true } = {}) {
  const errors = [...(bundle.validation?.errors || [])];
  const warnings = [];
  const add = (code, details = {}) => errors.push({ code, ...details });
  if (bundle.schemaVersion !== "1.0.0" || bundle.source?.fileKey !== SCHOOL_FILE_KEY ||
    bundle.source?.tool !== "figma-mcp" || !bundle.source?.fileName || !Number.isFinite(Date.parse(bundle.source?.exportedAt))) add("INVALID_SOURCE");
  if (requireComplete && bundle.source?.complete !== true) add("INCOMPLETE_SOURCE");
  if (!Array.isArray(bundle.collections) || !Array.isArray(bundle.variables)) return { errors: [...errors, { code: "INVALID_BUNDLE" }], warnings };
  const counts = bundle.source?.retrieval;
  if (requireComplete && (!counts || counts.collectionCount !== bundle.collections.length || counts.variableCount !== bundle.variables.length ||
    bundle.collections.some(c => counts.collectionVariableCounts?.[c.id] !== c.variableIds.length))) add("RETRIEVAL_COUNT_MISMATCH");
  const ids = new Set();
  const collectionIds = new Set();
  for (const collection of bundle.collections) {
    if (collectionIds.has(collection.id)) add("DUPLICATE_COLLECTION", { collectionId: collection.id });
    collectionIds.add(collection.id);
    const modes = new Set(collection.modes.map(m => m.id));
    if (modes.size !== collection.modes.length || !modes.has(collection.defaultModeId)) add("INVALID_MODES", { collectionId: collection.id });
    const modeNames = collection.modes.map(m => slug(m.name));
    if (modeNames.some(n => !n) || new Set(modeNames).size !== modeNames.length) add("INVALID_CSS_IDENTIFIER", { collectionId: collection.id });
    const members = bundle.variables.filter(v => v.collectionId === collection.id).map(v => v.id).sort(compare);
    if (json(members) !== json([...collection.variableIds].sort(compare))) add("COLLECTION_MEMBERSHIP", { collectionId: collection.id });
  }
  for (const required of ["Primitives", "Colour", "Font Size", "Size", "Breakpoints"]) {
    const matches = bundle.collections.filter(c => slug(c.name) === slug(required));
    if (matches.length !== 1) add(matches.length ? "AMBIGUOUS_CATEGORY" : "MISSING_COLLECTION", { name: required });
  }
  for (const collection of bundle.collections) if (!["primitives", "colour", "font-size", "size", "breakpoints"].includes(slug(collection.name))) {
    warnings.push({ code: "UNSUPPORTED_CATEGORY", collectionId: collection.id, message: `${collection.name} is retained in the complete JSON but has no CSS mapping.` });
  }
  for (const variable of bundle.variables) {
    if (ids.has(variable.id)) add("DUPLICATE_VARIABLE", { variableId: variable.id });
    ids.add(variable.id);
    if (!collectionIds.has(variable.collectionId)) add("MISSING_COLLECTION", { variableId: variable.id });
    if (!normalizedPath(variable.name)) add("INVALID_CSS_IDENTIFIER", { variableId: variable.id });
    if (variable.remote) add("REMOTE_VARIABLE_UNSUPPORTED", { variableId: variable.id });
  }
  if (errors.length) return { errors, warnings };
  const ctx = context(bundle, warnings);
  for (const collection of bundle.collections) for (const variable of bundle.variables.filter(v => v.collectionId === collection.id)) {
    for (const mode of collection.modes) {
      if (!Object.hasOwn(variable.valuesByMode || {}, mode.id)) { add("MISSING_MODE_VALUE", { variableId: variable.id, modeId: mode.id }); continue; }
      try { ctx.resolve(variable.valuesByMode[mode.id], variable.resolvedType, collection, mode.id); }
      catch (error) { add(error.message.split(":")[0], { variableId: variable.id, modeId: mode.id, message: error.message }); }
    }
    for (const modeId of Object.keys(variable.valuesByMode || {})) if (!collection.modes.some(m => m.id === modeId)) add("INVALID_MODES", { variableId: variable.id, modeId });
  }
  if (bundle.typography) {
    try { buildSchoolTypography(bundle, ctx, warning => warnings.push(warning)); }
    catch (error) { add("INCOMPLETE_TYPOGRAPHY_GROUP", { message: error.message }); }
  } else warnings.push({ code: "INCOMPLETE_TYPOGRAPHY_GROUP", message: "Font Size defines sizes only; text utilities omit line height, weight and letter spacing. No ZB Master style mappings are assumed." });
  return { errors, warnings };
}

// Read-only MCP specimen snapshots supply composites; raw variable values stay intact.
function buildSchoolTypography(bundle, ctx, onWarning = () => {}) {
  const config = bundle.typography;
  if (config.source?.fileKey !== SCHOOL_FILE_KEY || config.source?.tool !== "figma-mcp" ||
    !config.source?.nodeId || !Number.isFinite(Date.parse(config.source?.exportedAt)) || !Array.isArray(config.styles)) {
    throw new Error("Typography needs a traceable Figma specimen snapshot");
  }
  if (bundle.source?.retrieval?.typographyStyleCount !== config.styles.length) throw new Error("Typography specimen count does not match verified retrieval");
  const fontCollection = bundle.collections.find(c => slug(c.name) === "font-size");
  const primitives = ordered(bundle.variables.filter(v => slug(ctx.collections.get(v.collectionId).name) === "primitives"));
  const names = new Set();
  const covered = new Set();
  const binding = (style, key) => {
    const entries = style.boundVariables?.[key];
    if (!entries) return undefined;
    if (!Array.isArray(entries) || entries.length !== 1 || !alias(entries[0]) || !ctx.variables.has(entries[0].id)) throw new Error(`Invalid ${key} binding for ${style.name}`);
    return ctx.variables.get(entries[0].id);
  };
  const modeFor = (collection, mode) => collection.id === fontCollection.id ? mode.id :
    collection.modes.find(m => slug(m.name) === slug(mode.name))?.id || collection.defaultModeId;
  const resolveVariable = (variable, mode) => {
    const c = ctx.collections.get(variable.collectionId);
    return ctx.resolve(variable.valuesByMode[modeFor(c, mode)], variable.resolvedType, c, modeFor(c, mode));
  };
  const primitiveReference = (prefix, value, mode) => {
    const match = primitives.find(v => {
      if (!ctx.names.get(v.id).startsWith(prefix)) return false;
      const resolved = resolveVariable(v, mode);
      return typeof value === "string" ? resolved === value : Math.abs(Number(resolved) - value) < 0.0001;
    });
    return match ? `var(${ctx.names.get(match.id)})` : null;
  };
  const blocks = [];
  for (const style of ordered(config.styles.map(s => ({ ...s, id: s.nodeId })))) {
    const name = slug(style.name).replace(/-(?=\d)/g, "");
    if (!name || names.has(name) || !style.nodeId) throw new Error(`Invalid or duplicate typography name: ${style.name}`);
    names.add(name);
    const size = binding(style, "fontSize");
    if (!size || size.collectionId !== fontCollection.id || size.resolvedType !== "FLOAT") throw new Error(`Missing Font Size binding for ${style.name}`);
    covered.add(size.id);
    const declarations = mode => {
      const fontSize = resolveVariable(size, mode);
      if (!(fontSize > 0)) throw new Error(`Invalid font size for ${style.name}`);
      const result = [`font-size: ${primitiveReference("--size-", fontSize, mode) || `${round(fontSize)}px`};`];
      const properties = [
        ["lineHeight", "line-height", "--line-height-"],
        ["fontStyle", "font-weight", "--font-weight-"],
        ["letterSpacing", "letter-spacing", "--letter-spacing-"],
        ["fontFamily", "font-family", "--family-"],
      ];
      if (style.name.startsWith("paragraph-") || style.paragraphIndent) properties.push(["paragraphIndent", "text-indent", "--size-"]);
      for (const [key, property, prefix] of properties) {
        const variable = binding(style, key);
        let value;
        if (variable) {
          const c = ctx.collections.get(variable.collectionId);
          const expected = key === "fontFamily" ? "STRING" : key === "fontStyle" ? ["FLOAT", "STRING"] : "FLOAT";
          if (!(Array.isArray(expected) ? expected : [expected]).includes(variable.resolvedType)) throw new Error(`Invalid ${key} type for ${style.name}`);
          // Reject bindings whose namespace carries a different CSS unit.
          if (key !== "fontFamily" && key !== "fontStyle" && numericUnit(variable) !== (key === "lineHeight" ? "%" : "px")) throw new Error(`Invalid ${key} unit for ${style.name}`);
          if (key === "fontStyle" && (!ctx.names.get(variable.id).startsWith("--font-weight-") || !Number.isFinite(Number(resolveVariable(variable, mode))))) throw new Error(`Invalid weight for ${style.name}`);
          value = `var(${ctx.names.get(variable.id)})`;
          // Resolve a matched foreign non-default mode instead of depending on its selector.
          if (modeFor(c, mode) !== c.defaultModeId && c.id !== fontCollection.id) value = ctx.css(variable, c, modeFor(c, mode));
        } else if (key === "fontFamily") {
          if (typeof style.fontFamily !== "string" || !style.fontFamily) throw new Error(`Missing font family for ${style.name}`);
          value = primitiveReference(prefix, style.fontFamily, mode) || ctx.css({ resolvedType: "STRING", name: "Font Family", valuesByMode: { [mode.id]: style.fontFamily } }, fontCollection, mode.id);
        } else {
          const raw = key === "fontStyle" ? style.fontWeight : style[key];
          const number = typeof raw === "object" ? raw?.value : raw;
          if (!Number.isFinite(number) || (key === "lineHeight" && !["PERCENT", "PIXELS"].includes(raw?.unit)) ||
            (key === "letterSpacing" && !["PERCENT", "PIXELS"].includes(raw?.unit))) throw new Error(`Missing or unsupported ${key} for ${style.name}`);
          const unit = typeof raw === "object" ? (raw.unit === "PERCENT" ? "%" : "px") : key === "fontStyle" ? "" : "px";
          const canReference = key === "lineHeight" ? unit === "%" : key === "letterSpacing" ? unit === "px" : true;
          value = (canReference ? primitiveReference(prefix, number, mode) : null) || (number === 0 ? "0" : round(number) + unit);
        }
        result.push(`${property}: ${value};`);
      }
      return result;
    };
    const defaultMode = fontCollection.modes.find(m => m.id === fontCollection.defaultModeId);
    let block = `@utility text-${name} {\n${declarations(defaultMode).map(d => `    ${d}`).join("\n")}\n`;
    for (const mode of fontCollection.modes.filter(m => m.id !== defaultMode.id)) block += `    [data-font-size-mode="${slug(mode.name)}"] & {\n${declarations(mode).map(d => `        ${d}`).join("\n")}\n    }\n`;
    blocks.push(block + "}");
    // The specimen's actual properties and bindings take precedence over descriptive labels.
    const weightLabel = style.annotation?.match(/font-weight-(regular|medium)/)?.[1];
    const spacingLabel = style.annotation?.match(/letter-spacing-(\d+(?:\.\d+)?)/)?.[1];
    if ((weightLabel && style.fontWeight !== ({ regular: 400, medium: 500 })[weightLabel]) ||
      (spacingLabel !== undefined && style.letterSpacing?.value !== Number(spacingLabel)) || style.annotation?.includes("letter-spacing-md")) {
      onWarning({ code: "TYPOGRAPHY_ANNOTATION_MISMATCH", nodeId: style.nodeId, message: `${style.name}: applied specimen properties take precedence over its descriptive label.` });
    }
  }
  if (bundle.variables.some(v => v.collectionId === fontCollection.id && !covered.has(v.id))) throw new Error("Typography snapshot does not cover every Font Size variable");
  return blocks.join("\n\n") + "\n";
}

export function buildSchoolFiles(bundle) {
  const validation = validateSchoolBundle(bundle);
  if (validation.errors.length) throw new Error(json(validation.errors));
  const ctx = context(bundle, []);
  const header = "/* Generated from ZB School tokens via Figma MCP. Do not edit. */\n\n";
  const files = {};
  const mappings = [["Primitives", "primitives", "base"], ["Breakpoints", "breakpoints", "breakpoint"],
    ["Colour", "colour-token", "colour-token"], ["Font Size", "typography", "typography"], ["Size", "size", "size"]];
  for (const [category, jsonName, cssName] of mappings) {
    const collection = bundle.collections.find(c => slug(c.name) === slug(category));
    const variables = ordered(bundle.variables.filter(v => v.collectionId === collection.id));
    const subset = { ...bundle, collections: [collection], variables, aliases: schoolAliases(variables), validation };
    files[`tokens/${jsonName}.json`] = json(subset);
    let css;
    if (category === "Breakpoints") {
      const widths = new Set();
      for (const variable of variables.filter(v => slug(v.name.split("/").at(-1)) === "page-width")) for (const mode of collection.modes) {
        const width = ctx.resolve(variable.valuesByMode[mode.id], "FLOAT", collection, mode.id);
        if (width > 0) widths.add(width);
      }
      // School's actual widths, including 1024; never infer a width from a mode label.
      const known = new Map([[390, "xs"], [768, "md"], [1024, "lg"], [1200, "xl"]]);
      css = `@theme static {\n${[...widths].sort((a,b) => a-b).map(w => `  --breakpoint-${known.get(w) || `width-${slug(w)}`}: ${round(w)}px;`).join("\n")}\n}\n`;
    } else {
      const declarations = modeId => variables.map(v => `  ${ctx.names.get(v.id)}: ${ctx.css(v, collection, modeId)};`).join("\n");
      css = `@theme static {\n${declarations(collection.defaultModeId)}\n}\n`;
      for (const mode of collection.modes.filter(m => m.id !== collection.defaultModeId)) css += `\n[data-${slug(collection.name)}-mode="${slug(mode.name)}"] {\n${declarations(mode.id)}\n}\n`;
      if (category === "Font Size") {
        if (bundle.typography) css += "\n" + buildSchoolTypography(bundle, ctx);
        else {
          css += "\n/* Size-only utilities: no composite typography values are defined by this collection. */\n";
          for (const variable of variables) css += `\n@utility text-${ctx.names.get(variable.id).slice(7)} {\n  font-size: var(${ctx.names.get(variable.id)});\n}\n`;
        }
      }
    }
    files[`tailwind4/${cssName}.css`] = header + css;
  }
  files["tailwind4/index.css"] = header + Object.keys(files).filter(p => p.endsWith(".css")).map(p => `@import "./${path.posix.basename(p)}";\n`).join("");
  files["tokens/figma-variables.json"] = json({ ...bundle, collections: ordered(bundle.collections), variables: ordered(bundle.variables), aliases: schoolAliases(bundle.variables), validation });
  return files;
}

async function main() {
  // School 源文件统一存放在 variables，生成 token 仍写入 dist。
  const input = path.resolve(process.argv[2] || process.env.ZBSCHOOLS_VARIABLES_JSON || "variables/figma-zbschools.json");
  // ZBSchools 的 CSS 统一输出到产品目录下的 tailwind4 子目录。
  const cssRoot = path.resolve(process.argv[3] || process.env.ZBSCHOOLS_OUTPUT_DIR || "dist/zbschools/tailwind4");
  // ZBSchools 的生成 token 归入 dist/zbschools/tokens，避免覆盖输入源文件。
  const tokenRoot = path.resolve("dist/zbschools/tokens");
  const bundle = JSON.parse(await fs.readFile(input, "utf8"));
  const files = buildSchoolFiles(bundle);
  // Build and validate everything before writing any output.
  for (const [relative, content] of Object.entries(files)) {
    const target = relative.startsWith("tailwind4/")
      ? path.join(cssRoot, path.posix.basename(relative))
      : path.join(tokenRoot, path.posix.basename(relative));
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, content, "utf8");
  }
  for (const warning of validateSchoolBundle(bundle).warnings) console.warn(`${warning.code}: ${warning.message || warning.emittedName}`);
  console.log(`Generated ${Object.keys(files).length} files from ${bundle.variables.length} School variables; CSS: ${cssRoot}; JSON: ${tokenRoot}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => { console.error(`School export failed: ${error.message}`); process.exitCode = 1; });
}
