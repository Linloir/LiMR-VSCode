# Authoring choices

## Choose useful text units

- Bind a citation to the meaningful text it supports: prefer `<ref id="fan-2008">LibLinear (Fan et al., 2008)</ref>`. If the source supports a whole sentence, wrap that sentence. Reserve a self-closing, zero-length `<ref />` for an intentional marker-only citation.
- For other annotations, prefer a nonempty phrase, sentence, or paragraph that explains the note's scope. Avoid isolated punctuation, arbitrary fragments, or a whole section when a shorter complete unit is sufficient. Honor an explicit user selection; choose broader, disjoint, or zero-length ranges when the task calls for them.
- When several annotations concern the same exact text, reuse its existing named range and add only the new definitions. Do not create duplicate overlapping boundary pairs merely because the annotation type differs. Check every occurrence before reusing an ID.
- Pair translations by paragraph: keep each complete original paragraph and its translation in one `translations` block. Avoid word-by-word or sentence-by-sentence fragments unless the user requests that granularity; a naturally single-sentence paragraph is still a paragraph.
- When generating LiMR Markdown for papers or research notes, prefer `figure` for a single captioned image and `figures` for related panels. Preserve real image paths, figure numbers, panel labels, and supplied captions; use `figcaption` for rich Markdown captions. See the syntax guide's [figure examples](references/limr-syntax.md#paper-figures). Ordinary Markdown images remain suitable for uncaptioned images.

