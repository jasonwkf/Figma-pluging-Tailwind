# zaobao-theme

Design tokens from Figma, compiled into product-specific Tailwind themes for
Zaobao applications.

The pipeline retrieves design data through Figma MCP, saves complete verified
JSON bundles, and compiles them locally. Each product keeps its own source,
mappings and output paths.

```text
Product Figma sources -> verified JSON -> local compiler -> dist/ theme artifacts
```

The current npm package name is `@SPHTech-CQ/figma-tailwind-compiler`.
`zaobao-theme` is the project name; public package imports have not been renamed.

## Supported products

| Product | Figma source | Output |
| --- | --- | --- |
| ZB Master | [ZB-Design-System-Master](https://www.figma.com/design/pijva5QtMXOesieYY9lmEn) | Tailwind v4 CSS and v3 configuration |
| ZB School | [ZBSchools-Design-System](https://www.figma.com/design/MEN3cpvdA1YxUi29dHnHsc) | Tailwind v4 CSS |

Additional products can have different collections, typography, breakpoints and
naming rules. Document and implement a product adapter before generating its
outputs. Current compilers accept one source bundle per invocation; automatic
composition of multiple Figma files is not implemented.

## Setup

Use **pnpm 11.18.0**, pinned in `package.json`. Run commands from the repository root.

```bash
pnpm install
```

Use `pnpm install --frozen-lockfile` when verifying an unchanged dependency graph.

## Refresh Figma sources first

Before generating artifacts, use an AI agent with Figma MCP access to refresh the
required product sources. For example:

> Refresh ZB Master from Figma file `pijva5QtMXOesieYY9lmEn` through MCP. Retrieve
> all collections, modes, variables and aliases in bounded batches, verify counts
> and references, and save the complete bundle to `tokens/figma-variables.json`.

For School:

> Refresh ZB School from Figma file `MEN3cpvdA1YxUi29dHnHsc` through MCP. Retrieve
> all collections, modes, variables and aliases, refresh the typography specimens
> under node `1:26752`, and save the verified bundle to
> `zbschool/tokens/figma-variables.json`.

The refresh must checkpoint with `source.complete: false` and mark the bundle
complete only after verifying provenance, retrieval counts, collection membership,
mode values and aliases. Preserve every collection and mode in the source JSON.
If retrieval fails or remains incomplete, stop before generation; do not use a
stale bundle as a substitute.

The commands below **read local JSON only**. They do not connect to Figma or prove
that a bundle was freshly retrieved. Fixture tests and documentation changes do
not require a live refresh.

## Generate themes

| Command | Input | Generated destination |
| --- | --- | --- |
| `pnpm run tailwind4:output` | `tokens/figma-variables.json` | CSS in `dist/tailwind4/`, derived JSON in `dist/tokens/` |
| `pnpm run tailwind3:output` | `tokens/figma-variables.json` | `dist/tailwind3/tailwind.config.js` |
| `pnpm run zbschool:output` | `zbschool/tokens/figma-variables.json` | CSS in `dist/zbschool/`, JSON in `zbschool/tokens/` |

To generate both Master versions:

```bash
pnpm run tailwind:output
```

This runs Master v4 followed by v3 on success. It does not include School or roll
back v4 output if v3 fails.

### Generated files

```text
dist/
  tokens/
    primitives.json
    colour-token.json
    typography.json
  tailwind4/
    index.css
    base.css
    breakpoint.css
    colour-token.css
    typography.css
  tailwind3/
    tailwind.config.js
  zbschool/
    index.css
    base.css
    breakpoint.css
    colour-token.css
    typography.css
    size.css

zbschool/tokens/
  figma-variables.json
  primitives.json
  colour-token.json
  typography.json
  breakpoints.json
  size.json
```

Master's complete source stays at `tokens/figma-variables.json`. School CSS is
written directly into `dist/zbschool/`, without a nested `tailwind4/` folder.
`dist/` is ignored by Git. Old root-level `tailwind4/`, `tailwind3/` and
`zbschool/tailwind4/` paths are not current default output destinations.

### Custom paths

```bash
pnpm run tailwind4:output ./tokens/figma-variables.json
pnpm run tailwind3:output ./tokens/figma-variables.json ./dist/tailwind3
pnpm run zbschool:output ./zbschool/tokens/figma-variables.json ./dist/zbschool
```

Positional arguments take precedence over environment variables.

| Compiler | Input environment variable | Output environment variable |
| --- | --- | --- |
| Master v4 | `FIGMA_VARIABLES_JSON` | `FIGMA_OUTPUT_DIR` |
| Master v3 | `FIGMA_VARIABLES_JSON` | `FIGMA_TAILWIND3_OUTPUT_DIR` |
| School v4 | `ZBSCHOOL_VARIABLES_JSON` | `ZBSCHOOL_OUTPUT_DIR` |

Master v4 uses the parent of `FIGMA_OUTPUT_DIR` as the root for fixed
`tokens/` and `tailwind4/` subdirectories; it is not an arbitrary CSS directory
override. School's output override selects the CSS directory directly, while its
JSON stays in `zbschool/tokens/` relative to the working directory.

## Use the generated themes

Each v4 `index.css` imports its product's generated stylesheets once, using
relative paths. The consuming application supplies its Tailwind framework setup
and imports the appropriate product entry.

Current package subpaths are:

| Import | File |
| --- | --- |
| `@SPHTech-CQ/figma-tailwind-compiler/tailwind4` | `dist/tailwind4/index.css` |
| `@SPHTech-CQ/figma-tailwind-compiler/tailwind3` | `dist/tailwind3/tailwind.config.js` |
| `@SPHTech-CQ/figma-tailwind-compiler/zbschool/tailwind4` | `dist/zbschool/index.css` |

Generate the corresponding artifacts before using these entries. Products define
separate global themes; loading multiple products together needs an explicit CSS
composition contract.

Master v4 emits primitive and semantic `@theme` declarations and typography
`@utility text-*` blocks. School uses `@theme static` and its own typography
specimens. School Size tokens use `--spacing-*` except opacity, which retains
`--opacity-*`. Raw Figma names and aliases remain in JSON.

Master v3 generates an **ES module configuration** with `export default`,
`darkMode: "class"`, font families, primitive/semantic colours, background
references, screens and the `no-hover` variant. It emits no CSS. The consuming
application must supply matching CSS variables and mode values, and adjust the
config's content paths for its source files. V3 spacing and composite typography
are outside the current scope. Do not assume v4 supplies every v3 variable.

## Tests

Run output-path and product-isolation checks:

```bash
pnpm exec node --test scripts/outputPaths.test.mjs
```

Run all conversion and output-path suites:

```bash
pnpm exec node --test scripts/figmatotailwind.test.mjs scripts/figmatotailwind3.test.mjs scripts/zbschool.test.mjs scripts/outputPaths.test.mjs
```

Tests use local fixtures and temporary output directories. They do not retrieve
Figma data or regenerate repository design artifacts. Review compiler warnings
before accepting generated themes; current validation limitations are documented
in the PRD.

## Adding a product or Figma source

Record the product slug, file keys, source bundle paths, collection/mode mappings,
alias dependencies, units, typography, breakpoints, output paths and consumer
entry points. Preserve separate source bundles per Figma file; do not concatenate
bundles or resolve cross-file identities by variable name alone.

New sources should use `<product>/tokens/<source-id>/figma-variables.json` and new
v4 products should prefer `dist/<product>/` for CSS. These are onboarding
conventions; they do not migrate existing Master or School paths. Multi-file
composition requires explicit precedence/dependency rules, implementation and tests.

## Legacy plugin development

The repository retains legacy Figma plugin files. These commands compile plugin
TypeScript and do not generate themes:

```bash
pnpm run build
pnpm run watch
```

See [PRD.md](./PRD.md) for product requirements, mappings and implementation
limitations, and [AGENTS.md](./AGENTS.md) for contributor workflow and validation rules.
