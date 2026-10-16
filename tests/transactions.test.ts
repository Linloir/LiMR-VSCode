import { describe, expect, it } from 'vitest';
import { createDocument, editSourceAnnotations, standard } from '@linloir/limr';
import { applySourceEdits } from '@linloir/limr/core';
import { validateTransaction } from '../src/transactions';

describe('source edit transactions', () => {
  it('applies separate checkbox and annotation edits against original UTF-16 offsets', () => {
    const source = '- [ ] 中文😀\r\n';
    const edits = [{ range: { start: source.length, end: source.length }, text: '\r\n注释' }, { range: { start: 3, end: 4 }, text: 'x' }];
    expect(validateTransaction(source, edits, '- [x] 中文😀\r\n\r\n注释')).toHaveLength(2);
  });
  it('rejects overlapping ranges but coalesces legal equal-position insertions in LiMR order', () => {
    expect(() => validateTransaction('abcdef', [{ range: { start: 1, end: 4 }, text: '' }, { range: { start: 3, end: 5 }, text: '' }], 'af')).toThrow();
    expect(validateTransaction('abc', [{ range: { start: 1, end: 1 }, text: 'x' }, { range: { start: 1, end: 1 }, text: 'y' }], 'axybc'))
      .toEqual([{ range: { start: 1, end: 1 }, text: 'xy' }]);
    expect(validateTransaction('abc', [{ range: { start: 1, end: 2 }, text: 'B' }, { range: { start: 1, end: 1 }, text: 'x' }], 'axBc'))
      .toEqual([{ range: { start: 1, end: 2 }, text: 'xB' }]);
  });
  it('accepts real LiMR annotation transactions ending at EOF and meeting at adjacent boundaries', () => {
    const source = 'ABCD';
    const document = createDocument(source, { extensions: standard(), id: 'transaction-test' }).getSnapshot();
    for (const ranges of [[{ start: 0, end: 4 }], [{ start: 0, end: 2 }, { start: 2, end: 4 }]]) {
      const edits = editSourceAnnotations({
        added: [{ id: 'n-test', type: 'margin-note', data: { body: 'A shared note' },
          anchors: ranges.map(range => ({ range, documentId: document.id, quote: source.slice(range.start, range.end) })),
        }], updated: [], removed: [],
      }, document)!;
      const expected = applySourceEdits(source, edits);
      const normalized = validateTransaction(source, edits, expected);
      expect(applySourceEdits(source, normalized)).toBe(expected);
      expect(new Set(normalized.map(edit => edit.range.start)).size).toBe(normalized.length);
      const parsed = createDocument(expected, { extensions: standard(), id: document.id }).getSnapshot();
      const note = parsed.annotations.find(annotation => annotation.id === 'n-test');
      expect(note?.anchors?.map(anchor => expected.slice(anchor.range.start, anchor.range.end)))
        .toEqual(ranges.map(range => source.slice(range.start, range.end)));
    }
  });
  it('rejects out of bounds offsets and payloads inconsistent with edits', () => {
    expect(() => validateTransaction('abc', [{ range: { start: -1, end: 0 }, text: '' }], 'abc')).toThrow();
    expect(() => validateTransaction('abc', [{ range: { start: 0, end: 1 }, text: 'A' }], 'unrelated')).toThrow();
  });
});

