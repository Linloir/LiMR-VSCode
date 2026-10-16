import * as vscode from 'vscode';
import { Worker } from 'node:worker_threads';
import type { SyntaxKind, SyntaxToken } from './syntax-tokens';

const kinds: readonly SyntaxKind[] = ['punctuation', 'tag', 'attribute', 'value', 'annotation', 'highlight', 'math'];
interface HighlightResult { uri: string; version: number; tokens: SyntaxToken[]; error?: string }
interface HighlightRequest { uri: string; version: number; source: string }
interface PendingRequest extends HighlightRequest { document: vscode.TextDocument }
interface CachedResult extends HighlightResult { document: vscode.TextDocument }

/** Binary-search the cached token list; scrolling never invokes the parser. */
export function visibleSyntaxTokens(tokens: readonly SyntaxToken[], start: number, end: number): readonly SyntaxToken[] {
  let low = 0, high = tokens.length;
  while (low < high) { const middle = (low + high) >>> 1; if (tokens[middle].end <= start) low = middle + 1; else high = middle; }
  const result: SyntaxToken[] = [];
  for (let index = low; index < tokens.length && tokens[index].start < end; index++) result.push(tokens[index]);
  return result;
}

/** Color only recognized LiMR source tokens, alongside the native Markdown
 * grammar. Decorations do not compete for VS Code's single semantic provider. */
export class SourceSyntaxHighlighting implements vscode.Disposable {
  private readonly decorations = new Map(kinds.map(kind => [kind, vscode.window.createTextEditorDecorationType({
    color: new vscode.ThemeColor(`limr.syntax.${kind}`), rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed,
  })]));
  private readonly subscriptions: vscode.Disposable[] = [];
  private readonly cache = new Map<string, CachedResult>();
  private readonly queued = new Map<string, PendingRequest>();
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  private worker: Worker | undefined;
  private active: PendingRequest | undefined;
  private disposed = false;

