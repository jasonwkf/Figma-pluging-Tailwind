# PRD: zaobao-theme

## Product purpose

`zaobao-theme` is the shared design-token pipeline for Zaobao products. It turns
verified Figma sources into product-specific theme artifacts that frontend
applications can consume without copying design values manually.

A product can use one or more Figma files. Each file remains a traceable source;
a product profile determines which sources, collections, modes and mappings
contribute to its outputs. Products may have different typography, breakpoints,
collection names, naming conventions and supported Tailwind versions.

```text
Product + identified Figma source file(s)
  -> bounded Figma MCP retrieval per file
  -> complete, verified source bundles
  -> product-specific mapping and validation
  -> local Tailwind v4 / v3 compilers
  -> isolated product artifacts under dist/
```

The product name is `zaobao-theme`. The current npm package remains
`@SPHTech-CQ/zaobao-theme`; renaming the package, repository or public
imports is a separate migration. This document does not introduce a new CLI.

## Goals and boundaries

- Support additional products and Figma files without changing another product's
  tokens or assuming its design conventions.
- Preserve all retrieved data and provenance, including unused collections and
  modes, so compilation can be repeated from local JSON.
- Separate source retrieval, product mapping and version-specific compilation.
- Produce stable names, valid references and explicit diagnostics.
- Give each product a clear import entry and documented consumer requirements.

Legacy plugin runtime, UI, manifests and download flows are outside the theme
pipeline. Automatic Figma synchronization, application installation, publishing,
and new output formats require explicit scope. V3 spacing configuration is not currently supported. A universal product registry,
multi-file compiler and shared profile engine are future work, not existing APIs.

## Product profiles and source inventory

These are the current profiles. The profile names below are documentation labels;
they are not arguments accepted by a generic command.

| Profile | Figma source | Supported output | Compiler |
| --- | --- | --- | --- |
| `zb-master` | ZB-Design-System-Master: `pijva5QtMXOesieYY9lmEn` | Tailwind v4 and v3 | `figmatotailwind.mjs`, `figmatotailwind3.mjs` |
| `zbschools` | ZBSchools-Design-System: `MEN3cpvdA1YxUi29dHnHsc` | Tailwind v4 | `zbschools.mjs` |

Display labels may differ from the file name returned by MCP. Preserve the actual
reported name in source metadata; School has previously returned `Document`.
Historical counts are not acceptance criteria for a fresh retrieval.

Every new product/source needs a documented profile containing:

- Stable product slug and source identifier, Figma file key, display name and
  any specimen node IDs used for composite typography.
- Source bundle locations, required collections and modes, dependencies on other
  sources, and supported Tailwind versions.
- Collection-to-output mappings, CSS namespaces, unit conventions, mode matching,
  fallback behavior, breakpoints and typography rules.
- Output directories, package exports, generation command, tests and limitations.

### Multiple files within one product

Keep a separate complete bundle per Figma file. New sources should use
`variables/figma-<product>-<source-id>.json`; use `variables/figma-zb.json` for Master and
`variables/figma-zbschools.json` for School. Derived views must not replace sources.

Do not concatenate bundles or deduplicate across files by variable ID alone.
Cross-file identity is `(fileKey, variableId)`; collection and mode identities
also belong to their source. Multiple sources require explicit composition rules
for category ownership, overlapping names, precedence and dependency resolution.
Never silently select the first file or overwrite another source's token.

Current compilers accept one bundle per invocation. Cross-file composition needs
an implementation and tests before it can be advertised as supported. If a source
references an inaccessible remote variable, record the dependency and diagnostic;
block output that cannot be represented correctly. Do not substitute a similarly
named token from another file or product.

## Source retrieval and bundle contract

Before generating product artifacts, refresh all Figma sources required by that
product through MCP. Load the relevant tool skills first. Retrieve collections,
modes, variables, raw values and alias references in bounded batches. Refresh any
specimen snapshots used to generate typography in the same task.

Use `createTokenBundle`, `mergeVariableBatch` and `writeTokenBundleInBatches`
where practical. Checkpoint valid JSON with `source.complete: false`, deduplicate
within each file by variable ID, and retain every collection and mode. Preserve
file key, reported file name, `tool: "figma-mcp"` and a fresh ISO 8601 timestamp.

Verify collection counts, unique variable counts, full collection membership,
mode values and alias targets against MCP. Record inaccessible targets and other
issues. Store retrieval counts and `verifiedAt` in `source.retrieval`, including
per-collection counts and specimen counts when applicable. Set `complete: true`
only after verification, and save the verified source before compiling.

