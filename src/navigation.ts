import * as vscode from 'vscode';

export const readerViewType = 'limr.reader';
export type MarkdownOpenMode = 'none' | 'reader' | 'sideBySide';
export type MarkdownLinkMode = 'currentReader' | 'besideReader' | 'besideEditor' | 'editorAndReader' | 'smart';
export interface ReaderLocation {
  uri: string;
  fragment?: string;
  line?: number;
  position?: { source: number; offset: number };
}
interface EditorLocation { uri: vscode.Uri; viewType: string; selection?: vscode.Range }
interface NavigationStep {
  from: ReaderLocation; to: ReaderLocation;
  companion?: { group: vscode.TabGroup; before?: EditorLocation; after: EditorLocation };
}
interface History { back: NavigationStep[]; forward: NavigationStep[] }
const markdown = (document: vscode.TextDocument) => /\.(md|markdown)$/i.test(document.uri.path)
  || /^(markdown|prompt|instructions|chatagent|skill)$/.test(document.languageId);
const isReader = (tab: vscode.Tab) => tab.input instanceof vscode.TabInputCustom && tab.input.viewType === readerViewType;
const uriOf = (tab?: vscode.Tab) => tab?.input instanceof vscode.TabInputText || tab?.input instanceof vscode.TabInputCustom ? tab.input.uri : undefined;
const sameUri = (a?: vscode.Uri, b?: vscode.Uri) => !!a && !!b && a.toString() === b.toString();

export function navigationSettings(uri: vscode.Uri) {
  const config = vscode.workspace.getConfiguration('limr', uri);
  const open = config.get<string>('markdownOpenMode', 'none');
  const link = config.get<string>('markdownLinkMode', 'smart');
  return {
    open: (['none', 'reader', 'sideBySide'].includes(open) ? open : 'none') as MarkdownOpenMode,
    link: (['currentReader', 'besideReader', 'besideEditor', 'editorAndReader', 'smart'].includes(link) ? link : 'smart') as MarkdownLinkMode,
    single: config.get<boolean>('singleReader', false),
  };
}

/** VS Code owns document/tab identity. Keep link history per editor group so a
 * paired source can return with its reader without disturbing other groups. */
