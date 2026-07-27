# AGENT.md

## Purpose

This file instructs an implementation agent how to build and maintain a Figma plugin that exports Figma Variables into structured JSON files and transforms those files into Tailwind CSS v4-compatible output.

The plugin must:

1. Read Figma Variables from local variable collections.
2. Serialize collections, modes, variables, values, aliases, and metadata into structured JSON objects/files.
3. Convert the exported JSON into Tailwind CSS v4 theme output.
4. Convert all typography variables into Tailwind CSS utility classes inside `@layer utilities`.

The agent should prefer correctness, deterministic output, and recoverable handling of incomplete design-token data over clever shortcuts.

## Target Architecture

Use a small pipeline with explicit boundaries:

```text
Figma plugin main thread
  -> reads variable collections and variables
  -> normalizes Figma API objects into serializable token JSON
  -> sends JSON payload to plugin UI

Plugin UI
  -> previews export summary and validation warnings
  -> lets the user download JSON and CSS files
  -> optionally lets user choose modes, collections, and output naming strategy

Conversion layer
  -> transforms token JSON into Tailwind CSS v4
  -> resolves aliases where possible
  -> emits unresolved aliases as CSS variable references or validation warnings
```

Recommended implementation modules:

```text
src/
  main.ts                  # Figma plugin controller, variable API access
  ui.tsx                   # UI shell, export controls, download actions
  pipeline/
    collectVariables.ts    # reads collections, modes, variables
    normalizeTokens.ts     # maps Figma objects to JSON-safe token records
    resolveAliases.ts      # builds alias graph and resolves references safely
    toTailwindV4.ts        # converts normalized JSON to Tailwind v4 CSS
    typography.ts          # typography-specific parsing and utility generation
    validateTokens.ts      # warnings, errors, edge-case checks
  types/
    tokens.ts              # exported JSON data shapes
    figma.ts               # narrowed Figma API adapter types
  utils/
    naming.ts              # name normalization and collision handling
    color.ts               # RGBA to CSS color conversion
    units.ts               # px/rem/number conversion
```

Keep Figma API reads in `main.ts` or API adapter modules. Keep pure transformation logic free of Figma globals so it can be unit-tested outside Figma.

## Plugin/API Constraints

Figma plugin code has two execution environments:

- The plugin controller/main context can access `figma.variables`, `figma.notify`, `figma.ui.postMessage`, and document APIs.
- The plugin UI context can render HTML, allow file downloads, and receive messages from the controller.

Important constraints:

- Do not call Figma plugin APIs from the UI iframe.
- Do not use Node-only APIs such as `fs`, `path`, or process globals in plugin runtime code.
- Download files from the UI using `Blob`, `URL.createObjectURL`, and an `<a download>` click.
- Treat variable IDs and collection IDs as stable within a Figma file but not portable across files.
- Variable aliases may point across collections. Preserve alias metadata even when resolved values are emitted.
- Variable values can differ by mode. Never flatten modes silently.
- Remote library variables may have access constraints. Start with local variables and explicitly mark unsupported remote-library behavior if not implemented.

Use asynchronous Figma variable APIs if the project targets dynamic-page access:

```ts
const collections = await figma.variables.getLocalVariableCollectionsAsync();
const variables = await figma.variables.getLocalVariablesAsync();
```

If the project is configured for current-page access and uses synchronous APIs, isolate that choice behind the collection adapter so the rest of the pipeline is unchanged.

## Data Shapes

Export JSON should be structured, explicit, and versioned.

### Export Bundle

```ts
type TokenExportBundle = {
  schemaVersion: "1.0.0";
  source: {
    tool: "figma-plugin";
    fileKey?: string;
    fileName?: string;
    exportedAt: string; // ISO 8601
  };
  collections: TokenCollection[];
  variables: TokenVariable[];
  aliases: TokenAlias[];
  validation: ValidationResult;
};
```

### Collection

```ts
type TokenCollection = {
  id: string;
  key: string;
  name: string;
  normalizedName: string;
  modes: TokenMode[];
  defaultModeId: string;
  variableIds: string[];
};

type TokenMode = {
  id: string;
  name: string;
  normalizedName: string;
};
```

### Variable

