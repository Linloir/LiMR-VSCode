import { describe, expect, it } from 'vitest';
import type { HostMessage, ReaderState } from '../src/shared/protocol';
import { applyReaderConfiguration } from './reader-state';

describe('configuration-only host messages', () => {
  const current = { document: { uri: 'file:///paper.md', source: 'Unchanged source', version: 8, isDirty: true }, settings: { typography: 'standard' } } as ReaderState;
  const message = (version = 8) => ({ type: 'configuration', document: { ...current.document, version, isDirty: false },
    configuration: { settings: { ...current.settings, typography: 'knuth-plass' }, trusted: true, themeKind: 'light', themeName: '', resourceBase: '' },
  }) as Extract<HostMessage, { type: 'configuration' }>;
  it('updates view settings and save metadata without requiring source', () => {
    const update = message(); delete (update.document as { source?: string }).source;
    const result = applyReaderConfiguration(current, update)!;
    expect(result.document.source).toBe(current.document.source);
    expect(result.document.isDirty).toBe(false);
    expect(result.settings.typography).toBe('knuth-plass');
  });
  it('does not acknowledge a source version it has never received', () => {
    expect(applyReaderConfiguration(current, message(9))!.document).toBe(current.document);
    expect(applyReaderConfiguration(current, message(7))!.document).toBe(current.document);
  });
  it('ignores an old guest document and waits for full initialization', () => {
    expect(applyReaderConfiguration(null, message())).toBeNull();
    const update = message(); update.document.uri = 'file:///previous.md';
    expect(applyReaderConfiguration(current, update)).toBe(current);
  });
});
