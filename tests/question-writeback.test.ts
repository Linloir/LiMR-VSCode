import { describe, expect, it } from 'vitest';
import { createDocument, standard } from '@linloir/limr';
import { planQuestionWriteback } from '../src/question-writeback';
import { translationPeers } from '../src/shared/question-context';
const uri = 'file:///notes.md';
const parse = (source: string) => createDocument(source, { id: uri, extensions: standard() }).getSnapshot();
const select = (source: string, raw: string) => ({ start: source.indexOf(raw), end: source.indexOf(raw) + raw.length, raw });
const answer = { question: '为什么？', answer: '因为缓存保存了结果。\n\n公式：$a+b$。\n\n:::nested\n正文\n:::' };

describe('quick question writeback', () => {
  it('writes the complete question and answer with a shared highlight, preserving emoji and CRLF', () => {
    const source = '# Notes\r\n\r\nA 😀cache example.\r\n';
    const next = planQuestionWriteback(source, uri, [select(source, '😀cache')], answer, 'zh-CN');
    const doc = parse(next.source), question = doc.annotations.find(item => item.type === 'question')!;
    expect(doc.annotations.map(item => item.type)).toEqual(['question', 'highlight']);
    expect(question.data).toMatchObject({ body: expect.stringContaining(answer.answer.replace(/\n/g, '\r\n')) });
    expect(question.data).toMatchObject({ body: expect.stringContaining(answer.question) });
    expect(question.anchors?.map(anchor => next.source.slice(anchor.range.start, anchor.range.end))).toEqual(['😀cache']);
    expect(next.source.replace(/\r\n/g, '')).not.toContain('\n');
  });
  it('reuses exact ranges and preserves hidden highlights and unrelated notes byte for byte', () => {
    const source = '::%%limr%%{<#shared}Cache::%%limr%%{>#shared} works.\n\n:::limr-annotation{#h ranges="shared" type="highlight" hidden="true" color="red"}\n:::\n\n:::limr-annotation{#note ranges="shared" type="unknown" custom="preserve"}\nKeep me.\n:::\n';
    const next = planQuestionWriteback(source, uri, [select(source, 'Cache')], answer, 'en');
    expect(next.source.startsWith(source)).toBe(true);
    expect(parse(next.source).annotations.filter(item => item.type === 'highlight')).toHaveLength(1);
    expect(next.rangeIds).toEqual(['shared']);
  });
  it('does not widen a partial repeated range or rewrite its other definitions', () => {
    const source = '::%%limr%%{<#r}First::%%limr%%{>#r}. ::%%limr%%{<#r}Second::%%limr%%{>#r}.\n\n:::limr-annotation{#old ranges="r" type="margin-note"}\nKeep both.\n:::\n';
    const next = planQuestionWriteback(source, uri, [select(source, 'Second')], answer, 'en');
    const doc = parse(next.source);
    expect(doc.annotations.find(item => item.id === 'old')?.anchors).toHaveLength(2);
    expect(doc.annotations.find(item => item.id === next.annotationId)?.anchors).toHaveLength(1);
    expect(next.source).toContain(source.slice(source.indexOf(':::limr-annotation')));
  });
  it('binds corresponding bilingual spans once and refuses guessed or ambiguous matches', () => {
    const source = '<translations>\n<origin>\n\nCache reduces requests.\n\n</origin>\n<translation>\n\n缓存减少请求。\n\n</translation>\n</translations>\n';
    const ranges = [select(source, 'reduces requests')];
    expect(translationPeers(parse(source), ranges)).toMatchObject([{ selection: 0, side: 'translation', raw: '缓存减少请求。', whole: false }]);
    expect(() => planQuestionWriteback(source, uri, ranges, answer, 'zh-CN')).toThrow('counterpart');
    const next = planQuestionWriteback(source, uri, ranges, { ...answer, counterparts: [{ selection: 0, text: '减少请求' }] }, 'zh-CN');
    for (const annotation of parse(next.source).annotations) expect(annotation.anchors?.map(anchor => next.source.slice(anchor.range.start, anchor.range.end))).toEqual(['reduces requests', '减少请求']);
    expect(() => planQuestionWriteback(source, uri, ranges, { ...answer, counterparts: [{ selection: 0, text: '不存在' }] }, 'en')).toThrow('missing');
    const whole = planQuestionWriteback(source, uri, [select(source, 'Cache reduces requests.')], answer, 'en');
    expect(parse(whole.source).annotations[0].anchors).toHaveLength(2);
  });
  it('rejects missing answers, stale ranges, split Unicode and unfinished definitions without modifying source', () => {
    expect(() => planQuestionWriteback('😀hello', uri, [{ start: 1, end: 3, raw: '\ude00h' }], answer, 'en')).toThrow('boundaries');
    expect(() => planQuestionWriteback('hello', uri, [{ start: 0, end: 5, raw: 'stale' }], answer, 'en')).toThrow('changed');
    expect(() => planQuestionWriteback('hello', uri, [select('hello', 'hello')], { ...answer, answer: '' }, 'en')).toThrow('complete answer');
    const source = 'hello\n\n```js\nnot closed';
    expect(() => planQuestionWriteback(source, uri, [select(source, 'hello')], answer, 'en')).toThrow('Close the trailing');
  });
});
