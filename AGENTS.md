# AGENTS.md — zaobao-theme

## Purpose and scope

Maintain `zaobao-theme`, the command-line design-token pipeline for multiple
Zaobao products and Figma files. Read `PRD.md` for product profiles, source
inventory, output contracts and implementation limitations.

```text
Identified product + required Figma file(s)
  -> bounded MCP retrieval per source
  -> complete verified source bundles
  -> product-specific mappings and local compilers
  -> isolated Tailwind artifacts under dist/
```

Work on retrieval, JSON assembly, conversion scripts, generated artifacts and
conversion tests. Existing plugin files are legacy context. Change plugin
runtime, UI, manifests or download flows only when explicitly requested.

`zaobao-theme` is the product name. The current package name remains
`@SPHTech-CQ/figma-tailwind-compiler`. Do not infer authorization to rename the
package, repository, existing commands or public imports from the product name.

## Identify the product before acting

| Product profile | Source file key | Source bundle | Supported versions |
| --- | --- | --- | --- |
| `zb-master` | `pijva5QtMXOesieYY9lmEn` | `variables/figma-zb.json` | v4, v3 |
| `zbschool` | `MEN3cpvdA1YxUi29dHnHsc` | `variables/figma-zbschools.json` | v4 |

Use the user's Figma link, requested product and repository context to identify
scope. Never default a new product to Master or apply School rules globally.
Ask only if an unresolved choice affects the source or output contract.

For each new product/source, document the stable product slug, source identifier,
file key, source paths, required collections/modes, typography specimen nodes,
output mappings, naming/units, breakpoints, mode fallback, commands, exports and
tests in `PRD.md`. Implement and verify the adapter before claiming support.
Current scripts do not provide a universal profile registry or multi-file CLI.

For new sources, prefer `variables/figma-<product>-<source-id>.json`;
Master uses `variables/figma-zb.json` and School uses
`variables/figma-zbschools.json`. Keep each Figma file's complete bundle
separate. Identity across files is `(fileKey, variableId)`, not variable ID or
normalized name alone. Collection/mode identities are also source-specific.

Do not concatenate file bundles, silently override overlapping tokens, or resolve
remote dependencies by name. Multi-file composition requires explicit ownership,
precedence and dependency rules plus implementation and tests. Record inaccessible
remote targets and block output that would be invalid or misleading.

## Repository entry points and commands

| Path | Responsibility |
| --- | --- |
| `PRD.md` | Shared requirements and product-specific contracts |
| `scripts/figmatotailwind.mjs` | Bundle assembly helpers and Master v4 compiler |
| `scripts/figmatotailwind3.mjs` | Master v3 compiler |
| `scripts/zbschool.mjs` | School bundle validation and v4 compiler |
| `scripts/figmatotailwind.test.mjs` | Master v4 fixtures |
| `scripts/figmatotailwind3.test.mjs` | Master v3 fixtures |
| `scripts/zbschool.test.mjs` | School fixtures and CLI paths |
| `scripts/outputPaths.test.mjs` | Master CLI output paths and exports |

Use pnpm 11.18.0, pinned in `package.json`, and maintain `pnpm-lock.yaml`.
Install with `pnpm install`; use `pnpm install --frozen-lockfile` to verify an
unchanged dependency graph. Do not introduce npm or Yarn lockfiles.

Run commands from the repository root:

```bash
pnpm run tailwind4:output  # Master v4
pnpm run tailwind3:output  # Master v3
pnpm run tailwind:output   # Master v4, then v3 on success
pnpm run zbschool:output   # School v4
```

These commands read local JSON and do not retrieve Figma data. `tailwind:output`
does not include School or roll back v4 if v3 fails. `pnpm run build` and `watch`
build legacy plugin TypeScript; they are not theme generation commands.

## Mandatory refresh before generation

Apply this workflow to the actual product's required sources, not a fixed default
file. Compiler maintenance and fixture tests do not require live Figma unless
source-derived artifacts are being regenerated.

1. Load the required Figma tool skills before calling the corresponding tools.
2. Retrieve fresh local collections, modes, variables, raw values and aliases
   through Figma MCP in bounded batches for every required source file. Refresh
   typography specimen snapshots used by that product as well.
3. Use `createTokenBundle`, `mergeVariableBatch` and `writeTokenBundleInBatches`
   where practical. Deduplicate by variable ID within each file and checkpoint
   valid JSON after each batch.
4. Set `source.complete: false` during retrieval. Preserve file key, actual
   reported file name, `tool: "figma-mcp"` and a fresh ISO 8601 export timestamp.
5. Verify collection and unique variable counts, full membership, mode values,
   alias targets and specimen coverage against MCP. Record inaccessible targets,
   errors and warnings with relevant IDs. Store collection/variable counts,
   per-collection counts, specimen counts where applicable and `verifiedAt` in
   `source.retrieval`. Do not use historical counts as proof of completeness.
