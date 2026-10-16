# LiMR for VS Code

<img src="media/icon.png" alt="LiMR" width="96" />

[English](README.en.md)

基于 **@linloir/limr 1.2.2** 的 Markdown 阅读器。源代码编辑器与阅读界面可以并排显示；旁注、提问和高亮直接保存在 Markdown 中，可随 Git 追踪。

## 安装与打开

使用扩展面板的 **从 VSIX 安装…** 选择 `limr-vscode-1.0.0.vsix`。打开 `.md` 或 `.markdown` 文件，点击编辑器右上角的阅读器按钮，或执行：

- `LiMR: Open Reader to the Side`：源码与阅读器双栏并排。
- `LiMR: Open Markdown Reader`：在当前栏打开阅读器。
- 文件标签页的 **重新打开编辑器的方式… → LiMR Reader**：切换当前文件的阅读方式，也可以设置为默认。

### Remote-WSL

在已经连接 **WSL: Ubuntu** 的窗口安装 VSIX。LiMR 是 `workspace` 扩展：文件操作在 WSL 扩展宿主执行，Webview 在 Windows VS Code 客户端显示，通常只需安装到 WSL 一侧。

在该窗口的 WSL 终端中也可执行：

```bash
code --install-extension ./artifacts/limr-vscode-1.0.0.vsix
```

请确认 `code --list-extensions` 的输出标题为对应的 WSL 环境；如果 VS Code 提示重新加载窗口，按提示执行。**Developer: Show Running Extensions** 可以检查运行位置。开发时在 WSL 窗口打开此仓库，运行 `npm ci && npm run build` 后按 F5。

## 阅读与编辑

阅读区直接展示文档。主题、编辑权限、设置和 AI Skill 入口位于 **VS Code 原生编辑器工具栏**，阅读状态显示在 **VS Code 原生状态栏**。

默认只读。使用编辑器工具栏的编辑按钮、命令 **LiMR: Toggle Markdown Editing** 或 `limr.editingEnabled` 控制是否允许从阅读器修改 Markdown。开启后可：

- 划选文字，添加高亮、旁注或提问；同一范围可以绑定多条 annotation。
- 在悬浮卡片、侧栏条目中使用 **编辑／删除** 文本按钮；按钮带悬浮下划线动画。
- 点击高亮后的工具栏提供 **删除**，一次移除这段文字关联的注释和高亮；同一注释关联的其他范围仍保留。
- 修改 Markdown 任务列表的复选框。
- 在原生编辑器使用 Undo/Redo、保存和 Auto Save。阅读器只更新同一份 VS Code 文档，不另建数据库。

笔记编辑器离开编辑状态时提交；宿主拒绝过期修改时保留草稿并提示。外部编辑和 AI 修改会同步回阅读器。未启用编辑或未信任工作区时，阅读器不会创建临时高亮或写入 Markdown。

注释使用 LiMR 1.2.2 的成对范围边界 `::%%limr%%{<#r1}正文::%%limr%%{>#r1}`，以及 `:::limr-annotation` 定义块。支持跨格式、跨段落与交叠范围；解析和写入统一使用 LiMR 的公开接口。旧版内联标记不再支持。删除时会清理不再被引用的范围边界；空白新标注取消时也会撤销临时边界。

默认“自动”模式下，图片首先按 Markdown 所在目录解析；找不到时，仅再尝试当前文件所属的工作区根目录。支持 `../`、工作区根路径、绝对路径、`file:`、Windows／WSL 路径以及带空格、中文和编码字符的文件名。明确指定层级的 `../` 路径按所选起点精确解析，不再使用附加目录；不会扫描静态目录或按同名文件猜测替代图片。

## 主题与字体

默认 **Playground（跟随 VS Code 明暗）**，使用 LiMR Playground 的字体与阅读配色，根据 VS Code 当前主题选择浅色或深色外观。通过原生编辑器工具栏或 **LiMR: Choose Reader Theme**，也可以固定选择 **Playground Light／Dark**，或选择 **VS Code Light、VS Code Dark、One Dark Pro、One Dark Pro Darker**。**跟随 VS Code** 选项则采用当前主题的实际颜色与自定义覆盖。代码高亮随明暗主题切换。

默认正文使用随扩展打包的 **Noto Serif SC Variable**，回退到 Georgia／serif，字号 16px、行高 1.8；代码使用 **Maple Mono NF CN**，字号 14px。切换颜色主题不会改变字体设置。

