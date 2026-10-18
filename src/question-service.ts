import * as vscode from 'vscode';
import { createServer, type Server, type Socket } from 'node:net';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes, createHash } from 'node:crypto';
import { buildAIContext, type AIContextInput } from './shared/ai-context';
import { planQuestionWriteback, type QuestionAnswer } from './question-writeback';
import { readerSettings } from './settings';
import { MAX_DOCUMENT_BYTES } from './shared/load-limits';

const hash = (source: string) => createHash('sha256').update(source).digest('hex');
interface Ticket {
  document: vscode.TextDocument; version: number; hash: string; expires: number; path: string;
  input: AIContextInput;
  result?: { fingerprint: string; value: Record<string, unknown> };
  running?: Promise<Record<string, unknown>>;
}

/** A local, one-selection capability. It expires with this extension session;
 * no TCP listener, shell commands, arbitrary file names or automatic relocation. */
export class QuestionService implements vscode.Disposable {
  private server?: Server;
  private directory?: string;
  private endpoint?: string;
  private starting?: Promise<void>;
  private disposed = false;
  private readonly tickets = new Map<string, Ticket>();
  private readonly sockets = new Set<Socket>();
  constructor(private readonly context: vscode.ExtensionContext) {}
  dispose() {
    this.disposed = true; for (const socket of this.sockets) socket.destroy(); this.server?.close();
    this.tickets.clear(); if (this.directory) void rm(this.directory, { recursive: true, force: true });
  }
  private async start() {
    this.starting ??= (async () => {
      this.directory = await mkdtemp(join(tmpdir(), 'limr-question-'));
      this.endpoint = process.platform === 'win32' ? `\\\\.\\pipe\\limr-question-${randomBytes(16).toString('hex')}` : join(this.directory, 'host.sock');
      this.server = createServer(socket => {
        this.sockets.add(socket); socket.on('close', () => this.sockets.delete(socket));
        socket.setEncoding('utf8'); socket.setTimeout(15000, () => socket.destroy());
        let buffer = '', submitted = false;
        socket.on('error', () => {});
        socket.on('data', chunk => {
          if (submitted) return;
          buffer += chunk;
          if (Buffer.byteLength(buffer) > 1024 * 1024) { socket.destroy(); return; }
          if (!buffer.includes('\n')) return;
          submitted = true;
          void (async () => {
            try {
              const request = JSON.parse(buffer.slice(0, buffer.indexOf('\n')));
              const value = await this.submit(request.token, request.input);
              socket.end(JSON.stringify(value) + '\n');
            } catch (error) { socket.end(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }) + '\n'); }
          })();
        });
      });
      await new Promise<void>((resolve, reject) => { this.server!.once('error', reject); this.server!.listen(this.endpoint!, resolve); });
      if (this.disposed) this.dispose();
    })();
    await this.starting;
  }
  async prepare(document: vscode.TextDocument, supplied: Pick<AIContextInput, 'ranges' | 'selectedText' | 'rangeIds' | 'annotationIds' | 'peers'>, version: number) {
    if (document.isClosed || version !== document.version) throw new Error('Markdown changed. Copy the selection context again.');
    const source = document.getText(), settings = readerSettings(document.uri);
    const input: AIContextInput = { ...supplied, source, uri: document.uri.toString(), fsPath: document.uri.fsPath,
      relativePath: vscode.workspace.asRelativePath(document.uri, false), version, allowSourceEdits: settings.editingEnabled && vscode.workspace.isTrusted,
      language: settings.locale, skillPath: vscode.Uri.joinPath(this.context.extensionUri, 'skills', 'limr-annotations', 'SKILL.md').fsPath };
    buildAIContext(input); // Validate every offset before allocating a capability.
    if (input.allowSourceEdits) {
      await this.start();
      const token = randomBytes(24).toString('hex'), path = join(this.directory!, `${token}.json`), expires = Date.now() + 24 * 60 * 60 * 1000;
      const ticket: Ticket = { document, version, hash: hash(source), expires, path, input: { ...input, source: '' } };
      await writeFile(path, JSON.stringify({ format: 'limr-writeback-v1', token, endpoint: this.endpoint, expires, allowSourceEdits: true,
        file: document.uri.fsPath, version, selections: supplied.ranges.map(range => ({ ...range, raw: source.slice(range.start, range.end) })), peers: supplied.peers }), { mode: 0o600 });
      this.tickets.set(token, ticket);
      while (this.tickets.size > 64) {
        const oldest = this.tickets.keys().next().value!;
        void rm(this.tickets.get(oldest)!.path, { force: true }); this.tickets.delete(oldest);
      }
      input.writeback = { context: path, script: vscode.Uri.joinPath(this.context.extensionUri, 'skills', 'limr-annotations', 'scripts', 'write-question.cjs').fsPath };
    }
    return buildAIContext(input);
  }
  private async submit(token: unknown, input: QuestionAnswer): Promise<Record<string, unknown>> {
    const ticket = typeof token === 'string' ? this.tickets.get(token) : undefined;
    if (!ticket || ticket.expires < Date.now()) throw new Error('This context expired. Copy a new question context.');
    if (!input || typeof input !== 'object') throw new Error('Supply the question and answer as JSON.');
    const fingerprint = hash(JSON.stringify(input));
    if (ticket.running) await ticket.running;
    if (ticket.result) {
      if (ticket.result.fingerprint !== fingerprint) throw new Error('This context was already used for another answer. Copy a new context.');
      return ticket.result.value;
    }
    ticket.running = this.apply(ticket, input).then(value => { ticket.result = { fingerprint, value }; return value; });
    try { return await ticket.running; } finally { ticket.running = undefined; }
  }
  private async apply(ticket: Ticket, input: QuestionAnswer) {
    const document = ticket.document;
    if (!vscode.workspace.isTrusted || !readerSettings(document.uri).editingEnabled) throw new Error('Markdown editing is disabled. No changes were applied.');
    if (document.isClosed || document.version !== ticket.version || hash(document.getText()) !== ticket.hash)
      throw new Error('Markdown changed since this context was copied. Relocate the selection in the current document.');
    const source = document.getText(), wasDirty = document.isDirty;
    const plan = planQuestionWriteback(source, document.uri.toString(), ticket.input.ranges.map(range => ({ ...range, raw: source.slice(range.start, range.end) })), input, ticket.input.language ?? 'en');
    if (Buffer.byteLength(plan.source) > MAX_DOCUMENT_BYTES) throw new Error('The resulting document exceeds the reader size limit.');
    const edit = new vscode.WorkspaceEdit();
    for (const change of plan.edits) edit.replace(document.uri, new vscode.Range(document.positionAt(change.range.start), document.positionAt(change.range.end)), change.text);
    if (!await vscode.workspace.applyEdit(edit)) throw new Error('VS Code rejected the edit. No completion is claimed.');
    // The in-flight promise serializes retries through save; its cached result
    // then prevents a lost reply from appending the same question again.
    const value: Record<string, unknown> = { ok: true, file: document.uri.fsPath, annotationId: plan.annotationId, rangeIds: plan.rangeIds, saved: false };
    if (!wasDirty && document.getText() === plan.source) {
      try { value.saved = await document.save(); } catch { /* Applied to the editor; the user can save it. */ }
    }
    return value;
  }
}
