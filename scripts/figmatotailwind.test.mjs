import assert from "node:assert/strict";
import test from "node:test";
import { buildBreakpointFiles } from "./figmatotailwind.mjs";

test("breakpoints use page widths across modes and ignore other sizes", () => {
  const bundle = {
    collections: [
      { id: "breakpoints", name: "Breakpoints", modes: [{ id: "mobile" }, { id: "tablet" }, { id: "desktop" }, { id: "other" }] },
      { id: "size", name: "Size", modes: [{ id: "mobile" }] }
    ],
    variables: [
      { collectionId: "breakpoints", name: "page-width", valuesByMode: { mobile: 390, tablet: 768, desktop: 1200, other: 992 } },
      { collectionId: "breakpoints", name: "page-height", valuesByMode: { mobile: 1440 } },
      { collectionId: "size", name: "page-width", valuesByMode: { mobile: 1440 } }
    ]
  };
  assert.deepEqual(buildBreakpointFiles(bundle), {
    "tailwind4/breakpoint.css": "@theme {\n  --breakpoint-xs: 390px;\n  --breakpoint-md: 768px;\n  --breakpoint-lg: 1200px;\n}\n"
  });
});

test("missing widths are not invented from mode labels or other variables", () => {
  const bundle = {
    collections: [{ id: "b", name: "Breakpoints", modes: [{ id: "390" }, { id: "768" }] }],
    variables: [
      { collectionId: "b", name: "page-width", valuesByMode: { "390": 390 } },
      { collectionId: "b", name: "page-height", valuesByMode: { "768": 768 } }
    ]
  };
  assert.equal(buildBreakpointFiles(bundle)["tailwind4/breakpoint.css"], "@theme {\n  --breakpoint-xs: 390px;\n}\n");
});
