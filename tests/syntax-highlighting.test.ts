import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as vscode from 'vscode';
import type { SyntaxToken } from '../src/syntax-tokens';

const state = vi.hoisted(() => ({
  enabled: true,
  editors: [] as vscode.TextEditor[],
  events: new Map<string, (event: any) => void>(),
  workers: [] as { posted: any[]; listeners: Map<string, (...args: any[]) => void>; terminate: ReturnType<typeof vi.fn> }[],
}));
vi.mock('vscode', () => {
  const event = (name: string) => (callback: (event: any) => void) => {
    state.events.set(name, callback); return { dispose: () => state.events.delete(name) };
  };
  return {
    ThemeColor: class { constructor(public id: string) {} },
    Position: class { constructor(public line: number, public character: number) {} },
    Range: class { constructor(public start: vscode.Position, public end: vscode.Position) {} },
    DecorationRangeBehavior: { ClosedClosed: 1 },
    window: {
      get visibleTextEditors() { return state.editors; },
      createTextEditorDecorationType: (options: unknown) => ({ options, dispose: vi.fn() }),
      onDidChangeVisibleTextEditors: event('visible'),
      onDidChangeTextEditorVisibleRanges: event('scroll'),
    },
    workspace: {
      getConfiguration: () => ({ get: () => state.enabled }),
      onDidOpenTextDocument: event('open'), onDidCloseTextDocument: event('close'),
      onDidChangeTextDocument: event('change'), onDidChangeConfiguration: event('config'),
    },
  };
});
vi.mock('node:worker_threads', () => ({ Worker: class {
  posted: any[] = [];
  listeners = new Map<string, (...args: any[]) => void>();
  terminate = vi.fn();
  constructor() { state.workers.push(this); }
  on(event: string, callback: (...args: any[]) => void) { this.listeners.set(event, callback); return this; }
  postMessage(request: any) { this.posted.push(request); }
} }));
import { SourceSyntaxHighlighting, visibleSyntaxTokens } from '../src/syntax-highlighting';

function document(uri = 'file:///fixture.md', source = '<callout />') {
  return {
    uri: { toString: () => uri }, version: 1, languageId: 'markdown', isClosed: false, lineCount: 1000,
    getText: vi.fn(() => source),
    offsetAt: ({ line, character }: vscode.Position) => line * 100 + character,
    positionAt: (offset: number) => ({ line: Math.floor(offset / 100), character: offset % 100 }),
  } as unknown as vscode.TextDocument;
}
function editor(doc: vscode.TextDocument) {
  const colors = new Map<string, vscode.Range[]>();
  return {
    document: doc, visibleRanges: [{ start: { line: 0 }, end: { line: 10 } }], colors,
    setDecorations: vi.fn((decoration: { options: { color: { id: string } } }, ranges: vscode.Range[]) => colors.set(decoration.options.color.id, ranges)),
  } as unknown as vscode.TextEditor & { colors: Map<string, vscode.Range[]> };
}
const spans: SyntaxToken[] = [{ start: 1, end: 8, kind: 'tag' }];
const painted = (view: ReturnType<typeof editor>) => view.colors.get('limr.syntax.tag')?.length ?? 0;
function reply(tokens = spans, request = state.workers[0].posted.at(-1)) {
  state.workers[0].listeners.get('message')!({ uri: request.uri, version: request.version, tokens });
}

