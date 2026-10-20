# Extension development

Node.js 22.12+ is recommended.

The dependency is pinned to npm's `@linloir/limr@1.3.14`. Run `npm ci` with the lockfile; no neighboring repository or local tarball is required.

The host supplies `<DocumentSearch shortcuts={false} rememberQuery={settings.searchRememberQuery} />` through Reader.search and routes native find commands through public `useLiMR().find()`. VS Code owns the remappable keybindings: disabling core's keyboard listener prevents F3/Shift+F3 from navigating twice when the webview also forwards the key to the workbench. Core owns selected-plain-text search, query retention, viewport-first matching, regex/case options, interruptible search Workers, nearby scanning for large documents, loading motion and transient result highlights. Closing search clears its query by default; `limr.search.rememberQuery` retains it. Typing selects an already visible match without moving the reading position; when all matches are outside the viewport, `?/N` waits for Previous/Next. Native input undo/redo stays in the search field instead of reaching the source editor. Search uses the existing `worker-src blob:` permission without additional imports. The guarded build adapters retain selection actions, scrolling, typography and annotation IDs; search uses the core component without source patches or private find events. The reviewed core versions remain in the adapter allowlists, with exact source hashes and fail-closed drift checks.

The webview build applies a reviewed scroll compatibility patch to LiMR 1.3.14 via `scripts/limr-scroll.mjs`, alongside the short annotation ID adapter. It corrects estimated source seeks, invisible closing markup, and wheel takeover in reader gutters. Resized slots are measured in the existing ResizeObserver delivery so core's height correction runs before paint; deferring it to another animation frame exposed a changed paragraph height for one frame before restoring the visible text. This retains core's measured height index and scroll compensation, without adding a visual translation or another reading anchor. Source refinement uses the measured block index and permits up to 16 synchronous commit measurements per animation frame; further work waits for the next frame. Hidden viewports retain their measurements and latest navigation request until the scroll root has a size again. The host also keeps the empty plugin list stable, so unrelated host renders do not recreate the reader's extension configuration and lose that request. The adapter verifies the published module's SHA-256 and fails on version or source drift; `node_modules` remains unchanged. Remove it after reviewing an upstream release with equivalent fixes.

LiMR 1.3.14 retains the public code-block options and source-reveal support for folded code. The host forwards `parameters.codeBlock` and retains upstream reveal preparation and out-of-flow scroll correction. Typography implementation remains unchanged apart from generated imports. Exact artifact hashes and source-position/short-ID replacement sites were reviewed. These adapters retain core's parser and source mapping without introducing a second Markdown grammar in the host. Worker parity and real webview checks cover source ranges, annotation edits and both typography modes.

Host note editors wait for their input to become visible before requesting core autofocus during sidebar/overlay transitions. Sidebar space retention applies only to derived table overflow notes; disabling an annotation plugin releases its sidebar space.

Release builds contain no scroll diagnostic commands, message handlers or global recording hooks. The functional scroll and typography corrections remain enabled.

Typography can also move a word between lines without changing its block height. The separate typography adapter uses the reader scroll container for advance layout, as described below; the removed DOM-mutation/translation compensation must not be restored.

The host reserves Ctrl/Cmd+P and Ctrl/Cmd+Shift+P for VS Code. It prevents the embedded reader's print handler while preserving event propagation to the workbench, including custom keybindings. Otherwise LiMR treats both shortcuts as print preparation and can create a second full-document render. Initial source delivery and worker loading both use the top progress bar.

```bash
npm ci
npm run typecheck
npm test
npm run build
npm run test:vscode
npm run test:animations
npm run test:regressions
npm run test:features
npm run test:annotations
npm run package
```

The real Electron/Playwright test uses isolated profiles, extension directories, and temporary fixtures. `VSCODE_TEST_VERSION` selects the runtime; `LIMR_TEST_THEME_DIR` supplies a local One Dark Pro theme. Linux/WSLg needs a working display server.

`--entrypoints` verifies source/reader title buttons and the current-group/side-group preview shortcuts. For Windows Cursor + WSL, use `scripts/vscode-wsl-launcher.mjs` as `VSCODE_EXECUTABLE_PATH`, point `LIMR_TEST_WINDOWS_CODE` to `Cursor.exe`, `LIMR_TEST_WSL_EXTENSION` to the installed Cursor Remote WSL extension, and `LIMR_TEST_TEMP_ROOT` to a Windows-mounted temporary directory. The launcher skips first-run onboarding only in that disposable profile and cleans up only processes using that profile. The integration host probes optional layout commands instead of assuming Cursor has VS Code's auxiliary-sidebar command.

