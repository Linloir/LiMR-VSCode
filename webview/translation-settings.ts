import type { DocumentSnapshot, MarkdownNode } from '@linloir/limr';
import type { ParagraphTranslationMode, ReaderFileSettings, ReaderTranslationMode } from '../src/shared/protocol';

export const paragraphModes: readonly ParagraphTranslationMode[] = ['origin', 'translation', 'both'];
export const translationOverride = (mode: ReaderTranslationMode): ParagraphTranslationMode | undefined =>
  mode === 'bilingual' ? 'both' : mode === 'original' ? 'origin' : mode === 'translated' ? 'translation' : undefined;

// Content-based keys survive unrelated edits above a block. Equal blocks have
// independent occurrence suffixes; explicit IDs remain stable across edits.
function fingerprint(value: string): string {
  let hash = 14695981039346656037n;
  for (let index = 0; index < value.length; index++) hash = BigInt.asUintN(64, (hash ^ BigInt(value.charCodeAt(index))) * 1099511628211n);
  return hash.toString(36);
}
const cachedKeys = new WeakMap<DocumentSnapshot, Map<number, string>>();
export function translationBlockKeys(document: DocumentSnapshot): Map<number, string> {
  const cached = cachedKeys.get(document);
  if (cached) return cached;
  const keys = new Map<number, string>(), counts = new Map<string, number>();
  const visit = (node: MarkdownNode) => {
    if (node.name === 'translations' && node.position) {
      const { start, end } = node.position;
      const text = node.attributes?.id ? `id:${node.attributes.id}` : document.source.slice(start.offset, end.offset);
      const hash = fingerprint(text), occurrence = counts.get(hash) ?? 0;
      counts.set(hash, occurrence + 1); keys.set(start.offset, `${hash}-${occurrence}`);
    }
    node.children?.forEach(visit);
  };
  document.blocks.forEach(block => visit(block.node)); cachedKeys.set(document, keys);
  return keys;
}

export function paragraphSettings(
  mode: ReaderTranslationMode, overrides: ReaderFileSettings, keys: Iterable<string>, key: string, next: ParagraphTranslationMode,
): ReaderFileSettings {
  const translationParagraphs = { ...overrides.translationParagraphs }, previous = translationOverride(mode);
  // Leaving a document-wide mode should only change the clicked paragraph.
  if (previous) for (const current of keys) translationParagraphs[current] = previous;
  translationParagraphs[key] = next;
  return { ...overrides, translationMode: 'paragraph', translationParagraphs };
}
