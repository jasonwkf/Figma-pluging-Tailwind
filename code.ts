/// <reference types="@figma/plugin-typings" />

type FigmaVariableAlias = {
  type: "VARIABLE_ALIAS";
  id: string;
};

type FigmaColorValue = {
  r: number;
  g: number;
  b: number;
  a?: number;
};

type FigmaResolvedType = "BOOLEAN" | "COLOR" | "FLOAT" | "STRING";

type StyleDictionaryTokenType = "color" | "number" | "string" | "boolean";

type StyleDictionaryTokenValue = string | number | boolean;

type BaseCssCategory = "color" | "spacing" | "border" | "size" | "typography";

type TextStyleExport = {
  schemaVersion: "1.0.0";
  exportedAt: string;
  styleCount: number;
  styles: TextStyleRecord[];
};

type TextStyleRecord = {
  id: string;
  key: string;
  name: string;
  description: string;
  type: "TEXT";
  fontName: unknown;
  fontSize: number;
  fontWeight?: number;
  lineHeight: unknown;
  letterSpacing: unknown;
  paragraphIndent: number;
  paragraphSpacing: number;
  textCase: TextCase;
  textDecoration: TextDecoration;
  boundVariables?: unknown;
};

type StyleDictionaryToken = {
  $type: StyleDictionaryTokenType;
  $value: StyleDictionaryTokenValue;
  $description?: string;
  $extensions: {
    figma: {
      id: string;
      key: string;
      name: string;
      collection: string;
      mode: string;
      resolvedType: FigmaResolvedType;
      scopes: string[];
    };
  };
};

type StyleDictionaryTokenTree = {
  [key: string]: StyleDictionaryToken | StyleDictionaryTokenTree;
};

type StyleDictionaryModeExport = {
  modeId: string;
  modeName: string;
  isDefault: boolean;
  tokens: StyleDictionaryTokenTree;
};

type StyleDictionaryCollectionExport = {
  collectionId: string;
  collectionName: string;
  defaultModeId: string;
  modeCount: number;
  variableCount: number;
  modes: StyleDictionaryModeExport[];
};

type VariablesExport = {
  format: "style-dictionary";
  tokenSyntax: "dtcg";
  fileName: string;
  baseCss: string;
  colorTokensCss: string;
  typographyCss: string;
  colorVariableCount: number;
  collectionCount: number;
  variableCount: number;
  variableCountsByType: {
    color: number;
    number: number;
    string: number;
    boolean: number;
  };
  collections: StyleDictionaryCollectionExport[];
};

type UiMessage =
  | {
      type: "refresh-variables";
    }
  | {
      type: "close-plugin";
    };

type LocalVariable = Awaited<
  ReturnType<typeof figma.variables.getLocalVariablesAsync>
>[number];

type LocalVariableCollection = Awaited<
  ReturnType<typeof figma.variables.getLocalVariableCollectionsAsync>
>[number];

type LocalTextStyle = Awaited<
  ReturnType<typeof figma.getLocalTextStylesAsync>
>[number];

figma.showUI(__html__, { width: 560, height: 300 });

function toJsonSafeValue(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value));
}

function readJsonSafeProperty(source: unknown, key: string): unknown {
  try {
    const value = (source as { [property: string]: unknown })[key];

    if (typeof value === "function" || typeof value === "undefined") {
      return undefined;
    }

    return toJsonSafeValue(value);
  } catch (_error) {
    return undefined;
  }
}

function serializeTextStyle(style: LocalTextStyle): TextStyleRecord {
  const record: TextStyleRecord = {
    id: style.id,
    key: style.key,
    name: style.name,
    description: style.description,
    type: style.type,
    fontName: toJsonSafeValue(style.fontName),
    fontSize: style.fontSize,
    lineHeight: toJsonSafeValue(style.lineHeight),
    letterSpacing: toJsonSafeValue(style.letterSpacing),
    paragraphIndent: style.paragraphIndent,
    paragraphSpacing: style.paragraphSpacing,
    textCase: style.textCase,
    textDecoration: style.textDecoration,
  };

  if (style.boundVariables) {
    record.boundVariables = toJsonSafeValue(style.boundVariables);
  }

  const fontName = style.fontName;

  const runtimeFontWeight = readJsonSafeProperty(style, "fontWeight");

  record.fontWeight =
    getFontWeightFromValue(runtimeFontWeight) ||
    getFontWeightFromFontName(fontName) ||
    undefined;

  return record;
}

async function getTextStylesExport(): Promise<TextStyleExport> {
  const styles = await figma.getLocalTextStylesAsync();
  const records = styles
    .filter((style) => {
      const path = toTokenPath(style.name);

      return path[0] === "zb" || path[0].indexOf("zb-") === 0;
    })
    .map((style) => serializeTextStyle(style))
    .sort((first, second) => first.name.localeCompare(second.name));

  return {
    schemaVersion: "1.0.0",
    exportedAt: new Date().toISOString(),
    styleCount: records.length,
    styles: records,
  };
}

function formatFontFamily(fontName: unknown): string | null {
  if (
    typeof fontName === "object" &&
    fontName !== null &&
    "family" in fontName
  ) {
    const family = String(fontName.family);

    return family.indexOf(" ") === -1 ? family : `"${family.replace(/"/g, '\\"')}"`;
  }

  return null;
}

