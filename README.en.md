# LiMR for VS Code

<img src="media/limr-icon.png" alt="LiMR" width="96" />

[简体中文](README.md)

A Markdown reader built on **@linloir/limr 1.2.3**. Read beside the source editor, with margin notes, questions, and highlights stored directly in Markdown and tracked by Git.

## Install and open

Use **Extensions → Install from VSIX…** to install `limr-vscode-1.0.1.vsix`. Open a `.md` or `.markdown` file, then choose:

- **LiMR: Open Reader to the Side** for source and preview side by side.
- **LiMR: Open Markdown Reader** for the current editor group.
- **Reopen Editor With… → LiMR Reader** to choose the reader or make it the default.

### Remote-WSL

Install from a window already connected to **WSL: Ubuntu**. LiMR is a workspace extension: file operations run in the WSL extension host, while the Webview appears in the Windows VS Code client. Normally, only the WSL installation is needed.

From that window's WSL terminal:

```bash
code --install-extension ./artifacts/limr-vscode-1.0.1.vsix
```

Check that `code --list-extensions` identifies the intended WSL environment. Reload if VS Code requests it. **Developer: Show Running Extensions** shows the host location. To debug, open this repository in the WSL window, run `npm ci && npm run build`, and press F5.

## Read and edit

The reading area displays the document directly. Theme, editing, settings, and AI Skill controls live in the **native VS Code editor toolbar**; reading status appears in the **native VS Code status bar**.

The reader starts read-only. Use the editor toolbar's editing button, **LiMR: Toggle Markdown Editing**, or `limr.editingEnabled` to:

- Add highlights, margin notes, and questions to selected text. Several annotations can share a range.
- Use animated **Edit/Delete** text actions in annotation overlays and sidebar entries.
- Use **Delete** in the highlight toolbar to remove all annotations and highlighting on that range, preserving other ranges of a shared annotation.
- Toggle Markdown task checkboxes.
- Use normal VS Code Undo/Redo, Save, and Auto Save against the same text document.

Notes submit when editing ends. Rejected stale edits retain drafts and show an error. Source edits made by an editor or AI synchronize into the reader. Read-only and untrusted workspaces cannot create temporary annotations or change source through the reader.

Annotations use LiMR 1.2.3 paired range boundaries, `::%%limr%%{<#r1}text::%%limr%%{>#r1}`, and `:::limr-annotation` definitions. Ranges can cross formatting and paragraphs and overlap. Parsing and serialization use LiMR's public APIs; legacy inline markers are no longer supported. Deleting annotations removes unused boundaries, and canceling an empty draft removes its temporary boundaries.

By default (Auto), images resolve relative to the Markdown file first, then fall back only to that file’s workspace root. Parent paths, workspace-root paths, absolute paths, `file:` URLs, Windows/WSL paths, spaces, Unicode and encoded filenames are supported. Explicit `../` paths resolve from the selected base without additional search directories; the reader does not search static directories or guess replacements by filename.

## Themes and typography

The default is **Playground (follow VS Code light/dark)**: LiMR Playground fonts and reading colors, with light or dark appearance selected by the current VS Code theme. Use the native editor toolbar or **LiMR: Choose Reader Theme** to select **Playground Light / Dark**, **VS Code Light**, **VS Code Dark**, **One Dark Pro**, or **One Dark Pro Darker**. The separate **Follow VS Code** option uses the active theme's actual colors and overrides. Code highlighting follows the light/dark appearance.

The default body font is bundled **Noto Serif SC Variable**, with Georgia/serif fallbacks, at 16px and line height 1.8. Code uses **Maple Mono NF CN** at 14px. Changing color themes preserves font settings.

The body keeps its configured maximum width. With the annotation sidebar visible, remaining width goes to notes. When the sidebar is disabled or cannot fit, the body is centered in the entire reading viewport. The table of contents occupies the left gutter on wide screens and becomes a collapsible control when space is limited. Outer gutters retain comfortable spacing, with compact top padding.

Use the native editor toolbar's settings button or **LiMR: Reader Settings**:

| Setting | Purpose |
| --- | --- |
| `limr.bodyFontFamily` / `bodyFontSize` | Latin body typography; empty family uses Playground defaults |
| `limr.chineseFontFamily` / `chineseFontSize` | Chinese typography; size 0 inherits body size |
| `limr.otherFontFamily` / `otherFontSize` | Other scripts |
| `limr.codeFontFamily` / `codeFontSize` | Inline and block code; empty family uses Playground's code font |
| `limr.lineHeight` / `maxWidth` | Body spacing and maximum width |
| `limr.sidebarMode` | Annotation sidebar: `always`, `content` (default), or `hidden`; empty sidebars reserve no space and the article stays centered; narrow readers use overlays |
| `limr.sidebarAutoCollapse` | Fold crowded sidebar items automatically (on by default); turn off to lay out each item separately without changing each card body's expansion state |
| `limr.tocMode` | `always`, `wide` (side TOC only), or `hidden`; wide mode adds no top TOC on narrow screens |
| `limr.typography` | Default layout: `standard`, `justify`, or `knuth-plass` |
| `limr.translationMode` | `bilingual`, `original`, `translated`, or `paragraph` |
| `limr.language` | `auto` follows VS Code language; `zh-CN` or `en` |
| `limr.topBarButtons` / `bottomBarButtons` | Choose visible title and status bar actions |
| `limr.previewButtonMode` | `separate` or `merged` (one preview entry, default to LiMR) |
| `limr.skills.promptOnStartup` | Skill installation reminder, at user or workspace scope |
| `limr.plugins.enabled` / `plugins.manifest` | Reader plugins from the workspace and installed add-ons, in trusted windows; `manifest` selects only the workspace manifest |
| `limr.syncScroll` | Source/reader scroll synchronization |
| `limr.syntaxHighlighting.enabled` | Supplementary LiMR colors in Markdown source editors; on by default, changes apply immediately |
| `limr.images.pathMode` | Relative image paths: `auto` tries the Markdown directory then its workspace (default), `file` uses only the Markdown directory, `workspace` uses its workspace root, or `folder` uses a fixed directory |
| `limr.images.baseFolder` | Fixed directory for `folder` mode; an empty value does not guess automatically |
| `limr.images.searchPaths` | Additional directories tried in order after the selected strategy misses; the first match wins; defaults to `[]` |

Image settings support user defaults and workspace overrides. Fixed and additional directories accept absolute paths, `file:` URIs, and `~`. Relative directories start at the containing workspace, or the Markdown directory when no workspace is open. Explicit `../` references retain their precise locations. There is no basename search or implicit search of `public`, `static`, or other workspaces.

**LiMR: Choose Typography** and **LiMR: Choose Translation Display** offer this-file overrides, resetting this file to defaults, and default settings. Overrides persist in VS Code workspace state without rewriting Markdown. Changing one translation paragraph from a uniform mode preserves the other paragraphs' current display and switches only this file to per-paragraph configuration. **LiMR: Reset Current File Reading Settings** clears both overrides.

**Choose Top Bar Buttons** and **Choose Status Bar Buttons** provide multi-select dialogs. In merged preview mode, click opens LiMR; Alt-click (or Shift on Linux/Windows) opens the built-in preview. The editor overflow's **Markdown Preview** submenu lists both. This uses the built-in Markdown `hasCustomMarkdownPreview` integration context; it does not replace built-in command handlers.

`limr.language` controls the reader and command dialogs. Native command titles and setting labels follow VS Code's display language.

Source colors cover LiMR 1.2.3 built-in component tags, directives and static attributes, valid annotation definitions and paired boundaries, `==highlights==`, `^[inline footnotes]`, math delimiters, and blockquote `[!type]` markers. Existing Markdown, code and comment colors remain in place; paired boundaries referenced by a real annotation definition are also colored inside code, matching the reader. Custom syntax added by reader plugins is not included automatically. This works in local, remote and untitled Markdown editors; disabling it immediately removes the added colors. Colors follow the current theme and accept `workbench.colorCustomizations` overrides for `limr.syntax.punctuation`, `tag`, `attribute`, `value`, `annotation`, `highlight` and `math` (each prefixed with `limr.syntax.`).

## Style and syntax plugins