正文遵循最大宽度设置。显示旁注栏时，额外宽度分配给旁注；关闭旁注栏或窗口不足以显示旁注栏时，正文相对整个阅读区居中。目录在宽屏左侧留白中显示，空间不足时切换为折叠目录。两侧保留适度边距，顶部使用紧凑间距。

通过原生编辑器工具栏的设置按钮或 `LiMR: Reader Settings` 调整：

| 设置 | 用途 |
| --- | --- |
| `limr.bodyFontFamily` / `bodyFontSize` | 拉丁文字正文的字体和字号；空字体使用 Playground 默认字体 |
| `limr.chineseFontFamily` / `chineseFontSize` | 中文字体和字号；字号 0 跟随正文 |
| `limr.otherFontFamily` / `otherFontSize` | 其他文字的字体和字号 |
| `limr.codeFontFamily` / `codeFontSize` | 行内代码与代码块字体和字号；空字体使用 Playground 默认代码字体 |
| `limr.lineHeight` / `maxWidth` | 正文行高与最大宽度 |
| `limr.sidebarMode` | 旁注侧栏：`always` 始终启用、`content` 有内容时启用（默认）、`hidden` 关闭；空侧栏不占空间，正文居中，窄窗口通过浮层阅读标注 |
| `limr.sidebarAutoCollapse` | 自动折叠密集的侧栏条目（默认开启）；关闭后逐项排布，不再合并折叠，不改变单条卡片正文的展开状态 |
| `limr.tocMode` | `always` 始终、`wide` 仅宽度允许、`hidden` 隐藏；`wide` 在窄屏不插入顶部目录 |
| `limr.typography` | 默认排版：`standard` 标准、`justify` 两端对齐、`knuth-plass` |
| `limr.translationMode` | 默认翻译：`bilingual` 对照、`original` 原文、`translated` 译文、`paragraph` 按照段落配置 |
| `limr.language` | `auto` 跟随 VS Code 语言、`zh-CN`、`en` |
| `limr.topBarButtons` / `bottomBarButtons` | 分别选择顶栏和状态栏显示的操作 |
| `limr.previewButtonMode` | `separate` 独立按钮；`merged` 合并为默认打开 LiMR 的预览入口 |
| `limr.skills.promptOnStartup` | 首次安装 Skill 提醒，可在用户或工作区级别关闭 |
| `limr.plugins.enabled` / `plugins.manifest` | 自定义样式与语法插件；仅在已信任工作区加载 |
| `limr.syncScroll` | 源码与阅读器的滚动同步 |
| `limr.syntaxHighlighting.enabled` | Markdown 原文编辑器中的 LiMR 补充语法颜色，默认开启，切换即时生效 |
| `limr.images.pathMode` | 图片相对路径：`auto` 先查 Markdown 目录再查所属工作区（默认）、`file` 仅 Markdown 目录、`workspace` 仅所属工作区、`folder` 固定目录 |
| `limr.images.baseFolder` | `folder` 模式的固定目录；留空时不自动猜测 |
| `limr.images.searchPaths` | 所选策略未命中后按顺序尝试的额外目录，首个命中即停止；默认 `[]` |

图片配置可设为用户默认或工作区覆盖。固定目录和额外目录支持绝对路径、`file:` URI、`~`；相对目录基于当前文件所属工作区，未打开工作区时基于 Markdown 所在目录。显式 `../` 路径保持精确位置，不转为其他目录猜测；不会按文件名搜索，也不会隐式尝试 `public`、`static` 或其它工作区。

通过 `LiMR: Choose Typography` / `LiMR: Choose Translation Display` 可选“当前文件”“当前文件恢复默认”“默认配置”。当前文件覆盖保存在 VS Code 工作区状态中，关闭再打开仍然有效，不改写正文。翻译块在统一展示模式下切换任一段，会先保留其它段的显示状态，然后仅把当前文件改为“按照段落配置”。`LiMR: Reset Current File Reading Settings` 清除该文件的排版及翻译覆盖。

`LiMR: Choose Top Bar Buttons` / `LiMR: Choose Status Bar Buttons` 提供多选设置。合并预览按钮后，普通点击打开 LiMR，按住 Alt（Linux/Windows 也支持 Shift）点击打开系统预览；编辑器“更多”菜单中的“Markdown 预览”可选择两者。VS Code 没有供扩展任意改造其它扩展按钮的公共接口，因此此设置使用内置 Markdown 的 `hasCustomMarkdownPreview` 整合入口，保留系统预览命令，不覆盖其处理器。