function getFontWeightFromFontName(fontName: unknown): number | null {
  if (
    typeof fontName !== "object" ||
    fontName === null ||
    !("style" in fontName)
  ) {
    return null;
  }

  const fontStyle = String(fontName.style).toLowerCase();
  const weightMatch = fontStyle.match(/\b([1-9]00)\b/);

  if (weightMatch) {
    return Number(weightMatch[1]);
  }

  if (fontStyle.indexOf("thin") !== -1) {
    return 100;
  }

  if (fontStyle.indexOf("extra light") !== -1 || fontStyle.indexOf("extralight") !== -1) {
    return 200;
  }

  if (fontStyle.indexOf("light") !== -1) {
    return 300;
  }

  if (fontStyle.indexOf("regular") !== -1 || fontStyle.indexOf("normal") !== -1) {
    return 400;
  }

  if (fontStyle.indexOf("medium") !== -1) {
    return 500;
  }

  if (fontStyle.indexOf("semi bold") !== -1 || fontStyle.indexOf("semibold") !== -1) {
    return 600;
  }

  if (fontStyle.indexOf("extra bold") !== -1 || fontStyle.indexOf("extrabold") !== -1) {
    return 800;
  }

  if (fontStyle.indexOf("bold") !== -1) {
    return 700;
  }

  if (fontStyle.indexOf("black") !== -1) {
    return 900;
  }

  return null;
}

function getFontWeightFromValue(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.round(value);
  }

  if (typeof value !== "string") {
    return null;
  }

  const numericValue = Number(value);

  if (Number.isFinite(numericValue)) {
    return Math.round(numericValue);
  }

  const normalizedValue = value.toLowerCase();

  if (normalizedValue.indexOf("thin") !== -1) {
    return 100;
  }

  if (
    normalizedValue.indexOf("extra light") !== -1 ||
    normalizedValue.indexOf("extralight") !== -1
  ) {
    return 200;
  }

  if (normalizedValue.indexOf("light") !== -1) {
    return 300;
  }

  if (
    normalizedValue.indexOf("regular") !== -1 ||
    normalizedValue.indexOf("normal") !== -1
  ) {
    return 400;
  }

  if (normalizedValue.indexOf("medium") !== -1) {
    return 500;
  }

  if (
    normalizedValue.indexOf("semi bold") !== -1 ||
    normalizedValue.indexOf("semibold") !== -1
  ) {
    return 600;
  }

  if (
    normalizedValue.indexOf("extra bold") !== -1 ||
    normalizedValue.indexOf("extrabold") !== -1
  ) {
    return 800;
  }

  if (normalizedValue.indexOf("bold") !== -1) {
    return 700;
  }

  if (normalizedValue.indexOf("black") !== -1) {
    return 900;
  }

  return null;
}

function formatLineHeight(lineHeight: unknown): string | null {
  if (
    typeof lineHeight === "object" &&
    lineHeight !== null &&
    "unit" in lineHeight &&
    "value" in lineHeight
  ) {
    const value = Number(lineHeight.value);

    if (!Number.isFinite(value)) {
      return null;
    }

    if (lineHeight.unit === "PERCENT") {
      return `${Math.round(value)}%`;
    }

    if (lineHeight.unit === "PIXELS") {
      return `${Math.round(value)}%`;
    }
  }

  return null;
}

function getRoundedLineHeightPercent(lineHeight: unknown): number | null {
  if (
    typeof lineHeight === "object" &&
    lineHeight !== null &&
    "unit" in lineHeight &&
    "value" in lineHeight
  ) {
    const value = Number(lineHeight.value);

    if (Number.isFinite(value)) {
      return Math.round(value);
    }
  }

  return null;
}

function formatLetterSpacing(letterSpacing: unknown): string | null {
  if (
    typeof letterSpacing === "object" &&
    letterSpacing !== null &&
    "unit" in letterSpacing &&
    "value" in letterSpacing
  ) {
    const value = Number(letterSpacing.value);

    if (!Number.isFinite(value)) {
      return null;
    }

    if (value === 0) {
      return "0";
    }

    if (letterSpacing.unit === "PERCENT") {
      return `${value}%`;
    }

    if (letterSpacing.unit === "PIXELS") {
      return `${value}px`;
    }
  }

  return null;
}

function textCaseToCss(textCase: TextCase): string | null {
  if (textCase === "UPPER") {
    return "uppercase";
  }

  if (textCase === "LOWER") {
    return "lowercase";
  }

  if (textCase === "TITLE") {
    return "capitalize";
  }

  return null;
}

function textDecorationToCss(textDecoration: TextDecoration): string | null {
  if (textDecoration === "UNDERLINE") {
    return "underline";
  }

  if (textDecoration === "STRIKETHROUGH") {
    return "line-through";
  }

  return null;
}

function textStyleToUtilityName(styleName: string): string {
  const path = toTokenPath(styleName);
  const normalizedPath = path.map((segment) => {
    if (segment === "heading") {
      return "header";
    }

    if (/^h[1-6]$/.test(segment)) {
      return segment.replace("h", "");
    }

    return segment;
  });

  while (normalizedPath[0] === "zb" || normalizedPath[0].indexOf("zb-") === 0) {
    if (normalizedPath[0] === "zb") {
      normalizedPath.shift();
    } else {
      normalizedPath[0] = normalizedPath[0].replace(/^zb-+/, "");
    }
  }

  return `text-${normalizedPath.join("")}`
    .replace(/^text-ds(?=.)/, "text-")
    .replace(/-([0-9]+)$/g, "$1");
}

