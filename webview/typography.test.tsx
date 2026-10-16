import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { applySourceEdits, createDocument, editSourceAnnotations, Markdown, Reader, standard } from '@linloir/limr';
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

});
