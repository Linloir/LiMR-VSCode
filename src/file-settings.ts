import type { ReaderFileSettings } from './shared/protocol';

export function validateFileSettings(value: unknown): ReaderFileSettings {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid file settings.');
  const input = value as Record<string, unknown>, result: ReaderFileSettings = {};
  for (const key of Object.keys(input)) if (!['typography', 'translationMode', 'translationParagraphs'].includes(key)) throw new Error('Unknown file setting.');
  if (input.typography !== undefined) {
    if (!['standard', 'justify', 'knuth-plass'].includes(input.typography as string)) throw new Error('Invalid typography mode.');
    result.typography = input.typography as ReaderFileSettings['typography'];
  }
  if (input.translationMode !== undefined) {
    if (!['bilingual', 'original', 'translated', 'paragraph'].includes(input.translationMode as string)) throw new Error('Invalid translation mode.');
    result.translationMode = input.translationMode as ReaderFileSettings['translationMode'];
  }
  if (input.translationParagraphs !== undefined) {
    if (!input.translationParagraphs || typeof input.translationParagraphs !== 'object' || Array.isArray(input.translationParagraphs)) throw new Error('Invalid paragraph settings.');
    const entries = Object.entries(input.translationParagraphs);
    if (entries.length > 20000 || entries.some(([key, mode]) => key.length > 512 || !['origin', 'translation', 'both'].includes(mode as string))) throw new Error('Invalid paragraph settings.');
    result.translationParagraphs = Object.fromEntries(entries) as ReaderFileSettings['translationParagraphs'];
  }
  return result;
}