function getBoundVariableCssName(
  style: TextStyleRecord,
  field: string,
  variablesById: { [id: string]: LocalVariable },
): string | null {
  if (
    typeof style.boundVariables !== "object" ||
    style.boundVariables === null ||
    !(field in style.boundVariables)
  ) {
    return null;
  }

  const binding = (style.boundVariables as { [key: string]: unknown })[field];

  if (
    typeof binding !== "object" ||
    binding === null ||
    !("id" in binding) ||
    typeof binding.id !== "string"
  ) {
    return null;
  }

  const variable = variablesById[binding.id];
  const category = variable ? getBaseCssCategory(variable) : null;

  if (!variable || category === null) {
    return null;
  }

  return `var(${toBaseCssCustomPropertyName(variable, category)})`;
}

function getBoundVariable(
  style: TextStyleRecord,
  field: string,
  variablesById: { [id: string]: LocalVariable },
): LocalVariable | null {
  if (
    typeof style.boundVariables !== "object" ||
    style.boundVariables === null ||
    !(field in style.boundVariables)
  ) {
    return null;
  }

  const binding = (style.boundVariables as { [key: string]: unknown })[field];

  if (
    typeof binding !== "object" ||
    binding === null ||
    !("id" in binding) ||
    typeof binding.id !== "string"
  ) {
    return null;
  }

  return variablesById[binding.id] || null;
}

function getFontWeightSuffixFromCssName(cssName: string): string | null {
  if (cssName.indexOf("--font-weight-") === 0) {
    return cssName.replace("--font-weight-", "");
  }

  return null;
}

function isFontWeightCssName(cssName: string): boolean {
  return cssName === "--font-weight" || cssName.indexOf("--font-weight-") === 0;
}

function getPrimitiveFontWeightVariableMap(
  variables: LocalVariable[],
): { [weight: string]: { suffix: string; cssName: string } } {
  const weightVariables: { [weight: string]: { suffix: string; cssName: string } } =
    {};

  for (const variable of variables) {
    if (variable.resolvedType !== "FLOAT" && variable.resolvedType !== "STRING") {
      continue;
    }

    const cssName = toTypographyCssCustomPropertyName(variable.name);
    const suffix = getFontWeightSuffixFromCssName(cssName);

    if (!isFontWeightCssName(cssName)) {
      continue;
    }

    const values = Object.keys(variable.valuesByMode).map(
      (modeId) => variable.valuesByMode[modeId],
    );

    for (const value of values) {
      const parsedWeight = getFontWeightFromValue(value);

      if (parsedWeight === null) {
        continue;
      }

      const weight = String(parsedWeight);

      if (!weightVariables[weight]) {
        weightVariables[weight] = {
          suffix: suffix || "",
          cssName: toBaseCssCustomPropertyName(variable, "typography"),
        };
      }
    }
  }

  return weightVariables;
}

function getTextStyleWeightSuffix(
  style: TextStyleRecord,
  variablesById: { [id: string]: LocalVariable },
  primitiveFontWeightVariables: {
    [weight: string]: { suffix: string; cssName: string };
  },
): string | null {
  const boundWeightVariable = getBoundVariable(style, "fontWeight", variablesById);

  if (boundWeightVariable) {
    return (
      getFontWeightSuffixFromCssName(
        toTypographyCssCustomPropertyName(boundWeightVariable.name),
      ) || null
    );
  }

  if (!style.fontWeight) {
    return null;
  }

  const primitiveWeight = primitiveFontWeightVariables[String(style.fontWeight)];

  return primitiveWeight ? primitiveWeight.suffix : null;
}

function getTextStyleFontWeightValue(
  style: TextStyleRecord,
  variablesById: { [id: string]: LocalVariable },
  primitiveFontWeightVariables: {
    [weight: string]: { suffix: string; cssName: string };
  },
): string | null {
  const boundVariableValue = getBoundVariableCssName(
    style,
    "fontWeight",
    variablesById,
  );

  if (boundVariableValue) {
    return boundVariableValue;
  }

  if (!style.fontWeight) {
    return null;
  }

  const primitiveWeight = primitiveFontWeightVariables[String(style.fontWeight)];

  return primitiveWeight ? `var(${primitiveWeight.cssName})` : String(style.fontWeight);
}

function getPrimitiveSizeVariableMap(
  variables: LocalVariable[],
): { [size: string]: string } {
  const sizeVariables: { [size: string]: string } = {};

  for (const variable of variables) {
    if (variable.resolvedType !== "FLOAT") {
      continue;
    }

    if (getBaseCssCategory(variable) !== "size") {
      continue;
    }

    const cssName = toBaseCssCustomPropertyName(variable, "size");

    if (cssName.indexOf("--size-") !== 0 && cssName !== "--size") {
      continue;
    }

    const values = Object.keys(variable.valuesByMode).map(
      (modeId) => variable.valuesByMode[modeId],
    );

    for (const value of values) {
      if (typeof value !== "number" || !Number.isFinite(value)) {
        continue;
      }

      const size = String(value);

      if (!sizeVariables[size]) {
        sizeVariables[size] = `var(${cssName})`;
      }
    }
  }

  return sizeVariables;
}

function getPrimitiveLineHeightVariableMap(
  variables: LocalVariable[],
  variablesById: { [id: string]: LocalVariable },
): { [percent: string]: string } {
  const lineHeightVariables: { [percent: string]: string } = {};

  for (const variable of variables) {
    if (variable.resolvedType !== "FLOAT") {
      continue;
    }

    const cssName = toTypographyCssCustomPropertyName(variable.name);

    if (cssName.indexOf("--line-height") !== 0) {
      continue;
    }

    const values = Object.keys(variable.valuesByMode).map(
      (modeId) => variable.valuesByMode[modeId],
    );

    for (const value of values) {
      if (typeof value !== "number" || !Number.isFinite(value)) {
        continue;
      }

      const roundedValue = String(Math.round(value));

      if (!lineHeightVariables[roundedValue]) {
        lineHeightVariables[roundedValue] = `var(${toBaseCssCustomPropertyName(
          variable,
          "typography",
        )})`;
      }
    }
  }

  return lineHeightVariables;
}

