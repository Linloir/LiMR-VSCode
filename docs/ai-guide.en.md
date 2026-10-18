# Read, annotate, and customize LiMR with AI

[简体中文](ai-guide.md) · [Skill instructions](../skills/limr-annotations/SKILL.md)

LiMR copies question context to your clipboard for your chosen AI assistant. It needs no API key or message hook. Annotations live in Markdown and can be committed with the document. The bundled skill covers LiMR 1.3.4 annotations and VS Code reader style/syntax plugins.

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
3. The assistant displays the answer first, then prefers the script to save the complete question/answer and shared highlight. It reads and relocates source only if the script fails, the context is stale, or an existing annotation needs updating.

`limr-context-v3` sends the file, UTF-16 offsets, selected text, short surrounding excerpts and necessary IDs, without duplicate coordinates or syntax instructions. Bilingual selections include the hidden counterpart. Clipboard output retains file mentions and plain text.

Enable editing with the toolbar button, **LiMR: Toggle Markdown Editing**, or `limr.editingEnabled`. The context then requests writeback after answering, without another confirmation: one `question` body contains Question and Answer sections, and ranges without an explicit highlight get a `highlight` definition. Existing visibility, colors, and styles are preserved. Otherwise it asks for an answer without automatic edits; you can still explicitly request a change. Copying context itself never changes the file.

For a selection inside `translations`, the assistant reads both the original and translation, gives the corresponding passages separate range IDs, and links both to the same question/answer annotation and shared highlight. This includes the hidden side when the reader displays only one language. An ambiguous counterpart is reported instead of guessed. The answer is stored once and can be opened from either language.

The script uses a local pipe to the issuing VS Code window. It verifies the buffer version and selection, serializes/reparses with LiMR and applies one undoable edit; no npm install is needed. Existing unsaved work stays in the buffer (`saved: false`); clean files are saved when possible. Identical retries do not duplicate annotations. Closed windows, changed documents, disabled editing or contexts older than 24 hours trigger the skill fallback. Unknown conversation IDs are omitted.

## Example requests

```text
Use $limr-annotations to explain this selection, then write the question, answer, and highlighting back to the document. Inside a translation block, also link the corresponding passage in the other language.
```

```text
Read all margin notes and questions in this Markdown and summarize them by section. Do not modify the file.
```

```text
Replace the body of n-cache with the following explanation, keeping its ID, linked ranges, and other annotations.
```

Annotations use paired `::%%limr%%{<#r1}` / `::%%limr%%{>#r1}` boundaries and `:::limr-annotation` definitions. Ranges may cross paragraphs, nest, or overlap. Prefer meaningful, nonempty text of appropriate length; multiple annotations on the same exact text reuse its named range and add only definitions. Prefer a paired `<ref>` around a source mention or the full sentence it supports, and pair translations by complete paragraph. Marker-only citations and finer translation units remain available when intended. See the [source annotation reference](../skills/limr-annotations/references/source-annotations.md) for the complete contract.

Installation also includes an [offline LiMR 1.3.4 syntax guide](../skills/limr-annotations/references/limr-syntax.md) with citation, paragraph translation, footnote, and component examples plus official documentation links. No additional skill or LiMR source checkout is required.

When generating LiMR Markdown for papers or research notes, the skill recommends `figure` for a single captioned image and `figures` for related panels. Preserve real image paths, figure numbers, panel labels, and captions; use `figcaption` for rich Markdown captions.

## Ask AI to customize styles or syntax

```text
Use $limr-annotations to make quote blocks more compact in this workspace's LiMR reader, preserving dark theme and keyboard focus styles.
```

```text
Add a research-card syntax for displaying research conclusions. Implement it as a workspace plugin while preserving Markdown and annotations.
```

Put plugins in the workspace's `.limr/plugins/` directory. `manifest.json` registers CSS or JavaScript modules in its `plugins` array, loaded only in trusted workspaces. Style-only changes can use CSS. A syntax module's default factory receives `{ React, limr }` and returns a `RendererExtension`. The [workspace plugin reference](../skills/limr-annotations/references/reader-plugins.md) includes a working pattern and its constraints.