`test:animations` samples animation playback in the same real editor, checking intermediate frames and final states for toolbars, overlays, highlights, sidebars, and reading controls. Evidence and screenshots are saved under `artifacts`.

`test:regressions` checks mixed-format selections, toolbar widths, overlay switching, focus styles, bulk deletion and Undo, and wide/narrow reader layouts.

`test:plugins` loads a real companion extension in a disposable profile and checks registration, disposal, settings and load failure isolation. `test:scroll` checks synchronized scrolling across complex blocks; `test:translations` covers reversed source order and all three translation display modes; `test:syntax` checks source highlighting and theme colors. After `npm run package`, run `npm run test:installed-icon` to install the VSIX in a disposable profile and verify the icon loaded in the extension list and details page.

Output: `artifacts/limr-vscode-1.1.2.vsix`. Runtime assets are bundled, with no development server or CDN requirement. Remote media referenced by Markdown may still access the network.

Release builds minify the extension host and both workers; only watch mode emits the host source map. The source-decoration worker uses core's public `standardWorkerRegistry` to load its grammar without browser renderers. The 1.3.14 adapter review covers the new search, table controls and shared visible-reading-block iterator. The selection toolbar and window scheduling sites are unchanged; capture now takes the first item from `visibleReadingBlocks`. The typography module only changes generated imports/source-map names. Exact published-module and capture-helper hashes were updated after this comparison, preserving fail-closed guards.

The VSIX allowlist includes runtime bundles, translations, the icon, licenses, public API declarations and offline AI guides/skills. Source files, source maps, tests, benchmarks, add-on examples and development documents stay in the repository. KaTeX CSS retains all 20 font faces using WOFF2, which the supported VS Code webviews can load; duplicate WOFF/TTF encodings are omitted. All 314 Maple subsets (regular, bold, italic and bold italic) and all 101 Noto Serif SC subsets remain unchanged. Language and diagram modules retain lazy loading.

`npm run package` runs `check:package` after building. It uses vsce's actual file selection and esbuild's output graph to reject missing runtime resources, stale assets, renderer dependencies in parser workers and accidental development files. It also checks full offline font counts and budgets of 980 selected files / 60,000,000 unpacked bytes. Reports stay in `artifacts/build-outputs.json` and `artifacts/package-check.json`; they are not shipped. Run `npm run build && npm run check:package` after changing imports or packaging rules. Package size and file count measure installation work; actual installation time still needs measurement on the target client/filesystem.

The 1.1.2 package measured 41,910,345 bytes compressed / 56,364,183 bytes unpacked / 960 archive entries, compared with 1.1.1's 44,653,641 / 67,496,675 / 1,022: reductions of 6.14%, 16.49% and 6.07%. All 435 retained WOFF2 files matched the previous VSIX byte for byte. Windows VS Code 1.142.0 + WSL passed 23 packaged reader/source-highlighting checks, including all Maple styles and all 20 math faces. Two fresh Windows NTFS installations per version measured medians of 1.434 s before and 1.084 s after; all installed package files matched, allowing VS Code's `package.json` metadata. This small local sample excludes downloads, WSL transfer and GUI interaction, and did not reproduce a prolonged installation. Evidence is recorded in `artifacts/package-size/`.

`npm run test:reader-tools` checks actual focused-webview Ctrl+F, regex/case toggles, invalid-pattern recovery, focused-input highlights, borderless controls, virtual search across unmounted text and folded code, F3/Shift+F3, highlight/note shortcuts, native Undo, a companion add-on's custom footnote keybinding, code defaults/live overrides, exact code copying, and long-document edit acknowledgements. Run the same suite through the Windows WSL launcher for actual VS Code/Cursor acceptance.

`node scripts/test-vscode.mjs --search-interactions` covers selected plain text, input undo/redo, query retention, viewport-preserving typing, nearest Previous/Next navigation in ordinary and virtualized readers, and loading colors in four themes. Use `LIMR_TEST_EXTENSION_PATH` to exercise an extracted VSIX.