function buildTypographyCssFromTextStyles(
  textStyles: TextStyleExport,
  variablesById: { [id: string]: LocalVariable },
  variables: LocalVariable[],
): string {
  const utilities: string[] = [];
  const primitiveLineHeightVariables = getPrimitiveLineHeightVariableMap(
    variables,
    variablesById,
  );
  const primitiveFontWeightVariables = getPrimitiveFontWeightVariableMap(variables);
  const primitiveSizeVariables = getPrimitiveSizeVariableMap(variables);

  for (const style of textStyles.styles) {
    const declarations: string[] = [];
    const fontSize =
      getBoundVariableCssName(style, "fontSize", variablesById) ||
      primitiveSizeVariables[String(style.fontSize)] ||
      `${style.fontSize}px`;
    const roundedLineHeight = getRoundedLineHeightPercent(style.lineHeight);
    const lineHeight =
      getBoundVariableCssName(style, "lineHeight", variablesById) ||
      (roundedLineHeight !== null
        ? primitiveLineHeightVariables[String(roundedLineHeight)]
        : null) ||
      formatLineHeight(style.lineHeight);
    const letterSpacing =
      getBoundVariableCssName(style, "letterSpacing", variablesById) ||
      formatLetterSpacing(style.letterSpacing);
    const textCase = textCaseToCss(style.textCase);
    const textDecoration = textDecorationToCss(style.textDecoration);
    const weightSuffix = getTextStyleWeightSuffix(
      style,
      variablesById,
      primitiveFontWeightVariables,
    );
    const classNameWeightSuffix =
      weightSuffix === "regular" ||
      weightSuffix === "medium" ||
      weightSuffix === "light"
        ? null
        : weightSuffix;
    const fontWeight = getTextStyleFontWeightValue(
      style,
      variablesById,
      primitiveFontWeightVariables,
    );
    const utilityName = `${textStyleToUtilityName(style.name)}${
      classNameWeightSuffix ? `-${classNameWeightSuffix}` : ""
    }`;

    declarations.push(`    font-size: ${fontSize};`);

    if (lineHeight) {
      declarations.push(`    line-height: ${lineHeight};`);
    }

    if (fontWeight) {
      declarations.push(`    font-weight: ${fontWeight};`);
    }

    if (letterSpacing) {
      declarations.push(`    letter-spacing: ${letterSpacing};`);
    }

    if (textCase) {
      declarations.push(`    text-transform: ${textCase};`);
    }

    if (textDecoration) {
      declarations.push(`    text-decoration: ${textDecoration};`);
    }

    if (style.paragraphIndent !== 0) {
      declarations.push(`    text-indent: ${style.paragraphIndent}px;`);
    }

    if (style.paragraphSpacing !== 0) {
      declarations.push(`    margin-bottom: ${style.paragraphSpacing}px;`);
    }

    utilities.push(
      `@utility ${utilityName} {\n${declarations.join("\n")}\n}`,
    );
  }

  if (utilities.length === 0) {
    return `/* Generated ${textStyles.exportedAt} */\n`;
  }

  return `/* Generated ${textStyles.exportedAt} */\n\n${utilities.join("\n\n")}\n`;
}

function toTokenPath(name: string): string[] {
  const segments = name
    .split("/")
    .map((segment) =>
      segment
        .trim()
        .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
        .replace(/[^a-z0-9]+/gi, "-")
        .replace(/^-+|-+$/g, "")
        .toLowerCase(),
    )
    .filter(Boolean);

  return segments.length > 0 ? segments : ["unnamed"];
}

function isAliasValue(value: unknown): value is FigmaVariableAlias {
  return (
    typeof value === "object" &&
    value !== null &&
    "type" in value &&
    value.type === "VARIABLE_ALIAS" &&
    "id" in value &&
    typeof value.id === "string"
  );
}

function isColorValue(value: unknown): value is FigmaColorValue {
  return (
    typeof value === "object" &&
    value !== null &&
    "r" in value &&
    "g" in value &&
    "b" in value &&
    typeof value.r === "number" &&
    typeof value.g === "number" &&
    typeof value.b === "number"
  );
}

function toHexChannel(value: number): string {
  const channel = Math.max(0, Math.min(255, Math.round(value * 255)));
  const hex = channel.toString(16);

  return hex.length === 1 ? `0${hex}` : hex;
}

function colorToHex(color: FigmaColorValue): string {
  const rgb = [color.r, color.g, color.b].map(toHexChannel).join("");
  const alpha =
    typeof color.a === "number" && color.a < 1 ? toHexChannel(color.a) : "";

  return `#${rgb}${alpha}`;
}

function colorToCss(color: FigmaColorValue): string {
  const alpha = typeof color.a === "number" ? color.a : 1;

  if (alpha >= 1) {
    return colorToHex(color);
  }

  const [red, green, blue] = [color.r, color.g, color.b].map((channel) =>
    Math.max(0, Math.min(255, Math.round(channel * 255))),
  );
  const roundedAlpha = Math.round(Math.max(0, Math.min(1, alpha)) * 1000) / 1000;

  return `rgb(${red} ${green} ${blue} / ${roundedAlpha})`;
}

