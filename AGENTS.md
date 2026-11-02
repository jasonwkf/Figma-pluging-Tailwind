# AGENTS.md

## Purpose and scope

Maintain the command-line pipeline that exports design tokens from Figma through MCP and generates Tailwind CSS v4 files and a Tailwind CSS v3 configuration.

The primary workflow is:

```text
ZB-Design-System-Master
  -> Figma MCP retrieval in bounded batches
  -> verified tokens/figma-variables.json
  -> version-specific local compilers
  -> tailwind4/*.css and tailwind3/tailwind.config.js
```

Work on token retrieval, JSON assembly, conversion scripts, generated artifacts, and conversion tests. Existing plugin files are legacy context; change plugin runtime code, UI, manifests, or download flows only when the user explicitly requests plugin work.

Prefer correctness, deterministic naming, complete source data, and reproducible output. Keep conversion functions independent of live Figma access.

## Repository entry points

| Path | Responsibility |
| --- | --- |
| `tokens/figma-variables.json` | Complete source bundle retrieved through Figma MCP |
| `scripts/figmatotailwind.mjs` | Bundle assembly helpers and Tailwind v4 generation |
| `scripts/figmatotailwind3.mjs` | Tailwind v3 configuration generation |
| `scripts/figmatotailwind.test.mjs` | Tailwind v4 conversion tests |
| `scripts/figmatotailwind3.test.mjs` | Tailwind v3 conversion tests |
| `tailwind4/` | Generated Tailwind v4 CSS |
| `tailwind3/` | Generated Tailwind v3 configuration |

Use the commands defined in `package.json`. The generation commands read local JSON; they do not connect to Figma. `npm run build` builds legacy plugin TypeScript and is not the token generation command.

## Required Figma MCP refresh

Before generating either Tailwind version for the ZB Design System:

1. Retrieve fresh local variable collections, modes, variables, values, and alias references from **ZB-Design-System-Master**, file key `pijva5QtMXOesieYY9lmEn`, through Figma MCP.
2. Load any required Figma tool skill before calling the corresponding tool. Use bounded batches for large responses.
3. Assemble `tokens/figma-variables.json` using `createTokenBundle`, `mergeVariableBatch`, and `writeTokenBundleInBatches` where practical. Deduplicate variables by ID and checkpoint valid JSON after each batch.
4. Set `source.complete` to `false` during retrieval. Preserve the source file key, file name, tool (`figma-mcp`), and a fresh ISO 8601 export timestamp.
5. Verify collection and unique variable counts against the MCP retrieval. Check collection membership, mode values, and alias targets. Record inaccessible targets and validation issues explicitly.
6. Mark `source.complete` as `true` only after every batch is assembled and the counts and source metadata are verified. Save the verified bundle before running either compiler.
7. If MCP access fails or retrieval is incomplete, stop and report the problem. Never substitute a stale bundle or generate from a partial checkpoint.

One complete, fresh retrieval can feed both versions in the same task. Compiler maintenance and fixture tests do not require a live Figma refresh unless source-derived output is being regenerated.

Both versions require this verification even if a compiler does not enforce every check itself.

## Source bundle contract

Preserve the existing `schemaVersion: "1.0.0"` bundle format and compatibility with the scripts:

- `source`: provenance, file key, file name, export timestamp, and completeness.
- `collections`: IDs, keys, names, normalized names, modes, default mode IDs, and variable IDs.
- `variables`: IDs, keys, names, collection IDs, resolved types, scopes, publishing metadata, descriptions where available, and `valuesByMode`.
- `aliases`: source variable and mode IDs plus target variable IDs.
- `validation`: errors and warnings with relevant variable, collection, and mode IDs.

The v4 compiler currently consumes raw Figma values in `valuesByMode`: numbers, strings, booleans, RGBA objects, and `{ "type": "VARIABLE_ALIAS", "id": "..." }` references. Preserve this representation. Do not replace it with typed `kind` wrappers without updating both compilers and their tests together.

