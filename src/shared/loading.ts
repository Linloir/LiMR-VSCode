import type { ReaderLoadProgress } from './protocol';

export function loadProgressLabel(progress: Pick<ReaderLoadProgress, 'status' | 'phase' | 'percent'>, locale: string): string {
  const zh = locale === 'zh-CN';
  if (progress.status === 'error') return zh ? '加载失败' : 'Loading failed';
  if (progress.status === 'cancelled') return zh ? '已取消加载' : 'Loading cancelled';
  const labels = zh ? { read: '读取文档', parse: '解析文档', index: '建立索引', ready: '文档已就绪' }
    : { read: 'Reading', parse: 'Parsing', index: 'Indexing', ready: 'Ready' };
  return `${labels[progress.phase]} ${progress.percent}%`;
}

export function isReaderLoadProgress(value: unknown): value is ReaderLoadProgress {
  if (!value || typeof value !== 'object') return false;
  const p = value as ReaderLoadProgress;
  return typeof p.uri === 'string' && Number.isSafeInteger(p.version)
    && typeof p.requestId === 'string' && p.requestId.length > 0 && p.requestId.length <= 100
    && ['loading', 'ready', 'cancelled', 'error'].includes(p.status)
    && ['read', 'parse', 'index', 'ready'].includes(p.phase)
    && Number.isInteger(p.percent) && p.percent >= 0 && p.percent <= 100
    && (p.error === undefined || typeof p.error === 'string' && p.error.length <= 2000);
}
