import { createDocument, mapText, rangeOf, type MarkdownNode, type SourceRange, type SyntaxExtension } from '@linloir/limr/core';
import { gfm, inlineHighlights, sourceAnnotations } from '@linloir/limr/extensions';
import { math } from 'micromark-extension-math';
import { mathFromMarkdown } from 'mdast-util-math';
import { parseFrontmatter } from './shared/frontmatter';

export const syntaxKinds = ['punctuation', 'tag', 'attribute', 'value', 'annotation', 'highlight', 'math'] as const;
export type SyntaxKind = typeof syntaxKinds[number];
export interface SyntaxToken extends SourceRange { kind: SyntaxKind }

// The standard 1.2.3 parser vocabulary, without browser components or renderers.
// Tags are also valid directive names; the reverse does not hold.
export const syntaxTags = ['callout', 'definition', 'title', 'content', 'question', 'question-content', 'question-hint',
  'question-answer', 'question-sel-grp', 'question-sel', 'extras', 'extra', 'video', 'md-video', 'figures', 'figure',
  'figcaption', 'caption', 'img', 'citation', 'ref', 'translations', 'origin', 'translation', 'footnote', 'footnote-ref'] as const;
const blockTags = new Set<string>(syntaxTags.filter(name => !['citation', 'ref', 'footnote', 'footnote-ref'].includes(name)));
const literalDirectives = new Set(['math', 'code', 'code-highlight', 'mermaid']);
const parserExtensions = (): SyntaxExtension[] => [
  gfm(),
  { name: 'syntax-math', directives: ['math'], literal: true, micromark: [math()], mdast: [mathFromMarkdown()] },
  { name: 'syntax-code', directives: ['code', 'code-highlight', 'mermaid'], literal: true },
  { name: 'syntax-block-tags', tags: syntaxTags.filter(name => blockTags.has(name)), display: 'block' },
  { name: 'syntax-inline-tags', tags: syntaxTags.filter(name => !blockTags.has(name)) },
  sourceAnnotations(),
  inlineHighlights(),
];

/** Pure source classification. Only tokens recognized in LiMR's AST receive
 * color; CommonMark/GFM prose and embedded code retain their native grammar. */