function toCssCustomPropertyName(name: string): string {
  const colorPath = toTokenPath(name);

  while (
    colorPath[0] === "color" ||
    colorPath[0] === "colors" ||
    colorPath[0] === "colour" ||
    colorPath[0] === "colours"
  ) {
    colorPath.shift();
  }

  let colorName = (colorPath.length > 0 ? colorPath : ["unnamed"]).join("-");
  const firstSegment = colorName.split("-")[0];

  if (firstSegment && colorName.startsWith(`${firstSegment}-${firstSegment}-`)) {
    colorName = colorName.replace(`${firstSegment}-${firstSegment}-`, `${firstSegment}-`);
  }

  return `--color-${colorName}`;
}

function stripLeadingCategorySegments(
  path: string[],
  categories: string[],
): string[] {
  const strippedPath = path.slice();

  while (strippedPath.length > 0 && categories.indexOf(strippedPath[0]) !== -1) {
    strippedPath.shift();
  }

  return strippedPath.length > 0 ? strippedPath : ["unnamed"];
}

function toSpacingCssCustomPropertyName(name: string): string {
  const spacingPath = stripLeadingCategorySegments(toTokenPath(name), [
    "spacing",
    "spacings",
    "space",
    "spaces",
    "gap",
    "gaps",
  ]);

  return `--spacing-${spacingPath.join("-")}`.replace(
    /^--spacing-spacing(?=-|$)/,
    "--spacing",
  );
}

function toBorderCssCustomPropertyName(name: string): string {
  const borderPath = stripLeadingCategorySegments(toTokenPath(name), [
    "border",
    "borders",
  ]);

  return `--border-${borderPath.join("-")}`;
}

function toSizeCssCustomPropertyName(name: string): string {
  const sizePath = stripLeadingCategorySegments(toTokenPath(name), [
    "size",
    "sizes",
  ]);
  let sizeName = sizePath.join("-");

  if (sizeName.startsWith("size-")) {
    sizeName = sizeName.replace("size-", "");
  }

  return `--size-${sizeName || "unnamed"}`;
}

function toTypographyCssCustomPropertyName(name: string): string {
  let path = stripLeadingCategorySegments(toTokenPath(name), [
    "primitive",
    "primitives",
    "typography",
    "type",
  ]);
  const typographyIndex = path.indexOf("typography");
  const typeIndex = path.indexOf("type");
  const categoryIndex =
    typographyIndex !== -1
      ? typographyIndex
      : typeIndex !== -1
        ? typeIndex
        : -1;

  if (categoryIndex !== -1) {
    path = path.slice(categoryIndex + 1);
  }

  const lastSegment = path[path.length - 1];
  const parentPath = path.slice(0, -1);
  const letterSpacingIndex = path.indexOf("letter-spacing");
  const lineHeightIndex = path.indexOf("line-height");

  if (letterSpacingIndex !== -1) {
    const letterSpacingPath = path.slice(letterSpacingIndex + 1);

    while (letterSpacingPath[0] === "letter-spacing") {
      letterSpacingPath.shift();
    }

    const letterSpacingName = letterSpacingPath.join("-");

    const cssName = letterSpacingName
      ? `--letter-spacing-${letterSpacingName}`
      : "--letter-spacing";

    return cssName.replace(
      /^--letter-spacing-letter-spacing(?=-|$)/,
      "--letter-spacing",
    );
  }

  if (lineHeightIndex !== -1) {
    const lineHeightPath = path.slice(lineHeightIndex + 1);

    while (lineHeightPath[0] === "line-height") {
      lineHeightPath.shift();
    }

    const lineHeightName = lineHeightPath.join("-");

    return lineHeightName ? `--line-height-${lineHeightName}` : "--line-height";
  }

  if (path[0] === "family") {
    const familyName = path.slice(1).join("-");

    return familyName ? `--family-${familyName}` : "--family";
  }

  if (path[0] === "weight") {
    const weightPath = path.slice(1);

    while (weightPath[0] === "font-weight" || weightPath[0] === "weight") {
      weightPath.shift();
    }

    const weightName = weightPath.join("-");

    return (weightName ? `--font-weight-${weightName}` : "--font-weight").replace(
      /^--font-weight-font-weight(?=-|$)/,
      "--font-weight",
    );
  }

  if (lastSegment === "font-family" || lastSegment === "family") {
    return `--font-${(parentPath.length > 0 ? parentPath : ["sans"]).join("-")}`;
  }

  if (lastSegment === "font-size" || lastSegment === "size") {
    return `--text-${(parentPath.length > 0 ? parentPath : ["base"]).join("-")}`;
  }

  if (lastSegment === "line-height" || lastSegment === "leading") {
    return `--line-height-${(parentPath.length > 0 ? parentPath : ["normal"]).join("-")}`.replace(
      /^--line-height-line-height(?=-|$)/,
      "--line-height",
    );
  }

  if (lastSegment === "font-weight" || lastSegment === "weight") {
    return `--font-weight-${(parentPath.length > 0 ? parentPath : ["normal"]).join("-")}`.replace(
      /^--font-weight-font-weight(?=-|$)/,
      "--font-weight",
    );
  }

  if (lastSegment === "letter-spacing" || lastSegment === "tracking") {
    let letterSpacingName = (parentPath.length > 0
      ? parentPath
      : ["normal"]
    ).join("-");

    if (letterSpacingName.startsWith("letter-spacing-")) {
      letterSpacingName = letterSpacingName.replace("letter-spacing-", "");
    }

    if (letterSpacingName === "letter-spacing") {
      letterSpacingName = "";
    }

    return letterSpacingName
      ? `--letter-spacing-${letterSpacingName}`
      : "--letter-spacing";
  }

  return `--type-${path.join("-")}`;
}

function pathHasCategory(path: string[], categories: string[]): boolean {
  return path.some((segment) => categories.indexOf(segment) !== -1);
}

