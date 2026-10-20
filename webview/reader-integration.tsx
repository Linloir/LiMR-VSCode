import { memo, useLayoutEffect } from 'react';
import { DocumentSearch, Reader, useAnnotations, useDocument, useLiMR, type DocumentSnapshot, type ReaderProps } from '@linloir/limr';
import { RetainedReader } from './retained-reader';
import { ReaderLoadingIndicator, useReaderLoading } from './reader-loading';

export type ReaderCommands = ReturnType<typeof useLiMR>;
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
// The workbench forwards keys even when the webview prevents their default.
// Keep one shortcut owner so F3/Shift+F3 do not navigate twice.
const hostedSearch = <DocumentSearch shortcuts={false} />;
export function HostedReader({ source = '', loadingMode = 'progressive', documentVersion = 0, ...props }: ReaderProps & { loadingMode?: 'blocking' | 'progressive'; documentVersion?: number }) {
  // Core search is opt-in; enable it for both ordinary and worker-loaded files.
  const asynchronous = source.length >= 64 * 1024;
  // An unregistered synchronous parser cannot be interrupted by a timer. Large
  // custom grammars must supply a matching worker instead of freezing this UI.
  const { progress, onLoadStateChange, retry } = useReaderLoading(props.documentId ?? '', documentVersion, source, asynchronous);
  return <>{asynchronous
    ? <MemoAsyncReader {...props} search={hostedSearch} source={source} loadingMode={loadingMode} onLoadStateChange={onLoadStateChange} />
    : <Reader {...props} search={hostedSearch} source={source} />}
    {asynchronous && <ReaderLoadingIndicator progress={progress} locale={props.locale?.language?.startsWith('zh') ? 'zh-CN' : 'en'} retry={retry} />}
  </>;
}