`scripts/limr-commands.mjs` retains the version/hash-guarded selection-action bridge. Search uses the public core controller, with Reader.search enabled in synchronous and asynchronous readers. Workbench keybindings remain remappable. Both rendering modes search core's reading-text projection; above 4 Mi UTF-16 units, core scans nearby first and explicit Previous/Next extends the scan. A + count is incomplete, including the 100,000-hit cap. Regex runs in a disposable Worker with a 750 ms per-batch deadline, and changing the query or closing search cancels old work. This also avoids Cursor 3.24.18's native Webview find widget, which opened but returned no results in real Windows + WSL acceptance. Custom renderers can provide core's `virtualization.searchText` / `copyText` adapters for generated display text; ordinary module children use core's default projection.

Reader-authored transactions mark only the `workspace.applyEdit` interval as immediate, so their text-document events cancel any pending typing timer and broadcast without the 250ms quiet period. The marker is cleared after success or failure. Core already updates the local document synchronously; this change does not eliminate its parsing/layout cost. Unit tests exercise the actual provider, failure cleanup and later typing, separately from real-client latency observations.

## Remote-WSL

Install from a window already connected to **WSL: Ubuntu**. LiMR is a workspace extension: file operations run in the WSL extension host, while the Webview appears in the Windows VS Code client. Normally, only the WSL installation is needed.

From that window's WSL terminal:

```bash
code --install-extension ./artifacts/limr-vscode-1.1.2.vsix
```

Check that `code --list-extensions` identifies the intended WSL environment. Reload if VS Code requests it. **Developer: Show Running Extensions** shows the host location. To debug, open this repository in the WSL window, run `npm ci && npm run build`, and press F5.


Run `npm run test:navigation` for skill-language toolbar and real link navigation checks. After packaging, `npm run test:installed-icon` checks the installed extension icons, README images, and language navigation.

`npm run test:image-preview` checks LiMR’s native `Image` / `ImagePreview` components with the VS Code resource bridge in a real webview, including resolved image resources, keyboard access, focus containment, sizing, and source preservation. It uses LiMR public renderer components and does not patch the LiMR dependency.

`npm run test:annotations` checks source annotation creation, highlight visibility, range deletion and Undo, bilingual question/answer anchors, and clicking collapsed sidebar previews.

`node scripts/test-vscode.mjs --annotation-selection` uses real mouse drags and clipboard reads in narrow hover/expanded overlays and wide adaptive/fixed sidebars, with light and dark themes. The host restores native selection backgrounds for read-only `AnnotationMarkdown`: core still mounts its paint layer when selection tracking is disabled, so its transparent native selection rule otherwise hides the selected text. `LIMR_TEST_OBSERVE_ONLY=1` records the unfixed behavior without asserting selection colors.

`--strong-syntax` verifies multilingual punctuation-adjacent bold text and automatic links in standard/Knuth–Plass typography at narrow/wide widths. It checks AI context source coordinates through BOM, frontmatter, entities and escapes, then highlights a decoded link and undoes the edit. Run against the extracted VSIX with `LIMR_TEST_EXTENSION_PATH` in VS Code or Cursor.

## Loading and performance checks

`node scripts/test-vscode.mjs --large-scroll` checks continuous scrolling in both panes, gutter takeover, source/DOM continuity and per-frame reading anchors in a large document. Set `LIMR_TEST_LARGE_DOCUMENT` to a local Markdown file to exercise a copy of it in the disposable workspace; the original is never edited. `LIMR_TEST_WIDTH` selects a narrower test window.

`--scroll-layout-anchor` changes a real decoded image's height inside the reading block and in its preceding block, both during wheel input and at rest. It tracks the reading glyph, detects missing anchors and loading overlays, and retains negative-control evidence with `LIMR_TEST_OBSERVE_ONLY=1`. `--host-shortcuts` verifies real focused-webview keyboard events open the workbench pickers without a print-preparation popup or a duplicate full-document render; it also accepts `LIMR_TEST_LARGE_DOCUMENT`.

With the same document environment variable, `--scroll-reload` checks source navigation while the viewport is hidden or has zero height, followed by two webview reloads with immediate source-wheel input. It uses Knuth–Plass typography and an unwrapped editor, checks that pending navigation converges without replacing the reader, and fails on React update-depth errors. `LIMR_TEST_READER_SETTINGS` and `LIMR_TEST_EDITOR_SETTINGS` accept JSON overrides for the continuous-scroll suite; `LIMR_TEST_HEIGHT` controls the window height.

