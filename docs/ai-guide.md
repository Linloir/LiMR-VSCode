# 用 AI 阅读、标注和定制 LiMR

[English](ai-guide.en.md) · [Skill 原文](../skills/limr-annotations/SKILL.md)

LiMR 把提问上下文复制到剪贴板，交给你选择的 AI 助手；不需要 API Key 或消息 Hook。标注保存在 Markdown 中，可以跟随文档提交 Git。附带的 Skill 同时说明 LiMR 1.3.13 标注语法，以及 VS Code 阅读器的样式和语法插件开发方法。

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
3. AI 先在对话中显示答案，然后在允许编辑时优先调用脚本，把问题和完整回答写入同一 `question` 标注，并补充共享高亮。只有脚本失败、位置过期或需要更新指定旧标注时，才重新读文件定位。

`limr-context-v3` 只传文件路径、UTF-16 偏移、选区、少量前后文本及必要 ID，省去重复的行列、首尾、语法说明。若选区有原译文对应段落，也会包含隐藏侧的文本。剪贴板保留文件引用和纯文本两种形式。

通过顶栏编辑按钮、**LiMR: Toggle Markdown Editing** 或 `limr.editingEnabled` 开启编辑时，上下文要求 AI 在回答后完成回写，无需再次确认：同一条 `question` 正文包含“问题”和“回答”，没有显式高亮的范围添加 `highlight`，已有高亮的显隐、颜色和样式保持原样。关闭时默认只回答；仍可在对话中明确要求改动。复制操作本身不会修改文件。

选区位于 `translations` 翻译块时，AI 会读取原文与译文，为语义对应的两个片段分别设置范围 ID，让它们关联同一条问答标注和共享高亮。即使阅读器只显示一种语言，也应处理文件中的另一侧；匹配不明确时会说明，而不会猜测位置。问答正文只保存一份，原文和译文都可以打开它。

脚本通过本机管道向生成上下文的 VS Code 窗口提交答案，校验文档版本和选区后，用 LiMR 序列化器生成、重解析并应用一笔可撤销编辑。无需安装 npm 包。原文未保存时，回写保留在编辑缓冲区（结果 `saved: false`）；原文已保存时尝试保存。相同请求可安全重试，不会重复添加标注。窗口关闭、版本变化、关闭编辑或上下文超过 24 小时，脚本会拒绝写入，转由 AI 按 Skill 重新定位。会话 ID 未可靠取得时省略。

## 请求示例

```text
用 $limr-annotations 解释这段内容，回答后把问题、回答和高亮写回文档；在翻译块内也关联另一种语言的对应片段。
```

```text
阅读本文的所有旁注与问题，按章节归纳，不修改文件。
```

```text
把 n-cache 的正文改为以下说明，保留 ID、关联范围和其他标注。
```

标注使用成对边界 `::%%limr%%{<#r1}` / `::%%limr%%{>#r1}` 和 `:::limr-annotation` 定义，支持跨段、嵌套和交错范围。优先选择有意义、非空且不过长的文本；同一段文本上的多个标注复用命名范围，只增加定义。引用优先用 `<ref>` 包裹文献名称或它支持的完整句子，翻译优先按完整段落配对；有明确需求时仍可使用零长度标记或更细的翻译粒度。完整规则见 [Skill 标注参考](../skills/limr-annotations/references/source-annotations.md)。

Skill 同时安装[离线 LiMR 1.3.13 语法指南](../skills/limr-annotations/references/limr-syntax.md)，包括引用、段落翻译、脚注和常用组件的例子，并提供官方文档入口。无需额外安装其他 Skill，也不依赖工作区中存在 LiMR 源码。

生成论文或研究笔记的 LiMR Markdown 时，Skill 建议用 `figure` 展示带图注的单张图片，用 `figures` 组织相关子图；保留真实图片路径、图号、子图标签和图注，需要富文本图注时使用 `figcaption`。

## 让 AI 定制样式或语法

```text
用 $limr-annotations 定制本工作区的 LiMR 阅读器：让引用块更紧凑，保留暗色主题和键盘 focus 样式。
```

```text
给 LiMR 添加 research-card 语法，显示研究结论卡片。请通过工作区插件实现，保留现有 Markdown 和标注能力。
```

插件放在工作区 `.limr/plugins/`，由 `manifest.json` 的 `plugins` 注册 CSS 或 JavaScript 模块，仅在可信工作区加载。样式调整可以只写 CSS；语法模块通过默认工厂接收 `{ React, limr }` 并返回 `RendererExtension`。示例和边界见 [Skill 插件参考](../skills/limr-annotations/references/reader-plugins.md)。
