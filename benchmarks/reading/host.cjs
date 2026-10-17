// Dedicated benchmark IPC: acknowledgments never serialize the Markdown buffer.
// The functional acceptance host intentionally returns full snapshots; doing so
// during open/layout/configure would contaminate large-file latency measurements.
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const vscode = require('vscode');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function writeJson(file, data) {
  await fs.writeFile(`${file}.tmp`, JSON.stringify(data));
  await fs.rename(`${file}.tmp`, file);
}
exports.run = async function run() {
  const ipc = process.env.LIMR_TEST_IPC;
  assert.ok(ipc && process.env.LIMR_TEST_DOCUMENT, 'Benchmark IPC and copied fixture are required.');
  const uri = vscode.Uri.file(process.env.LIMR_TEST_DOCUMENT);
  const document = await vscode.workspace.openTextDocument(uri);
  const sourceLength = () => document.offsetAt(document.lineAt(document.lineCount - 1).range.end);
  const extension = vscode.extensions.getExtension('linloir.limr-vscode');
  assert.ok(extension, 'The frozen development extension must be loaded.');
  await vscode.window.showTextDocument(document, { viewColumn: vscode.ViewColumn.One });
  const activated = Date.now();
  while (!extension.isActive && Date.now() - activated < 10_000) await delay(25);
  assert.ok(extension.isActive, 'Opening Markdown source must activate LiMR.');
  const commands = await vscode.commands.getCommands(true);
  assert.ok(commands.includes('limr.openPreviewToSide'));
  // New VS Code versions open an auxiliary Chat pane in fresh profiles. Close
  // workbench chrome before timing so the reader gets the specified wide case.
  for (const command of ['workbench.action.closeSidebar', 'workbench.action.closeAuxiliaryBar', 'workbench.action.closePanel']) {
    assert.ok(commands.includes(command), `Workbench preparation command is unavailable: ${command}`);
    await vscode.commands.executeCommand(command);
  }
  const metadata = () => ({ version: document.version, isDirty: document.isDirty });
  const workbenchLayout = async () => {
    const startedAt = Date.now();
    const layout = await vscode.commands.executeCommand('vscode.getEditorLayout');
    const tab = value => {
      if (!value) return null;
      const input = value.input;
      const identity = input instanceof vscode.TabInputText ? { kind: 'text', uri: input.uri.toString() }
        : input instanceof vscode.TabInputCustom ? { kind: 'custom', uri: input.uri.toString(), viewType: input.viewType }
        : input instanceof vscode.TabInputWebview ? { kind: 'webview', viewType: input.viewType }
        : { kind: 'other' };
      return { ...identity, label: value.label, active: value.isActive };
    };
    return { startedAt, at: Date.now(), sourceURI: uri.toString(), readerViewType: 'limr.reader', layout,
      groups: vscode.window.tabGroups.all.map(group => ({ viewColumn: group.viewColumn, active: group.isActive,
        activeTab: tab(group.activeTab), tabs: group.tabs.map(tab) })),
      visibleEditors: vscode.window.visibleTextEditors.map(editor => ({ uri: editor.document.uri.toString(), viewColumn: editor.viewColumn })) };
  };
  const positionEvents = [];
  const positions = () => vscode.window.visibleTextEditors.filter(editor => editor.document.uri.toString() === uri.toString()).map(editor => ({
    viewColumn: editor.viewColumn, active: editor === vscode.window.activeTextEditor,
    selection: { start: document.offsetAt(editor.selection.start), end: document.offsetAt(editor.selection.end) },
    visible: editor.visibleRanges.map(range => ({ start: document.offsetAt(range.start), end: document.offsetAt(range.end) })),
  }));
  const positionListener = vscode.window.onDidChangeTextEditorVisibleRanges(event => {
    if (event.textEditor.document.uri.toString() !== uri.toString()) return;
    positionEvents.push({ at: Date.now(), visible: event.visibleRanges.map(range => ({ start: document.offsetAt(range.start), end: document.offsetAt(range.end) })) });
    if (positionEvents.length > 2000) positionEvents.shift();
  });
  const reveal = async command => {
    const offset = Math.max(0, Math.min(sourceLength() - 1, Number.isFinite(command.offset) ? command.offset : Math.floor(sourceLength() * command.ratio)));
    assert.ok(Number.isSafeInteger(offset), 'A finite source offset/ratio is required.');
    const editor = await vscode.window.showTextDocument(document, { viewColumn: vscode.ViewColumn.One, preserveFocus: false });
    const position = document.positionAt(offset);
    editor.selection = new vscode.Selection(position, position);
    editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.AtTop);
    return { at: Date.now(), offset, line: position.line, chars: sourceLength(), positions: positions() };
  };
  await writeJson(path.join(ipc, 'ready.json'), { version: vscode.version, platform: process.platform, remoteName: vscode.env.remoteName,
    trusted: vscode.workspace.isTrusted, sourceOnly: true, automaticallyActivated: extension.isActive, lightweightIPC: true,
    workbenchPanels: 'closed before timing', language: document.languageId });
  const started = Date.now();
  while (Date.now() - started < 600_000) {
    let command;
    try { command = JSON.parse(await fs.readFile(path.join(ipc, 'request.json'), 'utf8')); }
    catch (error) { if (error.code !== 'ENOENT') throw error; await delay(40); continue; }
    await fs.unlink(path.join(ipc, 'request.json'));
    let result, error;
    try {
      switch (command.action) {
        case 'openReader':
          await vscode.commands.executeCommand('limr.openPreviewToSide', uri);
          result = command.initialRevealRatio === undefined ? metadata() : { ...metadata(), initialReveal: await reveal({ ratio: command.initialRevealRatio }) }; break;
        case 'layout':
          assert.ok(command.sourceSize > 0 && command.sourceSize < 1);
          await vscode.commands.executeCommand('vscode.setEditorLayout', { orientation: 0, groups: [{ size: command.sourceSize }, { size: 1 - command.sourceSize }] });
          result = metadata(); break;
        case 'configure':
          for (const [key, value] of Object.entries(command.values)) await vscode.workspace.getConfiguration('limr', uri).update(key, value, vscode.ConfigurationTarget.Workspace);
          result = metadata(); break;
        case 'readConfiguration':
          result = Object.fromEntries(command.keys.map(key => [key, vscode.workspace.getConfiguration('limr', uri).get(key)])); break;
        case 'revealOffset': result = await reveal(command); break;
        case 'readWorkbenchLayout': result = await workbenchLayout(); break;
        case 'readPosition': result = { at: Date.now(), positions: positions(), events: positionEvents.filter(event => event.at >= (command.since ?? 0)) }; break;
        case 'readSourceRange': {
          const { start, end } = command;
          assert.ok(Number.isSafeInteger(start) && Number.isSafeInteger(end) && start >= 0 && end >= start && end <= sourceLength() && end - start <= 8192);
          result = { start, end, text: document.getText(new vscode.Range(document.positionAt(start), document.positionAt(end))) }; break;
        }
        case 'snapshot': {
          // This integrity check happens after all measured interactions.
          const source = document.getText();
          result = { ...metadata(), chars: source.length, sourceSHA256: createHash('sha256').update(source).digest('hex') }; break;
        }
        case 'finish': result = metadata(); break;
        default: throw new Error(`Unsupported benchmark action: ${command.action}`);
      }
    } catch (failure) { error = failure.stack ?? String(failure); }
    await writeJson(path.join(ipc, `response-${command.id}.json`), { result, error });
    if (command.action === 'finish') { positionListener.dispose(); return; }
  }
  throw new Error('Benchmark host exceeded its ten-minute case deadline.');
};
