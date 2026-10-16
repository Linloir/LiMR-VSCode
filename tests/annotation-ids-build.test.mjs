import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { build } from 'esbuild';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { shortAnnotationIdsPlugin } from '../scripts/annotation-ids.mjs';

const require = createRequire(import.meta.url);
let directory, fixture;
beforeAll(async () => {
  await mkdir('artifacts', { recursive: true });
  directory = await mkdtemp(path.resolve('artifacts/short-id-test-'));
  const outfile = path.join(directory, 'fixture.cjs');
  await build({
    stdin: { resolveDir: process.cwd(), contents: `
      import { createElement } from 'react';
      import { renderToStaticMarkup } from 'react-dom/server';
      import { DocumentProvider, useLiMR, sourceAnnotations, inlineHighlights, defaultHighlight, english } from '@linloir/limr';
      import { readerActions } from './webview/actions';
      import { validateTransaction } from './src/transactions';
      export function fixture(source) {
        let commands;
        function Capture() { commands = useLiMR(); return null; }
        renderToStaticMarkup(createElement(DocumentProvider, {
          source, documentId: 'short-id-fixture', extensions: [sourceAnnotations(), inlineHighlights()], annotations: [],
          annotationTypes: [{ type: 'margin-note', label: 'Note' }, { type: 'question', label: 'Question' }],
          onSourceChange(next, change) { validateTransaction(change.document.source, change.edits, next); },
        }, createElement(Capture)));
        return { commands, snapshot: () => commands.document.getSnapshot(), run(id, ranges) {
          const document = commands.document.getSnapshot();
          const context = { ...commands, document, annotations: [], highlight: undefined, locale: english, highlightAppearance: defaultHighlight,
            selection: { text: ranges.map(range => document.source.slice(range.start, range.end)).join(''), syntax: { ranges }, raw: { ranges } } };
          const actions = readerActions({ canWrite: () => true, getLanguage: () => 'en', isBusy: () => false,
            getDocument: () => ({ source: document.source }), notify() {} });
          actions.find(action => action.id === id).run(context);
        } };
      }
    ` },
    outfile, bundle: true, format: 'cjs', platform: 'node', target: 'node20',
    external: ['react', 'react-dom/server'], plugins: [shortAnnotationIdsPlugin()], logLevel: 'silent',
  });
  vi.stubGlobal('window', { getSelection: () => null });
  fixture = require(outfile).fixture;
}, 30_000);
afterAll(async () => { vi.unstubAllGlobals(); if (directory) await rm(directory, { recursive: true, force: true }); });

