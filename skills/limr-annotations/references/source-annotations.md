# LiMR 1.3.10 source annotation contract

The VS Code reader bundles LiMR 1.3.10 and adds `margin-note`, `inline-note`, and `question` types. Annotations belong in the same Markdown document, with no parallel `.limr` annotation database.

## Canonical form

```markdown
The ::%%limr%%{<#cache-check}cache check::%%limr%%{>#cache-check} happens before the network request.

:::limr-annotation{#h-cache ranges="cache-check" type="highlight" style="background" color="#E5C07B" hidden="false"}
:::

:::limr-annotation{#n-cache ranges="cache-check" type="margin-note"}
This is a **margin note**. It can contain multiple paragraphs.
:::

:::limr-annotation{#q-cache ranges="cache-check" type="question"}
Why is the cache checked before sending the request?
:::
```

- Exact, case-sensitive paired boundaries are `::%%limr%%{<#range-id}` and `::%%limr%%{>#range-id}`. A range ID matches `[A-Za-z0-9][A-Za-z0-9_.:-]*`. Range IDs and annotation IDs are separate namespaces.
- Boundaries activate only when referenced by a real, complete `:::limr-annotation` definition. Missing definitions, unmatched boundaries, or ambiguous repeated openings leave that ID's boundaries as literal source.
- Adjacent opening/closing boundaries create a zero-length anchor; prefer nonempty text unless an insertion-point note is intended. A range ID can label sequential independent pairs, and a definition using it targets all those occurrences. Use distinct IDs for genuinely different nested or crossing ranges.
- `#n-cache` is shorthand for `id="n-cache"`. `ranges="r1 r2"` or `ranges="r1,r2"` targets several named ranges. Omitting `ranges` uses the annotation's own ID. One range may have multiple annotations.
- Bodies are Markdown exposed as `data.body`. Other scalar attributes become type-specific data. Keep `id`, `ranges`, and `type` as definition fields, not data fields.
- `margin-note` is a side note; `inline-note` is a compact text note; `question` is a question card distinct from LiMR's `<question>` exercise component. `footnote` remains a built-in note type. Preserve unknown types until their plugin is available.
- The last definition for a repeated annotation ID supplies its active data and range list. Each registered content annotation has its own marker/card.

## Choose and reuse the range

Choose the smallest complete text unit that makes the note understandable: a term or phrase for a definition, a sentence for a claim, a paragraph for a paragraph-level explanation. Avoid extending a short remark over unrelated paragraphs. These are authoring preferences, not parser limits; preserve the user's explicit selection and use a broader or disjoint range when the note actually needs it. For bibliographic sources, prefer a meaningful paired `<ref>` as described in [the syntax guide](limr-syntax.md#citations-wrap-the-supported-text).

In the canonical example, the highlight, margin note, and question share **one** `cache-check` boundary pair. To add another comment on exactly that text, append only a new definition:

```markdown
:::limr-annotation{#n-cache-order ranges="cache-check" type="inline-note"}
This ordering also avoids an unnecessary network request.
:::
```

Avoid creating a second pair solely for a second annotation on the same text, as in this unnecessary duplication:

```markdown
The ::%%limr%%{<#cache-a}::%%limr%%{<#cache-b}cache check::%%limr%%{>#cache-b}::%%limr%%{>#cache-a} runs first.

:::limr-annotation{#note-a ranges="cache-a" type="margin-note"}
The cache is checked first.
:::

:::limr-annotation{#question-b ranges="cache-b" type="question"}
Why is the cache checked first?
:::
```

This parses, but both notes can instead use `ranges="cache-a"` with only that pair retained. Reuse only an exact match, including **all** occurrences of the ID: a new note on just one of several occurrences needs its own range. Overlap is appropriate when two notes really concern different spans; identical words elsewhere in the document are not automatically the same range.

## Ranges across Markdown structures

Boundaries are removed before Markdown parsing and mapped back to original source offsets. Ranges can cross formatting, paragraphs, lists, tables, quotations, and code:

```markdown
::%%limr%%{<#a}The **first ::%%limr%%{<#b}crossing** range.

The next paragraph::%%limr%%{>#a} ends here::%%limr%%{>#b}.

:::limr-annotation{#note-a ranges="a" type="margin-note"}
A note on both paragraphs.
:::

:::limr-annotation{#note-b ranges="b" type="inline-note"}
A crossing note.
:::
```