function getBaseCssCategory(variable: LocalVariable): BaseCssCategory | null {
  const path = toTokenPath(variable.name);

  if (variable.resolvedType === "COLOR") {
    return "color";
  }

  if (
    variable.resolvedType === "FLOAT" &&
    pathHasCategory(path, ["spacing", "spacings", "space", "spaces", "gap", "gaps"])
  ) {
    return "spacing";
  }

  if (
    variable.resolvedType === "FLOAT" &&
    pathHasCategory(path, ["border", "borders"])
  ) {
    return "border";
  }

  if (
    variable.resolvedType === "FLOAT" &&
    pathHasCategory(path, ["size", "sizes"])
  ) {
    return "size";
  }

  if (
    (variable.resolvedType === "FLOAT" || variable.resolvedType === "STRING") &&
    pathHasCategory(path, ["typography", "type"])
  ) {
    return "typography";
  }

  return null;
}

function isSpacingVariable(variable: LocalVariable): boolean {
  const path = toTokenPath(variable.name);

  return pathHasCategory(path, [
    "spacing",
    "spacings",
    "space",
    "spaces",
    "gap",
    "gaps",
  ]);
}

function getTokenType(variable: LocalVariable): StyleDictionaryTokenType {
  if (variable.resolvedType === "COLOR") {
    return "color";
  }

  if (variable.resolvedType === "FLOAT") {
    return "number";
  }

  if (variable.resolvedType === "BOOLEAN") {
    return "boolean";
  }

  return "string";
}

function makeSpacingCssValue(value: unknown): string | null {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }

  if (value === 0) {
    return "0";
  }

  return `${value}px`;
}

function makeTextCssValue(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value === 0 ? "0" : `${value}px`;
  }

  if (typeof value === "string" && value.trim()) {
    return value.indexOf(" ") === -1 ? value : `"${value.replace(/"/g, '\\"')}"`;
  }

  return null;
}

function makeLineHeightCssValue(value: unknown): string | null {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }

  if (value === 0) {
    return "0";
  }

  return `${Math.round(value)}%`;
}

function getSpacingNumberValue(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }

  return value;
}

function toBaseCssCustomPropertyName(
  variable: LocalVariable,
  category: BaseCssCategory,
): string {
  if (category === "color") {
    return toCssCustomPropertyName(variable.name);
  }

  if (category === "spacing") {
    return toSpacingCssCustomPropertyName(variable.name);
  }

  if (category === "border") {
    return toBorderCssCustomPropertyName(variable.name);
  }

  if (category === "size") {
    return toSizeCssCustomPropertyName(variable.name);
  }

  return toTypographyCssCustomPropertyName(variable.name).replace(
    /^--line-height-line-height(?=-|$)/,
    "--line-height",
  );
}

function makeColorCssValue(
  value: unknown,
  variablesById: { [id: string]: LocalVariable },
): string | null {
  if (isColorValue(value)) {
    return colorToCss(value);
  }

  if (isAliasValue(value)) {
    const targetVariable = variablesById[value.id];

    if (targetVariable && targetVariable.resolvedType === "COLOR") {
      return `var(${toCssCustomPropertyName(targetVariable.name)})`;
    }
  }

  return null;
}

function makeUniqueCssName(
  cssName: string,
  variable: LocalVariable,
  usedNames: { [cssName: string]: number },
): string {
  const seenCount = usedNames[cssName] ?? 0;
  usedNames[cssName] = seenCount + 1;

  if (seenCount === 0) {
    return cssName;
  }

  const suffix = variable.key || variable.id;
  const normalizedSuffix = toTokenPath(suffix).join("-").slice(0, 12);

  return `${cssName}-${normalizedSuffix || seenCount + 1}`;
}

function isColorCollection(collection: LocalVariableCollection): boolean {
  const collectionName = toTokenPath(collection.name).join("-");

  return (
    collectionName === "color" ||
    collectionName === "colors" ||
    collectionName === "colour" ||
    collectionName === "colours"
  );
}

function isLightMode(mode: LocalVariableCollection["modes"][number]): boolean {
  return toTokenPath(mode.name).join("-") === "light";
}

function getBaseColorValueMap(
  collections: LocalVariableCollection[],
  variables: LocalVariable[],
  variablesById: { [id: string]: LocalVariable },
): { [cssValue: string]: string } {
  const valueMap: { [cssValue: string]: string } = {};

  for (const collection of collections) {
    const collectionVariables = variables
      .filter(
        (variable) =>
          variable.variableCollectionId === collection.id &&
          variable.resolvedType === "COLOR",
      )
      .sort((first, second) => first.name.localeCompare(second.name));

    for (const variable of collectionVariables) {
      const cssValue = makeColorCssValue(
        variable.valuesByMode[collection.defaultModeId],
        variablesById,
      );

      if (cssValue && cssValue.indexOf("var(") !== 0 && !valueMap[cssValue]) {
        valueMap[cssValue] = toCssCustomPropertyName(variable.name);
      }
    }
  }

  return valueMap;
}