Failed retrieval, partial checkpoints and stale substitutes block generation.
One fresh verified retrieval may feed both Tailwind versions in the same task.
Compiler fixture tests and documentation edits do not require live retrieval.

Keep `schemaVersion: "1.0.0"` and the existing single-file bundle structure:

| Field | Contract |
| --- | --- |
| `source` | File provenance, timestamp, completeness and retrieval evidence |
| `collections` | IDs, keys, names, normalized names, modes, default mode IDs and variable IDs |
| `variables` | IDs, keys, names, collection IDs, resolved types, scopes, publishing metadata, descriptions and `valuesByMode` |
| `aliases` | Source variable/mode IDs and target IDs; nested aliases include `valuePath` where applicable |
| `validation` | Errors and warnings with relevant source, variable, collection and mode IDs |

Preserve raw numbers, strings, booleans, RGBA objects and
`{ "type": "VARIABLE_ALIAS", "id": "..." }` values. School also preserves
`{ color, opacity }` objects returned by MCP. Do not introduce typed wrappers or
flatten aliases without updating all affected compilers and tests. Keep
cross-collection targets in the complete bundle even if a focused view omits them.

## Current commands and filesystem contracts

Use pnpm 11.18.0 and `pnpm-lock.yaml`. Install with `pnpm install`; verify an
unchanged dependency graph with `pnpm install --frozen-lockfile`.

| Command | Input default | CSS/config destination | Derived JSON |
| --- | --- | --- | --- |
| `pnpm run zb:tailwind4` | `variables/figma-zb.json` | `dist/zb/tailwind4/` | `dist/zb/tokens/` |
| `pnpm run zb:tailwind3` | `variables/figma-zb.json` | `dist/zb/tailwind3/tailwind.config.js` | None |
| `pnpm run zbschools:tailwind4` | `variables/figma-zbschools.json` | `dist/zbschools/tailwind4/` | `dist/zbschools/tokens/` |

`pnpm run build` runs Master v4, Master v3, then School v4, stopping on failure.
It does not retrieve Figma data or roll back previously generated files. `pnpm run build:plugin` and `watch` build
legacy plugin TypeScript, not themes. Run commands from the repository root.

Positional input paths take precedence over environment overrides:

```bash
pnpm run zb:tailwind4 ./variables/figma-zb.json
pnpm run zb:tailwind3 ./variables/figma-zb.json ./dist/zb/tailwind3
pnpm run zbschools:tailwind4 ./variables/figma-zbschools.json ./dist/zbschools/tailwind4
```

- Master scripts accept `FIGMA_VARIABLES_JSON`.
- Master v3 accepts a second positional output directory, then
  `FIGMA_TAILWIND3_OUTPUT_DIR`, defaulting to `dist/zb/tailwind3/`.
- Master v4 accepts `FIGMA_OUTPUT_DIR`, defaulting to `dist/zb/tailwind4/`. Its grandparent
  is the root for fixed `zb/tokens/` and `zb/tailwind4/` paths. It is not an arbitrary
  CSS destination override.
- School accepts `ZBSCHOOLS_VARIABLES_JSON` and a second positional CSS directory,
  then `ZBSCHOOLS_OUTPUT_DIR`, defaulting to `dist/zbschools/tailwind4/`. CSS is written
  directly there; JSON remains in `dist/zbschools/tokens/` relative to the working directory.

For new products, prefer v4 CSS under `dist/<product>/tailwind4/`, with any v3
config under `dist/<product>/tailwind3/`. This is an onboarding convention, not a
change to existing Master paths. Existing files under `zbschools/tailwind4/` are
legacy artifacts and are not the current School CLI destination.

Recommended package subpaths are `./zb/tailwind4`, `./zb/tailwind3` and
`./zbschools/tailwind4`, pointing respectively to `dist/zb/tailwind4/index.css`,
`dist/zb/tailwind3/tailwind.config.js` and `dist/zbschools/tailwind4/index.css`.
The legacy `./tailwind4` and `./tailwind3` subpaths remain aliases for compatibility.

## Shared conversion and consumer requirements

Normalize slash-separated names into CSS-safe kebab-case, collapsing repeated
segments and prefixes. Preserve numeric names, including decimal spacing steps
as hyphenated names. Detect collisions, retain tokens with deterministic suffixes
and report them. Sort by collection, token path and stable identity.

