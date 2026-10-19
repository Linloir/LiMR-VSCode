import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ReaderLoadProgress } from '../src/shared/protocol';
import { ReaderLoadingIndicator, ReaderProgressBar } from './reader-loading';

vi.mock('./bridge', () => ({ listen: vi.fn(), post: vi.fn() }));

const progress: ReaderLoadProgress = { uri: 'file:///book.md', version: 1, requestId: 'test', status: 'loading', phase: 'parse', percent: 35 };
const render = (status: ReaderLoadProgress['status']) => renderToStaticMarkup(
  <ReaderLoadingIndicator progress={{ ...progress, status }} locale="zh-CN" retry={() => {}} />,
);

describe('reader loading feedback', () => {
  it('uses an indeterminate top bar before the host supplies the document, without a loading card', () => {
    const html = renderToStaticMarkup(<ReaderProgressBar label="Opening Markdown…" />);
    expect(html).toContain('class="lv-load-progress"');
    expect(html).toContain('role="progressbar"');
    expect(html).toContain('aria-label="Opening Markdown…"');
    expect(html).not.toContain('aria-valuenow');
    expect(html.replace(/<[^>]*>/g, '')).toBe('');
  });

  it('keeps worker progress in the top bar and removes it when ready', () => {
    const html = render('loading');
    expect(html).toContain('class="lv-load-progress"');
    expect(html).toContain('aria-valuenow="35"');
    expect(html.replace(/<[^>]*>/g, '')).toBe('');
    expect(render('ready')).toBe('');
  });

  it.each(['cancelled', 'error'] as const)('retains the actionable %s status instead of hiding it as progress', status => {
    const html = render(status);
    expect(html).toContain('<button type="button">重试</button>');
    expect(html).not.toContain('role="progressbar"');
  });
});
