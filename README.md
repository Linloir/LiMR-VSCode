# LiMR for VS Code

<img src="media/limr-icon.png" alt="LiMR" width="96" />

[English](#english) · [LiMR GitHub](https://github.com/Linloir/LiMR) · [在线 Playground](https://linloir.github.io/LiMR/) · [扩展源码](https://github.com/Linloir/LiMR-VSCode)

## 这是什么

LiMR 是一个注重阅读体验的 Markdown 阅读器。这个扩展将 [LiMR](https://github.com/Linloir/LiMR) 带进 VS Code，让技术文档、学习笔记、论文摘录和 `SKILL.md` 都有舒适的阅读界面，源码与阅读器可以并排使用。

- **开箱即用的外观**：内置中文衬线字体与等宽代码字体，提供浅色、深色及跟随 VS Code 的主题；正文宽度、目录和旁注栏随可用空间调整。
- **丰富的内容表达**：支持代码高亮、数学公式、Mermaid 图表，以及提示、定义、引用来源、段落翻译等特殊语法块。文件开头的 YAML 元信息自动展示为信息卡片。
- **直接写回 Markdown 的标注**：划选文字可添加高亮、旁注与提问，保存在原文件中，支持 VS Code 保存、撤销与 Git 追踪。默认只读，按需开启编辑。
- **点击图片预览**：使用 LiMR 原生图片预览，支持适应窗口、原始大小、铺满窗口、缩放、拖动和复制图片；支持普通图片、引用式图片和 figure 图片，按 Esc、关闭按钮或背景退出。复制需要浏览器剪贴板权限及可读取的图片资源。
- **可调整的阅读方式**：字体、行距、正文宽度、目录、翻译显示和排版均可配置；源码与阅读器支持滚动同步。
- **简易的扩展能力**：用工作区 CSS 调整外观，用 JavaScript 模块添加组件、语法、标注或操作；也可以做成独立的 VS Code 附加扩展。

LiMR 本身也是可用于 React 项目的 Markdown 渲染库。本扩展使用 `@linloir/limr 1.3.10`。你可以在 [Playground](https://linloir.github.io/LiMR/) 体验阅读与编辑，在 [语法文档](https://linloir.github.io/LiMR/#/docs/zh-CN/syntax) 查看更多内容模块。

## 开始使用与配置

1. 打开 `.md`、`.markdown` 或 `SKILL.md`，点击编辑器右上角的 **书本图标**，在旁边打开 LiMR。也可在命令面板执行 **LiMR: Open Reader to the Side**；**LiMR: Open Markdown Reader** 在当前栏打开。
2. 用阅读器工具栏切换主题、排版与翻译显示。需要添加标注或修改任务复选框时，点击编辑按钮开启编辑；更改沿用 VS Code 的保存与撤销操作。
3. 点击设置按钮，或执行 **LiMR: Reader Settings**。在 VS Code 设置中搜索 `@ext:linloir.limr-vscode`，选择“用户”可调整个人默认值，选择“工作区”仅对当前项目生效。

快捷键：`Ctrl+Shift+V` 在当前栏打开 LiMR，`Ctrl+Alt+V` 在侧栏打开（macOS 使用 `Cmd`）。VS Code 还支持 `Ctrl+K V`；Cursor 的 `Ctrl+K` 用于 AI 编辑。Cursor 首次激活时会将 LiMR 按钮补入 `cursor.general.pinnedTitleActions`，保留已有条目；之后从该列表删除的按钮不会自动加回。可在首次激活前关闭 `limr.cursor.pinTitleActions`。

默认预览按钮和快捷键打开 LiMR；如已显式设置 `limr.previewButtonMode: "separate"`，会继续显示两个按钮。Cursor 面包屑中的 `Preview / Markdown` 属于 Cursor 内部编辑器，当前没有公开的替换预览提供者接口；这个切换仍使用 Cursor 自己的渲染器。如果 Cursor 已记住内置 Preview，先切回 Markdown，或配置默认编辑器。源码文件的打开方式可选择 `limr.markdownOpenMode: "reader"`，或在“重新打开方式 → 配置默认编辑器”中选择 LiMR Reader。

在阅读器内可使用以下快捷键（macOS 将 `Ctrl` 换成 `Cmd`）：

| 操作 | 快捷键 |
| --- | --- |
| 搜索 | `Ctrl+F` |
| 下一个 / 上一个结果 | `F3` / `Shift+F3`；搜索框内 `Enter` / `Shift+Enter` |
| 返回源码 | `Ctrl+Shift+V` |
| 切换编辑权限 | `Ctrl+Alt+E` |
| 切换选段高亮 | `Ctrl+Alt+H` |
| 添加旁注 / 提问 | `Ctrl+Alt+M` / `Ctrl+Alt+Q` |
| 复制提问上下文 | `Ctrl+Alt+C` |
| 删除选段批注 | `Ctrl+Alt+Backspace` |

普通文档和虚拟化长文档统一使用 LiMR 全文搜索，支持不区分大小写的字面文本匹配，可定位尚未挂载的段落和折叠代码。macOS 还支持 `Cmd+G` / `Cmd+Shift+G`。快捷键可在 VS Code“键盘快捷方式”中修改；写入操作需要启用编辑并选择正文，不会处理旁注编辑框中的文本。模块的选段动作可通过 `limr.runSelectionAction` 绑定快捷键，见[插件指引](skills/limr-annotations/references/reader-plugins.md#selection-action-keybindings)。

阅读器内的高亮、旁注和任务框等源码修改立即广播，不经过源码连续输入的 250ms 合并等待；长文档的解析与布局仍需计算时间。


网页链接交给浏览器打开。内部 Markdown 链接默认智能跳转：同文档的源码/阅读双栏一起更新，其余布局只更新当前阅读器。可切换五种跳转方式；需旁栏时优先复用已有分栏。鼠标侧键或 Alt+左右键支持阅读器历史，双栏模式同时恢复另一栏的原文件。同一文档内的标题链接在阅读器中滚动。

达到 256 KiB（按 UTF-16 字符数计）的文档会合并连续输入：停顿 250 毫秒后刷新，持续输入时最长等待 1.2 秒。较小文档即时更新。异步刷新期间保留已显示的内容，完整结果就绪后在原阅读位置接替。

### 常见设置

| 设置 | 默认值 | 含义与用法 |
| --- | --- | --- |
| `limr.theme` | `"playground"` | 使用 LiMR 配色并跟随 VS Code 明暗；`"auto"` 使用当前 VS Code 主题的实际颜色。也可固定为 `playground-light`、`playground-dark`、`vscode-light`、`vscode-dark`、`one-dark-pro` 或 `one-dark-pro-darker`。 |
| `limr.editingEnabled` | `false` | 开启后可从阅读器添加、修改、删除标注和操作任务复选框；需信任工作区。 |
| `limr.bodyFontFamily` / `limr.bodyFontSize` | `""` / `16` | 正文字体和字号（px）。空字体使用内置 Noto Serif SC Variable。 |
| `limr.chineseFontFamily` / `limr.chineseFontSize` | `""` / `0` | 单独设置中文字体和字号；空字体、字号 0 跟随正文。`limr.otherFontFamily` / `limr.otherFontSize` 同样控制其他文字。 |
| `limr.codeFontFamily` / `limr.codeFontSize` | `""` / `14` | 代码字体和字号（px）；空字体使用内置 Maple Mono NF CN。 |
| `limr.codeBlock.lineNumbers` | `false` | 显示代码块行号，不影响复制。 |
| `limr.codeBlock.autoCollapse` | `true` | 自动折叠长代码块；可手动展开全文。 |
| `limr.codeBlock.wrap` | `false` | 代码长行自动换行；也可逐块切换。 |
| `limr.lineHeight` / `limr.maxWidth` | `1.8` / `860` | 正文行高倍数与最大宽度（px）；偏好紧凑阅读可适当调小。 |
| `limr.typography` | `"standard"` | `standard` 标准排版；`justify` 两端对齐；`knuth-plass` 使用段落级断行优化。 |
| `limr.tableLayout.enabled` | `true` | 启用表格优化布局；关闭后使用原生表格，减少长表格的测量开销。 |
| `limr.loadingMode` | `"progressive"` | 默认先显示只读预览，后台继续解析全文，完成后保留阅读位置；`blocking` 等解析完成后再展示。部分插件需要完整加载。 |
| `limr.markdownOpenMode` | `"none"` | `none` 保持当前打开方式；`reader` 直接阅读；`sideBySide` 同时打开常驻的源码和阅读器标签，并保持两栏顺序。修改设置会立即应用于当前源码标签。手动切换到文本编辑器后保留该选择，关闭文件后再次打开才重新应用默认方式。 |
| `limr.markdownLinkMode` | `"smart"` | `currentReader` 当前栏阅读；`besideReader` 另一栏阅读；`besideEditor` 另一栏编辑；`editorAndReader` 双栏一起跳转；`smart` 仅在同文档的源码/阅读双栏中联动。支持鼠标侧键和 Alt+左右键回退/前进。 |
| `limr.singleReader` | `false` | 复用单个阅读器；与 `besideReader` 冲突时改为当前栏跳转。未保存的旧阅读页签会保留，避免丢失编辑。 |
| `limr.sidebarMode` | `"content"` | `content` 有旁注时显示；`always` 始终启用；`hidden` 隐藏。窄窗口通过浮层查看标注。 |
| `limr.sidebarAutoCollapse` | `true` | 自动折叠密集的旁注条目；关闭后逐项排布。 |
| `limr.tocMode` | `"always"` | `always` 宽屏显示侧目录、窄屏显示折叠目录；`wide` 仅宽屏显示；`hidden` 隐藏。 |
| `limr.contentAlignment` | `"window"` | 没有批注侧栏时，`window` 将正文相对阅读窗口居中；`remaining` 相对侧目录右侧的剩余空间居中。 |
| `limr.translationMode` | `"paragraph"` | `paragraph` 遵循各段配置；`bilingual` 原译对照；`original` 仅原文；`translated` 仅译文。用于已有翻译内容，不自动翻译。 |
| `limr.syncScroll` | `true` | 源码与阅读器双向同步滚动。 |
| `limr.previewButtonMode` | `"merged"` | `separate` 同时显示 LiMR 书本按钮与内置预览按钮；`merged` 只保留 LiMR 入口，Alt 点击打开内置预览，也可在“更多操作 → Markdown 预览”中选择。 |
| `limr.language` | `"auto"` | 阅读器与对话框跟随 VS Code 语言，也可指定 `zh-CN` 或 `en`。原生命令和设置名称遵循 VS Code 界面语言。 |
| `limr.topBarButtons` / `limr.bottomBarButtons` | 顶栏全部；底栏编辑、排版、翻译 | 选择显示的操作。可用 **LiMR: Choose Top Bar Buttons** / **Choose Status Bar Buttons** 多选调整。 |
| `limr.images.pathMode` | `"auto"` | 图片先按 Markdown 所在目录解析，找不到再查所属工作区。`file` 仅文件目录；`workspace` 仅工作区；`folder` 使用 `limr.images.baseFolder` 指定的目录。 |
| `limr.images.searchPaths` | `[]` | 图片策略未命中后依次尝试的额外目录；显式 `../` 路径保持原位置，不搜索替代图片。 |
| `limr.syntaxHighlighting.enabled` | `true` | 在 Markdown 源码中补充 LiMR 内置语法的颜色。 |
| `limr.plugins.enabled` / `limr.plugins.manifest` | `true` / `".limr/plugins/manifest.json"` | 启用阅读器插件，并指定工作区插件清单；插件仅在已信任的窗口加载。 |
| `limr.skills.promptOnStartup` | `true` | 是否提醒安装用于 AI 协作的 Skill；可按用户或工作区关闭。 |

加载时，页签下方的细条与 VS Code 底部状态栏百分比同步展示进度。点击状态栏可取消，取消或失败后可点击重试。顶部细条使用 VS Code 的进度颜色，绘制在阅读区上沿；公开扩展 API 尚未提供编辑器组原生进度条的控制接口。

预览上限为 **75 MiB**（按当前编辑器文本的 UTF-8 字节数，包含未保存修改），每次加载最多 **60 秒**。超限文档不会传入阅读器；超时会释放阅读视图和解析 Worker，可重试或打开源码。大文本使用 VS Code 的二进制消息传输；超过 4 Mi UTF-16 字符时跳过附加的 LiMR 源码装饰解析，保留 VS Code 自身的 Markdown 高亮，避免分栏时再建立一份全文语法树。

例如，在用户设置或项目的 `.vscode/settings.json` 中加入：

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

这会稍微放大正文、缩窄阅读宽度，并只在宽屏显示目录。切换颜色主题不会重置字体。图片的固定目录和额外目录支持绝对路径、`file:` URI、`~`，相对目录基于当前文件所属工作区；未打开工作区时基于文件目录。

排版与翻译还支持“仅当前文件”的覆盖：执行 **LiMR: Choose Typography** 或 **LiMR: Choose Translation Display** 后，先选择具体配置，再选择应用于当前文件或默认配置。选择“默认配置”会保存默认值，并让当前文件的该项设置恢复跟随默认；翻译设置也会清除当前文件的段落覆盖，其他文件的独立设置保留。第一步会标明当前值和默认值；选择“当前文件恢复默认”直接清除该项覆盖，翻译设置也会清除各段落覆盖。默认配置遵循 VS Code 的用户、工作区及文件夹优先级，菜单会显示实际范围。覆盖在下次打开时保留，不改写 Markdown；**LiMR: Reset Current File Reading Settings** 可恢复默认。

## 用 AI 自定义外观与能力

在阅读器工具栏的 AI 菜单中查看指引，或执行 **LiMR: Install AI Skill…**，将随扩展提供的 `limr-annotations` Skill 安装到助手的全局或工作区目录。它包含标注写法、内置语法，以及样式和模块的扩展约定，可用于 Codex、Claude Code 等支持 Skill 的助手。

你可以把需求直接交给 AI，例如：

> 使用 limr-annotations，给当前项目添加适合长文阅读的 LiMR 样式：标题使用蓝色强调，段落间距稍微增大，并适配浅色、深色主题和窄分栏。

> 使用 limr-annotations，增加一个 `research-card` 模块，用来展示实验结论，卡片内部继续支持 Markdown。保留已有插件，并提供一份示例文档。

### 只改样式

在工作区创建 `.limr/plugins/manifest.json`，引用同目录下的 CSS；已有清单时追加条目：

```json
{
  "plugins": [
    { "id": "reading-style", "stylesheet": "reading.css" }
  ]
}
```

`reading.css` 可以从很小的调整开始：

```css
.limr-reader h1,
.limr-reader h2 {
  color: var(--vscode-textLink-foreground);
}
```

保存工作区插件文件后阅读器会自动重新加载，也可执行 **LiMR: Reload Reader Plugins**。

### 添加模块或发布附加扩展

在清单中增加 `{ "id": "research-card", "module": "research-card.mjs" }`，模块复用阅读器提供的 React 和 LiMR：

```js
export default ({ React, limr }) => limr.defineBlock({
  name: 'research-card',
  component: ({ children }) => React.createElement(
    'aside', { className: 'research-card' }, children
  ),
});
```

在 Markdown 中使用 `:::research-card`、卡片正文和结束的 `:::`，即可显示这个组件。可继续用 CSS 美化卡片，或让 AI 按公开接口增加语法、标注类型和操作。

宿主沿用清单命名空间隔离扩展 `name`，不会修改工厂返回的原对象；不同工作区插件或附加扩展可返回相同扩展名。Markdown 的 tag/directive 名称、组件键和批注类型保持原样，实际语法名称仍需避免冲突。纯视图插件不会禁用默认语法的 Worker。达到 64 Ki UTF-16 字符的文档必须使用可在 Worker 中运行的语法；当前 API v1 的自定义语法插件仅在较小文档中使用主线程兼容解析，大文会明确提示不兼容。窗口阅读另需渲染器契约，不能据此承诺所有插件的超大文档性能；边界见[插件指引](skills/limr-annotations/references/reader-plugins.md#large-document-compatibility)。

需要在多个项目复用时，可将模块打包为独立的 VS Code 附加扩展，通过 `registerPlugin` 注册，安装后即可使用。参见 [插件指引](skills/limr-annotations/references/reader-plugins.md)、[API 类型定义](api/index.d.ts) 和 [完整附加扩展示例](examples/vscode-reader-addon)。Remote-WSL / SSH 下，附加扩展应与 LiMR 位于同一扩展宿主。

### 围绕文档提问与标注

划选原文，点击 **提问上下文**，再粘贴给 AI 并输入问题。精简的上下文要求 AI 先显示答案，再通过附带脚本回写；脚本直接操作当前 VS Code 缓冲区（支持未保存内容和撤销），失败才重新读取文件定位。开启编辑后，Skill 要求助手在回答后把问题、回答和高亮写回 Markdown；翻译块中的原文与译文对应片段共用同一条问答标注。生成论文类文档时，建议使用 `figure` / `figures` 展示带图注的图片。扩展本身不调用模型；AI 对 Markdown 的修改会同步显示。详细用法见 [AI 指引](docs/ai-guide.md)。

开发与构建请参阅 [开发说明](docs/development.md)。

---

## English

[简体中文](#limr-for-vs-code) · [LiMR GitHub](https://github.com/Linloir/LiMR) · [Playground](https://linloir.github.io/LiMR/) · [Extension source](https://github.com/Linloir/LiMR-VSCode)

## What is LiMR?

LiMR is a Markdown reader designed for comfortable reading. This extension brings [LiMR](https://github.com/Linloir/LiMR) into VS Code for technical documentation, study notes, research excerpts, and `SKILL.md`, with source and reader side by side.

- **Polished defaults**: bundled Chinese serif and monospace code fonts, light and dark palettes, and VS Code theme integration. Article width, contents, and annotation panels adapt to the available space.
- **Rich content**: syntax highlighting, math, Mermaid diagrams, and blocks for callouts, definitions, citations, and paragraph translations. YAML frontmatter appears as a document information card.
- **Annotations in your Markdown**: select text to add highlights, notes, and questions. Changes stay in the original file and work with VS Code save, undo, and Git. Reading is read-only by default; enable editing when needed.
- **Click to preview images**: LiMR's native preview supports fit, actual size, fill, zoom, dragging, and copying image pixels for Markdown, reference, and figure images. Close with Escape, the close button, or the backdrop. Copying requires clipboard permission and a readable image resource.
- **Reading preferences**: configure fonts, spacing, article width, contents, translation display, and paragraph layout. Source and reader can scroll together.
- **Simple extensibility**: use workspace CSS to change appearance and JavaScript modules to add components, syntax, annotations, or actions. Reusable modules can also ship as VS Code add-ons.

LiMR is also a Markdown rendering library for React projects. This extension uses `@linloir/limr 1.3.10`. Try reading and editing in the [Playground](https://linloir.github.io/LiMR/), or explore the [syntax documentation](https://linloir.github.io/LiMR/#/docs/en/syntax).

## Get started and configure

1. Open a `.md`, `.markdown`, or `SKILL.md` file and click the **book icon** in the editor title bar to open LiMR beside it. The Command Palette also offers **LiMR: Open Reader to the Side** and **LiMR: Open Markdown Reader** for the current group.
2. Use the reader toolbar to choose a theme, typography, or translation display. Enable editing with the edit button to add annotations or change task checkboxes; use VS Code's usual save and undo actions.
3. Click settings or run **LiMR: Reader Settings**. Search VS Code Settings for `@ext:linloir.limr-vscode`. Choose **User** for personal defaults or **Workspace** for project settings.

Shortcuts: `Ctrl+Shift+V` opens LiMR in the current group; `Ctrl+Alt+V` opens it beside the source (use `Cmd` on macOS). VS Code also supports `Ctrl+K V`; Cursor uses `Ctrl+K` for AI editing. On first activation in Cursor, LiMR adds its buttons to `cursor.general.pinnedTitleActions`, preserving existing entries. Later removals from that list are respected. Disable `limr.cursor.pinTitleActions` before first activation to retain Cursor’s hidden buttons.

Reader shortcuts (replace `Ctrl` with `Cmd` on macOS):

| Action | Shortcut |
| --- | --- |
| Find | `Ctrl+F` |
| Next / previous match | `F3` / `Shift+F3`; `Enter` / `Shift+Enter` in the find input |
| Return to source | `Ctrl+Shift+V` |
| Toggle editing | `Ctrl+Alt+E` |
| Toggle selection highlight | `Ctrl+Alt+H` |
| Add margin note / question | `Ctrl+Alt+M` / `Ctrl+Alt+Q` |
| Copy question context | `Ctrl+Alt+C` |
| Delete annotations at selection | `Ctrl+Alt+Backspace` |

Ordinary and virtualized documents use LiMR's complete reading-text search with case-insensitive literal matching, including unmounted paragraphs and folded code. macOS also supports `Cmd+G` / `Cmd+Shift+G`. Customize bindings in VS Code Keyboard Shortcuts. Writing actions require editing permission and a body selection; they do not consume text inside annotation inputs. Modules can bind selection actions through `limr.runSelectionAction`; see the [plugin guide](skills/limr-annotations/references/reader-plugins.md#selection-action-keybindings).

Reader-authored highlights, notes and checkbox edits broadcast immediately, bypassing the 250ms quiet period for source-editor typing. Large-document parsing and layout still take computation time.


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
| `limr.codeBlock.lineNumbers` | `false` | Show code line numbers without changing copied text. |
| `limr.codeBlock.autoCollapse` | `true` | Initially fold long code blocks; manually expand their full height. |
| `limr.codeBlock.wrap` | `false` | Initially wrap long lines; also switch wrapping per block. |
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