const compact = /^[0-9a-f]{6}$/;
const rangeOf = snapshot => [...snapshot.annotationRanges.values()][0][0].range;
describe('LiMR 1.2.3 production bundle annotation ID integration', () => {
  it.each(['lv-margin-note', 'lv-question', 'highlight'])('keeps all-numeric IDs as strings through the actual %s creation and edit lifecycle', action => {
    const values = [[0x00, 0x00, 0x00], [0x12, 0x34, 0x56], [0x23, 0x45, 0x67]];
    const random = vi.spyOn(crypto, 'getRandomValues').mockImplementation(bytes => {
      const value = values.shift();
      if (!value) throw new Error('Unexpected extra ID allocation');
      bytes.set(value); return bytes;
    });
    try {
      const reader = fixture('Selected words.'); reader.run(action, [{ start: 0, end: 8 }]);
      const snapshot = reader.snapshot();
      expect(snapshot.annotations.map(item => item.id)).toEqual(action === 'highlight' ? ['000000'] : ['000000', '123456']);
      expect([...snapshot.annotationRanges.keys()]).toEqual([action === 'highlight' ? '123456' : '234567']);
      expect(snapshot.source).toContain('id="000000"');
      for (const annotation of snapshot.annotations) {
        expect(typeof annotation.id).toBe('string'); expect(annotation.anchors).toHaveLength(1);
        expect(snapshot.source.slice(annotation.anchors[0].range.start, annotation.anchors[0].range.end)).toBe('Selected');
      }
      expect(reader.commands.canEditAnnotation('000000')).toBe(true);
      if (action === 'highlight') {
        reader.commands.updateAnnotation('000000', { data: { color: '#ABCDEF', style: 'underline', hidden: false } });
        expect(reader.snapshot().annotations[0].id).toBe('000000');
      } else {
        expect(reader.commands.cancelAnnotationEdit('000000')).toBe(true);
        expect(reader.snapshot().annotations).toHaveLength(0);
        expect(reader.snapshot().source.trimEnd()).toBe('Selected words.');
      }
    } finally { random.mockRestore(); }
  });
  it.each(['lv-margin-note', 'lv-question'])('creates %s with short automatic paint and shared range, then cancels both atomically', action => {
    const reader = fixture('Selected words.');
    reader.run(action, [{ start: 0, end: 8 }]);
    const created = reader.snapshot(), note = created.annotations.find(annotation => annotation.type !== 'highlight');
    expect(note.type).toBe(action === 'lv-question' ? 'question' : 'margin-note');
    expect(created.annotations.map(annotation => annotation.id).every(id => compact.test(id))).toBe(true);
    expect(created.annotations).toHaveLength(2);
    expect(created.annotationRanges.size).toBe(1);
    expect([...created.annotationRanges.keys()][0]).toMatch(compact);
    expect(new Set(created.annotations.flatMap(annotation => annotation.source.rangeIds)).size).toBe(1);
    expect(reader.commands.cancelAnnotationEdit(note.id)).toBe(true);
    expect(reader.snapshot().annotations).toHaveLength(0);
    expect(reader.snapshot().source.trimEnd()).toBe('Selected words.');
  });
  it('saves a note and reuses its existing range and highlight for a question', () => {
    const reader = fixture('Selected words.'); reader.run('lv-margin-note', [{ start: 0, end: 8 }]);
    let snapshot = reader.snapshot();
    const note = snapshot.annotations.find(annotation => annotation.type === 'margin-note');
    reader.commands.updateAnnotation(note.id, { data: { body: 'Saved note', threadId: 'thread-123456789012345678901234567890', turnId: 'turn-123456789012345678901234567890' } });
    reader.commands.commitAnnotationEdit(note.id);
    snapshot = reader.snapshot(); const ids = snapshot.annotations.map(annotation => annotation.id), ranges = [...snapshot.annotationRanges.keys()];
    reader.run('lv-question', [rangeOf(snapshot)]);
    snapshot = reader.snapshot();
    const question = snapshot.annotations.find(annotation => annotation.type === 'question');
    expect([...snapshot.annotationRanges.keys()]).toEqual(ranges);
    expect(snapshot.annotations.filter(annotation => annotation.type === 'highlight')).toHaveLength(1);
    reader.commands.cancelAnnotationEdit(question.id);
    expect(reader.snapshot().annotations.map(annotation => annotation.id)).toEqual(ids);
    expect(reader.snapshot().annotations.find(annotation => annotation.id === note.id).data).toMatchObject({ body: 'Saved note', threadId: 'thread-123456789012345678901234567890', turnId: 'turn-123456789012345678901234567890' });
  });
  it('creates a short direct highlight and preserves its ID on update', () => {
    const reader = fixture('Selected words.'); reader.run('highlight', [{ start: 0, end: 8 }]);
    const highlight = reader.snapshot().annotations[0];
    expect(highlight.id).toMatch(compact);
    expect(highlight.source.rangeIds[0]).toMatch(compact);
    reader.commands.updateAnnotation(highlight.id, { data: { color: '#ABCDEF', style: 'underline', hidden: false } });
    expect(reader.snapshot().annotations[0].id).toBe(highlight.id);
  });
  it('preserves existing long IDs and splits a reused range only where required', () => {
    const range = 'r-00112233-4455-6677-8899-aabbccddeeff', annotation = 'margin-note-00112233-4455-6677-8899-aabbccddeeff';
    const source = '::%%limr%%{<#' + range + '}First::%%limr%%{>#' + range + '} and ::%%limr%%{<#' + range + '}Second::%%limr%%{>#' + range + '}\n\n'
      + ':::limr-annotation{id="' + annotation + '" ranges="' + range + '" type="margin-note"}\nOriginal\n:::\n';
    const reader = fixture(source), initial = reader.snapshot();
    reader.run('lv-question', [initial.annotationRanges.get(range)[1].range]);
    const snapshot = reader.snapshot(), original = snapshot.annotations.find(item => item.id === annotation);
    expect(original.id).toBe(annotation); expect(original.anchors).toHaveLength(2);
    expect(snapshot.annotationRanges.has(range)).toBe(true);
    const added = [...snapshot.annotationRanges.keys()].filter(id => id !== range);
    expect(added).toHaveLength(1); expect(added[0]).toMatch(compact);
    const question = snapshot.annotations.find(item => item.type === 'question');
    expect(question.source.rangeIds).toEqual(added);
    reader.commands.cancelAnnotationEdit(question.id);
    // Existing notes still reference the new shared paint, so LiMR preserves it.
    expect(reader.snapshot().annotations.map(item => item.type)).toEqual(['margin-note', 'highlight']);
    expect(reader.snapshot().annotations[0].id).toBe(annotation);
    expect(reader.snapshot().annotations[0].anchors).toHaveLength(2);
  });
});