export class ReaderNavigation implements vscode.Disposable {
  private readonly histories = new Map<vscode.TabGroup, History>();
  private lastSource?: { tab: vscode.Tab; uri: string };
  private readonly subscriptions: vscode.Disposable[] = [];
  private suppressed = 0;
  private queue = Promise.resolve();
  private timer: ReturnType<typeof setTimeout> | undefined;
  constructor(private readonly reveal: (location: ReaderLocation, column: vscode.ViewColumn) => void) {
    const schedule = () => {
      clearTimeout(this.timer);
      this.timer = setTimeout(() => { void this.serial(() => this.autoOpen()).catch(error => this.report(error)); }, 40);
    };
    this.subscriptions.push(vscode.window.onDidChangeActiveTextEditor(schedule),
      vscode.window.tabGroups.onDidChangeTabs(schedule),
      vscode.window.tabGroups.onDidChangeTabGroups(event => { for (const group of event.closed) this.histories.delete(group); }));
    schedule();
  }
  dispose() { clearTimeout(this.timer); this.subscriptions.forEach(item => item.dispose()); this.histories.clear(); }
  private report(error: unknown) { void vscode.window.showErrorMessage(`LiMR: ${error instanceof Error ? error.message : String(error)}`); }
  private serial<T>(task: () => Promise<T>): Promise<T> {
    const next = this.queue.then(task);
    this.queue = next.then(() => {}, () => {});
    return next;
  }
  async explicit<T>(task: () => Promise<T>): Promise<T> {
    this.suppressed++;
    try { return await task(); }
    finally {
      const tab = vscode.window.tabGroups.activeTabGroup.activeTab;
      this.lastSource = tab?.input instanceof vscode.TabInputText ? { tab, uri: tab.input.uri.toString() } : undefined;
      this.suppressed--;
    }
  }
  private group(column?: vscode.ViewColumn) {
    return vscode.window.tabGroups.all.find(group => group.viewColumn === column) ?? vscode.window.tabGroups.activeTabGroup;
  }
  private otherGroup(uri: vscode.Uri, current: vscode.TabGroup, reader = false) {
    const others = vscode.window.tabGroups.all.filter(group => group !== current);
    return others.find(group => group.tabs.some(tab => sameUri(uriOf(tab), uri) && isReader(tab) === reader))
      ?? others.sort((a, b) => Math.abs(a.viewColumn - current.viewColumn) - Math.abs(b.viewColumn - current.viewColumn))[0];
  }
  private companion(uri: vscode.Uri, current: vscode.TabGroup) {
    return vscode.window.tabGroups.all.find(group => group !== current && group.activeTab?.input instanceof vscode.TabInputText
      && sameUri(group.activeTab.input.uri, uri));
  }
  private captureEditor(group?: vscode.TabGroup): EditorLocation | undefined {
    const tab = group?.activeTab, uri = uriOf(tab);
    if (!uri || !tab) return;
    const editor = vscode.window.visibleTextEditors.find(editor => editor.viewColumn === group!.viewColumn && sameUri(editor.document.uri, uri));
    return { uri, viewType: tab.input instanceof vscode.TabInputCustom ? tab.input.viewType : 'default', selection: editor?.selection };
  }
  private async showEditor(location: EditorLocation, group: vscode.TabGroup | undefined, preserveFocus = false) {
    await vscode.commands.executeCommand('vscode.openWith', location.uri, location.viewType,
      { viewColumn: group?.viewColumn ?? vscode.ViewColumn.Beside, preview: false, preserveFocus, selection: location.selection });
    return this.group(vscode.window.visibleTextEditors.find(editor => sameUri(editor.document.uri, location.uri)
      && (!group || editor.viewColumn === group.viewColumn))?.viewColumn ?? group?.viewColumn);
  }
  private async showReader(location: ReaderLocation, column: vscode.ViewColumn, previous?: vscode.Tab, preserveFocus = false) {
    const uri = vscode.Uri.parse(location.uri);
    const origin = this.group();
    // Read failures leave the current reader and both history stacks intact.
    const document = await vscode.workspace.openTextDocument(uri);
    if (!markdown(document)) throw new Error('LiMR supports Markdown files.');
    await vscode.commands.executeCommand('vscode.openWith', uri, readerViewType, { viewColumn: column, preview: false, preserveFocus });
    const group = column === vscode.ViewColumn.Beside
      ? vscode.window.tabGroups.all.find(group => group !== origin && group.activeTab && isReader(group.activeTab) && sameUri(uriOf(group.activeTab), uri)) ?? this.group()
      : this.group(column);
    this.reveal(location, group.viewColumn);
    const close = navigationSettings(uri).single
      ? vscode.window.tabGroups.all.flatMap(group => group.tabs).filter(tab => isReader(tab) && tab !== group.activeTab)
      : previous && isReader(previous) && !sameUri(uriOf(previous), uri) ? [previous] : [];
    // Never discard a dirty buffer or prompt as a side effect of link navigation.
    const clean = close.filter(tab => !tab.isDirty && vscode.window.tabGroups.all.some(group => group.tabs.includes(tab)));
    if (clean.length) await vscode.window.tabGroups.close(clean, true);
    return group;
  }
  readerOpened(uri: vscode.Uri, column?: vscode.ViewColumn) {
    if (!navigationSettings(uri).single) return Promise.resolve();
    return this.serial(() => this.explicit(async () => {
      const current = this.group(column).activeTab;
      if (!current || !isReader(current) || !sameUri(uriOf(current), uri)) return;
      const others = vscode.window.tabGroups.all.flatMap(group => group.tabs).filter(tab => tab !== current && isReader(tab) && !tab.isDirty);
      if (others.length) await vscode.window.tabGroups.close(others, true);
    }));
  }
  open(uri: vscode.Uri, beside: boolean) {
    return this.serial(() => this.explicit(async () => {
      const current = this.group();
      let column = current.viewColumn;
      if (beside) {
        const document = await vscode.workspace.openTextDocument(uri);
        const source = vscode.window.visibleTextEditors.find(editor => sameUri(editor.document.uri, uri));
        await vscode.window.showTextDocument(document, { viewColumn: source?.viewColumn ?? column, preview: false });
        const sourceGroup = this.group(source?.viewColumn ?? column);
        column = this.otherGroup(uri, sourceGroup, true)?.viewColumn ?? vscode.ViewColumn.Beside;
      }
      if (navigationSettings(uri).single) {
        column = vscode.window.tabGroups.all.find(group => group.tabs.some(isReader))?.viewColumn ?? column;
      }
      await this.showReader({ uri: uri.toString() }, column);
    }));
  }
  private async autoOpen() {
    if (this.suppressed) return;
    const editor = vscode.window.activeTextEditor, group = this.group(), tab = group.activeTab;
    if (!editor || !tab || !(tab.input instanceof vscode.TabInputText) || !sameUri(tab.input.uri, editor.document.uri)) { this.lastSource = undefined; return; }
    const key = editor.document.uri.toString();
    if (this.lastSource?.tab === tab && this.lastSource.uri === key) return;
    this.lastSource = { tab, uri: key };
    if (!markdown(editor.document)) return;
    const settings = navigationSettings(editor.document.uri);
    if (settings.open === 'none') return;
    await this.explicit(async () => {
      if (settings.open === 'reader') {
        await this.showReader({ uri: key }, group.viewColumn);
        // A source view is only replaced when its buffer is safe to retain via
        // the custom text editor. Dirty tabs remain available for explicit save.
        if (!tab.isDirty && group.tabs.includes(tab)) await vscode.window.tabGroups.close(tab, true);
      } else {
        const target = settings.single ? vscode.window.tabGroups.all.find(group => group.tabs.some(isReader)) : this.otherGroup(editor.document.uri, group, true);
        if (target?.activeTab && isReader(target.activeTab) && sameUri(uriOf(target.activeTab), editor.document.uri)) return;
        await this.showReader({ uri: key }, target?.viewColumn ?? vscode.ViewColumn.Beside, target?.activeTab, true);
      }
    });
  }
  follow(from: ReaderLocation, to: ReaderLocation, column?: vscode.ViewColumn) {
    return this.serial(() => this.explicit(async () => {
      const current = this.group(column), uri = vscode.Uri.parse(to.uri), settings = navigationSettings(vscode.Uri.parse(from.uri));
      const paired = this.companion(vscode.Uri.parse(from.uri), current);
      const mode = settings.link === 'smart' ? paired ? 'editorAndReader' : 'currentReader'
        : settings.link === 'besideReader' && settings.single ? 'currentReader' : settings.link;
      // Resolve before opening either half of a paired navigation.
      const document = await vscode.workspace.openTextDocument(uri);
      const selection = to.line ? new vscode.Range(new vscode.Position(Math.min(document.lineCount - 1, to.line - 1), 0), new vscode.Position(Math.min(document.lineCount - 1, to.line - 1), 0)) : undefined;
      const after: EditorLocation = { uri, viewType: 'default', selection };
      if (mode === 'besideEditor') { await this.showEditor(after, this.otherGroup(uri, current)); return; }
      if (mode === 'besideReader') { await this.showReader(to, this.otherGroup(uri, current, true)?.viewColumn ?? vscode.ViewColumn.Beside); return; }
      const step: NavigationStep = { from, to };
      if (mode === 'editorAndReader') {
        const companion = paired ?? this.otherGroup(uri, current), before = this.captureEditor(companion);
        const group = await this.showEditor(after, companion);
        step.companion = { group, before, after };
      }
      const previous = current.activeTab;
      await this.showReader(to, current.viewColumn, previous);
      const history = this.histories.get(current) ?? { back: [], forward: [] };
      history.back.push(step); if (history.back.length > 100) history.back.shift(); history.forward = [];
      this.histories.set(current, history);
    }));
  }
  history(direction: 'back' | 'forward', current?: ReaderLocation, column?: vscode.ViewColumn) {
    return this.serial(() => this.explicit(async () => {
      const group = this.group(column), history = this.histories.get(group), step = history?.[direction].at(-1);
      if (!history || !step) return;
      const expected = direction === 'back' ? step.to : step.from;
      if (uriOf(group.activeTab)?.toString() !== expected.uri) return;
      if (current?.uri === expected.uri && current.position) expected.position = current.position;
      const target = direction === 'back' ? step.from : step.to;
      const previous = group.activeTab;
      await this.showReader(target, group.viewColumn, previous);
      const companion = step.companion;
      const editorTarget = direction === 'back' ? companion?.before : companion?.after;
      if (companion && editorTarget && vscode.window.tabGroups.all.includes(companion.group)) {
        // A closed/missing companion file must not break the reader's history.
        try { await this.showEditor(editorTarget, companion.group, true); } catch (error) { this.report(error); }
      }
      history[direction].pop(); history[direction === 'back' ? 'forward' : 'back'].push(step);
    }));
  }
}
