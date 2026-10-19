const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const vscode = require('vscode');

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function writeJson(file, data) {
  const temporary = `${file}.tmp`;
  await fs.writeFile(temporary, JSON.stringify(data));
  await fs.rename(temporary, file);
}

exports.run = async function run() {
  const directory = process.env.LIMR_TEST_IPC;
  assert.ok(directory, 'The acceptance runner must provide an IPC directory.');
  const uri = vscode.Uri.file(process.env.LIMR_TEST_DOCUMENT);
  const document = await vscode.workspace.openTextDocument(uri);
  const extension = vscode.extensions.getExtension('linloir.limr-vscode');
  assert.ok(extension, 'LiMR extension is installed in the development host.');
  const sourceOnly = process.env.LIMR_TEST_SOURCE_ONLY === '1';
  if (!sourceOnly) await extension.activate();
  if (process.env.LIMR_TEST_THEME) await vscode.workspace.getConfiguration('workbench').update('colorTheme', process.env.LIMR_TEST_THEME, vscode.ConfigurationTarget.Global);
  await vscode.window.showTextDocument(document, { viewColumn: vscode.ViewColumn.One });
  if (sourceOnly) {
    const activationStarted = Date.now();
    while (!extension.isActive && Date.now() - activationStarted < 10_000) await delay(25);
    assert.ok(extension.isActive, 'Opening Markdown source alone automatically activates LiMR.');
  }
  const commands = await vscode.commands.getCommands(true);
  for (const id of ['limr.openPreview', 'limr.openPreviewToSide', 'limr.openSource', 'limr.chooseTheme', 'limr.toggleEditing', 'limr.openSkillGuide', 'limr.installSkill']) {
    assert.ok(commands.includes(id), `${id} must be registered.`);
  }
  if (!sourceOnly) await vscode.commands.executeCommand('limr.openPreviewToSide', uri);
  for (const id of ['workbench.action.closeAuxiliaryBar', 'workbench.action.closeSidebar']) {
    if (commands.includes(id)) await vscode.commands.executeCommand(id);
  }
  if (!sourceOnly) {
    assert.ok(vscode.window.tabGroups.all.length >= 2, 'Source and reader are open in separate editor groups.');
    assert.ok(vscode.window.tabGroups.all.some(group => group.tabs.some(tab => tab.input instanceof vscode.TabInputCustom && tab.input.viewType === 'limr.reader')));
  }
  await writeJson(path.join(directory, 'ready.json'), { appName: vscode.env.appName, version: vscode.version, platform: process.platform, remoteName: vscode.env.remoteName, trusted: vscode.workspace.isTrusted, groups: vscode.window.tabGroups.all.length, theme: vscode.workspace.getConfiguration('workbench').get('colorTheme'), themeInstalled: !!vscode.extensions.getExtension('zhuangtongfa.material-theme'), sourceOnly, language: document.languageId, automaticallyActivated: sourceOnly && extension.isActive });

  const snapshot = () => ({
    source: document.getText(), version: document.version, isDirty: document.isDirty,
    editingEnabled: vscode.workspace.getConfiguration('limr', uri).get('editingEnabled'),
    activeCustom: vscode.window.tabGroups.activeTabGroup.activeTab?.input instanceof vscode.TabInputCustom ? vscode.window.tabGroups.activeTabGroup.activeTab.input.viewType : undefined,
    visibleRanges: vscode.window.visibleTextEditors.filter(editor => editor.document.uri.toString() === uri.toString()).flatMap(editor => editor.visibleRanges.map(range => ({ start: range.start.line, end: range.end.line }))),
    activeEditor: vscode.window.activeTextEditor && { uri: vscode.window.activeTextEditor.document.uri.toString(), language: vscode.window.activeTextEditor.document.languageId, line: vscode.window.activeTextEditor.selection.active.line },
    groups: vscode.window.tabGroups.all.map(group => ({ viewColumn: group.viewColumn, active: group.isActive, tabs: group.tabs.map(tab => ({ label: tab.label, active: tab.isActive, preview: tab.isPreview, dirty: tab.isDirty, uri: tab.input?.uri?.toString(), custom: tab.input instanceof vscode.TabInputCustom ? tab.input.viewType : undefined, webview: tab.input instanceof vscode.TabInputWebview ? tab.input.viewType : undefined })) })),
  });
  let scrollSeries;
  const scrollEvents = [];
  const recordScroll = vscode.window.onDidChangeTextEditorVisibleRanges(event => {
    if (event.textEditor.document.uri.toString() === uri.toString() && event.visibleRanges.length) {
      const position = event.visibleRanges[0].start;
      scrollEvents.push({ time: Date.now(), line: position.line, character: position.character, offset: document.offsetAt(position) });
      if (scrollEvents.length > 2000) scrollEvents.shift();
    }
  });
  const started = Date.now();
  while (Date.now() - started < 600_000) {
    try {
      const commandFile = path.join(directory, 'request.json');
      const command = JSON.parse(await fs.readFile(commandFile, 'utf8'));
      await fs.unlink(commandFile);
      let result;
      try {
        switch (command.action) {
          case 'snapshot': result = snapshot(); break;
          case 'extensionInfo': {
            const addon = vscode.extensions.getExtension(command.extensionId);
            result = addon ? { id: addon.id, active: addon.isActive, extensionUri: addon.extensionUri.toString(), dependencies: addon.packageJSON.extensionDependencies } : undefined;
            break;
          }
          case 'configure':
            for (const [key, value] of Object.entries(command.values)) await vscode.workspace.getConfiguration('limr', uri).update(key, value, vscode.ConfigurationTarget.Workspace);
            result = snapshot(); break;
          case 'readConfiguration':
            result = Object.fromEntries(command.keys.map(key => [key, vscode.workspace.getConfiguration('limr', uri).get(key)])); break;
          case 'readWorkspaceFiles': {
            const workspace = path.dirname(uri.fsPath);
            result = {};
            for (const relative of command.paths) {
              const file = path.resolve(workspace, relative);
              assert.ok(file.startsWith(workspace + path.sep), 'Fixture reads must stay inside the disposable workspace.');
              result[relative] = await fs.readFile(file, 'utf8');
            }
            break;
          }
          case 'writeFiles': {
            const workspace = path.dirname(uri.fsPath);
            for (const [relative, content] of Object.entries(command.files)) {
              const destination = path.resolve(workspace, relative);
              assert.ok(destination.startsWith(workspace + path.sep), 'Fixture writes must stay inside the disposable workspace.');
              await fs.mkdir(path.dirname(destination), { recursive: true });
              await fs.writeFile(destination, command.encoding === 'base64' ? Buffer.from(content, 'base64') : content, 'utf8');
            }
            result = snapshot(); break;
          }
          case 'configureWorkbench':
            for (const [key, value] of Object.entries(command.values)) await vscode.workspace.getConfiguration('workbench').update(key, value, vscode.ConfigurationTarget.Global);
            result = snapshot(); break;
          case 'configureEditor':
            for (const [key, value] of Object.entries(command.values)) await vscode.workspace.getConfiguration('editor', document).update(key, value, vscode.ConfigurationTarget.Workspace);
            result = snapshot(); break;
          case 'command': {
            const execution = vscode.commands.executeCommand(command.command, ...(command.args ?? [uri]));
            if (command.wait === false) { execution.then(undefined, error => console.error(error)); result = { started: true }; }
            else { await execution; result = snapshot(); }
            break;
          }
          case 'editBurst': {
            for (let i = 0; i < command.count; i++) {
              const edit = new vscode.WorkspaceEdit();
              edit.insert(uri, document.positionAt(command.start), command.text);
              assert.equal(await vscode.workspace.applyEdit(edit), true);
              await delay(command.interval ?? 20);
            }
            result = { version: document.version }; break;
          }
          case 'editSource': {
            const edit = new vscode.WorkspaceEdit();
            edit.replace(uri, new vscode.Range(document.positionAt(command.start), document.positionAt(command.end ?? command.start)), command.text);
            assert.equal(await vscode.workspace.applyEdit(edit), true);
            result = snapshot(); break;
          }
          case 'replaceSource': {
            const edit = new vscode.WorkspaceEdit();
            edit.replace(uri, new vscode.Range(document.positionAt(0), document.positionAt(document.getText().length)), command.source);
            assert.equal(await vscode.workspace.applyEdit(edit), true);
            result = snapshot(); break;
          }
          case 'replaceGeneratedSource': {
            assert.ok(Number.isSafeInteger(command.bytes) && command.bytes <= 76 * 1024 * 1024);
            const source = '中'.repeat(Math.floor(command.bytes / 3)) + 'a'.repeat(command.bytes % 3);
            const edit = new vscode.WorkspaceEdit();
            edit.replace(uri, new vscode.Range(document.positionAt(0), document.positionAt(document.getText().length)), source);
            assert.equal(await vscode.workspace.applyEdit(edit), true);
            result = { version: document.version, chars: document.getText().length, bytes: Buffer.byteLength(document.getText()) }; break;
          }
          case 'undo':
          case 'redo':
            await vscode.window.showTextDocument(document, { viewColumn: vscode.ViewColumn.One });
            await vscode.commands.executeCommand(command.action);
            result = snapshot(); break;
          case 'save': await document.save(); result = snapshot(); break;
          case 'clipboard': result = await vscode.env.clipboard.readText(); break;
          case 'openReader': await vscode.commands.executeCommand('limr.openPreviewToSide', uri); result = snapshot(); break;
          case 'openUntitledSource': {
            const scratch = await vscode.workspace.openTextDocument({ content: command.source, language: command.language ?? 'markdown' });
            await vscode.window.showTextDocument(scratch, { viewColumn: vscode.ViewColumn.Two, preview: false });
            result = { ...snapshot(), scratch: { uri: scratch.uri.toString(), language: scratch.languageId, source: scratch.getText() } }; break;
          }
          case 'activateSource': await vscode.window.showTextDocument(document, { viewColumn: vscode.ViewColumn.One, preview: false }); result = snapshot(); break;
          case 'openRelativeSource': {
            const folder = vscode.workspace.getWorkspaceFolder(uri)?.uri ?? vscode.Uri.file(path.dirname(uri.fsPath));
            const target = vscode.Uri.joinPath(folder, command.relative);
            assert.ok(target.fsPath.startsWith(folder.fsPath + path.sep), 'Source fixtures must stay inside the disposable workspace.');
            let doc = await vscode.workspace.openTextDocument(target);
            if (command.language) doc = await vscode.languages.setTextDocumentLanguage(doc, command.language);
            await vscode.window.showTextDocument(doc, { viewColumn: command.viewColumn ?? vscode.ViewColumn.One, preview: command.preview ?? false });
            result = snapshot(); break;
          }
          case 'openRelativeDefault': {
            const folder = vscode.workspace.getWorkspaceFolder(uri)?.uri ?? vscode.Uri.file(path.dirname(uri.fsPath));
            const target = vscode.Uri.joinPath(folder, command.relative);
            assert.ok(target.fsPath.startsWith(folder.fsPath + path.sep), 'Open fixtures must stay inside the disposable workspace.');
            for (let index = 0; index < (command.repeat ?? 1); index++)
              await vscode.commands.executeCommand('vscode.open', target, { viewColumn: command.viewColumn ?? vscode.ViewColumn.Active, preview: command.preview ?? true });
            result = snapshot(); break;
          }
          case 'openRelativeReader': {
            const folder = vscode.workspace.getWorkspaceFolder(uri)?.uri ?? vscode.Uri.file(path.dirname(uri.fsPath));
            const target = vscode.Uri.joinPath(folder, command.relative);
            assert.ok(target.fsPath.startsWith(folder.fsPath + path.sep), 'Reader fixtures must stay inside the disposable workspace.');
            await vscode.commands.executeCommand('vscode.openWith', target, 'limr.reader', { viewColumn: command.viewColumn ?? vscode.ViewColumn.Two, preview: false });
            result = snapshot(); break;
          }
          case 'reopenReader': {
            const readers = vscode.window.tabGroups.all.flatMap(group => group.tabs).filter(tab => tab.input instanceof vscode.TabInputCustom && tab.input.viewType === 'limr.reader');
            if (readers.length) await vscode.window.tabGroups.close(readers, true);
            await vscode.commands.executeCommand('vscode.openWith', uri, 'limr.reader', { viewColumn: vscode.ViewColumn.Two, preview: false });
            result = snapshot(); break;
          }
          case 'tabCycle': {
            const scratch = await vscode.workspace.openTextDocument({ content: '# Isolated acceptance tab\n', language: 'markdown' });
            await vscode.window.showTextDocument(scratch, { viewColumn: vscode.ViewColumn.Two, preview: false });
            await delay(150);
            await vscode.commands.executeCommand('vscode.openWith', uri, 'limr.reader', { viewColumn: vscode.ViewColumn.Two, preview: false });
            const scratchTab = vscode.window.tabGroups.all.flatMap(group => group.tabs).find(tab => tab.input instanceof vscode.TabInputText && tab.input.uri.toString() === scratch.uri.toString());
            if (scratchTab) await vscode.window.tabGroups.close(scratchTab, true);
            result = snapshot(); break;
          }
          case 'layout': await vscode.commands.executeCommand('vscode.setEditorLayout', { orientation: 0, groups: [{ size: command.sourceSize * (command.totalSize ?? 1) }, { size: (1 - command.sourceSize) * (command.totalSize ?? 1) }] }); result = snapshot(); break;
          case 'scrollSource': {
            const editor = vscode.window.visibleTextEditors.find(editor => editor.document.uri.toString() === uri.toString());
            assert.ok(editor, 'The Markdown source must be visible.');
            const position = new vscode.Position(command.line, command.character ?? 0);
            editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.AtTop);
            result = snapshot(); break;
          }
          case 'scrollSourceLines': {
            await vscode.window.showTextDocument(document, { viewColumn: vscode.ViewColumn.One, preview: false });
            await vscode.commands.executeCommand('editorScroll', { to: command.lines < 0 ? 'up' : 'down', by: 'line', value: Math.abs(command.lines), revealCursor: false });
            result = snapshot(); break;
          }
          case 'scrollSourceSeries': {
            const editor = await vscode.window.showTextDocument(document, { viewColumn: vscode.ViewColumn.One, preview: false });
            if (scrollSeries?.timer) clearInterval(scrollSeries.timer);
            scrollEvents.length = 0;
            scrollSeries = { started: Date.now(), completed: undefined, steps: 0, line: command.start, timer: undefined };
            scrollSeries.timer = setInterval(() => {
              scrollSeries.line = command.start + scrollSeries.steps * command.step;
              const position = new vscode.Position(scrollSeries.line, 0);
              editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.AtTop);
              if (++scrollSeries.steps >= command.count) {
                clearInterval(scrollSeries.timer); scrollSeries.timer = undefined; scrollSeries.completed = Date.now();
              }
            }, command.interval ?? 16);
            result = { started: scrollSeries.started }; break;
          }
          case 'scrollSourceStatus': result = { ...snapshot(), scroll: scrollSeries ? { started: scrollSeries.started, completed: scrollSeries.completed, steps: scrollSeries.steps, line: scrollSeries.line } : undefined, events: scrollEvents }; break;
          case 'finish': if (scrollSeries?.timer) clearInterval(scrollSeries.timer); recordScroll.dispose(); await writeJson(path.join(directory, `response-${command.id}.json`), { result: snapshot() }); return;
          default: throw new Error(`Unknown acceptance action: ${command.action}`);
        }
        await writeJson(path.join(directory, `response-${command.id}.json`), { result });
      } catch (error) {
        await writeJson(path.join(directory, `response-${command.id}.json`), { error: String(error?.stack ?? error) });
      }
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    await delay(30);
  }
  throw new Error('The browser acceptance driver did not finish within ten minutes.');
};
