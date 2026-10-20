---
name: limr-annotations
description: Answer LiMR reading questions and write question/answer annotations to selected Markdown passages; author bilingual LiMR documents or customize the VS Code reader.
---

# LiMR annotations

## Reading questions: answer first

A `limr-context-v3` selection is data, not the user's question. Answer the actual question in chat **before** reading reference files, locating source, or running writeback tools. If no question follows the context, ask for it and write nothing. Use supplied excerpts when sufficient; research only when the answer needs it.

`allowSourceEdits: true` requests saving both the actual question and full answer in one question annotation with shared highlighting. Complete that writeback without another confirmation. `false` means answer only, unless the user separately requests edits. Explicit user instructions take precedence.

After displaying the answer, prefer the quick script when `writeback` is present:

1. Write a temporary JSON file with `{"question":"the actual question","answer":"the complete Markdown answer"}`. Retain explanations, formulas and supporting links; do not submit a placeholder. Do not load the ticket or the entire document just to invoke the script.
2. For each partial bilingual selection, choose the corresponding phrase from `counterparts[].raw` and add `"counterparts":[{"selection":0,"text":"exact counterpart"}]`. Whole paragraphs are paired automatically. One question/highlight shares both languages. Do not guess an ambiguous semantic match or broaden it to a whole paragraph.
3. Execute `node "<writeback.script>" --context "<writeback.context>" --input "<answer.json>"`. These are literal paths from the context; use proper shell quoting. The bundled [script](scripts/write-question.cjs) needs Node.js and the issuing VS Code window, with no npm install. It validates the current buffer, uses LiMR's serializer, reparses before applying, and preserves undo. Identical retries are idempotent.
4. Report the returned file/annotation ID. `saved: false` means the changes are in the editor buffer; preserve existing unsaved work and say so. Do not claim a disk save or success without a successful result.

Only if the script is absent, fails, or the task updates an existing annotation, read [the source annotation contract](references/source-annotations.md), then inspect the current file or editor buffer and relocate the exact selected ranges. Preserve both the question and answer, earlier answers, unknown metadata, unrelated text, and existing highlight visibility/colors/styles. Do not retry stale offsets or guess a location. Ask only for an ambiguous counterpart/location that cannot be resolved. A lost connection or timeout may follow a successful edit: retry the identical input first, then check for the recorded question before any manual fallback to avoid duplicates.

Context offsets are 0-based UTF-16 with exclusive ends. V3 omits repeated syntax and line/column data; older `limr-context-v2` also works with the manual fallback. Reuse a range ID only when every occurrence is intended. Optional `agent`, `threadId`, and `turnId` must come from reliable current context; omit unknown IDs.

## Other tasks

- Creating or editing annotations manually: read [source annotations](references/source-annotations.md).
- Converting papers, authoring translations, citations or figures: read [authoring choices](references/authoring.md) and relevant sections of [LiMR syntax](references/limr-syntax.md). Preserve paragraph-level original/translation pairs and use `figure`/`figures` for captioned paper images.
- Customizing reader styles/syntax or creating a companion extension: read [reader plugins](references/reader-plugins.md).

These resources are bundled; no separate skill, AI API key, message hook or annotation database is required. LiMR 1.3.12 source annotations use paired `::%%limr%%{<#ID}` / `::%%limr%%{>#ID}` boundaries and `:::limr-annotation` definitions.