6. Mark `source.complete: true` only after every batch and validation succeeds.
   Save the verified source before running any requested compiler.
7. If MCP access fails or retrieval is incomplete, stop and report the failed
   step. Never substitute stale input or generate from a partial checkpoint.

One complete fresh retrieval may feed both versions in the same task. Verify
sources regardless of gaps in individual compiler enforcement.

## Source bundle rules

Preserve `schemaVersion: "1.0.0"` and existing `source`, `collections`,
`variables`, `aliases` and `validation` fields as defined in `PRD.md`.
Keep IDs, keys, names, normalized names, default mode IDs, membership, types,
scopes, publishing metadata, descriptions where available and `valuesByMode`.

Preserve raw numbers, strings, booleans, RGBA objects and VARIABLE_ALIAS objects.
School's nested `{ color, opacity }` values remain raw; inventory nested aliases
with `valuePath`. Do not introduce typed wrappers without changing all affected
compilers and tests together.

Keep every source collection and mode unless filtering is explicitly requested.
Focused views are derived data; the complete bundle remains the source of truth.
Keep cross-collection targets even when a subset excludes them. Product-specific
extensions such as School's `typography` snapshot must preserve their own source
provenance, node IDs, bindings and retrieval evidence.

## Output paths and isolation

| Product/output | Current destination |
| --- | --- |
| Master v4 CSS | `dist/zb/tailwind4/{index,base,breakpoint,colour-token,typography}.css` |
| Master derived JSON | `dist/zb/tokens/{primitives,colour-token,typography}.json` |
| Master v3 config | `dist/zb/tailwind3/tailwind.config.js` |
| School v4 CSS | `dist/zbschool/{index,base,breakpoint,colour-token,typography,size}.css` |
| School JSON | `zbschool/tokens/{figma-variables,primitives,colour-token,typography,breakpoints,size}.json` |

Keep package exports aligned: `./tailwind4` -> `dist/zb/tailwind4/index.css`,
`./tailwind3` -> `dist/zb/tailwind3/tailwind.config.js`,
`./zbschool/tailwind4` -> `dist/zbschool/index.css`.
New products should prefer CSS in `dist/<product>/` and optional v3 config in
`dist/<product>/tailwind3/`. Master uses version subdirectories under `dist/zb/`.
Do not delete or rewrite another product's output during targeted generation.

Input overrides and their precedence are documented in `PRD.md`:

- Master: positional input, then `FIGMA_VARIABLES_JSON`. V3 output uses a second
  positional path, then `FIGMA_TAILWIND3_OUTPUT_DIR`.
- Master v4: `FIGMA_OUTPUT_DIR` selects the CSS directory directly and defaults
  to `dist/zb/tailwind4`. Derived JSON stays in `dist/zb/tokens/`.
- School: positional input, then `ZBSCHOOL_VARIABLES_JSON`; second positional
  CSS directory, then `ZBSCHOOL_OUTPUT_DIR`. CSS defaults to `dist/zbschool`
  directly, with no `tailwind4/` child. JSON stays in `zbschool/tokens/`.

Do not manually edit generated files to fix conversion behavior. Change the
transformation and regenerate only after the required refresh. Do not regenerate
live artifacts to test documentation or path changes; use isolated fixtures.

## Shared conversion requirements

- Normalize slash paths into CSS-safe kebab-case, collapsing repeated segments
  and prefixes. Preserve numeric names, including decimal steps as hyphenated names.
- Detect normalized-name collisions, keep both tokens with deterministic suffixes
  and report them. Sort consistently by collection, path and stable identity.
- Preserve JSON aliases; emit CSS references when target names, units and modes
  permit. Report missing targets, type mismatches and cycles without recursion loops.
- Resolve cross-collection modes by normalized name with the product's explicit
  fallback. Never treat unrelated mode IDs as interchangeable.
- Preserve non-default values and report selected-mode/category output scope.
- Escape strings safely. Preserve transparent colours, alpha zero and numeric zero.
- Preserve established units: ordinary dimensions in px, line-height primitives
  in percent, weights unitless, School opacity in percent, durations/delays in ms.
  Do not introduce rem conversion without an explicit requirement and regressions.
- Do not invent missing design values or borrow them from another product.
- Derive v4 index imports from the generated stylesheet map, each once, excluding
  index itself. Preserve base, breakpoint, colour-token, typography, then additional
  stylesheets. Use relative imports and leave framework setup to the consumer.

## Product-specific requirements

Use the complete mappings in `PRD.md`; these distinctions are mandatory.

### ZB Master

- Primitives -> `base.css`; Colours/Colors -> `colour-token.css`;
  Font Adjustment -> `typography.css`; Breakpoints -> `breakpoint.css`.
- Keep primitive and semantic declarations inside `@theme`. Primitive CSS uses
  the collection default mode; retain other source modes in JSON and report scope.
