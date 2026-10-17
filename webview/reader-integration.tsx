import { memo, useLayoutEffect, useMemo } from 'react';
import { AsyncReader, Reader, useAnnotations, useDocument, useLiMR, type DocumentSnapshot, type ReaderProps } from '@linloir/limr';
import { createReaderWorker } from './reader-worker-port';
import { ReaderLoadingIndicator, useReaderLoading } from './reader-loading';

export type ReaderCommands = ReturnType<typeof useLiMR>;
export interface ReaderIntegrationProps {
  onReader(commands: ReaderCommands, document: DocumentSnapshot, hasContent: boolean): void;
  onDispose(commands: ReaderCommands): void;
}
/** Host integrations use public core state, independent of the current DOM window. */
export function ReaderIntegration({ onReader, onDispose }: ReaderIntegrationProps) {
  const commands = useLiMR(), document = useDocument(), { annotations, occurrences } = useAnnotations();
  const hasContent = occurrences.some(item => item.annotationIds.some(id => annotations.get(id)?.type !== 'highlight'));
  useLayoutEffect(() => { onReader(commands, document, hasContent); }, [commands, document, hasContent, onReader]);
  useLayoutEffect(() => () => onDispose(commands), [commands, onDispose]);
  return null;
}

const MemoAsyncReader = memo(AsyncReader);
export function HostedReader({ source = '', loadingMode = 'progressive', documentVersion = 0, ...props }: ReaderProps & { loadingMode?: 'blocking' | 'progressive'; documentVersion?: number }) {
  const asynchronous = source.length >= 64 * 1024;
  // An unregistered synchronous parser cannot be interrupted by a timer. Large
  // custom grammars must supply a matching worker instead of freezing this UI.
  const loading = useMemo(() => ({ mode: loadingMode, worker: createReaderWorker, fallback: 'error' as const }), [loadingMode]);
  const { progress, onLoadStateChange, retry } = useReaderLoading(props.documentId ?? '', documentVersion, source, asynchronous);
  return <>{asynchronous
    ? <MemoAsyncReader {...props} input={source} loading={loading} loadingFallback={null} onLoadStateChange={onLoadStateChange} />
    : <Reader {...props} source={source} />}
    {asynchronous && <ReaderLoadingIndicator progress={progress} locale={props.locale?.language?.startsWith('zh') ? 'zh-CN' : 'en'} retry={retry} />}
  </>;
}