Keep every source collection and mode unless the user requests filtering. Focused JSON files are derived views; the complete source bundle remains the source of truth. Keep cross-collection alias targets in the complete bundle even when a focused view excludes them.

## Generation commands and artifacts

Run the requested version, or both when the user asks for both:

```bash
npm run tailwind4:output
npm run tailwind3:output
```

Expected repository outputs:

```text
tokens/
  figma-variables.json          # verified MCP source
  primitives.json               # v4 primitive subset
  colour-token.json             # v4 semantic colour subset
  typography.json               # v4 font-adjustment subset
tailwind4/
  base.css                      # primitive @theme declarations
  colour-token.css              # semantic colours and mode selectors
  typography.css                # @utility text-* blocks
  breakpoint.css                # @theme breakpoint declarations
tailwind3/
  tailwind.config.js            # ES module configuration
```

The v3 CLI writes only to its output directory (default: `tailwind3/`). It does not copy the config to a consuming application.

The current v3 compiler emits configuration only. CSS variables referenced by that configuration must be supplied by the consuming application.

Input overrides:

```bash
npm run tailwind4:output -- ./tokens/figma-variables.json
npm run tailwind3:output -- ./tokens/figma-variables.json ./dist/tailwind3
```

Both commands support `FIGMA_VARIABLES_JSON`. V3 also supports `FIGMA_TAILWIND3_OUTPUT_DIR`. V4 supports `FIGMA_OUTPUT_DIR`, but currently uses its parent directory as the root for fixed `tokens/` and `tailwind4/` paths; inspect that behavior before selecting a custom destination.

## Shared conversion rules

- Normalize slash-separated names into CSS-safe kebab-case and collapse repeated path segments or prefixes.
- Preserve meaningful numeric names, including decimal spacing steps converted to hyphenated names.
- Detect normalized-name collisions, retain both tokens with deterministic suffixes, and report them.
- Sort output consistently by collection, token path, and stable ID where needed.
- Preserve aliases in JSON. Use CSS variable references when the target name is known; report missing targets, type mismatches, and cycles without infinite recursion.
- Resolve cross-collection mode references by matching mode names where supported, with an explicit default fallback. Never treat unrelated mode IDs as interchangeable.
- Preserve non-default source values. Report any output scope that intentionally represents only selected modes or token categories.
- Quote and escape string values safely. Preserve transparent colours and numeric zero.
- Preserve the established unit convention: v4 currently emits ordinary numeric dimensions in pixels, line-height primitives as percentages, and font weights as unitless values. Do not introduce a rem conversion or change units without an explicit requirement and regression coverage.
- Do not edit generated files manually to fix compiler behavior. Change the source transformation, then regenerate from verified input.

Naming examples:

```text
Colour/Yellow/yellow-100             -> --color-yellow-100
Spacing/spacing-4                    -> --spacing-4
Typography/Weight/font-weight-bold   -> --font-weight-bold
```

## Tailwind CSS v4 requirements

Use `scripts/figmatotailwind.mjs` and preserve the established ZB mappings:

- `Primitives` feeds `tokens/primitives.json` and `tailwind4/base.css`.
- `Colours` or `Colors` feeds `tokens/colour-token.json` and `tailwind4/colour-token.css`.
- `Font Adjustment` feeds `tokens/typography.json` and `tailwind4/typography.css`.
- `Breakpoints` supplies recognized `page-width` values for `tailwind4/breakpoint.css`: `390 -> xs`, `768 -> md`, and `1200 -> lg`.

Emit primitive and semantic declarations inside `@theme`. Keep established primitive references such as `--size-*`, `--line-height-*`, `--font-weight-*`, and `--letter-spacing-*` even when they are not automatic Tailwind utility namespaces.