function buildBaseCss(
  collections: LocalVariableCollection[],
  variables: LocalVariable[],
  variablesById: { [id: string]: LocalVariable },
): string {
  const colorDeclarations: string[] = [];
  const spacingDeclarations: Array<{
    name: string;
    value: number;
    declaration: string;
  }> = [];
  const borderDeclarations: Array<{
    name: string;
    value: number;
    declaration: string;
  }> = [];
  const sizeDeclarations: Array<{
    name: string;
    value: number;
    declaration: string;
  }> = [];
  const typographyDeclarations: Array<{
    name: string;
    value: number | null;
    declaration: string;
  }> = [];
  const usedNames: { [cssName: string]: number } = {};
  const generatedAt = new Date().toISOString();

  for (const collection of collections) {
    const collectionVariables = variables
      .filter(
        (variable) =>
          variable.variableCollectionId === collection.id &&
          !isColorCollection(collection) &&
          getBaseCssCategory(variable) !== null,
      )
      .sort((first, second) => first.name.localeCompare(second.name));

    for (const variable of collectionVariables) {
      const category = getBaseCssCategory(variable);

      if (category === null) {
        continue;
      }

      const modeValue = variable.valuesByMode[collection.defaultModeId];
      const cssName = makeUniqueCssName(
        toBaseCssCustomPropertyName(variable, category),
        variable,
        usedNames,
      );
      const cssValue =
        category === "color"
          ? makeColorCssValue(modeValue, variablesById)
          : cssName.indexOf("--line-height") === 0
            ? makeLineHeightCssValue(modeValue)
            : makeTextCssValue(modeValue);

      if (!cssValue) {
        continue;
      }

      if (category === "color") {
        colorDeclarations.push(`  ${cssName}: ${cssValue};`);
      } else if (category === "spacing") {
        const spacingValue = getSpacingNumberValue(modeValue);

        if (spacingValue !== null) {
          spacingDeclarations.push({
            name: cssName,
            value: spacingValue,
            declaration: `  ${cssName}: ${cssValue};`,
          });
        }
      } else if (category === "border") {
        const borderValue = getSpacingNumberValue(modeValue);

        if (borderValue !== null) {
          borderDeclarations.push({
            name: cssName,
            value: borderValue,
            declaration: `  ${cssName}: ${cssValue};`,
          });
        }
      } else if (category === "size") {
        const sizeValue = getSpacingNumberValue(modeValue);

        if (sizeValue !== null) {
          sizeDeclarations.push({
            name: cssName,
            value: sizeValue,
            declaration: `  ${cssName}: ${cssValue};`,
          });
        }
      } else {
        typographyDeclarations.push({
          name: cssName,
          value: getSpacingNumberValue(modeValue),
          declaration: `  ${cssName}: ${cssValue};`,
        });
      }
    }
  }

  const sortNumericDeclarations = (
    first: { name: string; value: number },
    second: { name: string; value: number },
  ): number => {
    if (first.value !== second.value) {
      return first.value - second.value;
    }

    return first.name.localeCompare(second.name);
  };

  spacingDeclarations.sort(sortNumericDeclarations);
  borderDeclarations.sort(sortNumericDeclarations);
  sizeDeclarations.sort(sortNumericDeclarations);
  typographyDeclarations.sort((first, second) => {
    if (first.value !== null && second.value !== null && first.value !== second.value) {
      return first.value - second.value;
    }

    if (first.value !== null && second.value === null) {
      return -1;
    }

    if (first.value === null && second.value !== null) {
      return 1;
    }

    return first.name.localeCompare(second.name);
  });

  const declarations = colorDeclarations.concat(
    spacingDeclarations.map((spacing) => spacing.declaration),
    borderDeclarations.map((border) => border.declaration),
    sizeDeclarations.map((size) => size.declaration),
    typographyDeclarations.map((typography) => typography.declaration),
  );

  if (declarations.length === 0) {
    return `/* Generated ${generatedAt} */\n\n@theme {\n}\n`;
  }

  return `/* Generated ${generatedAt} */\n\n@theme {\n${declarations.join("\n")}\n}\n`;
}

function buildColorTokensCss(
  collections: LocalVariableCollection[],
  variables: LocalVariable[],
  variablesById: { [id: string]: LocalVariable },
): string {
  const generatedAt = new Date().toISOString();
  const colorCollection = collections.filter(isColorCollection)[0];

  if (!colorCollection) {
    return `/* Generated ${generatedAt} */\n\n@theme {\n}\n`;
  }

  const lightMode =
    colorCollection.modes.filter(isLightMode)[0] ||
    colorCollection.modes.filter(
      (mode) => mode.modeId === colorCollection.defaultModeId,
    )[0];
  const baseColorValueMap = getBaseColorValueMap(collections, variables, variablesById);
  const usedNames: { [cssName: string]: number } = {};
  const declarations: string[] = [];
  const collectionVariables = variables
    .filter(
      (variable) =>
        variable.variableCollectionId === colorCollection.id &&
        variable.resolvedType === "COLOR",
    )
    .sort((first, second) => first.name.localeCompare(second.name));

  if (!lightMode) {
    return `/* Generated ${generatedAt} */\n\n@theme {\n}\n`;
  }

  for (const variable of collectionVariables) {
    const modeValue = variable.valuesByMode[lightMode.modeId];
    let cssValue = makeColorCssValue(modeValue, variablesById);

    if (isColorValue(modeValue)) {
      const baseVariableName = baseColorValueMap[colorToCss(modeValue)];

      if (baseVariableName) {
        cssValue = `var(${baseVariableName})`;
      }
    }

    if (!cssValue) {
      continue;
    }

    const cssName = makeUniqueCssName(
      toCssCustomPropertyName(variable.name),
      variable,
      usedNames,
    );
    declarations.push(`  ${cssName}: ${cssValue};`);
  }

  if (declarations.length === 0) {
    return `/* Generated ${generatedAt} */\n\n@theme {\n}\n`;
  }

  return `/* Generated ${generatedAt} */\n\n@theme {\n${declarations.join("\n")}\n}\n`;
}

