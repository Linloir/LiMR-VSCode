import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import type { AsyncReaderLoadControls, DocumentSessionState } from '@linloir/limr';
import type { ReaderLoadProgress } from '../src/shared/protocol';
import { loadProgressLabel } from '../src/shared/loading';
import { listen, post } from './bridge';

/** Isolate progress from the App/Reader tree and coalesce it to integer percent
 * or phase/status changes. The bridge never retains a document snapshot. */
export function useReaderLoading(uri: string, version: number, source: string, asynchronous: boolean) {
  const [progress, setProgress] = useState<ReaderLoadProgress>();
  const current = useRef<{ controls: AsyncReaderLoadControls; revision: number; progress: ReaderLoadProgress } | undefined>(undefined);
  const onLoadStateChange = useCallback((state: DocumentSessionState, controls: AsyncReaderLoadControls) => {
    // The previous engine can still be present in the prop-change commit.
    if (state.status === 'idle' || state.status === 'ready' && state.document?.getSnapshot().source !== source) return;
    const previous = current.current;
    const same = previous?.controls === controls && previous.revision === state.revision
      && previous.progress.uri === uri && previous.progress.version === version;
    const next: ReaderLoadProgress = {
      uri, version, requestId: same ? previous.progress.requestId : crypto.randomUUID(),
      status: state.status, phase: state.phase,
      percent: state.status === 'ready' ? 100 : Math.min(99, Math.max(0, Math.floor(state.overallProgress * 100))),
      ...(state.error ? { error: state.error.message.slice(0, 2000) } : {}),
    };
    if (same && next.status === previous.progress.status && next.phase === previous.progress.phase
      && next.percent === previous.progress.percent && next.error === previous.progress.error) return;
    current.current = { controls, revision: state.revision, progress: next };
    setProgress(next); post({ type: 'loadProgress', progress: next });
  }, [uri, version, source]);
  useEffect(() => listen(message => {
    const active = current.current;
    if (message.type === 'loadingAction' && active?.progress.requestId === message.requestId)
      active.controls[message.action]();
  }), []);
  useEffect(() => {
    if (asynchronous) return;
    current.current = undefined; setProgress(undefined);
    post({ type: 'loadProgress', progress: { uri, version, requestId: crypto.randomUUID(), status: 'ready', phase: 'ready', percent: 100 } });
  }, [asynchronous, uri, version]);
  // Release controls (and their session) on unmount or the synchronous path.
  useEffect(() => () => { current.current = undefined; }, []);
  return { progress: progress?.uri === uri && progress.version === version ? progress : undefined, onLoadStateChange,
    retry: () => current.current?.controls.retry() };
}

export function ReaderLoadingIndicator({ progress, locale, retry }: { progress?: ReaderLoadProgress; locale: string; retry(): void }) {
  if (!progress || progress.status === 'ready') return null;
  const label = loadProgressLabel(progress, locale);
  if (progress.status !== 'loading') return <div className="lv-load-error" role="status">
    <span>{label}{progress.error ? `: ${progress.error}` : ''}</span>
    <button type="button" onClick={retry}>{locale === 'zh-CN' ? '重试' : 'Retry'}</button>
  </div>;
  return <ReaderProgressBar label={label} percent={progress.percent} />;
}

/** Initial host delivery and worker parsing share the same non-blocking UI. */
export function ReaderProgressBar({ label, percent }: { label: string; percent?: number }) {
  return <div className="lv-load-progress" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100}
    aria-valuenow={percent} style={{ '--lv-load-fraction': `${Math.max(5, percent ?? 25)}%` } as CSSProperties}><span /></div>;
}
