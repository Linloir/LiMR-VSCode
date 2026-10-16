# Extension development

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
npm run test:annotations
npm run package
```

The real Electron/Playwright test uses isolated profiles, extension directories, and temporary fixtures. `VSCODE_TEST_VERSION` selects the runtime; `LIMR_TEST_THEME_DIR` supplies a local One Dark Pro theme. Linux/WSLg needs a working display server.

`test:animations` samples animation playback in the same real editor, checking intermediate frames and final states for toolbars, overlays, highlights, sidebars, and reading controls. Evidence and screenshots are saved under `artifacts`.

`test:regressions` checks mixed-format selections, toolbar widths, overlay switching, focus styles, bulk deletion and Undo, and wide/narrow reader layouts.

`test:plugins` loads a real companion extension in a disposable profile and checks registration, disposal, settings and load failure isolation. `test:scroll` checks synchronized scrolling across complex blocks; `test:translations` covers reversed source order and all three translation display modes; `test:syntax` checks source highlighting and theme colors. After `npm run package`, run `npm run test:installed-icon` to install the VSIX in a disposable profile and verify the icon loaded in the extension list and details page.

Output: `artifacts/limr-vscode-1.0.1.vsix`. Runtime assets are bundled, with no development server or CDN requirement. Remote media referenced by Markdown may still access the network.

## Remote-WSL

Install from a window already connected to **WSL: Ubuntu**. LiMR is a workspace extension: file operations run in the WSL extension host, while the Webview appears in the Windows VS Code client. Normally, only the WSL installation is needed.

From that window's WSL terminal:

```bash
code --install-extension ./artifacts/limr-vscode-1.0.1.vsix
```

Check that `code --list-extensions` identifies the intended WSL environment. Reload if VS Code requests it. **Developer: Show Running Extensions** shows the host location. To debug, open this repository in the WSL window, run `npm ci && npm run build`, and press F5.


Run `npm run test:navigation` for skill-language toolbar and real link navigation checks. After packaging, `npm run test:installed-icon` checks the installed extension icons, README images, and language navigation.

`npm run test:image-preview` checks the VS Code-only `readerImagePreview()` renderer module in a real webview, including resolved image resources, keyboard access, focus containment, sizing, and source preservation. It uses LiMR public renderer components and does not patch the LiMR dependency.

`npm run test:annotations` checks source annotation creation, highlight visibility, range deletion and Undo, bilingual question/answer anchors, and clicking collapsed sidebar previews.
