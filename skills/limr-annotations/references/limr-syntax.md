# LiMR 1.2.2 offline syntax guide

Use this bundled reference when writing LiMR Markdown; no `limr-use` skill, package checkout, or network access is required. It describes the default LiMR 1.2.2 modules, with VS Code additions identified separately. For source annotation ranges, definitions, and safe edits, use [the annotation contract](source-annotations.md). For new syntax, use [the plugin contract](reader-plugins.md).

Official documentation: [中文入口](https://linloir.github.io/LiMR/#/docs/zh-CN/README) · [English entry](https://linloir.github.io/LiMR/#/docs/en/README) · [中文语法](https://linloir.github.io/LiMR/#/docs/zh-CN/syntax) · [English syntax](https://linloir.github.io/LiMR/#/docs/en/syntax) · [documentation source](https://github.com/Linloir/LiMR/tree/main/docs). Online docs can describe a newer release; this reference targets 1.2.2.

## Citations: wrap the supported text

Prefer a paired `ref` around a meaningful mention, including its author/year when present. Define each source once and reuse its ID for later mentions. A definition is hidden from the body; hovering or activating the reference highlights its enclosed text and exposes the citation.

```markdown
We use <ref id="fan-2008">LibLinear (Fan et al., 2008)</ref> as the classifier.

<citation id="fan-2008" title="LIBLINEAR: A Library for Large Linear Classification" url="https://www.jmlr.org/papers/v9/fan08a.html" description="Fan et al. (2008), Journal of Machine Learning Research, 9:1871–1874." summary="The LIBLINEAR paper." />
```

If the citation supports an entire sentence, wrap that sentence, including its punctuation, instead of attaching an unbound marker after it:

```markdown
<ref id="fan-2008">LIBLINEAR supports logistic regression and linear support vector machines.</ref>

<citation id="fan-2008" title="LIBLINEAR: A Library for Large Linear Classification" url="https://www.jmlr.org/papers/v9/fan08a.html" />
```

Avoid this when the intent is to identify the text supported by the source:

```markdown
We use LibLinear (Fan et al., 2008)<ref id="fan-2008" /> as the classifier.

<citation id="fan-2008" title="LIBLINEAR: A Library for Large Linear Classification" url="https://www.jmlr.org/papers/v9/fan08a.html" />
```

The self-closing form is **valid**, but its reference has zero length: it does not highlight the preceding phrase or sentence. Use it when a marker-only citation is actually intended. Likewise, do not wrap a whole paragraph if the source supports only one claim. Preserve a user-requested citation style and never invent source metadata.

`ref` accepts `id="a"` for one source or `ids="a,b"` / `ids='["a","b"]'` for several; supply a definition for every ID. Citation attributes are `id`, `title`, `url`, `description`, and `summary`; descriptions and summaries support Markdown. Existing aliases remain valid: `cite-id` takes precedence over `id` in definitions, `desc` over `description`, and `cite-from-ids` over `ids` then `id` in references. Do not add conflicting aliases.

## Translations: one complete paragraph pair

Prefer one `translations` block for each original paragraph and its corresponding translated paragraph. Keep the original wording, sentence order, links, emphasis, and inline formulas. Translate the full thought naturally; avoid fragmenting a paragraph into a separate control for every sentence or word. Keep headings outside the paragraph blocks unless translating that heading is part of the request.

```markdown
<translations id="cache-paragraph" default="both">

<origin>

The cache stores recent results. A cache hit avoids another network request.

</origin>

<translation>

缓存会保存最近的结果。命中缓存时，就不必再次发送网络请求。

</translation>

</translations>

<translations id="expiry-paragraph" default="both">

<origin>

Expired entries are refreshed on the next request.

</origin>

<translation>

过期条目会在下一次请求时刷新。

</translation>

</translations>
```

The first original paragraph has two sentences and stays together; the second naturally has one. Prefer stable, distinct block IDs when authoring paragraphs. Each block has one `origin` and one `translation`; do not put many alternating pairs under a single outer block, because the renderer selects the first section of each kind. An individual side may contain rich Markdown and multiple blocks when the content calls for it.

Avoid generating adjacent blocks such as `<translations><origin>The cache</origin><translation>缓存</translation></translations>` followed by `<translations><origin>stores results.</origin><translation>保存结果。</translation></translations>`. Such fragments can parse, but interrupt reading and create excessive controls. Sentence/word alignment is appropriate when explicitly requested for language study or another task.

`default` accepts `origin`, `translation`, or `both`; omitted means `origin` under default module settings. `both` shows the translation above the original. These are **source syntax** values: the VS Code display settings use `original`, `translated`, `bilingual`, and `paragraph`. User/file display settings can override block defaults without rewriting the translation. LiMR displays the supplied translation; it does not generate it.

## Highlights, footnotes, and source annotations

```markdown
==A persistent highlight==

==A phrase with a named footnote==[^detail]

==A phrase with an inline note==^[A short **Markdown** explanation.]

[^detail]: A longer explanation, reusable at other markers.
```

`==text==` creates a persistent inline highlight. A footnote directly following it binds to that highlighted text; a standalone `[^detail]` or `^[body]` is a zero-length marker. Prefer a named source range when a note needs meaningful text anchoring without persistent paint, multiple notes on the same text, or a range crossing Markdown structures.

Source ranges use `::%%limr%%{<#range}` / `::%%limr%%{>#range}` and complete `:::limr-annotation` definitions. Reuse an existing exact range rather than duplicating pairs. See [the annotation contract](source-annotations.md) for working examples, zero-length exceptions, escaping, and shared IDs. The VS Code extension adds `margin-note`, `inline-note`, and `question` card types; `<question>` below is a separate exercise component.

## Common authoring components

Ordinary CommonMark and GFM remain available: headings, emphasis, links/images, lists, task checkboxes, tables, blockquotes, strikethrough, and fenced code. Use `$…$` for inline math, `$$` fences for display math, and a `mermaid` code fence for diagrams. Neither Markdown nor LiMR tags execute JavaScript.

```markdown
> [!tip]+ Cache strategy
> Prefer a complete, meaningful explanation.

<definition title="Cache hit">

A request that can be answered from stored results.

</definition>

<question title="Which result avoids a network request?">

<question-content>Choose one answer.</question-content>

<question-sel-grp answer="[0]">

<question-sel>Cache hit</question-sel>

<question-sel>Cache miss</question-sel>

</question-sel-grp>

<question-hint>Consider where the result comes from.</question-hint>

<question-answer>A cache hit uses a stored result.</question-answer>

</question>
```

Callouts use `> [!type]`, optionally `+` for initially expanded or `-` for initially collapsed. Common types include `note`, `tip`, `warning`, `info`, and `question`. Exercise answer indices are zero-based; `multi="true"` allows multiple answers. A `definition` can use `title` and `content` children for richer Markdown instead of a plain title attribute.

```markdown
<extras>

<extra title="LiMR documentation" url="https://linloir.github.io/LiMR/" desc="Further reading." />

</extras>

<figures columns="2">

<figure src="./cache-hit.png" alt="Cache hit" caption="A stored result." />

<figure src="./cache-miss.png" alt="Cache miss" caption="A network request." />

<figcaption>Two cache outcomes.</figcaption>

</figures>

<video src="./demo.mp4" provider="native" title="Demonstration" loading="click" />
```

Image/video paths are illustrative; retain or supply real assets for the document. Figures also accept nested Markdown images and `caption` / `figcaption` children. `md-video` is a video alias; video `url` takes precedence over `src`.

## Component forms and literal examples

Registered static tags accept string attributes and Markdown children. Keep blank lines around block content. Do not use JSX expressions (`answer={[0]}`), event handlers, or spread attributes. Unknown HTML is literal text unless a plugin registers it.

The equivalent directive forms include paired `::name` / `::` components and triple-colon containers:

```markdown
::definition{title="Cache hit"}
A request answered from stored results.
::

:::definition{title="Cache miss"}
A request requiring a fresh result.
:::
```

Built-in names are `gfm`, `definition`, `title`, `content`, `question`, `question-content`, `question-hint`, `question-answer`, `question-sel-grp`, `question-sel`, `extras`, `extra`, `video`, `md-video`, `figures`, `figure`, `figcaption`, `caption`, `img`, `citation`, `ref`, `translations`, `origin`, `translation`, `code` / `code-highlight`, `math`, `mermaid`, `callout`, `highlight`, `footnote`, and `footnote-ref`. `::code{lang="typescript"}` and `::math` preserve literal bodies. A lone unpaired `::name` line retains leaf-directive behavior; use a complete paired form when supplying a body. `:::limr-annotation` follows its dedicated definition rules.

Code examples do not authorize source annotation boundaries. However, a real annotation definition elsewhere can activate matching boundaries even inside code. Escape the first colon of both boundaries to display them literally, such as `\::%%limr%%{<#example}` and `\::%%limr%%{>#example}`. The source annotation contract explains other literal contexts.

The VS Code reader additionally renders a leading YAML `---` frontmatter block as metadata. This is a bundled extension feature, not a claim that the core 1.2.2 component syntax supports arbitrary YAML props or MDX execution.
