import { memo, useLayoutEffect } from 'react';
import { Reader, useAnnotations, useDocument, useLiMR, type DocumentSnapshot, type ReaderProps } from '@linloir/limr';
import { RetainedReader } from './retained-reader';
import { ReaderLoadingIndicator, useReaderLoading } from './reader-loading';

export type ReaderCommands = ReturnType<typeof useLiMR> & { find?: (command?: 'open' | 'next' | 'previous' | 'close') => void };
export interface ReaderIntegrationProps {
  onReader(commands: ReaderCommands, document: DocumentSnapshot, hasContent: boolean, hasTableContent: boolean): void;
  onDispose(commands: ReaderCommands): void;
}
/** Host integrations use public core state, independent of the current DOM window. */
export function ReaderIntegration({ onReader, onDispose }: ReaderIntegrationProps) {
  const commands = useLiMR(), document = useDocument(), { annotations, occurrences } = useAnnotations();
  const hasContent = occurrences.some(item => item.annotationIds.some(id => annotations.get(id)?.type !== 'highlight'));
  const hasTableContent = occurrences.some(item => item.annotationIds.some(id => annotations.get(id)?.type === 'table-cell-overflow'));
  useLayoutEffect(() => { onReader(commands, document, hasContent, hasTableContent); }, [commands, document, hasContent, hasTableContent, onReader]);
  useLayoutEffect(() => () => onDispose(commands), [commands, onDispose]);
  return null;
}

const MemoAsyncReader = memo(RetainedReader);
export function HostedReader({ source = '', loadingMode = 'progressive', documentVersion = 0, ...props }: ReaderProps & { loadingMode?: 'blocking' | 'progressive'; documentVersion?: number }) {
  // Prepared for 1.3.11's opt-in component. The pinned 1.3.10 ignores this
  // extra prop and retains its reviewed command adapter until npm is updated.
  const searchProps = { search: true };
  const asynchronous = source.length >= 64 * 1024;
  // An unregistered synchronous parser cannot be interrupted by a timer. Large
  // custom grammars must supply a matching worker instead of freezing this UI.
  const { progress, onLoadStateChange, retry } = useReaderLoading(props.documentId ?? '', documentVersion, source, asynchronous);
  return <>{asynchronous
    ? <MemoAsyncReader {...props} {...searchProps} source={source} loadingMode={loadingMode} onLoadStateChange={onLoadStateChange} />
    : <Reader {...props} {...searchProps} source={source} />}
    {asynchronous && <ReaderLoadingIndicator progress={progress} locale={props.locale?.language?.startsWith('zh') ? 'zh-CN' : 'en'} retry={retry} />}
  </>;
}
