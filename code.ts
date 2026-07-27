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

figma.showUI(__html__, { width: 560, height: 640 });

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
  const path = stripLeadingCategorySegments(toTokenPath(name), [
    "typography",
    "type",
  ]);
  const lastSegment = path[path.length - 1];
  const parentPath = path.slice(0, -1);
  const letterSpacingIndex = path.indexOf("letter-spacing");

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
    return `--leading-${(parentPath.length > 0 ? parentPath : ["normal"]).join("-")}`;
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

  return toTypographyCssCustomPropertyName(variable.name);
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
          getBaseCssCategory(variable) !== null,
      )
      .sort((first, second) => first.name.localeCompare(second.name));

    for (const variable of collectionVariables) {
      const category = getBaseCssCategory(variable);

      if (category === null) {
        continue;
      }

      const modeValue = variable.valuesByMode[collection.defaultModeId];
      const cssValue =
        category === "color"
          ? makeColorCssValue(modeValue, variablesById)
          : makeTextCssValue(modeValue);

      if (!cssValue) {
        continue;
      }

      const cssName = makeUniqueCssName(
        toBaseCssCustomPropertyName(variable, category),
        variable,
        usedNames,
      );

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

  return {
    format: "style-dictionary",
    tokenSyntax: "dtcg",
    fileName: figma.root.name,
    baseCss: buildBaseCss(collections, variables, variablesById),
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