describe('LiMR 1.2.2 paired annotation boundaries', () => {
  const snapshot = (source: string) => createDocument(source, { extensions: standard(), id: 'paired-boundaries' }).getSnapshot();
  const transact = (source: string, change: Parameters<typeof editSourceAnnotations>[0]) => {
    const edits = editSourceAnnotations(change, snapshot(source))!;
    const expected = applySourceEdits(source, edits);
    return applySourceEdits(source, validateTransaction(source, edits, expected));
  };
  const namedSource = 'Before ::%%limr%%{<#r1}**selected 中文😀**::%%limr%%{>#r1} after.\r\n\r\n'
    + ':::limr-annotation{#h1 ranges="r1" type="highlight" color="#E5C07B"}\r\n:::\r\n\r\n'
    + ':::limr-annotation{#n1 ranges="r1" type="margin-note" agent="codex" threadId="conversation" custom="keep"}\r\nOriginal note.\r\n:::\r\n';

  it('updates only the definition and preserves metadata, both boundaries and shared highlight', () => {
    const previous = snapshot(namedSource).annotations.find(item => item.id === 'n1')!;
    const updated = transact(namedSource, { added: [], removed: [], updated: [{ previous,
      annotation: { ...previous, data: { ...(previous.data as Record<string, unknown>), body: 'Edited **note**.\r\n\r\nSecond paragraph.' } },
    }] });
    expect(updated.slice(0, updated.indexOf(':::limr-annotation'))).toBe(namedSource.slice(0, namedSource.indexOf(':::limr-annotation')));
    const parsed = snapshot(updated);
    expect(parsed.annotations.map(item => item.id)).toEqual(['h1', 'n1']);
    expect(parsed.annotations.find(item => item.id === 'n1')!.data).toMatchObject({
      body: 'Edited **note**.\r\n\r\nSecond paragraph.', agent: 'codex', threadId: 'conversation', custom: 'keep',
    });
    const range = parsed.annotationRanges.get('r1')![0];
    expect(updated.slice(range.openingRange.start, range.openingRange.end)).toBe('::%%limr%%{<#r1}');
    expect(updated.slice(range.markerRange.start, range.markerRange.end)).toBe('::%%limr%%{>#r1}');
    expect(updated.slice(range.range.start, range.range.end)).toBe('**selected 中文😀**');
  });

  it('removes one note while retaining shared anchors; removes both boundaries after the last definition', () => {
    const note = snapshot(namedSource).annotations.find(item => item.id === 'n1')!;
    const withoutNote = transact(namedSource, { added: [], updated: [], removed: [note] });
    expect(snapshot(withoutNote).annotations.map(item => item.id)).toEqual(['h1']);
    expect(withoutNote).toContain('::%%limr%%{<#r1}**selected 中文😀**::%%limr%%{>#r1}');
    const highlight = snapshot(withoutNote).annotations[0];
    const plain = transact(withoutNote, { added: [], updated: [], removed: [highlight] });
    expect(plain).not.toContain('::%%limr%%');
    expect(plain).toContain('Before **selected 中文😀** after.');
    expect(snapshot(plain).annotations).toHaveLength(0);
  });

  it('creates cross-block and overlapping ranges without rewriting Markdown syntax', () => {
    const source = 'First **bold text**.\n\nSecond paragraph.\n';
    const ranges = [
      { start: source.indexOf('First'), end: source.indexOf('text') + 2 },
      { start: source.indexOf('bold'), end: source.indexOf('paragraph') + 'paragraph'.length },
    ];
    const updated = transact(source, { updated: [], removed: [], added: ranges.map((range, index) => ({
      id: `note-${index}`, type: 'margin-note', data: { body: `Note ${index}` }, anchors: [{ range, documentId: 'paired-boundaries', quote: source.slice(range.start, range.end) }],
    })) });
    expect(updated).toContain('::%%limr%%{<#');
    const parsed = snapshot(updated);
    expect(parsed.annotations).toHaveLength(2);
    const removeMarkers = (text: string) => text.replace(/::%%limr%%\{[<>]#[^}]+\}/g, '');
    for (const [index, annotation] of parsed.annotations.entries()) {
      const anchor = annotation.anchors![0];
      expect(removeMarkers(updated.slice(anchor.range.start, anchor.range.end))).toBe(source.slice(ranges[index].start, ranges[index].end));
    }
    const allRemoved = transact(updated, { added: [], updated: [], removed: [...parsed.annotations] });
    expect(allRemoved.trimEnd()).toBe(source.trimEnd());
  });

  it('rejects a boundary in the middle of a UTF-16 character without altering source', () => {
    const source = '中文😀 selection';
    expect(() => transact(source, { updated: [], removed: [], added: [{ id: 'broken', type: 'question', data: { body: 'Question' },
      anchors: [{ range: { start: 3, end: 8 }, documentId: 'paired-boundaries' }],
    }] })).toThrow(/complete text boundaries/);
  });

  it('leaves the previous named-marker syntax unbound instead of interpreting it as a source annotation', () => {
    const source = '==old range==[^%%limr:r1%%]\n\n:::limr-annotation{#old ranges="r1" type="margin-note"}\nOld content\n:::\n';
    const parsed = snapshot(source);
    expect(parsed.annotationRanges.size).toBe(0);
    expect(parsed.annotations.find(item => item.id === 'old')?.anchors).toEqual([]);
  });
});
