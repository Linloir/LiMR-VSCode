# Read, annotate, and customize LiMR with AI

[简体中文](ai-guide.md) · [Skill instructions](../skills/limr-annotations/SKILL.md)

LiMR copies question context to your clipboard for your chosen AI assistant. It needs no API key or message hook. Annotations live in Markdown and can be committed with the document. The bundled skill covers LiMR 1.2.2 annotations and VS Code reader style/syntax plugins.

## Install the skill

LiMR offers installation on first use. Choose **Install…** for global or workspace installation, or **Reminders…** to change reminder preferences. Without a detected global skill, each new workspace gets its own first-use prompt. Dismissing it does not prompt again for every document. In reminder preferences, choose **Do not remind again** or **Do not remind in this workspace** to turn off the user/workspace `limr.skills.promptOnStartup` setting. Installation requires a trusted workspace. An explicit user-level `true` re-enables reminders for new workspaces; the install commands remain available in workspaces already visited.

Use the reader toolbar's AI menu or these command-palette commands anytime:

- **LiMR: Install AI Skill…**: choose the tool and global/workspace scope, or export to a custom directory.
- **LiMR: Install AI Skill Globally…**: choose the global Codex or Claude Code directory directly.
- **LiMR: Copy Skill Installation Instructions**: copy a prompt with the bundled skill path for an AI assistant to guide installation.

| Tool | Global directory | Workspace directory | Invoke |
| --- | --- | --- | --- |
| Codex | `~/.agents/skills/limr-annotations/` | `.agents/skills/limr-annotations/` | `$limr-annotations` |
| Claude Code | `~/.claude/skills/limr-annotations/` | `.claude/skills/limr-annotations/` | `/limr-annotations` |

These locations follow the [official Codex documentation](https://learn.chatgpt.com/docs/customization/overview#skills) and [Claude Code documentation](https://code.claude.com/docs/en/skills). Global installation belongs to the VS Code extension host: a WSL, SSH, or container window uses that environment's home directory. Existing copies under `~/.codex/skills` or `$CODEX_HOME/skills` are also detected to avoid repeated prompts.

Only choosing installation copies files; showing a prompt creates no skill directories. Updating an existing destination asks first. Workspace skills can be committed to Git. If an existing AI conversation has not discovered the skill, invoke it explicitly or ask it to read `SKILL.md`; start a new session if needed. A chat-only website without file access can propose edits for you to apply.

## Copy question context

1. Select reader text and click **Question context** in its selection toolbar.
2. Paste into an existing or new AI conversation, add the actual question, and send it.
3. The assistant reads the current file, answers, and records a `question` annotation when editing is allowed.

Context includes the file path, UTF-16 source offsets, 1-based line/column positions, raw Markdown, readable selection, surrounding text, and available range/annotation IDs. Clipboard output tries to include both a file mention and full plain text; the plain text retains every locator.

Enable editing with the toolbar button, **LiMR: Toggle Markdown Editing**, or `limr.editingEnabled`. The context then asks the assistant to record the actual question in that Markdown, reuse named ranges, and preserve highlight choices. Otherwise it asks for an answer without automatic edits; you can still explicitly request a change. Copying context itself never changes the file.

Save before sending to reduce differences between disk and unsaved editor text. The assistant still needs to reread and verify the selection. Conversation IDs are only recorded when the assistant has a reliable current ID; questions and markers work without them.

## Example requests

```text
Use $limr-annotations to explain this selection and record my question as a question annotation on the range.
```

```text
Read all margin notes and questions in this Markdown and summarize them by section. Do not modify the file.
```

```text
Replace the body of n-cache with the following explanation, keeping its ID, linked ranges, and other annotations.
```

Annotations use paired `::%%limr%%{<#r1}` / `::%%limr%%{>#r1}` boundaries and `:::limr-annotation` definitions. Ranges may cross paragraphs, nest, or overlap. Prefer meaningful, nonempty text of appropriate length; multiple annotations on the same exact text reuse its named range and add only definitions. Prefer a paired `<ref>` around a source mention or the full sentence it supports, and pair translations by complete paragraph. Marker-only citations and finer translation units remain available when intended. See the [source annotation reference](../skills/limr-annotations/references/source-annotations.md) for the complete contract.

Installation also includes an [offline LiMR 1.2.2 syntax guide](../skills/limr-annotations/references/limr-syntax.md) with citation, paragraph translation, footnote, and component examples plus official documentation links. No additional skill or LiMR source checkout is required.

## Ask AI to customize styles or syntax

```text
Use $limr-annotations to make quote blocks more compact in this workspace's LiMR reader, preserving dark theme and keyboard focus styles.
```

```text
Add a research-card syntax for displaying research conclusions. Implement it as a workspace plugin while preserving Markdown and annotations.
```

Put plugins in the workspace's `.limr/plugins/` directory. `manifest.json` registers CSS or JavaScript modules in its `plugins` array, loaded only in trusted workspaces. Style-only changes can use CSS. A syntax module's default factory receives `{ React, limr }` and returns a `RendererExtension`. The [workspace plugin reference](../skills/limr-annotations/references/reader-plugins.md) includes a working pattern and its constraints.
