# Figma Variables to Tailwind Exporter

This repo contains a Figma plugin that exports local Figma Variables and Text Styles into Tailwind-ready files.

The purpose of the plugin is to help move design tokens from Figma into frontend code in two formats:

1. Tailwind 4 CSS-first output.
2. Tailwind 3 config and CSS output.

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

Compile the Tailwind files from a JSON export:

1. Use the plugin's `Download` button and save the JSON as
   `~/Desktop/figma-variables.json`.
2. Run:

```bash
npm run tailwind:export
```

The generated files are written to `~/Desktop/figma-tailwind/`:
`base.css`, `color-tokens.css`, `typography.css`, `index.css`, and
`tailwind.config.js`.

You can also provide custom paths:

```bash
npm run tailwind:export -- ./tokens.json ./dist/tailwind
```

The Figma plugin manifest points to `code.js` and `ui.html`.

## Product Notes

See [PRD.md](./PRD.md) for the detailed Tailwind 3 and Tailwind 4 export behavior, including how Figma API values are read, how keys are generated, and how the downloaded files are assembled.
