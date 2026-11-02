# Figma Variables to Tailwind Exporter

This repo contains a Figma plugin that exports local Figma Variables and Text Styles into Tailwind-ready files.

The purpose of the plugin is to help move design tokens from Figma into frontend code in two formats:

1. Tailwind 4 CSS-first output.
2. Tailwind 3 config and CSS output.

## Run Figma MCP Server from AI first
Always update the variable from figma first by using the MCP Server as we have limitation to pull the api.

### Paste this to the AI:
Refresh the variables from ZB-Design-System-Master through Figma MCP

## What It Exports

### Tailwind 4

The plugin generates:

- `base.css`: non-color design tokens emitted in `@theme`.
- `color-tokens.css`: color variables emitted in `@theme`.
- `typography.css`: text style utilities emitted with Tailwind 4 utility syntax.

### Tailwind 3

The plugin generates:

- `tailwind.config.js`: CommonJS Tailwind config with `content`, `darkmode`, `theme.fontFamily`, `theme.colors`, and `theme.backgroundColors`.
- `index.css`: CSS custom properties emitted under a top-level `:root` block.

## How It Reads Figma Data

The plugin reads local Figma data from the main plugin context with:

```ts
figma.variables.getLocalVariableCollectionsAsync()
figma.variables.getLocalVariablesAsync()
figma.getLocalTextStylesAsync()
```

Variables are normalized into CSS-safe token names, converted into CSS values, and then assembled into downloadable files in the plugin UI.

## Development

Install dependencies:

```bash
npm install
```

Build the plugin:

```bash
npm run build
```

Watch TypeScript changes:

```bash
npm run watch
```

Compile Tailwind v4 files from the local Figma MCP bundle:

```bash
npm run tailwind:output
```

This reads `tokens/figma-variables.json` and writes the three focused JSON files
under `tokens/` and `base.css`, `colour-token.css`, and `typography.css` under
`tailwind4/`.

Compile a separate Tailwind v3 config:

```bash
npm run tailwind3:output
```

This reads the same local bundle and writes `tailwind3/tailwind.config.js`.
The generated ES module config includes the example's content pattern, nested primitive palettes,
semantic colours, and font-family stack. Missing values, alias issues, collisions,
and unsupported values are reported as terminal warnings.

The v3 compiler uses the supported `darkMode` key and extends
`theme.backgroundColor` so `bg-primary` can coexist with `bg-red-500` and other
palette/semantic background utilities. Background tokens reference their own
variables so their values can change by mode. It collapses repeated prefixes,
including `elevation-elevation`, rather than copying that repetition from the
example.

The app supplies
the CSS variables referenced by this config; this compiler does not emit CSS.
The `content` paths are relative to the
consuming project's working directory; update them for your app.

The compiler validates every source mode, using Light (when present) or the
collection default to select config entries. Mode-specific values are supplied
by your application's CSS variables. This compiler exports colour and
font-family mappings, matching the example's scope; typography composites and
spacing configuration are not part of this v3 output.

Custom input and output directory:

```bash
npm run tailwind3:output -- ./tokens/figma-variables.json ./dist/tailwind3
```

Environment overrides are `FIGMA_VARIABLES_JSON` and
`FIGMA_TAILWIND3_OUTPUT_DIR`. The compiler reads local JSON and does not fetch
Figma data or modify the v4 output. Refresh the token bundle through the Figma
MCP workflow when updated design tokens are needed.

The Figma plugin manifest points to `code.js` and `ui.html`.

## Product Notes

See [PRD.md](./PRD.md) for the detailed Tailwind 3 and Tailwind 4 export behavior, including how Figma API values are read, how keys are generated, and how the downloaded files are assembled.