export function collectSyntaxTokens(source: string): SyntaxToken[] {
  if (!/[<:$=^]|\[!/.test(source)) return [];
  const metadata = parseFrontmatter(source);
  // YAML metadata is owned by the editor's Markdown/YAML grammar.
  const input = metadata ? source.slice(0, metadata.end).replace(/[^\r\n]/g, ' ') + source.slice(metadata.end) : source;
  const document = createDocument(input, { extensions: parserExtensions(), id: 'limr-source-highlighting' }).getSnapshot();
  const tokens: SyntaxToken[] = [];
  const add = (kind: SyntaxKind, start: number, end: number) => { if (end > start) tokens.push({ kind, start, end }); };
  const markers: SourceRange[] = [...document.annotationRanges.values()].flatMap(ranges => ranges.flatMap(range => [range.openingRange, range.markerRange]))
    .sort((a, b) => a.start - b.start);

  function attributes(start: number, end: number, allowed: Record<string, unknown> = {}, shorthands = false) {
    const raw = source.slice(start, end);
    const expression = /([#.][\w:.-]+)|([A-Za-z_][\w:.-]*)(?:([ \t\r\n]*=[ \t\r\n]*)("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[^\s{}<>]+))?/g;
    for (const match of raw.matchAll(expression)) {
      const at = start + match.index!;
      if (match[1]) { if (shorthands) add('value', at, at + match[0].length); continue; }
      const name = match[2];
      // JSX expressions/spreads are inert in LiMR. Do not invent token meaning.
      if (!Object.hasOwn(allowed, name)) continue;
      add('attribute', at, at + name.length);
      if (match[3]) {
        const equals = at + name.length + match[3].indexOf('=');
        add('punctuation', equals, equals + 1);
        const value = at + name.length + match[3].length;
        if (!match[4].startsWith('{')) add('value', value, value + match[4].length);
      }
    }
  }
  function header(node: MarkdownNode) {
    const { start, end } = rangeOf(node), raw = source.slice(start, end), name = node.name;
    if (!name) return;
    const opening = new RegExp(`^<${name}(?=[\\s/>])`).exec(raw);
    if (opening) {
      let quote = '', close = opening[0].length;
      for (; close < raw.length; close++) {
        const char = raw[close];
        if (quote) { if (char === quote) quote = ''; }
        else if (char === '"' || char === "'") quote = char;
        else if (char === '>') break;
      }
      if (close === raw.length) return;
      add('punctuation', start, start + 1); add('tag', start + 1, start + 1 + name.length);
      attributes(start + opening[0].length, start + close, node.attributes);
      add('punctuation', start + close - (raw[close - 1] === '/' ? 1 : 0), start + close + 1);
      const closing = new RegExp(`</${name}\\s*>$`).exec(raw);
      if (closing) {
        const at = start + closing.index;
        add('punctuation', at, at + 2); add('tag', at + 2, at + 2 + name.length);
        add('punctuation', end - 1, end);
      }
      return;
    }
    const directive = /^(:+)([A-Za-z][\w-]*)/.exec(raw);
    if (!directive || directive[2] !== name) return;
    add('punctuation', start, start + directive[1].length);
    add('tag', start + directive[1].length, start + directive[0].length);
    // Directive headers may have a bracket label before their attributes.
    let at = directive[0].length, depth = 0;
    for (; at < raw.length && !/[\r\n]/.test(raw[at]); at++) {
      const char = raw[at];
      if (char === '\\') { at++; continue; }
      if (char === '[') { if (!depth) add('punctuation', start + at, start + at + 1); depth++; }
      if (char === ']') { depth--; if (!depth) add('punctuation', start + at, start + at + 1); }
      if (char !== '{' || depth) continue;
      const beginning = at; let innerQuote = '';
      while (++at < raw.length) {
        const next = raw[at];
        if (next === '\\') { at++; continue; }
        if (innerQuote) { if (next === innerQuote) innerQuote = ''; }
        else if (next === '"' || next === "'") innerQuote = next;
        else if (next === '}') break;
      }
      if (raw[at] === '}') {
        add('punctuation', start + beginning, start + beginning + 1);
        attributes(start + beginning + 1, start + at, node.attributes, true);
        add('punctuation', start + at, start + at + 1);
      }
      break;
    }
    if (directive[1].length >= 2) {
      const closing = /(?:\r\n|\r|\n)(?:[ \t]*>[ \t]?)*[ \t]*(:{2,})[ \t]*$/.exec(raw);
      if (closing) { const close = start + closing.index + closing[0].lastIndexOf(closing[1]); add('punctuation', close, close + closing[1].length); }
    }
  }
  function inlineFootnotes(node: MarkdownNode) {
    if (!node.children) return;
    const protectedNodes = node.children.filter(child => child.type !== 'text').map(rangeOf);
    let consumed = -1;
    for (const child of node.children) {
      if (child.type !== 'text' || !child.value) continue;
      const candidates = [...child.value.matchAll(/\^\[/g)];
      if (!candidates.length) continue;
      const map = mapText(source, child.value, rangeOf(child), { omissions: child.sourceOmissions });
      for (const match of candidates) {
        const start = map.starts[match.index!], from = map.ends[match.index! + 1];
        if (start < consumed || source.slice(start, from) !== '^[') continue;
        let depth = 1, at = from, protectedIndex = 0;
        while (protectedIndex < protectedNodes.length && protectedNodes[protectedIndex].end <= at) protectedIndex++;
        for (; at < rangeOf(node).end && depth; at++) {
          while (protectedIndex < protectedNodes.length && protectedNodes[protectedIndex].end <= at) protectedIndex++;
          const protectedNode = protectedNodes[protectedIndex];
          if (protectedNode && protectedNode.start <= at) { at = protectedNode.end - 1; continue; }
          if (source[at] === '\\') { at++; continue; }
          if (source[at] === '[') depth++;
          else if (source[at] === ']') depth--;
        }
        if (!depth) { add('annotation', start, from); add('annotation', at - 1, at); consumed = at; }
      }
    }
  }
  function visit(node: MarkdownNode) {
    const { start, end } = rangeOf(node), raw = source.slice(start, end);
    if (node.type === 'annotationDefinition' && node.name === 'limr-annotation') {
      // The real module only authorizes closed definitions with an ID.
      if (node.annotation) header(node);
      return;
    }
    if (node.type === 'component' || node.name === 'highlight') header(node);
    if (node.type === 'component' && literalDirectives.has(node.name ?? '')) return;
    if (['inlineCode', 'code', 'html', 'footnoteDefinition'].includes(node.type)) {
      if (node.type === 'code' && /^mermaid$/i.test(String(node.lang ?? ''))) {
        const fence = /^(`{3,}|~{3,})[ \t]*(mermaid)\b/i.exec(raw);
        if (fence) { const at = start + fence[0].lastIndexOf(fence[2]); add('tag', at, at + fence[2].length); }
      }
      return;
    }
    if (node.type === 'math' || node.type === 'inlineMath') {
      const opening = /^\$+/.exec(raw);
      const closing = (node.type === 'math' ? /[\r\n](?:[ \t]*>[ \t]?)*[ \t]*(\$+)[ \t]*$/ : /(\$+)$/).exec(raw);
      if (opening) add('math', start, start + opening[0].length);
      if (closing && closing[1].length >= (opening?.[0].length ?? 0) && closing.index >= (opening?.[0].length ?? 0)) {
        const at = start + closing.index + closing[0].indexOf('$'); add('math', at, at + closing[1].length);
      }
      return;
    }
    if (node.type === 'embeddedHighlight' && raw.startsWith('==') && raw.endsWith('==')) {
      add('highlight', start, start + 2); add('highlight', end - 2, end);
    }
    if (node.type === 'blockquote' && node.children?.[0]?.type === 'paragraph') {
      const paragraph = node.children[0], at = rangeOf(paragraph).start;
      const marker = /^\[![\w-]+\][+-]?/.exec(source.slice(at, rangeOf(paragraph).end));
      if (marker) add('tag', at, at + marker[0].length);
    }
    inlineFootnotes(node);
    node.children?.forEach(visit);
  }
  document.blocks.forEach(block => visit(block.node));
  // Active range boundaries remain active inside code, comments and attributes.
  // Let the public source index decide, and cut other colors around those spans.
  const result: SyntaxToken[] = markers.map(range => ({ ...range, kind: 'annotation' }));
  for (const token of tokens) {
    let from = token.start;
    let low = 0, high = markers.length;
    while (low < high) { const middle = (low + high) >>> 1; if (markers[middle].end <= from) low = middle + 1; else high = middle; }
    for (let index = low; index < markers.length; index++) {
      const marker = markers[index];
      if (marker.start >= token.end) break;
      if (marker.start > from) result.push({ ...token, start: from, end: marker.start });
      from = Math.max(from, marker.end);
    }
    if (from < token.end) result.push({ ...token, start: from });
  }
  return result.sort((a, b) => a.start - b.start || a.end - b.end).filter((token, index, all) =>
    !index || token.start !== all[index - 1].start || token.end !== all[index - 1].end || token.kind !== all[index - 1].kind);
}