```ts
type TokenVariable = {
  id: string;
  key: string;
  name: string;
  path: string[];
  normalizedPath: string[];
  cssName: string;
  collectionId: string;
  resolvedType: "COLOR" | "FLOAT" | "STRING" | "BOOLEAN";
  scopes: string[];
  hiddenFromPublishing: boolean;
  valuesByMode: Record<string, TokenModeValue>;
  description?: string;
};

type TokenModeValue =
  | ColorTokenValue
  | NumberTokenValue
  | StringTokenValue
  | BooleanTokenValue
  | AliasTokenValue
  | UnsupportedTokenValue;

type ColorTokenValue = {
  kind: "color";
  value: {
    r: number; // 0..1
    g: number; // 0..1
    b: number; // 0..1
    a: number; // 0..1
  };
  css: string; // rgb(), rgba(), or color-mix-compatible string
};

type NumberTokenValue = {
  kind: "number";
  value: number;
  unit?: "px" | "rem" | "ms" | "percent" | "number";
  css: string;
};

type StringTokenValue = {
  kind: "string";
  value: string;
  css: string;
};

type BooleanTokenValue = {
  kind: "boolean";
  value: boolean;
};

type AliasTokenValue = {
  kind: "alias";
  aliasTo: {
    id: string;
    key?: string;
    name?: string;
    cssName?: string;
  };
  resolved?: Exclude<TokenModeValue, AliasTokenValue>;
};

type UnsupportedTokenValue = {
  kind: "unsupported";
  reason: string;
  rawType: string;
};
```

### Alias

```ts
type TokenAlias = {
  fromVariableId: string;
  fromModeId: string;
  toVariableId: string;
  resolved: boolean;
  circular: boolean;
  path: string[];
};
```

### Validation

```ts
type ValidationResult = {
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
};

type ValidationIssue = {
  code: string;
  message: string;
  variableId?: string;
  collectionId?: string;
  modeId?: string;
};
```

## JSON File Layout

Emit both a complete bundle and focused files.

```text
tokens/
  figma-tokens.json             # complete TokenExportBundle
  collections.json              # TokenCollection[]
  variables.json                # TokenVariable[]
  aliases.json                  # TokenAlias[]
  validation.json               # ValidationResult
tailwind/
  tokens.css                    # Tailwind v4 theme variables and utilities
  tokens.theme.css              # optional theme-only output
  tokens.utilities.css          # optional typography utilities only
```

If the plugin exports a zip, use the same paths inside the archive.

## Naming Rules

Names must be deterministic, CSS-safe, and collision-aware.

Figma variable names usually use slash-separated paths:

```text
Color/Brand/Primary
Spacing/4
Typography/Heading/H1/Font Size
```

Normalize names as follows:

1. Split Figma variable names on `/`.
2. Trim whitespace from each segment.
3. Convert each segment to kebab-case.
4. Remove unsupported CSS custom property characters.
5. Collapse repeated hyphens.
6. Remove leading and trailing hyphens.
7. Preserve meaningful numbers, such as `100`, `2xl`, `1-5`, and `0-75`.
8. Prefix generated CSS custom properties with `--`.
9. Detect collisions after normalization and append a deterministic suffix based on collection or variable key.

Examples:

```text
Color/Brand/Primary        -> --color-brand-primary
Color / Brand / Primary    -> --color-brand-primary
Spacing/1.5                -> --spacing-1-5
Typography/Heading/H1      -> typography-heading-h1
```

Do not silently overwrite colliding tokens. Record a `NAME_COLLISION` warning and preserve both tokens with deterministic names.

## Collection and Mode Handling

Collections are first-class output objects. Each variable must reference its collection and provide values by mode ID.

Rules:

- Preserve every collection unless the user explicitly filters collections.
- Preserve every mode unless the user explicitly filters modes.
- Store mode IDs and normalized mode names.
- Use the collection default mode as the default CSS output.
- For non-default modes, emit selectors using a configurable mode strategy.

Recommended mode strategies:

```css
@theme {
  --color-bg: #ffffff;
}

[data-theme="dark"] {
  --color-bg: #000000;
}
```

For multiple collections with overlapping mode names, include the collection name when needed:

```css
[data-color-mode="dark"] {
  --color-bg: #000000;
}

[data-density-mode="compact"] {
  --spacing-control-y: 0.375rem;
}
```

