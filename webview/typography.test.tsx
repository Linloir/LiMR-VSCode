import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { applySourceEdits, createDocument, editSourceAnnotations, Markdown, Reader, standard, type MarkdownNode } from '@linloir/limr';
import { readingAnnotations } from './annotations';
import { DraftStore, EditorContext } from './editor-context';
import { languageTypography } from './typography';

describe('language-specific reader typography', () => {
  const extensions = [...standard(), languageTypography()];
  it('preserves decoded entities and UTF-16 source ranges while rendering each script font', () => {
    const source = 'Latin &amp; 中文😀 τέλος';
    const html = renderToStaticMarkup(<Markdown source={source} extensions={extensions} />);
    expect(html).toContain('lv-script-latin');
    expect(html).toContain('lv-script-chinese');
    expect(html).toContain('lv-script-other');
    expect(html).toContain('Latin &amp; ');
    expect(html).toContain(`data-source-start="${source.indexOf('中文')}"`);
    expect(html).toContain(`data-source-end="${source.indexOf('中文') + 2}"`);
  });
  it('keeps partial-word annotation boundaries serializable after typography is enabled', () => {
    const source = 'English 中文阅读 and **formatted words**.';
    const document = createDocument(source, { id: 'fonts', extensions }).getSnapshot();
    for (const selected of ['ngli', '文阅', 'ormatted']) {
      const start = source.indexOf(selected), range = { start, end: start + selected.length };
      const edits = editSourceAnnotations({ added: [{ id: 'note', type: 'margin-note', data: { body: 'A note' },
        anchors: [{ range, documentId: document.id, quote: selected }],
      }], updated: [], removed: [] }, document)!;
      const updated = applySourceEdits(source, edits);
      const reparsed = createDocument(updated, { id: document.id, extensions }).getSnapshot();
      const annotation = reparsed.annotations.find(item => item.id === 'note')!;
      expect(annotation.anchors?.map(anchor => updated.slice(anchor.range.start, anchor.range.end))).toEqual([selected]);
    }
  });
  it('keeps paired source markers on native text nodes across script segments', () => {
    const source = 'Before ::%%limr%%{<#r1}selected &amp; 中文😀::%%limr%%{>#r1} after.\n\n'
      + ':::limr-annotation{#n1 ranges="r1" type="margin-note"}\nA note\n:::\n';
    const html = renderToStaticMarkup(<EditorContext.Provider value={{ busy: false, editingEnabled: false,
      drafts: new DraftStore(), waitForCommit: async () => {}, notify: () => {},
    }}><Reader source={source} extensions={[...standard(), readingAnnotations(), languageTypography()]} sidebar={false} toc={false} /></EditorContext.Provider>);
    expect(html).toContain('aria-label="旁注"');
    expect(html).toContain('lv-script-chinese');
    expect(html).toContain('selected &amp; ');
    expect(html).toContain(`data-source-start="${source.indexOf('中文')}"`);
    expect(html).toContain(`data-source-end="${source.indexOf('中文') + 2}"`);
    expect(html).not.toContain('::%%limr%%');
  });

  it('keeps UTF-16 points and shared positions when identity text crosses scripts and lines', () => {
    const source = 'A😀中\né\u0301 Z';
    const nodes = createDocument(source, { extensions }).getSnapshot().blocks[0].node.children!;
    expect(nodes.map(node => [node.lvScript, node.children![0].value])).toEqual([
      ['latin', 'A'], ['other', '😀'], ['chinese', '中\n'], ['latin', 'é\u0301 Z'],
    ]);
    expect(nodes.map(node => node.position)).toEqual([
      { start: { offset: 0, line: 1, column: 1 }, end: { offset: 1, line: 1, column: 2 } },
      { start: { offset: 1, line: 1, column: 2 }, end: { offset: 3, line: 1, column: 4 } },
      { start: { offset: 3, line: 1, column: 4 }, end: { offset: 5, line: 2, column: 1 } },
      { start: { offset: 5, line: 2, column: 1 }, end: { offset: 9, line: 2, column: 5 } },
    ]);
    for (const node of nodes) expect(node.position).toBe(node.children![0].position);
  });

  it('keeps repeated classifications independent across paragraphs and typography factories', () => {
    const source = '中中中 aaa 111 😀中😀\n\n... 中中中 aaa 111 😀中😀';
    const groups = [['chinese', '中中中 '], ['latin', 'aaa 111 '], ['other', '😀'], ['chinese', '中'], ['other', '😀']];
    for (const readingExtensions of [extensions, [...standard(), languageTypography()], extensions]) {
      const document = createDocument(source, { extensions: readingExtensions }).getSnapshot();
      expect(document.blocks.map(block => block.node.children!.map(node => [node.lvScript, node.children![0].value])))
        .toEqual([groups, [['latin', '... '], ...groups]]);
    }
  });

  it('preserves exact line/column points in mixed-script paragraphs with entities and mixed newlines', () => {
    const source = ('Latin中文😀 Ω &amp; escaped \\* text\n中A\r\n\r\n').repeat(120);
    const document = createDocument(source, { extensions }).getSnapshot();
    let wrappers = 0;
    const point = (offset: number) => {
      const lines = source.slice(0, offset).split(/\r\n|\r|\n/);
      return { offset, line: lines.length, column: lines.at(-1)!.length + 1 };
    };
    const visit = (node: MarkdownNode) => {
      if (node.type === 'lv-script') {
        wrappers++;
        expect(node.position!.start).toEqual(point(node.position!.start.offset));
        expect(node.position!.end).toEqual(point(node.position!.end.offset));
        expect(node.position).toBe(node.children![0].position);
      }
      node.children?.forEach(visit);
    };
    document.blocks.forEach(block => visit(block.node));
    expect(wrappers).toBeGreaterThan(500);
  });

  it.each([
    { raw: '&amp; 中文' },
    { raw: '\\*中文' },
    { raw: 'A\r\n中文' },
    { raw: 'Same 中文', sourceOmissions: [{ start: 0, end: 1 }] },
  ])('keeps raw-equal text on the exact mapper when source syntax is present: $raw', ({ raw, sourceOmissions }) => {
    // Other syntax plugins may supply literal values. Equality alone must not
    // bypass the mapper's decoding/omission checks and turn inexact text exact.
    const lines = raw.split(/\r\n|\r|\n/);
    const child: MarkdownNode = { type: 'text', value: raw, sourceOmissions,
      position: { start: { offset: 0, line: 1, column: 1 }, end: { offset: raw.length, line: lines.length, column: lines.at(-1)!.length + 1 } } };
    const root: MarkdownNode = { type: 'root', children: [child] };
    languageTypography().transform!(root, { source: raw, documentId: 'literal-plugin', streaming: false });
    expect(root.children).toEqual([child]);
    expect(root.children![0]).toBe(child);
  });

});
