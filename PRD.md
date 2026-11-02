# PRD: Figma MCP to Tailwind Compiler

## Purpose

Provide a command-line pipeline that converts the ZB design system's Figma
variables into Tailwind CSS v4 stylesheets and a Tailwind CSS v3 configuration.
Frontend developers use the generated artifacts to consume design tokens without
manually copying values from Figma.

```text
ZB-Design-System-Master
  -> Figma MCP retrieval in bounded batches
  -> verified tokens/figma-variables.json
  -> local version-specific compilers
  -> tailwind4/*.css and tailwind3/tailwind.config.js
```

The `.mjs` compilers read local JSON. Figma retrieval is a separate MCP workflow.
Legacy plugin build scripts and manifest files are outside the primary token
pipeline; plugin UI downloads and local Text Style export are outside this PRD's
scope. Tailwind v4 typography comes from the `Font Adjustment` variable collection.

## Goals and Scope

- Preserve a complete, traceable source bundle with every retrieved collection,
  mode, variable, and alias.
- Generate version-specific artifacts using local conversion functions that can
  be tested without Figma access.
- Preserve meaningful token names, aliases, units, and supported mode overrides.
- Provide a single import entry for v4 and an ES module configuration for v3.
- Make incomplete retrieval, unsupported values, and conversion limitations
  visible before artifacts are used.

Automatic Figma synchronization, consuming-app installation, v3 CSS generation,
and extending v3 to spacing or typography composites require separate work.

## Source Retrieval and Verification

The source is **ZB-Design-System-Master**, file key
`pijva5QtMXOesieYY9lmEn`, retrieved through Figma MCP.

Before generating either Tailwind version:

1. Retrieve fresh local collections, modes, variables, values, and alias targets
   in bounded batches, following the required Figma tool skills.
2. Assemble `tokens/figma-variables.json`, using `createTokenBundle`,
   `mergeVariableBatch`, and `writeTokenBundleInBatches` where practical.
3. Set `source.complete` to `false` while retrieving. Preserve the file key, file
   name, `tool: "figma-mcp"`, and a fresh ISO 8601 `exportedAt` timestamp.
4. Deduplicate variables by ID and checkpoint valid JSON after each batch.
5. Verify collection and unique variable counts against MCP retrieval. Check
   collection membership, mode values, aliases, and inaccessible targets; record
   errors and warnings in `validation`.
6. Set `source.complete` to `true` and save only after verification succeeds.

Failed or incomplete retrieval blocks generation. A stale bundle or partial
checkpoint must never replace a fresh verified export. One complete retrieval
can supply both compilers in the same task.

### Source Bundle Contract

Keep `schemaVersion: "1.0.0"` and these top-level fields:

| Field | Contents |
| --- | --- |
| `source` | Provenance, export timestamp, and completeness |
| `collections` | IDs, keys, names, normalized names, modes, default mode IDs, and variable IDs |
| `variables` | IDs, keys, names, collection IDs, resolved types, scopes, publishing metadata, descriptions where available, and `valuesByMode` |
| `aliases` | Source variable/mode IDs and target variable IDs |
| `validation` | Errors and warnings with relevant IDs |

`valuesByMode` preserves raw Figma numbers, strings, booleans, RGBA objects, and
`{ "type": "VARIABLE_ALIAS", "id": "..." }` references. Keep every source mode
and cross-collection alias target in the complete bundle. Focused JSON outputs
are derived views and may reference targets outside their own subset.

## Commands and Entry Points

Use **pnpm 11.18.0**, pinned in `package.json`, and `pnpm-lock.yaml`.

```bash
pnpm install
```

After the required MCP refresh and verification, generate both versions:

```bash
pnpm run tailwind:output
```

This runs v4 first and v3 only if v4 exits successfully. It does not provide
transactional rollback if the second compiler fails.

Generate an individual version:

```bash
pnpm run tailwind4:output
pnpm run tailwind3:output
```

| Entry point | Responsibility |
| --- | --- |
| `scripts/figmatotailwind.mjs` | Bundle assembly helpers and v4 compilation |
| `scripts/figmatotailwind3.mjs` | V3 configuration compilation |
| `scripts/figmatotailwind.test.mjs` | V4 fixture tests |
| `scripts/figmatotailwind3.test.mjs` | V3 fixture tests |

