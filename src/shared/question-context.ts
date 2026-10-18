import type { DocumentSnapshot, MarkdownNode, SourceRange } from '@linloir/limr/core';

export interface QuestionSelection extends SourceRange { raw: string }
export interface TranslationPeer extends QuestionSelection { selection: number; side: 'origin' | 'translation'; whole: boolean }

/** Use the already parsed document, including its hidden translation side. The
 * model chooses a semantic counterpart; the script only accepts an exact match. */
export function translationPeers(document: DocumentSnapshot, selections: readonly SourceRange[]): TranslationPeer[] {
  const peers: TranslationPeer[] = [];
  const span = (node: MarkdownNode): SourceRange | undefined => {
    const children = node.children?.filter(child => child.position);
    if (!children?.length) return;
    return { start: children[0].position!.start.offset, end: children.at(-1)!.position!.end.offset };
  };
  const visit = (node: MarkdownNode) => {
    if (node.name === 'translations') {
      const sides = node.children?.filter(child => child.name === 'origin' || child.name === 'translation') ?? [];
      for (const [selection, range] of selections.entries()) {
        const selected = sides.find(side => { const bounds = span(side); return bounds && range.start >= bounds.start && range.end <= bounds.end; });
        if (!selected) continue;
        const selectedSpan = span(selected)!;
        for (const other of sides.filter(side => side !== selected)) {
          const bounds = span(other); if (!bounds) continue;
          peers.push({ ...bounds, raw: document.source.slice(bounds.start, bounds.end), selection,
            side: other.name as TranslationPeer['side'], whole: range.start === selectedSpan.start && range.end === selectedSpan.end });
        }
      }
    }
    node.children?.forEach(visit);
  };
  document.blocks.forEach(block => visit(block.node));
  return peers;
}