Even boundaries inside inline/fenced code activate when a real definition elsewhere references them. Definitions inside code examples, literal components, footnote definitions, or unknown HTML/JSX do not authorize boundaries. Boundaries inside annotation bodies are inert. To show a boundary literally, escape its first colon, including inside code: `\::%%limr%%{<#a}`. Escape both ends when demonstrating a pair whose ID is also used by real definitions.

## Highlight appearance

`highlight` supports `style="background"`, `"underline"`, `"dotted"`, or `"wavy"`. `color` is a CSS color. `hidden="true"` hides persistent paint without deleting data; use explicit `"true"`/`"false"` values.

Only the last highlight targeting a range takes effect. Preserve document order where it controls precedence. Boundaries alone do not create a persistent highlight; without a visible explicit highlight, the range shows hover feedback. Ordinary `==text==` remains an independent persistent highlight.

## Question metadata

Put the question in the body, not a `question` attribute. `agent="codex"`, `threadId`, and `turnId` are optional scalar metadata. Use the actual agent name and verified current conversation identifiers only. Preserve existing metadata when editing a body. Never fill unavailable conversation IDs with placeholders or arbitrary UUIDs. New annotation IDs may be UUIDs.

## Question writeback and bilingual anchors

An answered reading question stores the actual question and answer together in one `question` body, plus explicit highlighting on the referenced text. For a translation block, locate the corresponding semantic span in each language and give each side its own range ID. One question definition and one shared highlight reference both IDs. This also works when the reader currently displays only one language.

```markdown
<translations id="cache-paragraph" default="both">

<origin>

The cache ::%%limr%%{<#cache-origin}avoids repeated network requests::%%limr%%{>#cache-origin}.

</origin>

<translation>

缓存::%%limr%%{<#cache-translation}避免重复的网络请求::%%limr%%{>#cache-translation}。

</translation>

</translations>

:::limr-annotation{#h-cache ranges="cache-origin cache-translation" type="highlight" style="background" color="#E5C07B" hidden="false"}
:::

:::limr-annotation{#q-cache ranges="cache-origin cache-translation" type="question"}
### 问题
为什么缓存可以减少网络请求？

### 回答
缓存保存先前请求的结果。后续请求命中仍有效的缓存时，可以直接复用该结果，因此不必再次发送网络请求；未命中或缓存过期时仍需请求。
:::
```

Reuse a suitable existing range on either side only after checking all of its occurrences. If a counterpart already has an explicit highlight, preserve that definition and its appearance instead of appending an overriding highlight. Add highlighting only for uncovered ranges. When extending a question, retain its ID, metadata, existing anchors, and previous question/answer text; do not create separate copies for the two languages. Multi-range definitions may have other anchors, which must not be removed by this extension. Verify that both nonempty anchors resolve inside their respective language sections after reparsing.

## Source changes

1. Read the latest source. An additional annotation on an exact existing range only needs a definition.
2. For a new range, insert its opening and closing boundaries around the original selected source. Append a closed definition outside code/literal blocks. Use a longer colon fence when the body contains a potential closing `:::` line.
3. Multiple disjoint fragments use one annotation with several range IDs. Crossing ranges use separate IDs without splitting or rearranging the enclosed Markdown.
4. Delete every definition of a removed annotation ID. Retain boundaries referenced by any other definition, including unknown types or hidden highlights. Remove an unused pair together, preserving the enclosed source text.
5. Reparse after each source change; old offsets and `Annotation.source` spans become stale.

`addAnnotation(annotation, { target: 'source' })` stores source annotations; plain `addAnnotation` uses external state. `updateAnnotation` and `removeAnnotation` follow existing storage. `onSourceChange(nextSource, transaction)` expects synchronous acceptance; the VS Code host handles file writes, versions, undo, and conflicts. Source edits are disabled during streaming. The reader's editing setting gates UI writes; an AI file-edit task follows the user's instruction and filesystem permissions.

The generic serializer rejects boundaries inside entities, escapes, surrogate/CRLF pairs, active boundary tokens, hidden definitions, and immediately after an odd run of backslashes. Both boundaries may lie outside a span that includes intervening definitions. Close unfinished trailing literal blocks before appending a definition. Data supports a Markdown `body` string and scalar fields; nested objects need a custom serializer.
