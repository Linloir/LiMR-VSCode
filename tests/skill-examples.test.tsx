import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { applySourceEdits, createDocument, editSourceAnnotations, Markdown, standard } from '@linloir/limr';

const examples = (name: string) => [...readFileSync(new URL(`../skills/limr-annotations/references/${name}.md`, import.meta.url), 'utf8')
  .matchAll(/```markdown\n([\s\S]*?)\n```/g)].map(match => match[1]);
const snapshot = (source: string) => createDocument(source, { id: 'skill-example', extensions: standard() }).getSnapshot();

describe('bundled skill examples on the pinned LiMR parser', () => {
  it('binds one question/answer and shared highlight to both language spans and preserves both when updating an answer', () => {
    const source = examples('source-annotations').find(source => source.includes('<translations'))!;
    const document = snapshot(source);
    expect(document.annotations.map(item => item.type)).toEqual(['highlight', 'question']);
    const question = document.annotations.find(item => item.type === 'question')!;
    const highlight = document.annotations.find(item => item.type === 'highlight')!;
    for (const annotation of [question, highlight]) {
      expect(annotation.anchors?.map(anchor => source.slice(anchor.range.start, anchor.range.end)))
        .toEqual(['avoids repeated network requests', '避免重复的网络请求']);
    }
    expect(highlight.data).toMatchObject({ hidden: false, style: 'background' });
    const body = (question.data as { body: string }).body;
    expect(body).toContain('为什么缓存可以减少网络请求？');
    expect(body).toContain('缓存保存先前请求的结果');
    const nextBody = `${body}\n\n补充：过期策略决定何时重新请求。`;
    const next = applySourceEdits(source, editSourceAnnotations({ added: [], removed: [], updated: [{ previous: question,
      annotation: { ...question, data: { ...(question.data as object), body: nextBody } },
    }] }, document)!);
    const updated = snapshot(next);
    expect(updated.annotations).toHaveLength(2);
    expect(updated.annotations.find(item => item.id === question.id)?.data).toMatchObject({ body: nextBody });
    expect(next.slice(0, next.indexOf(':::limr-annotation'))).toBe(source.slice(0, source.indexOf(':::limr-annotation')));
    for (const annotation of updated.annotations) expect(annotation.anchors?.map(anchor => next.slice(anchor.range.start, anchor.range.end)))
      .toEqual(['avoids repeated network requests', '避免重复的网络请求']);
  });

  it('renders paper figure examples as one standalone image and a two-panel group with captions', () => {
    const source = examples('limr-syntax').find(source => source.includes('<figures'))!;
    const html = renderToStaticMarkup(<Markdown source={source} extensions={standard()} />);
    expect(html.match(/class="limr-figure"/g)).toHaveLength(3);
    expect(html.match(/class="limr-figures"/g)).toHaveLength(1);
    expect(html.match(/<img\b/g)).toHaveLength(3);
    expect(html).toContain('src="./cache-overview.png"');
    expect(html).toContain('src="./cache-hit.png"');
    expect(html).toContain('src="./cache-miss.png"');
    expect(html.replace(/<\/?span\b[^>]*>/g, '')).toContain('<strong>Figure 2.</strong>');
    expect(html).toContain('Send a network request when the result is absent.');
  });
});