Do not merge modes from different collections unless the user chooses an explicit merge strategy.

## Alias Handling

Figma aliases are represented as values with `type: "VARIABLE_ALIAS"` and an `id` target.

The agent must:

- Preserve alias references in JSON.
- Build an alias graph.
- Resolve aliases per mode where possible.
- Detect circular aliases.
- Detect missing alias targets.
- Avoid infinite recursion.
- Emit CSS custom property references for aliases when appropriate.

Example JSON value:

```json
{
  "kind": "alias",
  "aliasTo": {
    "id": "VariableID:123",
    "name": "Color/Brand/Primary",
    "cssName": "--color-brand-primary"
  },
  "resolved": {
    "kind": "color",
    "value": { "r": 0.1, "g": 0.2, "b": 0.9, "a": 1 },
    "css": "#1a33e6"
  }
}
```

Example CSS output:

```css
@theme {
  --color-button-bg: var(--color-brand-primary);
}
```

If an alias cannot be resolved, keep `var(--known-name)` when the target name is known. Otherwise, emit a warning and skip the CSS declaration for that value.

## Tailwind CSS v4 Output

Tailwind CSS v4 uses CSS-first configuration through `@theme`, CSS custom properties, and layers.

The generated output should be valid CSS that can be imported by the app:

```css
@import "tailwindcss";

@theme {
  --color-brand-primary: #1a33e6;
  --spacing-4: 1rem;
  --radius-md: 0.375rem;
}

@layer utilities {
  .type-heading-h1 {
    font-family: var(--font-heading);
    font-size: 2.5rem;
    line-height: 1.1;
    font-weight: 700;
    letter-spacing: 0;
  }
}
```

Output rules:

- Emit primitive design tokens as CSS custom properties inside `@theme`.
- Use Tailwind-recognized namespaces where possible:
  - `--color-*`
  - `--font-*`
  - `--text-*`
  - `--spacing-*`
  - `--radius-*`
  - `--shadow-*`
  - `--breakpoint-*`
  - `--ease-*`
  - `--animate-*`
- Emit typography composites as utility classes inside `@layer utilities`.
- Keep CSS declaration order deterministic: collections, variable path, mode.
- Include generated comments only when useful for warnings or source context.
- Do not emit invalid CSS identifiers.

## Token Category Mapping

Infer token category from variable path, scopes, and type.

Recommended mapping:

```text
Color/*                         -> --color-*
Colors/*                        -> --color-*
Spacing/*, Space/*, Gap/*       -> --spacing-*
Radius/*, Border Radius/*       -> --radius-*
Font/*, Font Family/*           -> --font-*
Typography/*/Font Size          -> typography utility property
Typography/*/Line Height        -> typography utility property
Typography/*/Font Weight        -> typography utility property
Typography/*/Letter Spacing     -> typography utility property
Shadow/*                        -> --shadow-*
Breakpoint/*                    -> --breakpoint-*
Duration/*                      -> --duration-* or utility-local property
Easing/*                        -> --ease-*
```

When the category is ambiguous, preserve the normalized full path and emit a warning:

```css
@theme {
  --token-product-card-depth: 4;
}
```

## Typography Variables

All typography variables must be converted into Tailwind CSS utilities inside `@layer utilities`.

Typography may appear as individual variables:

```text
Typography/Heading/H1/Font Family
Typography/Heading/H1/Font Size
Typography/Heading/H1/Line Height
Typography/Heading/H1/Font Weight
Typography/Heading/H1/Letter Spacing
Typography/Heading/H1/Text Transform
Typography/Heading/H1/Paragraph Spacing
```

Group typography variables by the shared path before the final property segment:

```text
Typography/Heading/H1/Font Size
Typography/Heading/H1/Line Height
```

becomes:

```css
@layer utilities {
  .type-heading-h1 {
    font-family: var(--font-heading);
    font-size: 2.5rem;
    line-height: 1.1;
    font-weight: 700;
    letter-spacing: 0;
  }
}
```

Typography utility naming:

```text
Typography/Heading/H1 -> .type-heading-h1
Typography/Body/Small -> .type-body-small
Typography/Label/LG   -> .type-label-lg
```

Typography property mapping:

```text
Font Family       -> font-family
Font Size         -> font-size
Line Height       -> line-height
Font Weight       -> font-weight
Letter Spacing    -> letter-spacing
Text Case         -> text-transform
Text Transform    -> text-transform
Paragraph Spacing -> margin-bottom, if explicitly enabled; otherwise warn
Paragraph Indent  -> text-indent
```

Prefer using CSS variables for typography primitives when the primitive exists:

```css
@theme {
  --font-sans: Inter, sans-serif;
  --text-heading-h1: 2.5rem;
}

@layer utilities {
  .type-heading-h1 {
    font-family: var(--font-sans);
    font-size: var(--text-heading-h1);
    line-height: 1.1;
    font-weight: 700;
  }
}
```

If Figma exports typography values only as separate variables, synthesize the utility class from those variables. If a typography group is incomplete, emit the class with available declarations and add a validation warning.

## Unit Conversion

Recommended defaults:

- Color RGBA values: convert to hex when alpha is `1`; convert to `rgba()` or modern `rgb(... / alpha)` when alpha is less than `1`.
- Pixel sizes: convert to `rem` using a configurable base, default `16px`.
- Line height:
  - If the token is a ratio, emit the unitless value.
  - If the token is pixels, convert to `rem`.
  - If both font size and line height are known, optionally emit a unitless ratio rounded to 4 decimals.
- Letter spacing:
  - Preserve `0` as `0`.
  - Convert pixels to `em` when font size is known, otherwise `rem`.
- Font weight:
  - Normalize common names: `Regular -> 400`, `Medium -> 500`, `Semibold -> 600`, `Bold -> 700`.
- Spacing and radius:
  - Convert px to rem by default.
  - Preserve `0` as `0`.
- Duration:
  - Use `ms` unless the variable name clearly indicates seconds.

Conversion examples:

```text
16px -> 1rem
24px -> 1.5rem
2px letter spacing with 40px font size -> 0.05em
rgba(26, 51, 230, 1) -> #1a33e6
rgba(26, 51, 230, 0.5) -> rgb(26 51 230 / 0.5)
```

## Conversion Example

Input Figma variables:

```text
Collection: Brand
Modes: Light, Dark

Color/Brand/Primary
  Light: { r: 0.1, g: 0.2, b: 0.9, a: 1 }
  Dark:  { r: 0.6, g: 0.7, b: 1.0, a: 1 }

Color/Button/Background
  Light: alias(Color/Brand/Primary)
  Dark:  alias(Color/Brand/Primary)

Typography/Heading/H1/Font Family
  Light: "Inter"

Typography/Heading/H1/Font Size
  Light: 40

Typography/Heading/H1/Line Height
  Light: 44

Typography/Heading/H1/Font Weight
  Light: 700
```

Output JSON excerpt:

```json
{
  "schemaVersion": "1.0.0",
  "collections": [
    {
      "id": "VariableCollectionId:1",
      "key": "brand-key",
      "name": "Brand",
      "normalizedName": "brand",
      "defaultModeId": "mode-light",
      "modes": [
        { "id": "mode-light", "name": "Light", "normalizedName": "light" },
        { "id": "mode-dark", "name": "Dark", "normalizedName": "dark" }
      ],
      "variableIds": ["VariableID:1", "VariableID:2"]
    }
  ]
}
```

Output CSS:

```css
@import "tailwindcss";

@theme {
  --color-brand-primary: #1a33e6;
  --color-button-background: var(--color-brand-primary);
}

[data-theme="dark"] {
  --color-brand-primary: #99b3ff;
  --color-button-background: var(--color-brand-primary);
}

@layer utilities {
  .type-heading-h1 {
    font-family: Inter, sans-serif;
    font-size: 2.5rem;
    line-height: 2.75rem;
    font-weight: 700;
  }
}
```

## Validation

Run validation before file generation and expose issues in the UI.

Required validation checks:

- `MISSING_MODE_VALUE`: variable has no value for a collection mode.
- `UNRESOLVED_ALIAS`: alias target cannot be found.
- `CIRCULAR_ALIAS`: alias graph loops back on itself.
- `NAME_COLLISION`: two variables produce the same normalized CSS name.
- `UNSUPPORTED_TYPE`: value cannot be converted to JSON or CSS.
- `INVALID_CSS_IDENTIFIER`: generated property or class name is invalid.
- `INCOMPLETE_TYPOGRAPHY_GROUP`: typography utility is missing expected properties.
- `AMBIGUOUS_CATEGORY`: variable cannot be mapped confidently to a Tailwind namespace.
- `REMOTE_VARIABLE_UNSUPPORTED`: remote/library variable is referenced but cannot be read.

