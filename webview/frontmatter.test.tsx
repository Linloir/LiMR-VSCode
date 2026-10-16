import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { applySourceEdits, createDocument, editSourceAnnotations, Markdown, standard } from '@linloir/limr';
import { parseFrontmatter, readerFrontmatter } from './frontmatter';

const extensions = () => [...standard(), readerFrontmatter()];
const render = (source: string) => renderToStaticMarkup(<Markdown source={source} extensions={extensions()} />);

describe('document frontmatter', () => {
  it('renders name, multiline description and ordinary nested fields without interpreting HTML', () => {
    const source = '---\nname: reader-skill\ndescription: >\n  Read Markdown\n  with annotations.\ntags: [reader, AI]\nsettings:\n  enabled: true\n  languages: [en, zh-CN]\nhtml: "<script>alert(1)</script>"\n---\n\n# Body\n';
    const metadata = parseFrontmatter(source)!;
    expect(metadata.values).toEqual({ name: 'reader-skill', description: 'Read Markdown with annotations.\n', tags: ['reader', 'AI'], settings: { enabled: true, languages: ['en', 'zh-CN'] }, html: '<script>alert(1)</script>' });
    const html = render(source);
    expect(html).toContain('limr-definition lv-frontmatter');
    expect(html).toContain('lv-frontmatter-name">reader-skill');
    expect(html).toContain('Read Markdown with annotations.');
    expect(html).toContain('lv-frontmatter-tags');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).not.toContain('<script>');
    expect(html).toContain('View original metadata');
  });

  it('preserves BOM, CRLF, exact source offsets and checkbox edits', () => {
    const header = '\uFEFF---\r\nname: 测试😀\r\ndescription: |\r\n  First line.\r\n  第二行。\r\n---';
    const source = `${header}\r\n\r\n# Body\r\n\r\n- [ ] selected 中文😀\r\n`;
    const document = createDocument(source, { id: 'frontmatter', extensions: extensions() }).getSnapshot();
    expect(document.source).toBe(source);
    expect(document.blocks[0].range).toEqual({ start: 0, end: header.length });
    expect(document.blocks[0].node.position?.end).toEqual({ offset: header.length, line: 6, column: 4 });
    expect(document.headings.map(heading => heading.text)).toEqual(['Body']);
    expect(document.headings[0].range.start).toBe(source.indexOf('# Body'));
    const checkbox = source.indexOf('[ ]') + 1;
    const checked = applySourceEdits(source, [{ range: { start: checkbox, end: checkbox + 1 }, text: 'x' }]);
    const edited = createDocument(checked, { id: document.id, extensions: extensions() }).getSnapshot();
    expect(edited.source.slice(0, header.length)).toBe(header);
    expect(edited.blocks.at(-1)?.node.children?.[0].checked).toBe(true);
  });

  it('round-trips body annotations after frontmatter with CRLF and UTF-16 characters', () => {
    const header = '---\r\nname: 测试😀\r\ndescription: |\r\n  First line.\r\n  第二行。\r\n---';
    const source = `${header}\r\n\r\n# Body\r\n\r\n- [ ] selected 中文😀\r\n`;
    const document = createDocument(source, { id: 'frontmatter-annotations', extensions: extensions() }).getSnapshot();
    const start = source.indexOf('selected'), range = { start, end: start + 'selected 中文😀'.length };
    const edits = editSourceAnnotations({ added: [{ id: 'body-note', type: 'margin-note', data: { body: 'A note' }, anchors: [{ range, documentId: document.id, quote: source.slice(range.start, range.end) }] }], updated: [], removed: [] }, document)!;
    const updated = applySourceEdits(source, edits);
    expect(updated.slice(0, header.length)).toBe(header);
    const parsed = createDocument(updated, { id: document.id, extensions: extensions() }).getSnapshot();
    const anchor = parsed.annotations.find(item => item.id === 'body-note')!.anchors![0];
    expect(updated.slice(anchor.range.start, anchor.range.end)).toBe('selected 中文😀');
  });

  it.each([
    '\n---\nname: not-at-start\n---\nBody',
    'Body\n\n---\nname: later\n---',
    '---\nname: unfinished\n\n# Body',
    '---\nA normal paragraph\n---\n\n# Body',
    '---\n- ordinary list\n---\n\n# Body',
    '```yaml\n---\nname: fenced\n---\n```',
  ])('leaves ordinary Markdown and unclosed or misplaced delimiters intact: %s', source => {
    expect(parseFrontmatter(source)).toBeUndefined();
    expect(render(source)).not.toContain('lv-frontmatter');
  });

  it.each([
    'name: duplicate\nname: duplicate-again',
    'description: [unfinished',
    'action: !!js/function "function () { throw new Error(); }"',
    'items: &cycle [*cycle]',
  ])('shows unsupported or invalid metadata as original text: %s', body => {
    const raw = `---\n${body}\n---`, source = `${raw}\n\n# Body`;
    expect(parseFrontmatter(source)).toEqual({ end: raw.length, raw });
    const document = createDocument(source, { extensions: extensions() }).getSnapshot();
    expect(document.headings.map(heading => heading.text)).toEqual(['Body']);
    expect(render(source)).toContain('This metadata is shown as written.');
    expect(document.source).toBe(source);
  });

  it('handles aliases as plain data and caps expanding graphs without executing tags', () => {
    const source = '---\nbase: &base {enabled: true}\ncopy: *base\n---\n';
    expect(parseFrontmatter(source)?.values).toEqual({ base: { enabled: true }, copy: { enabled: true } });
    const graph = Array.from({ length: 7 }, (_, index) => `level${index}: &l${index} ${index ? `[*l${index - 1}, *l${index - 1}, *l${index - 1}, *l${index - 1}]` : '[one, two, three, four]'}`).join('\n');
    const large = parseFrontmatter(`---\n${graph}\n---`);
    expect(large).toBeDefined();
    expect(large?.values).toBeUndefined();
  });

  it('retains empty name and description as ordinary fields', () => {
    const html = render('---\nname: ""\ndescription: ""\n---\n\nBody');
    expect(html).toContain('<dt>name</dt>');
    expect(html).toContain('<dt>description</dt>');
    expect(html).not.toContain('lv-frontmatter-name');
  });

  it('restores exactly one header when streaming closes it and appends body content', () => {
    const engine = createDocument('---\nname: streaming\n', { id: 'stream', streaming: true, extensions: extensions() });
    engine.append('---\n\n# Body\n');
    engine.append('\nText after metadata.\n');
    const document = engine.finish();
    expect(document.blocks.filter(block => block.node.type === 'vscode-frontmatter')).toHaveLength(1);
    expect(document.headings[0].range.start).toBe(document.source.indexOf('# Body'));
    expect(document.blocks.at(-1)?.range.end).toBe(document.source.trimEnd().length);
  });
});