Preserve aliases in JSON and use CSS references when target names, units and
mode semantics permit. Validate missing targets, type mismatches and cycles
without infinite recursion. Match cross-collection modes by normalized name with
an explicit documented fallback; unrelated mode IDs are never interchangeable.
Preserve non-default source values and report output that covers selected modes
or categories only.

Escape strings safely; preserve alpha zero and numeric zero. Keep established
units: ordinary dimensions in pixels, line-height primitives in percentages,
weights unitless, School opacity in percentages and duration/delay in milliseconds.
Do not introduce rem conversion or borrow another product's values.

Each v4 output provides `index.css` with one relative import per generated
stylesheet, excluding itself. Preserve the order `base.css`, `breakpoint.css`,
`colour-token.css`, `typography.css`, then additional stylesheets such as
`size.css`. Include additional generated stylesheets automatically. Consumers
supply Tailwind framework setup; generated files do not repeat framework imports.
Custom namespaces such as `--size-*` remain valid token references even when they
are not automatic Tailwind utility namespaces. Products are separate themes;
loading multiple products into the same global CSS scope requires an explicit
consumer composition contract.

## Product-specific mappings

### ZB Master

| Collection | JSON filename under `dist/zb/tokens/` | CSS filename under `dist/zb/tailwind4/` |
| --- | --- | --- |
| Primitives | `primitives.json` | `base.css` |
| Colours / Colors | `colour-token.json` | `colour-token.css` |
| Font Adjustment | `typography.json` | `typography.css` |
| Breakpoints | No separate view | `breakpoint.css` |

Primitive and semantic declarations use `@theme`. Primitive CSS uses the
collection default mode; JSON retains other modes. Semantic colours retain mode
selectors. Typography comes from numeric Font Adjustment variables, with the
existing body, button, display, header, label and subheader mappings and per-style
overrides. Emit top-level `@utility text-*` blocks referencing matching size,
line-height, weight and letter-spacing primitives. Preserve typography mode
overrides. Missing required values must be reported without invalid fallbacks.

Master breakpoint mappings are `390 -> xs`, `768 -> md`, `1200 -> lg`, based on
actual `page-width` values across modes. Omit absent and unrecognized widths.

Master v3 emits an ES module with `export default`, preserving:

- `content: ["./src/**/*.{astro,html,js,jsx,ts,tsx,vue}"]`, unless overridden by requirements.
- `darkMode: "class"`.
- Deduplicated `theme.fontFamily.sans` family references, then `Arial`, `sans-serif`.
- Nested primitive palettes and semantic references in `theme.colors`.
- Each background token's own variable in `theme.extend.backgroundColor`.
- Recognized breakpoints in `theme.extend.screens`.
- Composite typography tuples in `theme.extend.fontSize`, built by
  `buildTypographyFontSizes` from Font Adjustment sizes and Primitives.
- The `no-hover` variant for `@media (hover: none)`.

Validate every mode; prefer Light, otherwise the collection default, for config
entries. Cross-collection resolution matches mode names with the compiler's
preferred-mode fallback. The application supplies CSS variables and mode values;
v3 emits no CSS, separate mode palettes or copied application config. Verify its
CSS contract explicitly; v4 output does not guarantee all v3 references exist.

V3 typography emits literal px font sizes and letter spacing, percentage line
height and unitless string weights. Keys follow the v4 text utility naming
(`Body 1 -> body1`). It uses the established Master style-family mappings and
overrides, except Body 1 uses `line-height-sm` (150%) in v3; v4 is unchanged.
Select Light if present, otherwise the Font Adjustment default (Standard in the
current source). Validate aliases and required values across every mode, matching
cross-collection mode names before falling back to the target's selected mode.
Only the selected mode is emitted; `TYPOGRAPHY_MODE_SCOPE` reports that literal
entries do not switch dynamically. All modes remain in the source JSON. Missing
or ambiguous primitives, invalid values and aliases warn and omit incomplete
selected-mode styles. Name collisions retain deterministic suffixed entries.
These mappings are compiler policy; Master has no applied typography specimen
snapshot. School continues to use its own specimen-based typography pipeline.

### ZB School

| Collection | JSON filename under `dist/zbschools/tokens/` | CSS filename under `dist/zbschools/tailwind4/` |
| --- | --- | --- |
| Complete source | `figma-variables.json` | — |
| Primitives | `primitives.json` | `base.css` |
| Colour | `colour-token.json` | `colour-token.css` |
| Font Size | `typography.json` | `typography.css` |
| Size | `size.json` | `size.css` |
| Breakpoints | `breakpoints.json` | `breakpoint.css` |

