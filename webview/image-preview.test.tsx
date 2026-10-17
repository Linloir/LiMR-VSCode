import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Markdown, standard } from '@linloir/limr';

const render = (source: string) => renderToStaticMarkup(<Markdown source={source} extensions={standard()} />);

describe('core images used by the VS Code resource bridge', () => {
  it('keeps ordinary, reference and figure image attributes and source ranges', () => {
    const source = '![普通😀](a%20b.png "Image title")\n\n![Reference][picture]\n\n[picture]: diagram.svg "Reference title"\n\n<figure src="figure.png" alt="Figure" caption="Caption" />\n';
    const html = render(source);
    expect(html).toContain('src="a%20b.png"');
    expect(html).toContain('alt="普通😀"');
    expect(html).toContain('title="Image title"');
    expect(html).toContain('src="diagram.svg"');
    expect(html).toContain('alt="Reference"');
    expect(html).toContain('title="Reference title"');
    expect(html).toContain('src="figure.png" alt="Figure"');
    expect(html).toContain('Caption');
    const ranges = [...html.matchAll(/data-limr-media="image"[^>]*data-source-start="(\d+)" data-source-end="(\d+)"/g)]
      .map(match => source.slice(Number(match[1]), Number(match[2])));
    expect(ranges).toContain('![普通😀](a%20b.png "Image title")');
    expect(ranges).toContain('![Reference][picture]');
  });

  it('preserves missing-reference fallback and rejects executable image URLs', () => {
    const html = render('![Unresolved][missing]\n\n![Unsafe](javascript:alert)\n\n<img src="javascript:alert" alt="Unsafe tag" />\n');
    expect(html).toContain('Unresolved');
    expect(html).not.toContain('src="javascript:');
    expect(html).not.toContain('role="button"');
    expect(html).not.toContain('<dialog');
  });
});
