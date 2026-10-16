# LiMR reader add-on example

A minimal VS Code extension that contributes a styled Markdown block to LiMR. It has no build step or npm dependencies. The extension host runs `extension.cjs`; the reader loads `reader.mjs` as browser ESM and supplies its existing React and LiMR instances.

## Run

1. Install **LiMR for VS Code 1.0.1 or later** (`linloir.limr-vscode`) in the extension host you use. For Remote-WSL, install LiMR and the add-on on the WSL side.
2. From this directory, launch an Extension Development Host:

   ```bash
   code --new-window --extensionDevelopmentPath="$PWD" "$PWD"
   ```

3. Trust this example folder, open `example.md`, and run **LiMR: Open Reader to the Side**. The research card appears with a colored border.
4. Run **LiMR Example: Disable Research Card** and **LiMR Example: Enable Research Card**. Existing readers refresh immediately; repeated enabling keeps one registration. Disabling removes the component and CSS without changing the Markdown.

Registration happens during activation. `extensionDependencies` ensures LiMR is present; the host checks `apiVersion` before using the API. The registration is disposed through `context.subscriptions`. `limr.plugins.enabled` controls loading alongside workspace plugins. The example does not execute in an untrusted workspace.

To distribute your own add-on, change the publisher, name, command IDs and syntax name, then package this directory using the normal VS Code extension packaging workflow. The browser entry must already be JavaScript; if you use TypeScript, JSX or other dependencies, bundle them into browser ESM while leaving React and LiMR supplied by the factory arguments.

The [public TypeScript contract](../../api/index.d.ts) and [reader plugin guide](../../skills/limr-annotations/references/reader-plugins.md) describe paths, lifecycle, and available browser capabilities. No `.limr/plugins/manifest.json` is needed for an installed add-on.

## 中文说明

此目录是可直接运行的附加 VS Code 扩展，无需安装 npm 依赖或构建。先在同一扩展宿主安装 LiMR 1.0.1 或更新版本，再从本目录执行上面的 `code` 命令。在新窗口信任示例目录，打开 `example.md` 并运行 **LiMR: Open Reader to the Side**。

示例激活时调用 `registerPlugin`，关闭扩展时通过 `context.subscriptions` 释放注册。命令 **LiMR Example: Disable Research Card** 和 **LiMR Example: Enable Research Card** 可即时移除、重新加载组件与 CSS；重复启用不会重复注册，也不会修改 Markdown。`extension.cjs` 在扩展宿主中运行，`reader.mjs` 在浏览器中复用 LiMR 提供的 React 和 LiMR，不重复打包它们。Remote-WSL 下，两项扩展均应安装在 WSL 一侧。
