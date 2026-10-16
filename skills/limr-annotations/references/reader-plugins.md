# Customize the LiMR VS Code reader

Use workspace plugins to change styles or add syntax without editing the installed extension bundle. The host uses LiMR 1.2.2. Keep changes in the user's chosen workspace and preserve existing manifest entries.

## Files and loading

Create `.limr/plugins/manifest.json` in the workspace root:

```json
{
  "plugins": [
    { "id": "reading-style", "stylesheet": "reading.css" },
    { "id": "research-card", "module": "research-card.js", "stylesheet": "research-card.css" }
  ]
}
```

Paths are relative to `.limr/plugins/`. Each entry has a unique `id` and at least one of `stylesheet` or `module`. Keep all plugin files and resources inside that directory; absolute paths, URLs, and traversal outside it are not supported. Plugins load only in trusted workspaces. A module is executable workspace code, with the webview's access restrictions. Do not add network fetches, credentials, or host file-write assumptions to a presentation plugin.

An entry module is a self-contained browser ESM file, or a single ESM bundle. Its default export is a factory receiving the host's `{ React, limr }` and returning a `RendererExtension`. Use the supplied React and LiMR instances; do not import or bundle another copy of either. Bundle additional dependencies into that entrypoint; bare package imports, TS/JSX source, and Node APIs are not supported directly. Convert TS/JSX to browser JavaScript before registering it. Avoid replacing all standard extensions. Reloading checks the manifest and each registered entry file by content hash. Separately imported helper modules do not have independent hot reload; rebuild the entry bundle after changing a helper.

## Style-only changes

Start with CSS when the request changes appearance only. Scope selectors to LiMR classes or a unique plugin class. Respect `--vscode-*` colors and the reader's `--limr-*` variables. For floating annotation content, use classes or appearance attributes on the card itself; portals may be outside the reader ancestor.

```css
.limr-reader .research-card {
  margin-block: 1.2em;
  padding: 1em 1.25em;
  border-inline-start: 2px solid var(--vscode-textLink-foreground);
  background: var(--vscode-textBlockQuote-background);
}
```

Inspect the installed reader DOM before targeting a built-in selector. Keep button sizing and wrapping intact on narrow screens. Use `:focus-visible` for keyboard focus; do not restore broad input/button focus borders inside annotation editors. Preserve accessible names and touch targets. Underline hover animations belong on inline label spans, not direct flex items.

## Add a block syntax

`research-card.js`:

```js
export default function ({ React, limr }) {
  return limr.defineBlock({
    name: 'research-card',
    component: function ResearchCard({ children }) {
      return React.createElement('aside', { className: 'research-card' }, children);
    },
  });
}
```

Then a document can contain:

```markdown
:::research-card
This **Markdown** is rendered using the normal reader components.
:::
```

`defineBlock` registers its same-named tag/directive by default. Extension, tag, and directive names must not collide with existing modules. Reuse `children`, `renderChildren`, and `renderValue` from public renderer props to preserve source mapping and selection. Use atomic selection for custom interactive widgets without character-level correspondence.

For lower-level syntax, annotations, or actions, inspect the public LiMR 1.2.2 declarations and matching package documentation first. `RendererExtension` can contribute `components`, `annotationTypes`, `actions`, and `parameters` as well as syntax. Follow the existing source annotation serializer for source-backed notes; a presentation plugin must not write files itself. Read [the source annotation contract](source-annotations.md) when adding annotation UI or serialization.

## Verify the requested outcome

Run **LiMR: Reload Workspace Plugins** after installing or rebuilding files and inspect plugin-load errors. Check the changed appearance or syntax in light/dark themes and a narrow reader. Confirm ordinary Markdown, source selection, links, and existing annotations still work. For interactive changes, check keyboard focus and that clicks do not unexpectedly blur or save editors. Report the changed manifest/files and the behavior you actually observed. Do not claim real VS Code validation from a build or a standalone HTML preview alone.
