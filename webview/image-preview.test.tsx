import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createDocument, Markdown, standard } from '@linloir/limr';
import { ImagePreviewProvider, readerImagePreview } from './image-preview';

const extensions = () => [...standard(), readerImagePreview()];
const render = (source: string) => renderToStaticMarkup(<ImagePreviewProvider locale="en"><Markdown source={source} extensions={extensions()} /></ImagePreviewProvider>);

describe('VS Code image preview module', () => {
  it('keeps ordinary, reference and figure image attributes and source ranges', () => {
    const source = '![普通😀](a%20b.png "Image title")\n\n![Reference][picture]\n\n[picture]: diagram.svg "Reference title"\n\n<figure src="figure.png" alt="Figure" caption="Caption" />\n';
    const html = render(source);
    expect(html).toContain('src="a%20b.png"');
    expect(html).toContain('alt="普通😀" title="Image title"');
    expect(html).toContain('src="diagram.svg" alt="Reference" title="Reference title"');
    expect(html).toContain('src="figure.png" alt="Figure"');
    expect(html).toContain('Caption');
    const plain = createDocument(source, { id: 'same', extensions: standard() }).getSnapshot();
    const preview = createDocument(source, { id: 'same', extensions: extensions() }).getSnapshot();
    expect(preview.source).toBe(plain.source);
    expect(preview.blocks.map(block => ({ range: block.range, node: block.node }))).toEqual(plain.blocks.map(block => ({ range: block.range, node: block.node })));
  });

  it('preserves missing-reference fallback and rejects executable image URLs', () => {
    const html = render('![Unresolved][missing]\n\n![Unsafe](javascript:alert)\n\n<img src="javascript:alert" alt="Unsafe tag" />\n');
    expect(html).toContain('Unresolved');
    expect(html).not.toContain('src="javascript:');
    expect(html).not.toContain('role="button"');
    expect(html).not.toContain('<dialog');
  });
});