Mapped collections use `@theme static` and non-default mode selectors of the form
`[data-<collection>-mode="<mode>"]`. Cross-collection aliases match mode names,
then target defaults. References requiring a foreign non-default mode or a change
of numeric unit resolve to values in the receiving context.

Every non-opacity Size token uses `--spacing-*`, including radii, elevation,
border widths, icons, illustrations, indicators and overlay dimensions. Preserve
the normalized path: `--spacing-button-br-rounded`, `--spacing-icon-md`,
`--spacing-container-bw-sm`. Opacity retains `--opacity-*` and percentage values.
JSON preserves Figma names and aliases. Nested colour/opacity aliases resolve to
RGBA per mode; runtime opacity changes alone do not recompute composed colours.

School widths map `390 -> xs`, `768 -> md`, `1024 -> lg`, `1200 -> xl`; other
positive widths use `width-<number>`. Read page widths, not mode labels; retain
page heights and all modes in JSON. Do not reuse Master's breakpoint mapping.

Composite typography uses applied specimens under node `1:26752`, stored in the
bundle's `typography` extension with provenance, specimen IDs, properties,
bindings and annotations. Verify specimen coverage and `typographyStyleCount`.
The previous export had 17 specimens; confirm the live count on refresh.

Text utilities include size, line height, weight, letter spacing, family and
paragraph indent where applicable, with primitive references when available.
Verified numeric sizes without matching primitives can use literal pixels.
Applied properties take precedence over descriptive annotations. Known annotation
discrepancies for Header 2, Body 1 and Label 1 produce
`TYPOGRAPHY_ANNOTATION_MISMATCH`; re-evaluate them on refresh. Incomplete snapshots
block generation. Bundles without a snapshot emit size-only utilities and warn
`INCOMPLETE_TYPOGRAPHY_GROUP`. Extra collections remain in the complete bundle
and warn `UNSUPPORTED_CATEGORY` until mapped. School currently has no v3 adapter.

## Validation, limitations and acceptance

All profiles require pre-generation checks of provenance, completeness, counts,
membership, required modes, supported values, names, aliases and typography.
Errors that make output invalid or misleading block generation. Conservative
omissions may be warnings only when their scope is explicit.

Use stable diagnostic codes such as `MISSING_COLLECTION`, `MISSING_MODE_VALUE`,
`UNRESOLVED_ALIAS`, `CIRCULAR_ALIAS`, `NAME_COLLISION`, `UNSUPPORTED_TYPE`,
`INVALID_CSS_IDENTIFIER`, `INCOMPLETE_TYPOGRAPHY_GROUP`, `AMBIGUOUS_CATEGORY` and
`REMOTE_VARIABLE_UNSUPPORTED`, with relevant source and token IDs.

Current enforcement gaps remain:

- Master v4 rejects explicit incomplete checkpoints and recorded errors, but does
  not prove provenance/counts. It selects the first matching category and lacks
  comprehensive alias, collision and missing-value diagnostics.
- Master v4 typography can append `px` after a failed lookup, producing invalid
  symbolic values. Inspect required primitives before accepting output.
- Master v3 does not enforce bundle completeness gates. Some invalid colour and
  family tokens are warned and omitted without failing the CLI.
- School validates provenance, retrieval counts, membership, modes, values,
  collisions and typography, but local checks alone cannot prove a live refresh.
- Source preservation does not mean all categories or modes reach every output.
- V3 includes a generated timestamp; account for it in deterministic comparisons.
- Shared multi-product orchestration and cross-file composition are not implemented.

Run relevant fixtures for compiler changes; include all affected profiles when
changing shared conversion behavior:

```bash
pnpm exec node --test scripts/figmatotailwind.test.mjs scripts/figmatotailwind3.test.mjs scripts/zbschools.test.mjs scripts/outputPaths.test.mjs
```

Regression coverage must address relevant aliases/cycles, missing targets,
collisions, mode preservation and matching, repeated prefixes, decimal names,
alpha zero, escaping, units, typography, breakpoints, stable ordering, syntax,
output isolation and package entry points. This list is a requirement for relevant
changes, not a claim that all existing suites cover every case.

A generation task is accepted when every required source is freshly verified,
requested artifacts are generated from those sources, imports/references and
product mappings are checked, relevant tests pass for compiler changes, and
warnings or omissions are reported. Inspect the diff for unrelated product
changes. Report product, source keys, Tailwind versions, output paths, validation,
tests and any incomplete steps. Documentation-only work does not retrieve Figma
or regenerate artifacts.
