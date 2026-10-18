import { describe, expect, it } from 'vitest';
import { buildAIContext, positionAt, reusableRangeIds, type AIContextInput } from '../src/shared/ai-context';

const base: AIContextInput = {
  source: '第一行\r\nA😀BC\r\n最后一行',
  uri: 'file:///workspace/docs/notes.md',
  fsPath: '/workspace/docs/notes.md',
  relativePath: 'docs/notes.md',
  version: 7,
  ranges: [{ start: 6, end: 9 }],
  selectedText: '😀B',
};

function payload(text: string) {
  const match = /(`{3,})json\n([\s\S]*?)\n\1(?:\n|$)/.exec(text);
  if (!match) throw new Error('Missing JSON context');
  return JSON.parse(match[2]);
}

describe('AI question context', () => {
  it('preserves UTF-16 coordinates, raw source and readable selection independently', () => {
    const result = buildAIContext(base);
    const data = payload(result.text);
    expect(data.selections[0]).toMatchObject({
      start: 6, end: 9,
      raw: '😀B', before: '第一行\r\nA', after: 'C\r\n最后一行',
    });
    expect(data.selectedText).toBeUndefined(); // Identical rendered/raw text is sent once.
    expect(data.version).toBe(7);
    expect(result.text.startsWith('@docs/notes.md')).toBe(true);
    expect(result.html).toContain('at-mention-path="docs/notes.md"');
    expect(result.html).toContain('at-mention-fs-path="/workspace/docs/notes.md"');
  });

  it('handles LF, CRLF, lone CR and the exclusive end of the document', () => {
    expect(positionAt('a\nb', 2)).toEqual({ line: 2, column: 1 });
    expect(positionAt('a\r\nb', 3)).toEqual({ line: 2, column: 1 });
    expect(positionAt('a\rb', 2)).toEqual({ line: 2, column: 1 });
    expect(positionAt('a😀', 3)).toEqual({ line: 1, column: 4 });
    expect(() => positionAt('a', -1)).toThrow(RangeError);
  });

  it('retains multiple selections and stable range/annotation IDs without synthesizing a thread ID', () => {
    const result = buildAIContext({ ...base, ranges: [{ start: 0, end: 3 }, { start: 6, end: 9 }],
      rangeIds: ['rA', 'rA', 'rB'], annotationIds: ['q1', 'n1'], allowSourceEdits: true });
    const data = payload(result.text);
    expect(data.selections).toHaveLength(2);
    expect(data.rangeIds).toEqual(['rA', 'rB']);
    expect(data.annotationIds).toEqual(['q1', 'n1']);
    expect(data.allowSourceEdits).toBe(true);
    expect(data).not.toHaveProperty('threadId');
  });

  it('escapes file mentions and source HTML while retaining literal data in plain text', () => {
    const hostile = 'a" onmouseover="alert(1)<x>&\'.md';
    const source = '<script>alert(1)</script>\n```\n````';
    const result = buildAIContext({ ...base, source, relativePath: hostile, fsPath: `/work/${hostile}`,
      ranges: [{ start: 0, end: source.length }] });
    expect(result.html).not.toContain('<script>');
    expect(result.html).not.toContain('" onmouseover="');
    expect(result.html).toContain('&quot; onmouseover=&quot;');
    expect(result.html).toContain('&lt;x&gt;&amp;&#39;');
    expect(payload(result.text).selections[0].raw).toBe(source);
    expect(result.text).toContain('`````json');
  });

  it('rejects stale/out-of-bounds selections instead of silently pointing at different text', () => {
    for (const ranges of [[], [{ start: -1, end: 2 }], [{ start: 3, end: 2 }],
      [{ start: 0, end: 100 }], [{ start: 0.5, end: 2 }]]) {
      expect(() => buildAIContext({ ...base, ranges })).toThrow(RangeError);
    }
  });

  it('retains zero-length anchors and does not grant source editing by default', () => {
    const result = buildAIContext({ ...base, language: 'en', ranges: [{ start: 5, end: 5 }] });
    const data = payload(result.text);
    expect(data.selections[0].raw).toBe('');
    expect(data.allowSourceEdits).toBe(false);
    expect(result.text).toContain('answer without automatically writing annotations');
    expect(data.writeback).toBeUndefined();
  });
});


describe('paired-boundary AI context', () => {
  it('keeps compact locators and optional script paths without repeated syntax', () => {
    for (const language of ['zh-CN', 'en'] as const) {
      const writeback = { context: '/tmp/context.json', script: '/extension/skills/write-question.cjs' };
      const result = buildAIContext({ ...base, language, allowSourceEdits: true, rangeIds: ['selected'], writeback });
      expect(payload(result.text)).toMatchObject({ format: 'limr-context-v3', rangeIds: ['selected'], writeback });
      expect(result.text.length).toBeLessThan(1000);
      expect(payload(result.text)).not.toHaveProperty('annotationSyntax');
      expect(payload(result.text)).not.toHaveProperty('coordinates');
    }
  });

  it('does not offer a reused name if one occurrence falls outside the selected text', () => {
    const names = new Map([
      ['selected', [{ range: { start: 4, end: 8 } }]],
      ['repeated', [{ range: { start: 4, end: 8 } }, { range: { start: 14, end: 18 } }]],
      ['point', [{ range: { start: 6, end: 6 } }]],
      ['empty', []],
    ]);
    expect(reusableRangeIds(names, [{ start: 4, end: 8 }])).toEqual(['selected', 'point']);
    expect(reusableRangeIds(names, [{ start: 4, end: 8 }, { start: 14, end: 18 }])).toEqual(['selected', 'repeated', 'point']);
  });
});