`--scroll-idle` uses isolated wheel gestures followed by idle observation, including the CMOS translator's preface, wrapped source lines, and returning from the middle of the book. `LIMR_TEST_IDLE_PASSIVE=1` avoids observers, animation-frame probes and geometry reads during the idle interval. `LIMR_TEST_GPU=1` keeps GPU acceleration enabled. `LIMR_TEST_NATIVE_DEVICE_SCALE=2` starts the disposable Electron process at DPR 2; page-only CDP emulation does not necessarily reach the webview iframe. Passing these isolated scenarios does not establish that a reported restored-window incident is fixed.

The previous host-added glyph translation/MutationObserver compensation has been removed after reported autonomous scrolling. Core height measurement remains responsible for scrolling. The synthetic `--scroll-layout-anchor` stress probe is retained for upstream media/typography reflow investigation; its earlier passing reports describe the superseded compensation build, not a guarantee for this rollback.

For LiMR 1.3.14, the guarded typography adapter observes the configured reader scroll container with the existing 600 px margin. A page-level observer's margin cannot extend an inner overflow clip, which previously delayed Knuth–Plass preparation until a paragraph became visible. The adapter preserves core's batched reads/writes and 6 ms asynchronous budget. Notifications from obsolete observers are ignored, scroll-root changes move jobs to the appropriate observer, and unused observers are released. The adapter does not write scroll positions.

Failed figures keep the pending media height instead of growing from the 120 px placeholder to a 156 px error box. The host override only affects the figure fallback; long hints can scroll inside it, and ordinary inline/successful images keep their sizing.

`node scripts/test-vscode.mjs --loading` exercises progressive/blocking loading, native status actions, toolbar icons, and stale revision handling. `--limits` checks the exact 75 MiB boundary and waits for the real 60-second host timeout, then verifies worker teardown and retry. `--large-plugins` checks pure view plugins, explicit rejection of large incompatible grammars, and small-document compatibility.

The host starts its deadline before sending text, includes webview startup on first open, and never resets it for progress ticks. It recreates a timed-out guest to release partial trees. Documents at least 64 Ki UTF-16 characters use an interruptible worker (`fallback: 'error'`). Smaller documents keep the low-overhead synchronous reader. Arbitrary synchronous plugin/render callbacks and a blocked VS Code renderer cannot be forcibly preempted by an extension API.

Large source messages use the public `Webview.postMessage` ArrayBuffer support (VS Code 1.57+); UTF-8 decoding preserves BOMs, while malformed UTF-16 takes the original string path. Hidden retained readers defer edits until visible. Retention preserves annotation drafts and avoids repeatedly parsing large documents when switching tabs; closing a reader releases it. Source decoration workers skip buffers over 4 Mi UTF-16 characters, stop on hide/close, and have a 60-second ceiling.

See [the benchmark harness](../benchmarks/reading/README.md) for frozen builds, real Electron timing, memory/long-task observations, and GPU evidence. Keep the default GPU policy for representative measurements. An extension cannot enable GPU acceleration on behalf of the VS Code client; do not change user launch flags or global renderer settings for a benchmark.

The [1.0.2 measured results](performance-1.0.2.md) describe the tested hardware, host overhead, 75 MiB boundary, and remaining fast-scroll cost.

`--open-modes` exercises native Quick Open under all three Markdown opening modes, changes the mode while the same source tab remains active, reuses existing split groups, and preserves explicit Reopen with Text Editor choices. Run it in both VS Code and Windows Cursor + WSL.

`--preview-default` verifies the default LiMR preview button, Alt-click access to the built-in preview, and live separate/merged setting changes. On Cursor it also records the independent native breadcrumb Preview editor and verifies the return path to LiMR.

`--toc-colors` checks neutral and active TOC colors, hover, keyboard focus, heading navigation, and prose link colors in wide/narrow readers across four palettes. The Cursor runner supplies measured pixel sizes for editor layout changes because its existing-group layout path treats fractional sizes as pixels.

Navigation tracks replacement tab/group wrappers as well as stable VS Code objects. Cursor can replace all wrappers on a full tab-model update. `tests/tab-references.test.ts` covers replacement, reordering, and close/recreate boundaries; `--navigation-modes` validates real linked navigation, history, moving groups, default splits, and explicit source access on both hosts.
