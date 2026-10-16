import { describe, expect, it } from 'vitest';
import { validateFileSettings } from '../src/file-settings';
describe('per-file reading preferences', () => {
  it('accepts independent overrides and per-paragraph translations', () => {
    expect(validateFileSettings({ typography: 'knuth-plass', translationMode: 'paragraph', translationParagraphs: { intro: 'origin', detail: 'both' } }))
      .toEqual({ typography: 'knuth-plass', translationMode: 'paragraph', translationParagraphs: { intro: 'origin', detail: 'both' } });
  });
  it('allows clearing all overrides without changing document content', () => { expect(validateFileSettings({})).toEqual({}); });
  it.each([{ typography: 'bad' }, { translationMode: 'both' }, { translationParagraphs: { p: 'bad' } }, { editingEnabled: true }])('rejects invalid or unrelated settings', value => {
    expect(() => validateFileSettings(value)).toThrow();
  });
});
