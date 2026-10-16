# 用 AI 阅读、标注和定制 LiMR

[English](ai-guide.en.md) · [Skill 原文](../skills/limr-annotations/SKILL.md)

LiMR 把提问上下文复制到剪贴板，交给你选择的 AI 助手；不需要 API Key 或消息 Hook。标注保存在 Markdown 中，可以跟随文档提交 Git。附带的 Skill 同时说明 LiMR 1.2.2 标注语法，以及 VS Code 阅读器的样式和语法插件开发方法。

## 安装 Skill

首次启动 LiMR 时会提示安装。点击「安装…」选择全局或当前工作区；点击「提醒设置…」调整提醒范围。没有发现全局 Skill 时，每个首次使用的工作区仍会提示一次。关闭提示后不会对每篇文档重复询问；在提醒设置中可选择「以后不再提醒」或「当前工作区不再提醒」，对应 `limr.skills.promptOnStartup` 的用户/工作区设置。安装需要可信工作区。把用户级配置明确设为 `true` 可恢复新工作区提醒；已访问工作区可随时使用安装命令。

也可以从阅读器顶栏的 AI 菜单，或命令面板执行：

- **LiMR: Install AI Skill…**：选择 AI 工具、全局/工作区，或导出到其他目录。
- **LiMR: Install AI Skill Globally…**：直接选择 Codex 或 Claude Code 的全局目录。
- **LiMR: Copy Skill Installation Instructions**：复制包含插件附带 Skill 路径的文本，让 AI 助手指导安装。

| AI 工具 | 全局目录 | 当前工作区目录 | 调用 |
| --- | --- | --- | --- |
| Codex | `~/.agents/skills/limr-annotations/` | `.agents/skills/limr-annotations/` | `$limr-annotations` |
| Claude Code | `~/.claude/skills/limr-annotations/` | `.claude/skills/limr-annotations/` | `/limr-annotations` |

目录约定来自 [Codex 官方文档](https://learn.chatgpt.com/docs/customization/overview#skills)和 [Claude Code 官方文档](https://code.claude.com/docs/en/skills)。全局目录属于当前 VS Code 扩展宿主：在 WSL、SSH 或容器窗口中，就是对应远端环境的用户目录。也会识别已存在的 `~/.codex/skills` 或 `$CODEX_HOME/skills` 中的同名 Skill，避免重复提示。

只有选择安装才复制文件；提示本身不会创建 Skill 目录。更新现有安装前会询问。工作区安装可提交 Git。如果现有 AI 会话尚未发现 Skill，可以明确调用它或让助手读取对应 `SKILL.md`；必要时重开会话。聊天网站若无法访问文件，可以根据粘贴内容提出改动，由你应用。

## 复制提问上下文

1. 在阅读器中选择正文，点击选区工具栏的「提问上下文」。
2. 粘贴到已有或新的 AI 对话，补充实际问题并发送。
3. AI 按 Skill 读取当前文件、回答问题，并在允许编辑时记录为 `question` 标注。

上下文包含文件路径、UTF-16 源码偏移、从 1 开始的行列、原始 Markdown、可读选区、前后文本和已有范围/标注 ID。剪贴板会尝试同时写入文件引用和完整纯文本；纯文本保留所有定位信息。

通过顶栏编辑按钮、**LiMR: Toggle Markdown Editing** 或 `limr.editingEnabled` 开启编辑时，上下文会要求 AI 把实际问题写回同一 Markdown，复用已命名范围并保留高亮配置。关闭时默认只回答；仍可在对话中明确要求改动。复制操作本身不会修改文件。

发送前保存文件能减少磁盘和未保存编辑器内容的差异。AI 仍需重新读取并验证选区。会话 ID 仅在 AI 能可靠取得当前真实 ID 时填写；未填写也能正常记录问题和显示标注。

## 请求示例

```text
用 $limr-annotations 解释这段内容，并把我的问题记录为所选范围上的 question 标注。
```

```text
阅读本文的所有旁注与问题，按章节归纳，不修改文件。
```

```text
把 n-cache 的正文改为以下说明，保留 ID、关联范围和其他标注。
```

标注使用成对边界 `::%%limr%%{<#r1}` / `::%%limr%%{>#r1}` 和 `:::limr-annotation` 定义，支持跨段、嵌套和交错范围。优先选择有意义、非空且不过长的文本；同一段文本上的多个标注复用命名范围，只增加定义。引用优先用 `<ref>` 包裹文献名称或它支持的完整句子，翻译优先按完整段落配对；有明确需求时仍可使用零长度标记或更细的翻译粒度。完整规则见 [Skill 标注参考](../skills/limr-annotations/references/source-annotations.md)。

Skill 同时安装[离线 LiMR 1.2.2 语法指南](../skills/limr-annotations/references/limr-syntax.md)，包括引用、段落翻译、脚注和常用组件的例子，并提供官方文档入口。无需额外安装其他 Skill，也不依赖工作区中存在 LiMR 源码。

## 让 AI 定制样式或语法

```text
用 $limr-annotations 定制本工作区的 LiMR 阅读器：让引用块更紧凑，保留暗色主题和键盘 focus 样式。
```

```text
给 LiMR 添加 research-card 语法，显示研究结论卡片。请通过工作区插件实现，保留现有 Markdown 和标注能力。
```

插件放在工作区 `.limr/plugins/`，由 `manifest.json` 的 `plugins` 注册 CSS 或 JavaScript 模块，仅在可信工作区加载。样式调整可以只写 CSS；语法模块通过默认工厂接收 `{ React, limr }` 并返回 `RendererExtension`。示例和边界见 [Skill 插件参考](../skills/limr-annotations/references/reader-plugins.md)。
