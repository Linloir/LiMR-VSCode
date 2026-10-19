import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { collectSyntaxTokens, syntaxTags } from '../src/syntax-tokens';

const tokens = (source: string) => collectSyntaxTokens(source).map(token => ({ ...token, text: source.slice(token.start, token.end) }));
const named = (body: string, definition = ':::limr-annotation{#note ranges="r1" type="margin-note"}\nA note\n:::') => `${body}\n\n${definition}\n`;
const pair = '::%%limr%%{<#r1}selected::%%limr%%{>#r1}';

describe('native Markdown LiMR source colors', () => {
  it('preserves colon prose and exact annotation tokens next to multilingual strong text', () => {
    const source = named('\uFEFF前**http:www\\.baidu.com**后 **12:30** :unknown[literal]\r\n\r\n::%%limr%%{<#r1}**“中文！”**::%%limr%%{>#r1}');
    const spans = tokens(source);
    expect(spans.filter(item => item.kind === 'annotation').map(item => item.text)).toEqual(['::%%limr%%{<#r1}', '::%%limr%%{>#r1}']);
    expect(spans.filter(item => item.kind === 'tag').map(item => item.text)).toEqual(['limr-annotation']);
    expect(spans.every(item => item.start >= source.indexOf('::%%limr%%{<#r1}'))).toBe(true);
  });

  it('colors every exact attribute and quoted value in translation, figure and list reference headers', () => {
    const source = readFileSync(new URL('./syntax-attributes.md', import.meta.url), 'utf8').replaceAll('\n', '\r\n');
    const spans = tokens(source);
    const expected = [
      ['default', '"both"'], ['id', '"fv-objectives"'], ['min-width', '"160"'], ['max-width', '"240"'],
      ['min-height', '"120"'], ['max-height', '"240"'], ['src', '"./papers/feature vectors/图1.png"'],
      ['alt', '"中文图示 😀"'], ['caption', '\'Feature-vector "objectives"\''], ['id', '"fv-paper"'],
      ['id', '"fv-paper"'], ['title', '"Feature vectors"'], ['url', '"https://example.com/paper"'],
    ];
    let offset = 0;
    for (const [attribute, value] of expected) {
      const start = source.indexOf(`${attribute}=${value}`, offset);
      expect(start, `${attribute}=${value}`).toBeGreaterThanOrEqual(offset);
      expect(spans).toContainEqual({ kind: 'attribute', start, end: start + attribute.length, text: attribute });
      expect(spans).toContainEqual({ kind: 'value', start: start + attribute.length + 1, end: start + attribute.length + 1 + value.length, text: value });
      offset = start + attribute.length + 1 + value.length;
    }
    expect(spans.filter(item => item.kind === 'attribute')).toHaveLength(expected.length);
    expect(spans.filter(item => item.kind === 'value')).toHaveLength(expected.length);
    expect(spans.some(item => item.text.includes('Ordinary') || item.text.includes('supports this point'))).toBe(false);
  });
  it('colors registered tag headers, static attributes and closers without coloring prose', () => {
    const source = '<definition title="中文 > value" open>\n\n**ordinary text**\n\n</definition>';
    const spans = tokens(source);
    expect(spans.filter(item => item.kind === 'tag').map(item => item.text)).toEqual(['definition', 'definition']);
    expect(spans.filter(item => item.kind === 'attribute').map(item => item.text)).toEqual(['title', 'open']);
    expect(spans.filter(item => item.kind === 'value').map(item => item.text)).toEqual(['"中文 > value"']);
    expect(spans.some(item => item.text.includes('ordinary'))).toBe(false);
  });
  it('recognizes every actual tag and does not invent directive-only HTML tags', () => {
    for (const tag of [...syntaxTags, 'highlight']) {
      expect(tokens(`<${tag} />`).some(item => item.kind === 'tag' && item.text === tag), tag).toBe(true);
    }
    for (const tag of ['code', 'math', 'mermaid', 'gfm', 'limr-annotation', 'script', 'unknown']) {
      expect(tokens(`<${tag}>==literal==</${tag}>`), tag).toEqual([]);
    }
  });
  it('handles directives, quoted braces, ids, class names, nested containers and leaf headers', () => {
    const source = '::definition{#outer .wide title="A } title"}\n\n:::question{answer="[0]"}\ntext\n:::\n\n::\n\n::extra{url="https://example.com"}';
    const spans = tokens(source);
    expect(spans.filter(item => item.kind === 'tag').map(item => item.text)).toEqual(['definition', 'question', 'extra']);
    expect(spans.filter(item => item.kind === 'value').map(item => item.text)).toContain('"A } title"');
    expect(spans.some(item => item.text === '#outer')).toBe(true);
    expect(spans.some(item => item.text === '.wide')).toBe(true);
    expect(spans.filter(item => item.text === '::').length).toBeGreaterThanOrEqual(3);
  });
  it('parses directive labels independently from quoted attribute values', () => {
    const spans = tokens(':ref[Bob\'s note]{id="citation-1"}');
    expect(spans.filter(item => item.kind === 'punctuation').map(item => item.text)).toEqual([':', '[', ']', '{', '=', '}']);
    expect(spans.filter(item => item.kind === 'attribute').map(item => item.text)).toEqual(['id']);
    expect(spans.filter(item => item.kind === 'value').map(item => item.text)).toEqual(['"citation-1"']);
  });
  it('uses LiMR active source ranges, including markers inside code and comments', () => {
    for (const body of [pair, `\`${pair}\``, `\`\`\`md\n${pair}\n\`\`\``, `<!-- ${pair} -->`, `<unknown>${pair}</unknown>`, `$${pair}$`]) {
      const source = named(body), spans = tokens(source);
      expect(spans.filter(item => item.kind === 'annotation').map(item => item.text)).toEqual(['::%%limr%%{<#r1}', '::%%limr%%{>#r1}']);
      expect(spans.filter(item => item.kind === 'tag').map(item => item.text)).toContain('limr-annotation');
    }
  });
  it('leaves orphaned, unreferenced, escaped and code-defined boundaries literal', () => {
    const definitions = ':::limr-annotation{#note ranges="r1" type="margin-note"}\nA note\n:::';
    for (const source of [pair, named(pair.replace('{>#r1}', '{>#missing}')), named(`\\${pair}`), `${pair}\n\n\`\`\`md\n${definitions}\n\`\`\``]) {
      expect(tokens(source).filter(item => item.kind === 'annotation'), source).toEqual([]);
    }
    expect(tokens(`${pair}\n\n:::limr-annotation{#note ranges="r1"}\nUnclosed`).filter(item => item.kind === 'annotation')).toEqual([]);
    expect(tokens(named('body', `:::limr-annotation{#note ranges="r1"}\n${pair}\n:::`)).filter(item => item.kind === 'annotation')).toEqual([]);
  });
  it('retains ordinary Markdown, code, comments, math contents and literal directive bodies', () => {
    const source = '# Heading\n\n**bold** [link](https://example.com)\n\n`==literal== <definition />`\n\n    ==indented== <definition />\n\n```md\n==fenced== <definition />\n```\n\n<!-- ==comment== <definition /> -->\n\n$==formula==$\n\n::code\n==literal body== <definition />\n::\n';
    const spans = tokens(source);
    expect(spans.filter(item => item.kind === 'highlight')).toEqual([]);
    expect(spans.filter(item => item.kind === 'tag').map(item => item.text)).toEqual(['code']);
    expect(spans.filter(item => item.kind === 'math').map(item => item.text)).toEqual(['$', '$']);
  });
  it('handles actual highlights, inline footnotes, math and callout headers without regex lookalikes', () => {
    const source = '==highlight **bold**== and ^[note `]` [nested]] with $x$ and $$y$$.\n\n> [!custom-kind]- Title\n> Body\n\n[!note] plain.\n\n\\==escaped==.\n\n===triple===.\n\n&#61;&#61;entity==.\n';
    const spans = tokens(source);
    expect(spans.filter(item => item.kind === 'highlight').map(item => item.text)).toEqual(['==', '==']);
    expect(spans.filter(item => item.kind === 'annotation').map(item => item.text)).toEqual(['^[', ']']);
    expect(spans.filter(item => item.kind === 'math').map(item => item.text)).toEqual(['$', '$', '$$', '$$']);
    expect(spans.filter(item => item.kind === 'tag').map(item => item.text)).toEqual(['[!custom-kind]-']);
  });
  it('colors math fence closers with trailing whitespace and ignores shorter unclosed fences', () => {
    for (const source of ['$$\nx+y\n$$   \n', '> $$\n> x+y\n> $$   \n']) {
      expect(tokens(source).filter(item => item.kind === 'math').map(item => item.text)).toEqual(['$$', '$$']);
    }
    expect(tokens('$$$$\nx+y\n$$\n').filter(item => item.kind === 'math').map(item => item.text)).toEqual(['$$$$']);
  });
  it('keeps frontmatter and arbitrary JSX expressions under their existing grammar', () => {
    const source = '---\ntitle: "==not highlighted=="\nsyntax: "<definition />"\n---\n\n<question title={expression.property} {...props} />';
    const spans = tokens(source);
    expect(spans.filter(item => item.kind === 'highlight')).toEqual([]);
    expect(spans.some(item => item.text.includes('expression'))).toBe(false);
    expect(spans.some(item => item.kind === 'attribute' && item.text === 'title')).toBe(false);
    expect(spans.filter(item => item.kind === 'value')).toEqual([]);
    expect(spans.filter(item => item.kind === 'tag').map(item => item.text)).toEqual(['question']);
  });
  it('preserves UTF-16 offsets after emoji and CRLF, and cuts attribute colors around active markers', () => {
    const source = named(`😀中文\r\n\r\n<definition title="${pair}" />`), spans = tokens(source);
    const tag = spans.find(item => item.kind === 'tag' && item.text === 'definition')!;
    expect(tag.start).toBe(source.indexOf('definition'));
    expect(spans.filter(item => item.kind === 'annotation')).toHaveLength(2);
    for (let index = 1; index < spans.length; index++) expect(spans[index].start).toBeGreaterThanOrEqual(spans[index - 1].end);
  });
});