阅读器与命令对话框使用 `limr.language`；VS Code 原生命令名称和设置标签遵循 VS Code 自身的界面语言。

原文高亮覆盖 LiMR 1.2.2 内置组件标签、指令及静态属性、有效标注定义与成对边界、`==高亮==`、`^[行内脚注]`、数学分隔符和引用块中的 `[!类型]`。保留普通 Markdown、代码与注释的现有颜色；被真实标注定义引用的成对边界即使位于代码中也会高亮，与阅读器解析一致。工作区插件新增的自定义语法不自动加入。此设置适用于本地、远程及未保存的 Markdown；关闭会立即移除补充颜色。颜色跟随当前主题，可在 `workbench.colorCustomizations` 中覆盖 `limr.syntax.punctuation`、`tag`、`attribute`、`value`、`annotation`、`highlight`、`math`（每项均以 `limr.syntax.` 开头）。

## 样式与语法插件

文件开头由 `---` 包围的 YAML 元信息会自动显示为文档信息卡片：突出名称与描述，并展示其它字段、列表和嵌套信息。“查看原始元信息”可展开完整原文。此能力默认启用，也适用于 `SKILL.md`；不会改写文件，不需要配置工作区插件。无法解析的元信息保留原文显示。

在工作区创建 `.limr/plugins/manifest.json`，将 CSS 或 ESM 模块列入 `plugins`。模块通过 `export default ({ React, limr }) => RendererExtension` 复用阅读器现有 React/LiMR，可添加语法、组件、标注和操作；无需修改插件源码。文件修改自动重新加载，也可运行 `LiMR: Reload Workspace Plugins`。解析或加载失败会保留基础阅读器并提示错误。

完整例子见 [扩展指引](skills/limr-annotations/references/reader-plugins.md)。已安装的 Skill 包含同一指引，可直接让 AI 修改样式或添加语法。

## 向 AI 提问

划选文字，点击 **提问上下文**。悬浮提示会说明：复制后粘贴到 Codex 或其他 AI 助手，再输入自己的问题。

剪贴板包含文件路径、原始 UTF-16 范围、起止行列、原文及相邻片段、已有标注 ID 和写回说明。支持富文本的剪贴板同时包含 Codex 文件 mention HTML；受客户端权限限制时回退为完整纯文本。该 HTML 与已核对的 Codex 编辑器格式兼容，但不是 OpenAI 承诺稳定的公开接口。

激活阅读器标签页，从原生工具栏的 AI 子菜单查看指南、安装 Skill 或复制安装指引。`LiMR: Install AI Skill…` 支持全局、当前工作区和自选目录；`LiMR: Install AI Skill Globally…` 直接选择全局安装。Codex 使用 `~/.agents/skills/limr-annotations` 或工作区 `.agents/skills/limr-annotations`；Claude Code 使用对应的 `.claude/skills` 目录。首次启动会提示安装；尚未安装全局 Skill 时，每个新工作区仍会提示，可选择以后不再提醒或仅关闭当前工作区提醒。用户作出安装选择后才创建 Skill 文件。

详细说明见 [AI Annotation Guide](docs/ai-guide.md)。插件不自动发送 AI 请求；对话关联由用户粘贴上下文后，AI 按 Skill 规则回写原文件。只能写入实际已知的会话 ID。

## 开发

建议 Node.js 22.12+。

使用 npm 上的固定版本 `@linloir/limr@1.2.2`，运行 `npm ci` 按锁文件安装；无需准备相邻仓库或本地 tarball。

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

`test:vscode` 使用独立的 VS Code 配置、扩展目录和临时工作区，启动真实 Electron 编辑器并通过 Playwright 检查 Webview。设置 `VSCODE_TEST_VERSION` 可指定测试版本；`LIMR_TEST_THEME_DIR` 可使用本机 One Dark Pro 主题目录。Linux/WSLg 需要可用显示服务。

`test:animations` 在同样的真实编辑器中采样动画播放过程，检查工具栏、浮层、高亮、侧栏和阅读控件的中间帧与结束状态；证据和截图保存在 `artifacts` 中。

`test:regressions` 检查混合格式选区、工具栏宽度、浮卡切换、焦点样式、批量删除与 Undo，以及宽窄窗口布局。

打包产物为 `artifacts/limr-vscode-1.0.0.vsix`。运行资源全部随 VSIX 打包，不依赖开发服务器或 CDN；Markdown 自己引用的远程图片、视频仍可能联网。