Errors should block CSS export only when output would be invalid or misleading. Warnings should allow export.

Validation UI should show:

- Number of collections exported.
- Number of variables exported.
- Number of aliases resolved.
- Number of warnings and errors.
- A downloadable validation JSON file.

## Implementation Steps

1. Create narrowed TypeScript types for the token JSON schema.
2. Build a Figma variable adapter that reads local collections and local variables.
3. Normalize collection names, modes, variable paths, and CSS names.
4. Serialize all variables into `TokenExportBundle`.
5. Preserve raw mode values as typed `TokenModeValue` objects.
6. Build alias lookup tables by variable ID and mode ID.
7. Resolve aliases recursively with circular-reference detection.
8. Implement category inference and Tailwind namespace mapping.
9. Implement CSS value formatting for colors, numbers, strings, booleans, aliases, and unsupported values.
10. Implement typography grouping from variable paths.
11. Generate `@theme` output for primitive tokens.
12. Generate `@layer utilities` output for all typography groups.
13. Add validation and expose warnings/errors in the UI.
14. Add download actions for JSON, CSS, and optional zip export.
15. Add tests for normalization, alias resolution, mode handling, typography grouping, and CSS generation.

## Testing Guidance

Pure pipeline modules should be unit-tested without Figma.

Minimum test cases:

- Exports a single color token from one collection and one mode.
- Exports light/dark mode values without losing either mode.
- Converts color alpha values correctly.
- Resolves a simple alias.
- Preserves an unresolved alias and emits a warning.
- Detects circular aliases.
- Normalizes names with spaces, slashes, punctuation, numbers, and duplicate names.
- Converts spacing and radius numbers to rem.
- Groups typography variables into one utility class.
- Emits incomplete typography utilities with warnings.
- Produces deterministic CSS ordering.
- Produces valid JSON matching the schema.

Add fixture-style tests with representative `TokenExportBundle` JSON objects rather than depending on live Figma documents.

## Edge Cases

Handle these deliberately:

- Empty Figma file with no local variables.
- Collection with zero variables.
- Variable with values for only some modes.
- Variable aliases target deleted or inaccessible variables.
- Alias chains cross collections.
- Alias chain resolves differently per mode.
- Circular aliases across two or more variables.
- Duplicate variable names across collections.
- Duplicate normalized names caused by punctuation or casing differences.
- Variables with hidden-from-publishing enabled.
- Variables using unsupported scopes.
- Numeric variables whose unit cannot be inferred.
- Typography group with missing font family or line height.
- Typography variable names that do not use the expected final property segment.
- Color values with alpha `0`.
- String values requiring CSS quoting.
- Font family names with spaces.
- User chooses only one mode from a multi-mode collection.
- Remote variables are present but unavailable to plugin APIs.

## Acceptance Criteria

The implementation is complete when:

- The plugin can read all local Figma variable collections.
- The plugin exports a complete versioned JSON bundle.
- The JSON bundle includes collections, modes, variables, aliases, and validation results.
- The plugin can generate Tailwind CSS v4-compatible output from the JSON bundle.
- Primitive tokens are emitted inside `@theme`.
- All typography variables are converted into classes inside `@layer utilities`.
- Mode-specific values are preserved and emitted with deterministic selectors.
- Aliases are preserved in JSON and resolved or represented correctly in CSS.
- Circular and unresolved aliases are detected.
- Naming is deterministic and collision-aware.
- The UI lets the user download JSON and CSS outputs.
- Tests cover the conversion pipeline without requiring a live Figma file.
- The generated CSS can be imported into a Tailwind v4 project.

## Agent Notes

Prefer small, testable pure functions. Do not bind conversion logic directly to Figma plugin globals. Keep the JSON schema stable and versioned so future plugin versions can add fields without breaking downstream consumers.

When in doubt, preserve more source metadata in JSON and emit conservative CSS with validation warnings. The JSON export should be the source of truth; Tailwind CSS output should be a reproducible build artifact derived from it.
