import { useLayoutEffect } from 'react';
import { AsyncReader, Reader, useAnnotations, useDocument, useLiMR, type DocumentSnapshot, type ReaderProps } from '@linloir/limr';
import { createReaderWorker } from './reader-worker-port';

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

export function HostedReader({ source = '', loadingMode = 'blocking', ...props }: ReaderProps & { loadingMode?: 'blocking' | 'progressive' }) {
  return source.length >= 64 * 1024
    ? <AsyncReader {...props} input={source} loading={{ mode: loadingMode, worker: createReaderWorker }} />
    : <Reader {...props} source={source} />;
}