- Typography uses numeric Font Adjustment variables, existing style-family
  mappings and overrides, and top-level `@utility text-*`. Reference size,
  line-height, weight and letter-spacing primitives. Keep semantic and typography
  mode overrides. Report missing primitives and reject invalid symbolic fallbacks.
- Breakpoints: actual page widths `390 -> xs`, `768 -> md`, `1200 -> lg`.
- V3 emits ES module `export default`, the established content glob, `darkMode:
  "class"`, deduplicated sans family references plus Arial/sans-serif, nested
  palettes and semantic colours, each background token's own variable under
  `extend.backgroundColor`, recognized screens and the no-hover media variant.
- Validate every v3 mode. Select Light when present, otherwise the default, for
  entries; application CSS provides mode values. V3 scope is colours, families,
  breakpoints, composite typography and the variant. Composite typography uses
  literal tuples under `extend.fontSize` for the selected Font Adjustment mode,
  reports `TYPOGRAPHY_MODE_SCOPE`, and does not switch at runtime. V3 Body 1 uses
  `line-height-sm` (150%); keep v4 mappings independent. Spacing needs explicit scope.
  Verify consumer CSS references; v4 does not guarantee the entire v3 contract.

### ZB School

- Map Primitives, Colour, Font Size, Size and Breakpoints independently of Master.
  Mapped collections use `@theme static` and collection/mode attribute overrides.
- Every non-opacity Size token starts `--spacing-*`, including radii, border
  widths, elevation, icons and dimensions. Keep the normalized path, including
  `-br-`. Opacity retains `--opacity-*`. JSON keeps original names and aliases.
- Breakpoints: `390 -> xs`, `768 -> md`, `1024 -> lg`, `1200 -> xl`; other positive
  widths become `width-<number>`. Use actual page widths, not mode labels.
- Cross-collection aliases match mode names, then target defaults. Resolve foreign
  non-default modes or unit-changing numeric aliases in the receiving context.
- Resolve nested colour/opacity values per mode, preserving zero alpha. Report
  that runtime opacity changes alone do not recompute composed colours.
- Composite typography comes from applied specimens under node `1:26752` with
  traceable properties/bindings and verified coverage. Applied values override
  annotations; report discrepancies. Do not reuse Master's typography mappings.
- Missing/invalid snapshots block composites; absent snapshots yield size-only
  utilities and `INCOMPLETE_TYPOGRAPHY_GROUP`. Extra collections stay in the bundle
  and warn `UNSUPPORTED_CATEGORY`. School currently supports v4 only.

## Validation and tests

Before generation, check completeness, provenance/counts, membership, every
required mode, aliases/cycles, collisions, supported values and required typography.
Block errors that would make output invalid or misleading. Warnings may permit
conservative omissions only when explicitly reported.

Use stable codes including `MISSING_COLLECTION`, `MISSING_MODE_VALUE`,
`UNRESOLVED_ALIAS`, `CIRCULAR_ALIAS`, `NAME_COLLISION`, `UNSUPPORTED_TYPE`,
`INVALID_CSS_IDENTIFIER`, `INCOMPLETE_TYPOGRAPHY_GROUP`, `AMBIGUOUS_CATEGORY` and
`REMOTE_VARIABLE_UNSUPPORTED`. Include source and relevant token IDs.

Account for current enforcement gaps: Master v4 does not prove provenance/counts,
selects first matching categories and lacks comprehensive diagnostics; its missing
primitive fallback can emit invalid symbolic px values. Master v3 lacks bundle
completeness gates and may omit invalid tokens with warnings. School's stronger
local validation still does not prove a live refresh. Inspect outputs accordingly.

Run relevant fixture suites for compiler changes; run all affected product/version
suites for shared changes:

```bash
pnpm exec node --test scripts/figmatotailwind.test.mjs scripts/figmatotailwind3.test.mjs scripts/zbschool.test.mjs scripts/outputPaths.test.mjs
```

Add regressions relevant to the change: mode preservation/matching, aliases and
cycles, missing targets, collisions, repeated prefixes, decimal names, alpha zero,
escaping, units, typography references, breakpoint mappings, deterministic ordering,
valid JSON/config syntax, output isolation and package entry paths. Account for
v3's generated timestamp. Do not claim coverage beyond what was tested.

For generation, inspect the resulting diff, expected files, imports and CSS
references against actual definitions. Confirm unrelated products remain untouched.

## Completion and reporting

Generation is complete only when all required sources are fresh, complete and
verified; requested version artifacts follow the product contract; references and
modes are checked; relevant tests pass for code changes; and omissions, warnings
and limitations are reported.

In the final response, state the product, source keys, versions generated, output
paths, validation/test results and any incomplete step. For documentation-only
work, report the documentation change without Figma retrieval or regeneration.

<!-- postman-cli:installation:start -->
Postman CLI is installed on this device and can be used for API Engineering work.
It is not on PATH; run it as /Users/jasonwkf/.local/bin/postman.
<!-- postman-cli:installation:end -->