`pnpm run build` and `pnpm run watch` invoke legacy plugin TypeScript compilation.
They are not token generation commands.

### Input and Output Overrides

```bash
pnpm run tailwind4:output ./tokens/figma-variables.json
pnpm run tailwind3:output ./tokens/figma-variables.json ./dist/tailwind3
```

Both scripts accept `FIGMA_VARIABLES_JSON`; a positional input path takes
precedence. V3 accepts a second positional output directory, then
`FIGMA_TAILWIND3_OUTPUT_DIR`, defaulting to `tailwind3/`.

V4 accepts `FIGMA_OUTPUT_DIR`, defaulting to `tailwind4/`, but uses its parent as
the root for fixed `tokens/` and `tailwind4/` paths. It is not an arbitrary CSS
directory override.

## Tailwind CSS v4 Output

`buildTailwindFiles(bundle)` returns file paths and contents. The CLI writes:

| Path | Source and behavior |
| --- | --- |
| `tokens/primitives.json` | `Primitives` subset, preserving source mode values |
| `tokens/colour-token.json` | First matching `Colours` or `Colors` collection subset |
| `tokens/typography.json` | `Font Adjustment` subset |
| `tailwind4/base.css` | Primitive declarations inside `@theme`, using the collection default mode |
| `tailwind4/colour-token.css` | Semantic declarations inside `@theme` plus non-default mode selectors |
| `tailwind4/typography.css` | Top-level `@utility text-*` blocks plus mode overrides |
| `tailwind4/breakpoint.css` | Recognized page widths inside `@theme` |
| `tailwind4/index.css` | Relative imports for every generated v4 stylesheet, excluding itself |

The index derives its imports from the generated file map in this order:

```css
@import "./base.css";
@import "./breakpoint.css";
@import "./colour-token.css";
@import "./typography.css";
```

Generated stylesheets do not repeat framework imports. The consuming application
provides its Tailwind setup and imports the index. The package export
`@SPHTech-CQ/figma-tailwind-compiler/tailwind4` points to `tailwind4/index.css`.

### Names, Values, and Modes

Normalize slash-separated names to kebab-case and collapse repeated path
segments. Examples include `--color-yellow-100`, `--spacing-4`, and
`--font-weight-bold`. Preserve established custom namespaces such as `--size-*`,
`--line-height-*`, `--letter-spacing-*`, and `--font-weight-*`.

Ordinary numeric dimensions use pixels, line-height primitives use percentages,
and font weights are unitless. Numeric zero remains zero. Colours preserve
alpha, including full transparency. Known aliases become CSS variable references.

Semantic colours use their collection default mode for `@theme`. Non-default
values use `[data-<collection-normalized-name>-mode="<mode-normalized-name>"]`
selectors. Primitive CSS represents only the default mode; other source values
remain in JSON.

### Typography

Numeric variables in `Font Adjustment` supply font sizes. The compiler uses its
existing body, button, display, header, label, and subheader mappings and per-style
overrides for line height, weight, and letter spacing. Matching primitive tokens
supply references:

```css
@utility text-body1 {
    font-size: var(--size-18);
    line-height: var(--line-height-md);
    font-weight: var(--font-weight-regular);
    letter-spacing: var(--letter-spacing-sm);
}
```

Non-default collection modes override font size through nested attribute
selectors. Missing required primitives must be reported and must not produce
invalid fallback declarations; current enforcement gaps are listed below.

### Breakpoints

Read numeric `page-width` values across all modes of `Breakpoints` collections.
Emit only these recognized widths when present:

| Width | Name | V4 declaration | V3 location |
| --- | --- | --- | --- |
| 390px | `xs` | `--breakpoint-xs` | `theme.extend.screens.xs` |
| 768px | `md` | `--breakpoint-md` | `theme.extend.screens.md` |
| 1200px | `lg` | `--breakpoint-lg` | `theme.extend.screens.lg` |