describe('source editor decoration lifecycle', () => {
  let service: SourceSyntaxHighlighting | undefined;
  beforeEach(() => { vi.useFakeTimers(); state.enabled = true; state.editors = []; state.events.clear(); state.workers = []; });
  afterEach(() => { service?.dispose(); service = undefined; vi.useRealTimers(); });
  const start = () => { service = new SourceSyntaxHighlighting('/test/syntax-worker.cjs'); vi.runOnlyPendingTimers(); };
  const toggle = (enabled: boolean) => { state.enabled = enabled; state.events.get('config')!({ affectsConfiguration: () => true }); };

  it('keeps scrolling on cached visible tokens without reading or reparsing source', () => {
    const doc = document(), view = editor(doc); state.editors = [view]; start(); reply();
    expect(painted(view)).toBe(1);
    for (let index = 0; index < 100; index++) state.events.get('scroll')!({ textEditor: view });
    expect(doc.getText).toHaveBeenCalledTimes(1);
    expect(state.workers[0].posted).toHaveLength(1);
    Object.assign(view, { visibleRanges: [{ start: { line: 100 }, end: { line: 110 } }] });
    state.events.get('scroll')!({ textEditor: view });
    expect(painted(view)).toBe(0);
  });
  it('immediately clears both split editors, cancels queued parsing, and ignores in-flight results when disabled', () => {
    const doc = document(), left = editor(doc), right = editor(doc); state.editors = [left, right]; start(); reply();
    expect([painted(left), painted(right)]).toEqual([1, 1]);
    const next = document('untitled:Untitled-1'); state.editors.push(editor(next)); state.events.get('visible')!([]);
    toggle(false); vi.advanceTimersByTime(150);
    expect([painted(left), painted(right)]).toEqual([0, 0]);
    expect(next.getText).not.toHaveBeenCalled();
    toggle(true); vi.advanceTimersByTime(150); toggle(false); reply();
    expect(state.editors.every(view => painted(view as ReturnType<typeof editor>) === 0)).toBe(true);
    expect(state.workers.flatMap(worker => worker.posted)).toHaveLength(2); // No disabled queued untitled parse.
    expect(state.workers.every(worker => worker.terminate.mock.calls.length === 1)).toBe(true);
  });
  it('debounces edits and discards results from an earlier document version', () => {
    const doc = document(), view = editor(doc); state.editors = [view]; start();
    const original = state.workers[0].posted[0];
    for (let version = 2; version <= 4; version++) {
      Object.assign(doc, { version }); state.events.get('change')!({ document: doc, contentChanges: [{}] });
    }
    vi.advanceTimersByTime(150); reply(spans, original);
    expect(painted(view)).toBe(0);
    expect(state.workers[0].posted.map(request => request.version)).toEqual([1, 4]);
    reply(); expect(painted(view)).toBe(1);
  });
  it('does not apply an old result to a reopened URI whose version starts over', () => {
    const old = document(), previous = editor(old); state.editors = [previous]; start();
    const original = state.workers[0].posted[0];
    Object.assign(old, { isClosed: true }); state.events.get('close')!(old);
    const replacement = document(), view = editor(replacement); state.editors = [view]; state.events.get('visible')!([]);
    vi.advanceTimersByTime(150); reply(spans, original);
    expect(painted(view)).toBe(0);
    expect(state.workers[0].terminate).toHaveBeenCalledOnce();
    const worker = state.workers.at(-1)!;
    worker.listeners.get('message')!({ ...worker.posted.at(-1), tokens: spans }); expect(painted(view)).toBe(1);
  });
  it('supports untitled and remote Markdown, then clears when the language changes', () => {
    for (const uri of ['untitled:Untitled-1', 'vscode-remote://wsl+Ubuntu/home/test.md']) {
      const doc = document(uri); state.editors.push(editor(doc));
    }
    start(); reply(); reply();
    expect(state.editors.map(view => painted(view as ReturnType<typeof editor>))).toEqual([1, 1]);
    Object.assign(state.editors[0].document, { languageId: 'plaintext' });
    state.events.get('open')!(state.editors[0].document);
    expect(painted(state.editors[0] as ReturnType<typeof editor>)).toBe(0);
  });
  it('does no scanning while disabled and disposes the worker and pending timers', () => {
    const doc = document(); state.editors = [editor(doc)]; state.enabled = false; start();
    expect(doc.getText).not.toHaveBeenCalled(); expect(state.workers).toHaveLength(0);
    toggle(true); vi.advanceTimersByTime(150); service!.dispose(); service = undefined;
    expect(state.workers[0].terminate).toHaveBeenCalledOnce(); expect(state.events.size).toBe(0);
    reply(); // A result racing shutdown is harmless.
  });
  it('skips supplementary parsing above 4 MiB characters without reading the buffer', () => {
    const doc = document(); Object.assign(doc, { lineCount: 50_000 });
    state.editors = [editor(doc)]; start();
    expect(doc.getText).not.toHaveBeenCalled(); expect(state.workers).toHaveLength(0);
  });
  it('terminates a hidden document worker and a worker exceeding 60 seconds', () => {
    const doc = document(); state.editors = [editor(doc)]; start();
    state.editors = []; state.events.get('visible')!([]);
    expect(state.workers[0].terminate).toHaveBeenCalledOnce();
    state.editors = [editor(doc)]; state.events.get('visible')!([]); vi.advanceTimersByTime(150);
    vi.advanceTimersByTime(60_000); expect(state.workers[1].terminate).toHaveBeenCalledOnce();
  });
  it('binary-searches large cached arrays and respects exact end boundaries', () => {
    const all: SyntaxToken[] = Array.from({ length: 100_000 }, (_, index) => ({ start: index * 10, end: index * 10 + 3, kind: 'tag' }));
    expect(visibleSyntaxTokens(all, 999_973, 999_991).map(token => token.start)).toEqual([999_980, 999_990]);
    expect(visibleSyntaxTokens(all, 1_000_000, 1_000_100)).toEqual([]);
  });
});