  constructor(private readonly workerPath: string) {
    this.subscriptions.push(
      vscode.window.onDidChangeVisibleTextEditors(() => this.refreshVisible()),
      vscode.window.onDidChangeTextEditorVisibleRanges(event => this.paint(event.textEditor)),
      // VS Code emits close/open when the language of an existing buffer changes.
      vscode.workspace.onDidOpenTextDocument(() => this.refreshVisible()),
      vscode.workspace.onDidChangeTextDocument(event => {
        if (event.contentChanges.length && event.document.languageId === 'markdown') this.schedule(event.document);
      }),
      vscode.workspace.onDidCloseTextDocument(document => {
        const uri = document.uri.toString();
        clearTimeout(this.timers.get(uri)); this.timers.delete(uri); this.queued.delete(uri); this.cache.delete(uri);
        for (const editor of vscode.window.visibleTextEditors) if (editor.document === document) this.clear(editor);
      }),
      vscode.workspace.onDidChangeConfiguration(event => {
        if (event.affectsConfiguration('limr.syntaxHighlighting.enabled')) this.refreshVisible();
      }),
    );
    this.refreshVisible();
  }
  private enabled(document: vscode.TextDocument) {
    return document.languageId === 'markdown' && vscode.workspace.getConfiguration('limr', document).get<boolean>('syntaxHighlighting.enabled', true);
  }
  private clear(editor: vscode.TextEditor) { for (const decoration of this.decorations.values()) editor.setDecorations(decoration, []); }
  private refreshVisible() {
    const visible = new Set(vscode.window.visibleTextEditors.map(editor => editor.document.uri.toString()));
    // A reopened editor is scanned on demand; hidden documents do not retain
    // token arrays or pending source copies indefinitely.
    for (const uri of this.cache.keys()) if (!visible.has(uri)) this.cache.delete(uri);
    for (const uri of this.queued.keys()) if (!visible.has(uri)) this.queued.delete(uri);
    for (const editor of vscode.window.visibleTextEditors) {
      if (!this.enabled(editor.document)) {
        const uri = editor.document.uri.toString();
        clearTimeout(this.timers.get(uri)); this.timers.delete(uri); this.queued.delete(uri); this.cache.delete(uri);
        this.clear(editor);
      } else { this.paint(editor); this.schedule(editor.document, 0); }
    }
  }
  private schedule(document: vscode.TextDocument, delay = 120) {
    if (this.disposed || !this.enabled(document) || !vscode.window.visibleTextEditors.some(editor => editor.document === document)) return;
    const uri = document.uri.toString(), version = document.version;
    if (this.cache.get(uri)?.document === document && this.cache.get(uri)?.version === version
      || this.active?.document === document && this.active.version === version
      || this.queued.get(uri)?.document === document && this.queued.get(uri)?.version === version) return;
    clearTimeout(this.timers.get(uri));
    // Never leave stale colors on unrelated text while an asynchronous parse runs.
    for (const editor of vscode.window.visibleTextEditors) if (editor.document === document) this.clear(editor);
    this.timers.set(uri, setTimeout(() => {
      this.timers.delete(uri);
      if (document.isClosed || !this.enabled(document) || !vscode.window.visibleTextEditors.some(editor => editor.document === document)) return;
      this.queued.set(uri, { uri, version: document.version, source: document.getText(), document });
      this.dispatch();
    }, delay));
  }
  private dispatch() {
    if (this.disposed || this.active || !this.queued.size) return;
    if (!this.worker) {
      const worker = this.worker = new Worker(this.workerPath);
      worker.on('message', (result: HighlightResult) => {
        if (this.disposed || this.worker !== worker) return;
        const request = this.active;
        this.active = undefined;
        const editors = vscode.window.visibleTextEditors.filter(editor => editor.document === request?.document && !editor.document.isClosed
          && request.uri === result.uri && request.version === result.version
          && editor.document.version === result.version && this.enabled(editor.document));
        if (editors.length) {
          this.cache.set(result.uri, { ...result, document: editors[0].document });
          for (const editor of editors) this.paint(editor);
        }
        if (result.error) console.error('LiMR source highlighting:', result.error);
        this.dispatch();
      });
      const failed = (error: unknown) => {
        if (this.disposed || this.worker !== worker) return;
        this.worker = undefined; this.active = undefined;
        console.error('LiMR source highlighting worker:', error);
        // Do not restart a crashing worker in a loop; a subsequent document edit
        // or visibility change can retry without affecting the Markdown editor.
        this.queued.clear();
      };
      worker.on('error', failed);
      worker.on('exit', code => failed(new Error(`Worker exited with code ${code}`)));
    }
    const request = this.queued.values().next().value!;
    this.queued.delete(request.uri); this.active = request;
    this.worker.postMessage({ uri: request.uri, version: request.version, source: request.source });
  }
  private paint(editor: vscode.TextEditor) {
    if (this.disposed) return;
    if (!this.enabled(editor.document)) { this.clear(editor); return; }
    const cached = this.cache.get(editor.document.uri.toString());
    if (!cached || cached.document !== editor.document || cached.version !== editor.document.version) return;
    const groups = new Map(kinds.map(kind => [kind, [] as vscode.Range[]]));
    const seen = new Set<SyntaxToken>();
    for (const visible of editor.visibleRanges) {
      const from = editor.document.offsetAt(new vscode.Position(Math.max(0, visible.start.line - 12), 0));
      const until = editor.document.offsetAt(new vscode.Position(Math.min(editor.document.lineCount, visible.end.line + 13), 0));
      for (const token of visibleSyntaxTokens(cached.tokens, from, until)) if (!seen.has(token)) {
        seen.add(token);
        groups.get(token.kind)!.push(new vscode.Range(editor.document.positionAt(token.start), editor.document.positionAt(token.end)));
      }
    }
    for (const [kind, decoration] of this.decorations) editor.setDecorations(decoration, groups.get(kind)!);
  }
  dispose() {
    this.disposed = true;
    this.subscriptions.forEach(subscription => subscription.dispose());
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear(); this.queued.clear(); this.cache.clear();
    for (const decoration of this.decorations.values()) decoration.dispose();
    void this.worker?.terminate(); this.worker = undefined;
  }
}