YAML metadata enclosed by `---` at the start of a file automatically appears as a document information card, highlighting its name and description alongside other fields, lists, and nested values. **View original metadata** reveals the complete source. This works for `SKILL.md` and other Markdown files by default, without changing the file or configuring a workspace plugin. Invalid metadata remains visible as original text.

Create `.limr/plugins/manifest.json` in your workspace, listing CSS and ESM modules in `plugins`. Modules export a factory, `export default ({ React, limr }) => RendererExtension`, sharing the reader's React/LiMR. They can add syntax, components, annotations, and actions without rebuilding the extension. Workspace file changes reload automatically; **LiMR: Reload Reader Plugins** also refreshes them. Loading failures retain the base reader and display an error.

You can also distribute a separate VS Code extension that registers its modules when installed. Declare `extensionDependencies: ["linloir.limr-vscode"]` and `extensionKind: ["workspace"]`, activate LiMR, then call the public `registerPlugin(context.extension.id, { id, module, stylesheet })` and dispose its registration through `context.subscriptions`. Paths resolve from the add-on's root, with no workspace manifest required. Registration and disposal immediately refresh open readers. See the [API v1 declarations](api/index.d.ts) and [complete example with no build step](examples/vscode-reader-addon). Both plugin sources respect `limr.plugins.enabled` and window trust. In Remote-WSL, install the add-on in the same WSL extension host as LiMR.

See the [plugin guide](skills/limr-annotations/references/reader-plugins.md). It is included in the installed skill so an AI assistant can customize styles and syntax.

## Ask an AI assistant

Select text and choose **Question context**, then paste into Codex or another assistant and add your question. The hover hint explains this workflow.

Clipboard text includes the file path, original UTF-16 offsets, line/column positions, selected source, surrounding text, annotation IDs, and write-back guidance. When supported, HTML includes a Codex file mention. Clipboard permission restrictions fall back to complete plain text. The mention format was checked against an installed Codex editor; it is not a stable public OpenAI API.

Use the reader's AI submenu to read the guide, install the skill, or copy installation instructions. **LiMR: Install AI Skill…** offers global, workspace, and custom locations; **LiMR: Install AI Skill Globally…** opens global choices directly. Codex uses `~/.agents/skills/limr-annotations` or workspace `.agents/skills/limr-annotations`; Claude Code uses `.claude/skills`. First use offers installation. Each new workspace gets one offer unless a global skill is installed; users can disable reminders globally or just in this workspace. Skill files are created only after the user chooses to install.

See the [AI Annotation Guide](docs/ai-guide.en.md). The extension does not send AI requests. After the user pastes context, the assistant can follow the skill to update inline annotations. Conversation IDs must come from actual known context.

## Development

Node.js 22.12+ is recommended.

The dependency is pinned to npm's `@linloir/limr@1.2.3`. Run `npm ci` with the lockfile; no neighboring repository or local tarball is required.

```bash
npm ci
npm run typecheck
npm test
npm run build
npm run test:vscode
npm run test:animations
npm run test:regressions
npm run test:features
npm run package
```

The real Electron/Playwright test uses isolated profiles, extension directories, and temporary fixtures. `VSCODE_TEST_VERSION` selects the runtime; `LIMR_TEST_THEME_DIR` supplies a local One Dark Pro theme. Linux/WSLg needs a working display server.

`test:animations` samples animation playback in the same real editor, checking intermediate frames and final states for toolbars, overlays, highlights, sidebars, and reading controls. Evidence and screenshots are saved under `artifacts`.

`test:regressions` checks mixed-format selections, toolbar widths, overlay switching, focus styles, bulk deletion and Undo, and wide/narrow reader layouts.

`test:plugins` loads a real companion extension in a disposable profile and checks registration, disposal, settings and load failure isolation. `test:scroll` checks synchronized scrolling across complex blocks; `test:translations` covers reversed source order and all three translation display modes; `test:syntax` checks source highlighting and theme colors. After `npm run package`, run `npm run test:installed-icon` to install the VSIX in a disposable profile and verify the icon loaded in the extension list and details page.

Output: `artifacts/limr-vscode-1.0.1.vsix`. Runtime assets are bundled, with no development server or CDN requirement. Remote media referenced by Markdown may still access the network.
