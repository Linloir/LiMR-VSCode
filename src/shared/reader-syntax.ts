import { mapText, type Annotation, type MarkdownNode, type ParseContext, type SourcePoint, type SyntaxExtension } from '@linloir/limr/core';
import { parseFrontmatter, type Frontmatter } from './frontmatter';

/** These versioned factories are shared by the host and its parser worker.
 * Bump the ID when syntax or independent-prose guarantees change. */
export const readerSyntaxIds = {
  frontmatter: 'limr-vscode/frontmatter@1',
  typography: 'limr-vscode/language-typography@1',
  annotations: 'limr-vscode/reading-annotations@1',
} as const;
export const frontmatterNodeType = 'vscode-frontmatter';

/** Preserve the complete source and UTF-16 positions while hiding the header
 * from Markdown parsing. Each parse context owns its prepared metadata. */
export function readerFrontmatterSyntax(): SyntaxExtension {
  const prepared = new WeakMap<ParseContext, Frontmatter>();
  return {
    name: frontmatterNodeType, scope: 'local',
    preprocess(context) {
      const metadata = parseFrontmatter(context.source);
      if (!metadata) return [];
      prepared.set(context, metadata);
      return [{ start: 0, end: metadata.end }];
    },
    transform(root, context) {
      const metadata = prepared.get(context);
      if (!metadata || (root.position?.start.offset ?? 0) !== 0) return;
      const lines = metadata.raw.split(/\r\n|\r|\n/);
      const node: MarkdownNode = { type: frontmatterNodeType, value: metadata.raw, metadata: metadata.values, selection: 'atomic',
        position: { start: { offset: 0, line: 1, column: 1 }, end: { offset: metadata.end, line: lines.length, column: lines.at(-1)!.length + 1 } },
      };
      root.children = [node, ...root.children ?? []];
    },
  };
}

type Script = 'latin' | 'chinese' | 'other';
// Stateless Unicode tests are shared across text leaves and parser instances.
// No global/sticky flags: repeated tests never advance lastIndex.
const hanCharacter = /\p{Script=Han}/u;
const latinOrNumberCharacter = /[\p{Script=Latin}\p{Number}]/u;
const letterOrSymbolCharacter = /[\p{Letter}\p{Symbol}]/u;
function scriptFor(character: string, previous: Script): Script {
  if (hanCharacter.test(character)) return 'chinese';
  if (latinOrNumberCharacter.test(character)) return 'latin';
  if (letterOrSymbolCharacter.test(character)) return 'other';
  return previous;
}
function sourcePoints(source: string, origin: SourcePoint): (offset: number) => SourcePoint {
  // One line index per leaf, not a growing prefix copy/split for every script
  // boundary. Mixed-script paragraphs otherwise take quadratic time and GC.
  const breaks = [...source.matchAll(/\r\n|\r|\n/g)].map(match => ({ start: match.index!, end: match.index! + match[0].length }));
  return offset => {
    let low = 0, high = breaks.length;
    while (low < high) { const middle = (low + high) >>> 1; if (breaks[middle].start < offset) low = middle + 1; else high = middle; }
    return { offset: origin.offset + offset, line: origin.line + low,
      column: low ? offset - Math.min(offset, breaks[low - 1].end) + 1 : origin.column + offset };
  };
}

/** Split text before source bindings are created. The wrapper never owns a
 * source annotation or changes the decoded leaf's text. */
export function languageTypographySyntax(): SyntaxExtension {
  return {
    name: 'vscode-language-typography', scope: 'local',
    transform(root, { source }) {
      const visit = (node: MarkdownNode) => {
        if (!node.children || node.type === 'lv-script') return;
        node.children = node.children.flatMap(child => {
          if (child.type !== 'text' || !child.position || !child.value) { visit(child); return [child]; }
          const start = child.position.start.offset, end = child.position.end.offset;
          const raw = source.slice(start, end), value = child.value;
          // Identity text needs no per-UTF-16-unit mapping. Keep all decoding,
          // omitted-syntax and CR normalization cases on the exact core mapper.
          const identity = raw === value && !child.sourceOmissions?.length && !/[\\&\r]/.test(raw);
          const mapping = identity ? undefined : mapText(source, value, { start, end }, { escapes: child.verbatimEscapes !== true, omissions: child.sourceOmissions });
          if (mapping && !mapping.exact) return [child];
          const pieces: { start: number; end: number; script: Script }[] = [];
          let offset = 0, previous: Script = 'latin';
          for (const character of value) {
            const script = scriptFor(character, previous), last = pieces.at(-1);
            if (last?.script === script) last.end += character.length;
            else pieces.push({ start: offset, end: offset + character.length, script });
            offset += character.length; previous = script;
          }
          const point = sourcePoints(raw, child.position.start);
          return pieces.map(piece => {
            const position = {
              start: point(mapping ? mapping.starts[piece.start] - start : piece.start),
              end: point(mapping ? mapping.ends[piece.end - 1] - start : piece.end),
            };
            const leaf: MarkdownNode = { ...child, value: value.slice(piece.start, piece.end), position };
            return { type: 'lv-script', lvScript: piece.script, position, children: [leaf] } as MarkdownNode;
          });
        });
      };
      visit(root);
    },
  };
}

export function readingAnnotationsSyntax(): SyntaxExtension {
  return {
    name: 'vscode-reading-annotations', scope: 'local',
    transform(root) {
      const visit = (node: MarkdownNode) => {
        const annotation = node.annotation as Annotation<Record<string, unknown>> | undefined;
        // The host supplies Copy + AI Context for read-only highlights. Source
        // ownership and onSourceChange remain the independent write gate.
        if (annotation?.type === 'highlight' && annotation.source && annotation.data?.readOnly) {
          node.annotation = { ...annotation, data: { ...annotation.data, readOnly: false } };
        }
        node.children?.forEach(visit);
      };
      visit(root);
    },
  };
}
