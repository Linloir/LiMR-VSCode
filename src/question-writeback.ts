import { createDocument, applySourceEdits, resolveAnnotationAnchors, type Annotation, type SourceRange } from '@linloir/limr/core';
import { gfm, sourceAnnotations, inlineHighlights, editSourceAnnotations } from '@linloir/limr/extensions';
import { math } from 'micromark-extension-math';
import { mathFromMarkdown } from 'mdast-util-math';
import { syntaxTags } from './syntax-tokens';
import { shortAnnotationId } from './shared/annotation-ids';
import { translationPeers, type QuestionSelection } from './shared/question-context';
import { readerFrontmatterSyntax } from './shared/reader-syntax';

export interface QuestionAnswer {
  question: string;
  answer: string;
  /** One exact substring per partial translated selection, indexed by selection. */
  counterparts?: { selection: number; text: string }[];
}
export function planQuestionWriteback(source: string, uri: string, selections: readonly QuestionSelection[], input: QuestionAnswer, language: 'zh-CN' | 'en') {
  if (typeof input.question !== 'string' || !input.question.trim() || typeof input.answer !== 'string' || !input.answer.trim())
    throw new Error('Supply both the actual question and the complete answer.');
  if (!selections.length || selections.some(range => !Number.isSafeInteger(range.start) || !Number.isSafeInteger(range.end)
    || range.start < 0 || range.end < range.start || range.end > source.length || source.slice(range.start, range.end) !== range.raw))
    throw new Error('The selection changed. Read the current document and relocate it before retrying.');
  // Host serialization needs syntax only; do not bundle browser renderers,
  // diagrams or every Shiki language into the extension process.
  const inline = ['citation', 'ref', 'footnote', 'footnote-ref'];
  const extensions = [gfm(), sourceAnnotations(), inlineHighlights(), readerFrontmatterSyntax(),
    { name: 'question-blocks', tags: syntaxTags.filter(name => !inline.includes(name)), display: 'block' as const },
    { name: 'question-inline', tags: inline },
    { name: 'question-math', directives: ['math'], literal: true, micromark: [math()], mdast: [mathFromMarkdown()] },
    { name: 'question-code', directives: ['code', 'code-highlight', 'mermaid'], literal: true },
  ];
  const document = createDocument(source, { id: uri, extensions }).getSnapshot();
  const ranges: SourceRange[] = selections.map(({ start, end }) => ({ start, end }));
  const peers = translationPeers(document, selections);
  for (const peer of peers) {
    if (ranges.some(range => range.start >= peer.start && range.end <= peer.end)) continue;
    const chosen = input.counterparts?.filter(item => item.selection === peer.selection);
    if (!peer.whole && (!chosen?.length || chosen.some(item => typeof item.text !== 'string' || !item.text.trim())))
      throw new Error(`Choose an exact counterpart for selection ${peer.selection} from its ${peer.side} text; no semantic match is guessed.`);
    for (const text of chosen?.length ? chosen.map(item => item.text) : [peer.raw]) {
      const index = peer.raw.indexOf(text);
      if (index < 0 || peer.raw.indexOf(text, index + 1) >= 0) throw new Error('The counterpart is missing or ambiguous. Read both translation sides before retrying.');
      ranges.push({ start: peer.start + index, end: peer.start + index + text.length });
    }
  }
  if (input.counterparts?.some(item => !peers.some(peer => peer.selection === item.selection))) throw new Error('A counterpart does not belong to a selected translation block.');
  const unique = [...new Map(ranges.map(range => [`${range.start}:${range.end}`, range])).values()];
  // The core serializer may rename repeated ranges when editing a subset. Use
  // a fresh nested range instead, preserving every unrelated definition byte.
  const repeated = [...document.annotationRanges.values()].filter(items => items.length > 1
    && items.some(item => unique.some(range => range.start === item.range.start && range.end === item.range.end))
    && !items.every(item => unique.some(range => range.start === item.range.start && range.end === item.range.end)));
  const annotationRanges = new Map([...document.annotationRanges].filter(([, items]) => !repeated.includes(items)));
  const editingDocument = { ...document, annotationRanges };
  const anchors = unique.map(range => ({ range, documentId: uri, quote: source.slice(range.start, range.end) }));
  const id = shortAnnotationId(document), zh = language === 'zh-CN';
  const newline = /\r\n|\r|\n/.exec(source)?.[0] ?? '\n';
  const body = `### ${zh ? '问题' : 'Question'}\n${input.question.trim()}\n\n### ${zh ? '回答' : 'Answer'}\n${input.answer.trim()}`.replace(/\r\n|\r|\n/g, newline);
  const question: Annotation = { id, type: 'question', data: { body }, anchors };
  const uncovered = anchors.filter(anchor => !document.annotations.some(annotation => annotation.type === 'highlight'
    && resolveAnnotationAnchors(annotation, document).some(existing => existing.range.start <= anchor.range.start && existing.range.end >= anchor.range.end)));
  const added: Annotation[] = [question];
  if (uncovered.length) added.push({ id: shortAnnotationId(document), type: 'highlight', data: { style: 'background', color: '#E5C07B', hidden: false }, anchors: uncovered });
  const edits = editSourceAnnotations({ added, updated: [], removed: [] }, editingDocument);
  if (!edits) throw new Error('The selection requires a custom source serializer.');
  const next = applySourceEdits(source, edits);
  const verified = createDocument(next, { id: uri, extensions }).getSnapshot();
  const saved = verified.annotations.find(annotation => annotation.id === id);
  if (!saved || (saved.data as { body?: string })?.body?.replace(/\r\n|\r/g, '\n') !== body.replace(/\r\n|\r/g, '\n')
    || resolveAnnotationAnchors(saved, verified).length !== unique.length)
    throw new Error('Question writeback did not reparse correctly; no changes were applied.');
  return { edits, source: next, annotationId: id, rangeIds: saved.source?.rangeIds ?? [] };
}