function makeAliasReference(
  alias: FigmaVariableAlias,
  variablesById: { [id: string]: LocalVariable },
): string {
  const targetVariable = variablesById[alias.id];

  if (!targetVariable) {
    return `{${alias.id}}`;
  }

  return `{${toTokenPath(targetVariable.name).join(".")}}`;
}

function makeTokenValue(
  value: unknown,
  variable: LocalVariable,
  variablesById: { [id: string]: LocalVariable },
): StyleDictionaryTokenValue | null {
  if (isAliasValue(value)) {
    return makeAliasReference(value, variablesById);
  }

  if (isColorValue(value)) {
    return colorToHex(value);
  }

  if (
    variable.resolvedType === "FLOAT" &&
    typeof value === "number" &&
    Number.isFinite(value)
  ) {
    return value;
  }

  if (variable.resolvedType === "STRING" && typeof value === "string") {
    return value;
  }

  if (variable.resolvedType === "BOOLEAN" && typeof value === "boolean") {
    return value;
  }

  return null;
}

function setTokenAtPath(
  tokens: StyleDictionaryTokenTree,
  path: string[],
  token: StyleDictionaryToken,
): void {
  let current = tokens;

  for (let index = 0; index < path.length - 1; index += 1) {
    const segment = path[index];
    const existing = current[segment];

    if (!existing || "$value" in existing) {
      current[segment] = {};
    }

    current = current[segment] as StyleDictionaryTokenTree;
  }

  current[path[path.length - 1]] = token;
}

function buildModeTokens(
  collection: LocalVariableCollection,
  variables: LocalVariable[],
  mode: LocalVariableCollection["modes"][number],
  variablesById: { [id: string]: LocalVariable },
): StyleDictionaryTokenTree {
  const tokens: StyleDictionaryTokenTree = {};

  for (const variable of variables) {
    const tokenValue = makeTokenValue(
      variable.valuesByMode[mode.modeId],
      variable,
      variablesById,
    );

    if (tokenValue === null) {
      continue;
    }

    const token: StyleDictionaryToken = {
      $type: getTokenType(variable),
      $value: tokenValue,
      $extensions: {
        figma: {
          id: variable.id,
          key: variable.key,
          name: variable.name,
          collection: collection.name,
          mode: mode.name,
          resolvedType: variable.resolvedType,
          scopes: variable.scopes.slice(),
        },
      },
    };

    if (variable.description.trim()) {
      token.$description = variable.description;
    }

    setTokenAtPath(tokens, toTokenPath(variable.name), token);
  }

  return tokens;
}

function buildCollectionExport(
  collection: LocalVariableCollection,
  variables: LocalVariable[],
  variablesById: { [id: string]: LocalVariable },
): StyleDictionaryCollectionExport {
  const collectionVariables = variables.filter(
    (variable) => variable.variableCollectionId === collection.id,
  );

  return {
    collectionId: collection.id,
    collectionName: collection.name,
    defaultModeId: collection.defaultModeId,
    modeCount: collection.modes.length,
    variableCount: collectionVariables.length,
    modes: collection.modes.map((mode) => ({
      modeId: mode.modeId,
      modeName: mode.name,
      isDefault: mode.modeId === collection.defaultModeId,
      tokens: buildModeTokens(collection, collectionVariables, mode, variablesById),
    })),
  };
}

function countVariablesByType(
  variables: LocalVariable[],
): VariablesExport["variableCountsByType"] {
  return variables.reduce<VariablesExport["variableCountsByType"]>(
    (counts, variable) => {
      counts[getTokenType(variable)] += 1;
      return counts;
    },
    {
      color: 0,
      number: 0,
      string: 0,
      boolean: 0,
    },
  );
}

async function getVariablesExport(): Promise<VariablesExport> {
  const [collections, variables] = await Promise.all([
    figma.variables.getLocalVariableCollectionsAsync(),
    figma.variables.getLocalVariablesAsync(),
  ]);

  const variablesById = variables.reduce<{ [id: string]: LocalVariable }>(
    (byId, variable) => {
      byId[variable.id] = variable;
      return byId;
    },
    {},
  );
  const collectionsJson = collections
    .map((collection) => buildCollectionExport(collection, variables, variablesById))
    .filter((collection) => collection.variableCount > 0);
  const textStyles = await getTextStylesExport();

  return {
    format: "style-dictionary",
    tokenSyntax: "dtcg",
    fileName: figma.root.name,
    baseCss: buildBaseCss(collections, variables, variablesById),
    colorTokensCss: buildColorTokensCss(collections, variables, variablesById),
    typographyCss: buildTypographyCssFromTextStyles(
      textStyles,
      variablesById,
      variables,
    ),
    colorVariableCount: variables.filter(
      (variable) => variable.resolvedType === "COLOR",
    ).length,
    collectionCount: collectionsJson.length,
    variableCount: collectionsJson.reduce(
      (count, collection) => count + collection.variableCount,
      0,
    ),
    variableCountsByType: countVariablesByType(variables),
    collections: collectionsJson,
  };
}

async function reportVariablesJson(): Promise<void> {
  figma.ui.postMessage({ type: "variables-loading" });

  try {
    const variablesJson = await getVariablesExport();
    figma.ui.postMessage({ type: "variables-json", data: variablesJson });
    figma.notify(
      `Exported ${variablesJson.variableCount} tokens from ${variablesJson.collectionCount} collections.`,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    figma.ui.postMessage({ type: "variables-error", error: message });
    figma.notify("Could not export variables.");
  }
}

figma.ui.onmessage = (msg: UiMessage) => {
  if (msg.type === "refresh-variables") {
    void reportVariablesJson();
    return;
  }

  if (msg.type === "close-plugin") {
    figma.closePlugin();
  }
};

void reportVariablesJson();
