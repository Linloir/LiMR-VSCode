import { Component, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Reader, createDocumentSession, hasDocumentSyntax, useLiMR, type DocumentEngine, type DocumentSessionState, type ReaderProps, type ReadingPosition, type AsyncReaderLoadControls } from '@linloir/limr';
import { createReaderWorker } from './reader-worker-port';

/** Map the retained reading anchor through one source replacement. The common
 * prefix/suffix cover ordinary typing without searching for duplicate prose. */
export function remapReadingPosition(position: ReadingPosition, before: string, after: string): ReadingPosition {
  if (before === after) return position;
  let start = 0, oldEnd = before.length, newEnd = after.length;
  while (start < oldEnd && start < newEnd && before[start] === after[start]) start++;
  while (oldEnd > start && newEnd > start && before[oldEnd - 1] === after[newEnd - 1]) { oldEnd--; newEnd--; }
  return { ...position, source: position.source <= start ? position.source : position.source >= oldEnd ? position.source + newEnd - oldEnd : start };
}
type Commands = ReturnType<typeof useLiMR>;
interface HandoffProps { document: DocumentEngine; children: ReactNode; commands: { current: Commands | null } }
class ReaderHandoff extends Component<HandoffProps> {
  getSnapshotBeforeUpdate(previous: HandoffProps) {
    if (previous.document === this.props.document || previous.document.id !== this.props.document.id) return null;
    const position = this.props.commands.current?.getReadingPosition();
    return position ? remapReadingPosition(position, previous.document.getSnapshot().source, this.props.document.getSnapshot().source) : null;
  }
  componentDidUpdate(_previous: HandoffProps, _state: unknown, position: ReadingPosition | null) {
    if (position) this.props.commands.current?.restoreReadingPosition(position);
  }
  render() { return this.props.children; }
}
function BindCommands({ target }: { target: { current: Commands | null } }) {
  const commands = useLiMR();
  useLayoutEffect(() => { target.current = commands; return () => { if (target.current === commands) target.current = null; }; }, [target, commands]);
  return null;
}

/** Host document refresh policy using LiMR's public loader and Reader. A fresh
 * source revision prepares offscreen in a worker; the last accepted Reader
 * stays mounted until a complete replacement can take over before paint. */
export function RetainedReader({ source, loadingMode, onLoadStateChange, ...props }: ReaderProps & {
  source: string; loadingMode: 'blocking' | 'progressive';
  onLoadStateChange(state: DocumentSessionState, controls: AsyncReaderLoadControls): void;
}) {
  const [accepted, setAccepted] = useState<{ document: DocumentEngine; complete: boolean }>();
  const last = useRef(accepted); last.current = accepted;
  const commands = useRef<Commands | null>(null);
  const [attempt, setAttempt] = useState(0);
  const observer = useRef(onLoadStateChange); observer.current = onLoadStateChange;
  const extensions = useMemo(() => [...props.extensions ?? [], ...props.plugins ?? []], [props.extensions, props.plugins]);
  const parsers = extensions.filter(hasDocumentSyntax), parserIdentity = useRef(parsers);
  if (parsers.length !== parserIdentity.current.length || parsers.some((item, index) => item !== parserIdentity.current[index])) parserIdentity.current = parsers;
  const previousParsers = useRef<readonly unknown[] | undefined>(undefined);
  useEffect(() => {
    // Reader-authored source changes already updated the displayed engine.
    if (last.current?.complete && last.current.document.getSnapshot().source === source && previousParsers.current === parserIdentity.current) return;
    previousParsers.current = parserIdentity.current;
    const session = createDocumentSession({ id: props.documentId, extensions, worker: createReaderWorker, fallback: 'error',
      mode: last.current?.complete ? 'blocking' : loadingMode });
    const controls = { cancel: session.cancel, retry: () => setAttempt(value => value + 1) };
    const receive = () => {
      const state = session.getSnapshot();
      if (state.document && (state.complete || !last.current?.complete)) {
        const next = { document: state.document, complete: state.complete };
        last.current = next; setAccepted(next);
      }
      observer.current(state, controls);
    };
    const unsubscribe = session.subscribe(receive);
    void session.load(source).catch(() => {});
    return () => { unsubscribe(); session.dispose(); };
  }, [source, props.documentId, parserIdentity.current, loadingMode, attempt]);
  if (!accepted) return <div className={`limr-reader ${props.className ?? ''}`} style={{ height: 0, visibility: 'hidden' }} aria-hidden="true" />;
  const current = accepted.complete && accepted.document.getSnapshot().source === source;
  return <ReaderHandoff document={accepted.document} commands={commands}>
    <Reader {...props} document={accepted.document} extensions={extensions} plugins={undefined}
      readOnly={!current || props.readOnly} provisional={!accepted.complete || props.provisional}
      onSourceChange={current ? props.onSourceChange : undefined} virtualization={props.virtualization ?? true}>
      <BindCommands target={commands} />{props.children}
    </Reader>
  </ReaderHandoff>;
}