Other dimensions and unrecognized widths do not become breakpoints. Do not infer
widths from mode labels or invent missing values.

## Tailwind CSS v3 Output

`buildTailwind3Files(bundle, { onWarning })` returns `tailwind.config.js`. The CLI
writes it to `tailwind3/` by default. The package export
`@SPHTech-CQ/figma-tailwind-compiler/tailwind3` points to this generated file.

The output uses `export default` and contains:

- `content: ["./src/**/*.{astro,html,js,jsx,ts,tsx,vue}"]`.
- `darkMode: "class"`.
- `theme.fontFamily.sans`: deduplicated `var(--family-...)` references followed by
  `Arial` and `sans-serif`.
- `theme.colors`: nested primitive palettes and semantic colour references.
- `theme.extend.backgroundColor`: each background token's own CSS variable
  reference, preserving palette and semantic `bg-*` utilities.
- `theme.extend.screens`: recognized breakpoint mappings.
- A `no-hover` variant using `@media (hover: none)`.

Colour and recognized font-family variables are selected across collections.
Light is preferred when present; otherwise the collection default mode determines
config entries. All source modes are checked for supported colour/family values
and aliases. Cross-collection alias resolution matches normalized mode names,
then falls back to the target collection's preferred mode.

The consuming application must provide the referenced CSS variables and their
mode changes, load the configuration as an ES module, and adjust content paths
for its own files. V3 generates no `index.css`, embeds no separate mode palettes,
and does not copy files into another application. V4 output is not guaranteed
to supply every variable needed by v3; the application's CSS contract must match
the generated references.

## Validation Requirements and Current Limitations

The required workflow validates source completeness, membership, every mode,
alias targets and cycles, supported values, and normalized-name collisions
before generation. Invalid or misleading output must be blocked. Warnings may
allow conservative omissions when clearly reported. `AGENTS.md` defines the
full retrieval and conversion requirements.

Current implementation does not enforce every requirement automatically:

- V4 rejects explicit `source.complete: false` and recorded validation errors,
  but does not independently prove completeness or validate provenance/counts.
- V3 does not gate on `source.complete` or recorded bundle validation errors.
  MCP verification remains mandatory before either compiler runs.
- V3 reports `MISSING_COLLECTION`, `MISSING_MODE_VALUE`, `UNRESOLVED_ALIAS`,
  `CIRCULAR_ALIAS`, `UNSUPPORTED_TYPE`, and `NAME_COLLISION` warnings for its
  colour/family scope. Some invalid tokens are omitted; warnings do not
  automatically fail the CLI.
- V4 resolves known alias names but lacks equivalent comprehensive alias,
  collision, and missing-value diagnostics. It selects the first matching
  primitive, semantic colour, and font-adjustment collections.
- V4 typography falls back to appending `px` when primitive lookup fails. This
  can produce invalid values for symbolic typography properties and requires
  correction before relying on incomplete primitive sets.
- Complete source JSON preserves modes beyond the generated CSS/config scope.
  Source preservation does not imply every mode is emitted into every artifact.
- V3 adds a generation timestamp. Deterministic-content comparisons must account
  for that header.

These are implementation gaps to resolve, not guarantees supplied by the CLI.

## Verification and Acceptance

Run fixture tests without live Figma access:

```bash
pnpm exec node --test scripts/figmatotailwind.test.mjs scripts/figmatotailwind3.test.mjs
```

The current suites cover v4 index imports and recognized breakpoint extraction
in both versions, including omission of absent widths. Required regression
coverage should also include aliases and cycles, mode preservation, missing
targets, collisions, numeric names, alpha-zero colours, escaping, unit formatting,
typography references, stable ordering, and valid config syntax.

A generation task is complete when:

1. Fresh MCP counts and provenance match a complete, saved source bundle.
2. All requested artifacts are generated from that verified bundle.
3. Imports, variable references, names, units, and supported modes are inspected
   against their definitions and intended scope.
4. Relevant fixture tests pass for compiler changes.
5. Skipped values, warnings, unsupported scope, and remaining limitations are
   reported, with unrelated artifacts unchanged.

Documentation-only edits do not require Figma retrieval or artifact regeneration.
