import type { HostMessage, ReaderState } from '../src/shared/protocol';

/** A configuration acknowledgement cannot advance or roll back source text. */
export function applyReaderConfiguration(current: ReaderState | null, message: Extract<HostMessage, { type: 'configuration' }>): ReaderState | null {
  if (!current || current.document.uri !== message.document.uri) return current;
  return {
    ...message.configuration,
    loadError: current.loadError,
    document: current.document.version === message.document.version
      ? { ...message.document, source: current.document.source }
      : current.document,
  };
}