Use top-level `@utility text-*` blocks for typography, preserving the existing style-family mappings and overrides. Reference primitives where available:

```css
@utility text-body1 {
    font-size: var(--size-18);
    line-height: var(--line-height-md);
    font-weight: var(--font-weight-regular);
    letter-spacing: var(--letter-spacing-sm);
}
```

Preserve semantic colour mode selectors and typography mode overrides using the collection and mode normalized names. Primitive CSS currently uses the collection default mode; retain other source modes in JSON and report this limitation when relevant.

If a required primitive or typography value is unavailable, report it and avoid invalid fallback declarations. Do not silently invent design values. Keep these files importable by a consuming Tailwind v4 stylesheet without repeating framework imports in every generated file.

## Tailwind CSS v3 requirements

Use `scripts/figmatotailwind3.mjs` to emit an ES module config with `export default`. Preserve:

- `content: ["./src/**/*.{astro,html,js,jsx,ts,tsx,vue}"]`, unless the user supplies different consumer paths.
- `darkMode: "class"` with the correct casing.
- `theme.fontFamily.sans` using deduplicated family variable references followed by `Arial` and `sans-serif`.
- `theme.colors` containing nested primitive palettes and semantic colour references.
- `theme.extend.backgroundColor` containing background token references so semantic backgrounds coexist with palette `bg-*` utilities.
- `theme.extend.screens` containing recognized breakpoint mappings.
- The existing `no-hover` variant for `@media (hover: none)`.

Use `var(--color-...)` and `var(--family-...)` references matching the application's CSS contract. Each background token references its own variable so application mode changes can update its value.

Validate every source mode. Select Light when present, otherwise the collection default, to determine config entries. Mode-specific values come from application CSS; the config does not embed separate theme values for each mode.

Current v3 scope covers colours, font families, breakpoints, and the existing variant. Typography composites and spacing configuration require an explicit scope extension. Keep v3 syntax separate from v4 `@theme` and `@utility` output.

## Validation and testing

Before generation, check source completeness, collection membership, required mode values, aliases, collisions, and supported values. Report issues with stable codes such as:

```text
MISSING_COLLECTION
MISSING_MODE_VALUE
UNRESOLVED_ALIAS
CIRCULAR_ALIAS
NAME_COLLISION
UNSUPPORTED_TYPE
INVALID_CSS_IDENTIFIER
INCOMPLETE_TYPOGRAPHY_GROUP
AMBIGUOUS_CATEGORY
REMOTE_VARIABLE_UNSUPPORTED
```

Block generation for incomplete retrieval or errors that would make output invalid or misleading. Warnings may allow generation when unsupported or missing values are handled conservatively and reported clearly.

For compiler changes, run the relevant fixture tests; run both suites for shared conversion changes:

```bash
node --test scripts/figmatotailwind.test.mjs scripts/figmatotailwind3.test.mjs
```

Cover mode preservation, aliases and cycles, missing targets, collision handling, repeated prefixes, alpha colours including alpha zero, escaping, unit formatting, typography references, breakpoint mappings, stable ordering, and valid JSON/config syntax where relevant to the change.

Do not regenerate live artifacts merely to test documentation edits. For generation tasks, inspect the resulting diff and confirm that expected files exist, references match their intended definitions, and unrelated artifacts remain untouched. Account for the v3 generated timestamp when checking deterministic content.

## Completion criteria and reporting

A generation task is complete when:

1. The source bundle is fresh, complete, and verified against MCP retrieval counts.
2. Requested version-specific files have been generated from that same verified bundle.
3. Naming, aliases, units, and supported modes follow the contracts above.
4. Relevant conversion tests pass when compiler code changes.
5. Any skipped values, warnings, unsupported categories, or mode limitations are reported.

In the final response, state which versions were generated, list the output paths, summarize validation and test results, and identify any failed or incomplete step. For instruction-only tasks, report the documentation change without invoking Figma or regenerating artifacts.
