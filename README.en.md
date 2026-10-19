# LiMR for VS Code

<img src="media/limr-icon.png" alt="LiMR" width="96" />

[简体中文](README.md) · [LiMR GitHub](https://github.com/Linloir/LiMR) · [Playground](https://linloir.github.io/LiMR/) · [Extension source](https://github.com/Linloir/LiMR-VSCode)

## What is LiMR?

LiMR is a Markdown reader designed for comfortable reading. This extension brings [LiMR](https://github.com/Linloir/LiMR) into VS Code for technical documentation, study notes, research excerpts, and `SKILL.md`, with source and reader side by side.

- **Polished defaults**: bundled Chinese serif and monospace code fonts, light and dark palettes, and VS Code theme integration. Article width, contents, and annotation panels adapt to the available space.
- **Rich content**: syntax highlighting, math, Mermaid diagrams, and blocks for callouts, definitions, citations, and paragraph translations. YAML frontmatter appears as a document information card.
- **Annotations in your Markdown**: select text to add highlights, notes, and questions. Changes stay in the original file and work with VS Code save, undo, and Git. Reading is read-only by default; enable editing when needed.
- **Click to preview images**: LiMR's native preview supports fit, actual size, fill, zoom, dragging, and copying image pixels for Markdown, reference, and figure images. Close with Escape, the close button, or the backdrop. Copying requires clipboard permission and a readable image resource.
- **Reading preferences**: configure fonts, spacing, article width, contents, translation display, and paragraph layout. Source and reader can scroll together.
- **Simple extensibility**: use workspace CSS to change appearance and JavaScript modules to add components, syntax, annotations, or actions. Reusable modules can also ship as VS Code add-ons.

LiMR is also a Markdown rendering library for React projects. This extension uses `@linloir/limr 1.3.6`. Try reading and editing in the [Playground](https://linloir.github.io/LiMR/), or explore the [syntax documentation](https://linloir.github.io/LiMR/#/docs/en/syntax).

## Get started and configure

1. Open a `.md`, `.markdown`, or `SKILL.md` file and click the **book icon** in the editor title bar to open LiMR beside it. The Command Palette also offers **LiMR: Open Reader to the Side** and **LiMR: Open Markdown Reader** for the current group.
2. Use the reader toolbar to choose a theme, typography, or translation display. Enable editing with the edit button to add annotations or change task checkboxes; use VS Code's usual save and undo actions.
3. Click settings or run **LiMR: Reader Settings**. Search VS Code Settings for `@ext:linloir.limr-vscode`. Choose **User** for personal defaults or **Workspace** for project settings.

Shortcuts: `Ctrl+Shift+V` opens LiMR in the current group; `Ctrl+Alt+V` opens it beside the source (use `Cmd` on macOS). VS Code also supports `Ctrl+K V`; Cursor uses `Ctrl+K` for AI editing. On first activation in Cursor, LiMR adds its buttons to `cursor.general.pinnedTitleActions`, preserving existing entries. Later removals from that list are respected. Disable `limr.cursor.pinTitleActions` before first activation to retain Cursor’s hidden buttons.

The default preview title button and shortcuts open LiMR; an explicit `limr.previewButtonMode: "separate"` still shows both buttons. Cursor’s breadcrumb `Preview / Markdown` toggle belongs to its internal editor and currently has no public preview-provider replacement API, so it continues to use Cursor’s renderer. If Cursor remembers its internal Preview, switch back to Markdown or configure the default editor. For source files, choose `limr.markdownOpenMode: "reader"` or **Reopen Editor With → Configure default editor → LiMR Reader**.

Web links open in your browser. Markdown links default to smart navigation: a source/reader pair for the same document updates together; other layouts update only the current reader. Choose among five link modes; side targets reuse existing groups. Mouse back/forward or Alt+arrow keys restore reader history and the previous companion file. Same-document heading links scroll within the reader.

Documents of at least 256 KiB of UTF-16 text coalesce edits for 250 ms, with a 1.2 s maximum wait during continuous typing. Smaller documents update immediately. Asynchronous refresh keeps the accepted content visible until a complete replacement is ready at the same reading position.

### Common settings

| Setting | Default | Meaning and use |
| --- | --- | --- |
| `limr.theme` | `"playground"` | LiMR colors following VS Code light/dark mode. `"auto"` uses the active VS Code theme's actual colors. Fixed choices: `playground-light`, `playground-dark`, `vscode-light`, `vscode-dark`, `one-dark-pro`, `one-dark-pro-darker`. |
| `limr.editingEnabled` | `false` | Allow annotation changes and task checkbox edits in the reader; requires workspace trust. |
| `limr.bodyFontFamily` / `limr.bodyFontSize` | `""` / `16` | Body font and size in px. An empty family uses bundled Noto Serif SC Variable. |
| `limr.chineseFontFamily` / `limr.chineseFontSize` | `""` / `0` | Separate Chinese font and size; an empty family and size 0 inherit the body settings. `limr.otherFontFamily` / `limr.otherFontSize` do the same for other scripts. |
| `limr.codeFontFamily` / `limr.codeFontSize` | `""` / `14` | Code font and size in px; an empty family uses bundled Maple Mono NF CN. |
| `limr.lineHeight` / `limr.maxWidth` | `1.8` / `860` | Body line-height multiplier and maximum width in px. Reduce them for a more compact layout. |
| `limr.typography` | `"standard"` | `standard` normal layout; `justify` justified text; `knuth-plass` paragraph-wide line-breaking optimization. |
| `limr.tableLayout.enabled` | `true` | Optimize table layout; disable for native tables with less measurement work on long tables. |
| `limr.loadingMode` | `"progressive"` | Show a read-only preview while the complete document parses in the background, preserving your reading position when ready. Choose `blocking` to wait before showing content. Some plugins require complete loading. |
| `limr.markdownOpenMode` | `"none"` | `none` preserves current opening behavior; `reader` opens LiMR; `sideBySide` opens permanent source and reader tabs in a stable column order. Setting changes also apply to the current source tab. Switching to the text editor is respected until the file is closed and opened again. |
| `limr.markdownLinkMode` | `"smart"` | `currentReader`, `besideReader`, `besideEditor`, `editorAndReader`, or `smart`. Smart updates both columns only when they show source and reader for the same document. Mouse back/forward and Alt+arrow keys restore navigation. |
| `limr.singleReader` | `false` | Reuse one reader; `besideReader` falls back to the current group. Unsaved old reader tabs remain available to protect edits. |
| `limr.sidebarMode` | `"content"` | `content` shows the sidebar when notes exist; `always` always enables it; `hidden` hides it. Narrow readers display annotations in overlays. |
| `limr.sidebarAutoCollapse` | `true` | Fold crowded sidebar items automatically; turn off to lay them out individually. |
| `limr.tocMode` | `"always"` | `always` shows side contents on wide screens and collapsible contents on narrow ones; `wide` shows only side contents; `hidden` hides both. |
| `limr.contentAlignment` | `"window"` | Without an annotation sidebar, `window` centers the article in the reader window; `remaining` centers it in the space to the right of the side TOC. |
| `limr.translationMode` | `"paragraph"` | `paragraph` follows each block; `bilingual` shows both versions; `original` or `translated` shows one. Displays existing translations; does not generate them. |
| `limr.syncScroll` | `true` | Synchronize scrolling between source and reader in both directions. |
| `limr.previewButtonMode` | `"merged"` | `separate` shows the LiMR book and built-in preview buttons; `merged` keeps one LiMR entry. Alt-click opens the built-in preview; both choices are also in **More Actions → Markdown Preview**. |
| `limr.language` | `"auto"` | Reader and dialogs follow VS Code language, or use `zh-CN` / `en`. Native command and setting names follow VS Code's display language. |
| `limr.topBarButtons` / `limr.bottomBarButtons` | All title actions; editing, typography, translation in status bar | Select visible actions with **LiMR: Choose Top Bar Buttons** / **Choose Status Bar Buttons**. |
| `limr.images.pathMode` | `"auto"` | Try the Markdown directory, then its workspace. `file` uses only the file directory; `workspace` uses its workspace; `folder` uses `limr.images.baseFolder`. |
| `limr.images.searchPaths` | `[]` | Extra directories tried in order after the image strategy misses. Explicit `../` paths keep their exact location without searching for replacements. |
| `limr.syntaxHighlighting.enabled` | `true` | Add colors for built-in LiMR syntax in Markdown source editors. |
| `limr.plugins.enabled` / `limr.plugins.manifest` | `true` / `".limr/plugins/manifest.json"` | Enable reader plugins and select the workspace manifest. Plugins load only in trusted windows. |
| `limr.skills.promptOnStartup` | `true` | Offer the AI collaboration skill; disable at user or workspace scope if desired. |

A thin bar below the editor tabs and a native status-bar percentage show loading progress. Click the status item to cancel; after cancellation or an error, click it to retry. The top bar uses VS Code's progress color inside the reader because the public extension API does not expose the editor group's native progress widget.

Previews accept up to **75 MiB** of UTF-8 editor text, including unsaved edits, with a **60-second** deadline per load. Oversized text never enters the reader; a timeout releases the guest and parser worker, with Retry and Open source actions. Large text uses VS Code binary messages. Above 4 Mi UTF-16 characters, supplementary LiMR source decorations are skipped while VS Code’s Markdown highlighting remains available, avoiding a second full syntax tree in split view.

For example, add this to User Settings JSON or your project's `.vscode/settings.json`:

```json
{
  "limr.theme": "playground",
  "limr.bodyFontSize": 17,
  "limr.lineHeight": 1.8,
  "limr.maxWidth": 800,
  "limr.tocMode": "wide",
  "limr.sidebarMode": "content",
  "limr.previewButtonMode": "merged"
}
```

This slightly enlarges body text, narrows the article, and shows contents only in wide readers. Switching color themes preserves font settings. Fixed and additional image directories accept absolute paths, `file:` URIs, and `~`; relative directories start at the file's workspace, or its directory when no workspace is open.

Typography and translation support per-file overrides through **LiMR: Choose Typography** and **LiMR: Choose Translation Display**. Choose a value first, then apply it to this file or the default settings. Choosing default settings also clears this file’s override for that preference, including paragraph overrides for translation; other files keep their overrides. The first menu shows the current and default values; “Reset this file to default” clears the override immediately, including paragraph overrides for translation. Defaults follow VS Code user/workspace/folder precedence, with the actual scope shown in the menu. Overrides persist across reopening without rewriting Markdown. **LiMR: Reset Current File Reading Settings** restores the defaults.

## Customize appearance and capabilities with AI

Open the toolbar's AI menu for guidance, or run **LiMR: Install AI Skill…** to install the bundled `limr-annotations` skill in your assistant's global or workspace directory. It includes annotation rules, built-in syntax, and the style/module extension contract for assistants such as Codex and Claude Code.

Try requests like these:

> Use limr-annotations to add a LiMR reading style for this project: blue heading accents and slightly more paragraph spacing. Support light and dark themes and narrow editor groups.

> Use limr-annotations to add a `research-card` module for experiment conclusions, keeping Markdown content inside each card. Preserve existing plugins and include an example document.

### Change styles

Create `.limr/plugins/manifest.json` in the workspace and reference CSS in the same directory. Append entries if a manifest already exists:

```json
{
  "plugins": [
    { "id": "reading-style", "stylesheet": "reading.css" }
  ]
}
```

Start with a small `reading.css`:

```css
.limr-reader h1,
.limr-reader h2 {
  color: var(--vscode-textLink-foreground);
}
```

Workspace plugin files reload automatically after saving. **LiMR: Reload Reader Plugins** also refreshes them.

### Add modules or distribute an add-on

Add `{ "id": "research-card", "module": "research-card.mjs" }` to the manifest. The module reuses the reader's React and LiMR:

```js
export default ({ React, limr }) => limr.defineBlock({
  name: 'research-card',
  component: ({ children }) => React.createElement(
    'aside', { className: 'research-card' }, children
  ),
});
```

Use `:::research-card`, the card's Markdown body, and a closing `:::` in your document. Add CSS for its appearance, or ask your assistant to build syntax, annotation types, and actions using the public interfaces.

The host retains manifest namespaces for extension `name` without mutating the factory's original object; workspace plugins and add-ons may return the same extension name. Authored tag/directive names, component keys and annotation types remain unchanged, so actual syntax names must still avoid conflicts. Pure view plugins keep the default syntax worker. Custom syntax uses main-thread compatibility parsing only below 64 Ki UTF-16 characters; larger documents report missing worker compatibility explicitly. Windowed rendering has a separate contract, so large-document performance is not guaranteed for every plugin; see the [compatibility contract](skills/limr-annotations/references/reader-plugins.md#large-document-compatibility).

For reuse across projects, package modules as a separate VS Code add-on and register them through `registerPlugin`. See the [plugin guide](skills/limr-annotations/references/reader-plugins.md), [API declarations](api/index.d.ts), and [complete add-on example](examples/vscode-reader-addon). In Remote-WSL / SSH, install add-ons in the same extension host as LiMR.

### Ask questions and annotate documents

Select text, choose **Question context**, then paste into your assistant and add your question. Compact context asks the assistant to answer first, then use the bundled script against the live VS Code buffer, including unsaved edits and undo. It rereads and relocates only if quick writeback fails. With editing enabled, the skill requires writing the question, answer, and highlighting back to Markdown. Corresponding original/translated passages share one question annotation. For papers, it recommends `figure` / `figures` for captioned images. The extension does not call an AI model; changes your assistant makes to Markdown appear in the reader. See the [AI guide](docs/ai-guide.en.md).

For extension development and builds, see the [development guide](docs/development.md).
