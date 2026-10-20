# Customize the LiMR VS Code reader

Use reader plugins to change styles or add syntax without editing the installed LiMR extension bundle. LiMR for VS Code 1.1.3 exposes API v1 and uses LiMR 1.3.15. For changes scoped to one project, use its workspace manifest and preserve existing entries. For reusable functionality installed through VS Code, create an add-on extension and register its packaged files through the public API.

## Workspace files

Create `.limr/plugins/manifest.json` in the workspace root:

```json
{
  "plugins": [
    { "id": "reading-style", "stylesheet": "reading.css" },
    { "id": "research-card", "module": "research-card.js", "stylesheet": "research-card.css" }
  ]
}
```

Paths are relative to `.limr/plugins/`. Each entry has a unique `id` and at least one of `stylesheet` or `module`. Keep all plugin files and resources inside that directory; absolute paths, URLs, and traversal outside it are not supported. `limr.plugins.manifest` changes the workspace manifest location; it does not configure installed add-ons.

## Installed VS Code add-ons

Use `extensionDependencies: ["linloir.limr-vscode"]`, `extensionKind: ["workspace"]`, and an activation event such as `onStartupFinished` in the add-on's `package.json`. Install it in the same extension host as LiMR, including the WSL/SSH side of a remote window. The complete [runnable example](https://github.com/Linloir/LiMR-VSCode/tree/main/examples/vscode-reader-addon) requires no build step. Its enable/disable commands demonstrate registration and disposal without changing Markdown.

The [published TypeScript declarations](https://github.com/Linloir/LiMR-VSCode/blob/main/api/index.d.ts) define this host API; this copy is sufficient for a small TypeScript add-on:

```ts
import * as vscode from 'vscode';

export interface LiMRPluginContribution {
  readonly id: string;
  readonly module?: string;
  readonly stylesheet?: string;
}

export interface LiMRExtensionApi {
  readonly apiVersion: 1;
  readonly viewType: 'limr.reader';
  registerPlugin(extensionId: string, plugin: LiMRPluginContribution): vscode.Disposable;
}

export async function activate(context: vscode.ExtensionContext) {
  const extension = vscode.extensions.getExtension<LiMRExtensionApi>('linloir.limr-vscode');
  if (!extension) throw new Error('Install LiMR for VS Code 1.0.1 or later.');
  const api = await extension.activate();
  if (api?.apiVersion !== 1 || typeof api.registerPlugin !== 'function') {
    throw new Error('LiMR reader plugin API v1 is required.');
  }
  context.subscriptions.push(api.registerPlugin(context.extension.id, {
    id: 'research-card',
    module: 'reader.mjs',
    stylesheet: 'reader.css',
  }));
}
```

Pass the contributing extension's `context.extension.id`. Each contribution needs a unique, stable `id` within that extension, matching `[a-z][a-z0-9-]*`, and at least one of `module` or `stylesheet`. Paths are relative to that extension's root and must stay inside it: no leading `./`, `..` segments, absolute paths, URLs, query strings or fragments. Browser modules must use `.js` or `.mjs`. CSS-only contributions can omit `module`.

Registration returns a disposable synchronously. Invalid descriptors and duplicate extension/id pairs throw; dispose an earlier registration before replacing it. Missing files and module-load failures are reported asynchronously in each reader; the failed entry is skipped without removing other plugins. Registration and disposal refresh existing readers. The contribution can be registered without a workspace folder, so it also works for untitled documents in a trusted window. Uninstalling or disabling an add-on follows VS Code's normal extension lifecycle, which may request a window reload.

## Shared browser contract

Both workspace plugins and installed add-ons load only when the window is trusted and `limr.plugins.enabled` is enabled. The factory receives only the browser React/LiMR surface; API v1 does not add host RPC or file access. A module runs within the webview's restrictions. Keep presentation plugins free of credentials and host file-write assumptions.

An entry module is a self-contained browser ESM file, or a single ESM bundle. Its default export is a factory receiving the host's `{ React, limr }` and returning a `RendererExtension`, directly or asynchronously. Use the supplied React and LiMR instances; do not import or bundle another copy of either. Bundle additional dependencies into that entrypoint; bare package imports, TS/JSX source, and Node APIs are not supported directly. Convert TS/JSX to browser JavaScript before registering it. Avoid replacing all standard extensions. Workspace file changes reload automatically; **LiMR: Reload Reader Plugins** refreshes both sources. Reloading checks registered entry files by content hash. Separately imported helper modules do not have independent hot reload; rebuild the entry bundle after changing a helper.

Loading or factory failures skip only that entry. A component that crashes during rendering makes the entire document fall back to the base reader; its CSS remains until that plugin is disabled. After fixing the plugin, change its entry bundle or disable and re-enable it to retry; reloading unchanged files does not retry a failed factory or render boundary.

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

`defineBlock` registers its same-named tag/directive by default. The host keeps its existing manifest namespace: it creates a shallow wrapper whose extension `name` is the resolved manifest ID (`workspace:<id>` or `extension:<publisher.extension>/<id>`), leaving the factory's original object unchanged, including frozen results. Different plugins may return the same extension name or a name also used by a built-in module. Authored tag/directive names, component keys and annotation types are not renamed; actual tag/directive conflicts remain errors. Reuse `children`, `renderChildren`, and `renderValue` from public renderer props to preserve source mapping and selection. Use atomic selection for custom interactive widgets without character-level correspondence.

### Large-document compatibility

VS Code 1.0.2 limits previews to 75 MiB of UTF-8 editor text and 60 seconds per load. The default `limr.loadingMode` is `progressive`; `blocking` waits for the complete document. The top blue bar and native status item report progress. A host timeout destroys the guest and worker; retry starts a fresh load. Pure view plugins should preserve parser identity on palette or locale changes.

Worker parsing and windowed rendering have separate contracts. Documents of at least 64 Ki UTF-16 characters require worker-compatible syntax. An unmatched custom grammar fails explicitly instead of running an uninterruptible parser on the UI thread; the Markdown source stays intact. Smaller documents retain the synchronous compatibility parser. Pure view extensions stay on the host without disabling worker parsing for built-in syntax. A custom component or renderer override without a virtualization text/lifetime contract keeps the ordinary DOM renderer. Such plugins remain supported but may prevent large-document performance improvements.

Core worker registrations and internal standard-renderer identity checks belong to the original extension object and are not inherited by the host's namespaced wrapper. Explicit public `virtualization` declarations are retained. The host does not copy worker descriptors onto renamed extensions: their worker factories could return different names or syntax. Calling `registerWorkerExtension()` on a factory result alone does not install a parser factory in this VS Code extension's worker or opt its wrapper into worker parsing. API v1 has no custom worker-module contribution field. Until API v1 provides a matching namespaced worker contract, custom plugin syntax is available only on the small-document compatibility path; do not invent descriptor IDs or reuse built-in IDs for different syntax.

For a custom renderer that can safely be unmounted, `RendererExtension.virtualization[componentName]` or an override's `virtualization` must supply `copyText(node, context)`. It may also supply `searchText` and `keepAlive`. `context.children` is projected visible child text, and `context.value` is the selected, decoded literal value; use these rather than copying hidden Markdown syntax. A pure wrapper can return `context.children`. Stateful widgets must preserve their state outside transient DOM, or declare the appropriate `keepAlive` behavior. Keep-alive widgets consume DOM while retained, so it is not a general performance shortcut. Verify ordinary and cross-window copy, search, navigation, and widget state before claiming windowed compatibility. Existing `defineBlock` examples deliberately require no such declarations and retain compatibility behavior.

For lower-level syntax, annotations, or actions, inspect the public LiMR 1.3.15 declarations and matching package documentation first. `RendererExtension` can contribute `components`, `annotationTypes`, `actions`, and `parameters` as well as syntax. Follow the existing source annotation serializer for source-backed notes; a presentation plugin must not write files itself. Read [the source annotation contract](source-annotations.md) when adding annotation UI or serialization. Custom reader syntax does not automatically extend Markdown source-editor highlighting.

## Search styling and host boundaries

The host imports LiMR's DocumentSearch with shortcuts={false} and forwards native commands through useLiMR().find(). Search UI and behavior stay in core; do not copy them into a host module. Ctrl/Cmd+F opens it; Aa toggles case sensitivity and .* toggles regex. Search highlights are transient view state, not source annotations. Large-document counts ending in + are incomplete; explicit Previous/Next scans further. Search does not require editing permission.

Workspace/add-on stylesheets may target `.limr-document-search`, `.limr-search-field`, `.limr-search-count`, `.limr-search-loading` and its buttons. Set `--limr-search-width` on the component, `--limr-search-accent` for its loading ring, and `--limr-search-match` / `--limr-search-current` (plus their `-border` variants) on the reading surface. Preserve theme contrast, keyboard focus, fixed inner geometry and reduced motion. Default selected toggles have no border and follow page colors.

Core React consumers can replace Reader.search or compose DocumentSearch/useDocumentSearch, but the VS Code add-on API does not expose a root search-component slot. Do not register a second controller inside a content renderer or claim a renderer override replaces the host search UI. Native host commands already route to the one core controller.

## Selection action keybindings

LiMR for VS Code 1.1.3 provides `limr.runSelectionAction` with `{ "actionId": "your.unique.action.id" }`. Both workspace modules and installed add-ons can contribute ordinary `RendererExtension.actions`. Use a unique action ID: actions are merged by ID, while only the extension's `name` receives the host namespace.

For a workspace module, add a binding in the user's **Keyboard Shortcuts (JSON)**:

```json
{
  "key": "ctrl+alt+n",
  "command": "limr.runSelectionAction",
  "when": "activeCustomEditorId == limr.reader && limr.readerEditing && !inputFocus",
  "args": { "actionId": "limrExample.addFootnote" }
}
```

On macOS use `cmd+alt+n`. An installed add-on can supply the same object in `contributes.keybindings` with `"mac": "cmd+alt+n"`; user keybindings can override it. A workspace browser module cannot register a native VS Code keybinding by itself. Do not install a global `keydown` listener or synthesize a selection to work around this.

The runnable [add-on browser module](https://github.com/Linloir/LiMR-VSCode/blob/main/examples/vscode-reader-addon/reader.mjs) defines a `research-footnote` annotation type and an `actions` entry named `limrExample.addFootnote`. Its [package manifest](https://github.com/Linloir/LiMR-VSCode/blob/main/examples/vscode-reader-addon/package.json) binds `Ctrl+Alt+N` / `Cmd+Alt+N` to the command. The example creates a note with an initial body that can be edited in the Markdown source; it does not implement a custom note editor.

The shortcut invokes core's existing toolbar action, including its `visible`, `disabled`, busy, read-only, error and source-write handling. It receives the same `ToolbarActionContext` as a toolbar click: use `context.selection.syntax.ranges`, `context.document`, `context.canEditSource()`, and `context.addAnnotation(..., { target: 'source' })`. No action runs while the reader is loading or when focus is inside an annotation/search input. Plugin unloading removes its actions from the active reader. Set `readOnly: true` only for actions safe without write access.

Add-ons can also call `vscode.commands.executeCommand('limr.runSelectionAction', { actionId })`. This dispatches to the active reader; completion of the VS Code command is not a source-save acknowledgement. Source edits retain normal VS Code Undo and Save semantics.

Code-block defaults are host settings: `limr.codeBlock.lineNumbers` (false), `limr.codeBlock.autoCollapse` (true), and `limr.codeBlock.wrap` (false). They map to LiMR's public `parameters.codeBlock`. Per-block wrap/fold choices take precedence for that reader; changing a default does not reset a user's explicit per-block choice.

## Verify the requested outcome

Run **LiMR: Reload Reader Plugins** after installing or rebuilding files and inspect plugin-load errors. For an add-on, verify it actually activates in the intended extension host, registration reaches an open reader, and disposal removes its component and CSS. Check the changed appearance or syntax in light/dark themes and a narrow reader. Confirm ordinary Markdown, source selection, links, and existing annotations still work. For interactive changes, check keyboard focus and that clicks do not unexpectedly blur or save editors. Report the changed manifest/files and the behavior you actually observed. Do not claim real VS Code validation from a build or a standalone HTML preview alone.
