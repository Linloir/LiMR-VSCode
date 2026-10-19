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
interface ReaderPair { source: vscode.TabGroup; reader: vscode.TabGroup }
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
  private readonly readerResources = new Set<string>();
  private readonly readerTabs = new WeakMap<vscode.Tab, string>();
  private readonly explicitSources = new WeakMap<vscode.Tab, string>();
  private readonly pairs = new Set<ReaderPair>();
  private lastSource?: { tab: vscode.Tab; uri: string };
  private readonly subscriptions: vscode.Disposable[] = [];
  private suppressed = 0;
  private queue = Promise.resolve();
  private timer: ReturnType<typeof setTimeout> | undefined;
  constructor(private readonly reveal: (location: ReaderLocation, column: vscode.ViewColumn) => void) {
    for (const tab of vscode.window.tabGroups.all.flatMap(group => group.tabs)) if (isReader(tab)) {
      const uri = uriOf(tab)!.toString(); this.readerTabs.set(tab, uri); this.readerResources.add(uri);
    }
    const schedule = () => {
      clearTimeout(this.timer);
      this.timer = setTimeout(() => { void this.serial(() => this.autoOpen()).catch(error => this.report(error)); }, 40);
    };
    this.subscriptions.push(vscode.workspace.onDidChangeConfiguration(event => {
      if (event.affectsConfiguration('limr.markdownOpenMode')) {
        // A Quick Pick can change the setting without changing the active tab.
        // Reconsider that source, while retaining explicit Open Source choices.
        this.lastSource = undefined;
        schedule();
      }
    }), vscode.window.onDidChangeActiveTextEditor(schedule),
      vscode.window.tabGroups.onDidChangeTabs(event => {
        if (!this.suppressed) {
          for (const tab of event.changed) if (tab.input instanceof vscode.TabInputText && this.readerTabs.get(tab) === tab.input.uri.toString())
            this.explicitSources.set(tab, tab.input.uri.toString());
          // Some VS Code reopen operations replace the tab object instead of
          // its input. The replacement text tab is already in the same group.
          for (const closed of event.closed) if (isReader(closed)) {
            for (const tab of closed.group.tabs) if (tab.input instanceof vscode.TabInputText && sameUri(tab.input.uri, uriOf(closed)))
              this.explicitSources.set(tab, tab.input.uri.toString());
          }
        }
        for (const tab of [...event.opened, ...event.changed]) {
          if (isReader(tab)) this.readerTabs.set(tab, uriOf(tab)!.toString());
          else this.readerTabs.delete(tab);
        }
        const open = new Set(vscode.window.tabGroups.all.flatMap(group => group.tabs).map(tab => uriOf(tab)?.toString()));
        for (const uri of this.readerResources) if (!open.has(uri)) this.readerResources.delete(uri);
        schedule();
      }),
      vscode.window.tabGroups.onDidChangeTabGroups(event => {
        for (const group of event.closed) {
          this.histories.delete(group);
          for (const pair of this.pairs) if (pair.source === group || pair.reader === group) this.pairs.delete(pair);
        }
        schedule();
      }));
    schedule();
  }
  dispose() { clearTimeout(this.timer); this.subscriptions.forEach(item => item.dispose()); this.histories.clear(); this.pairs.clear(); this.readerResources.clear(); }
  private report(error: unknown) { void vscode.window.showErrorMessage(`LiMR: ${error instanceof Error ? error.message : String(error)}`); }
  private serial<T>(task: () => Promise<T>): Promise<T> {
    const next = this.queue.then(task);
    this.queue = next.then(() => {}, () => {});
    return next;
  }
  async explicit<T>(task: () => Promise<T>, rememberSource = true): Promise<T> {
    this.suppressed++;
    try { return await task(); }
    finally {
      const tab = vscode.window.tabGroups.activeTabGroup.activeTab;
      const uri = uriOf(tab);
      this.lastSource = tab && uri ? { tab, uri: uri.toString() } : undefined;
      if (rememberSource && this.lastSource && tab?.input instanceof vscode.TabInputText) this.explicitSources.set(tab, this.lastSource.uri);
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
  private rememberPair(source: vscode.TabGroup, reader: vscode.TabGroup) {
    if (source === reader) return;
    for (const pair of this.pairs) if (pair.source === source || pair.reader === source || pair.source === reader || pair.reader === reader) this.pairs.delete(pair);
    this.pairs.add({ source, reader });
    for (const tab of source.tabs) if (tab.input instanceof vscode.TabInputText && sameUri(tab.input.uri, uriOf(reader.activeTab))) this.explicitSources.delete(tab);
  }
  private async showPair(document: vscode.TextDocument, current: vscode.TabGroup, transient?: vscode.Tab, preserveFocus = true) {
    const uri = document.uri, groups = vscode.window.tabGroups.all;
    const remembered = [...this.pairs].find(pair => (pair.source === current || pair.reader === current) && groups.includes(pair.source) && groups.includes(pair.reader));
    const existingReader = groups.find(group => group.tabs.some(tab => isReader(tab) && sameUri(uriOf(tab), uri)));
    const singleReader = navigationSettings(uri).single ? groups.find(group => group.tabs.some(isReader)) : undefined;
    const reader = remembered?.reader ?? existingReader ?? singleReader;
    // A file opened from the reader's group still belongs to the established
    // source group. Focus and preview-tab reuse must never swap the two roles.
    const source = remembered?.source
      ?? groups.find(group => group !== reader && group.tabs.some(tab => tab.input instanceof vscode.TabInputText && sameUri(tab.input.uri, uri)))
      ?? (current !== reader ? current : this.otherGroup(uri, current));
    const editor = await vscode.window.showTextDocument(document, { viewColumn: source?.viewColumn ?? vscode.ViewColumn.Beside, preview: false });
    const sourceGroup = this.group(editor.viewColumn);
    const target = reader && reader !== sourceGroup ? reader : this.otherGroup(uri, sourceGroup, true);
    const readerGroup = await this.showReader({ uri: uri.toString() }, target?.viewColumn ?? vscode.ViewColumn.Beside, undefined, preserveFocus);
    this.rememberPair(sourceGroup, readerGroup);
    // The pinned source now owns the same buffer in its original column. Only
    // remove a redundant, clean tab created on the reader side by this open.
    if (transient && current !== sourceGroup && current.tabs.includes(transient) && !transient.isDirty)
      await vscode.window.tabGroups.close(transient, true);
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
    // Native Reopen With replaces the tab input while retaining the resource.
    // Respect source access until its last tab closes. TextDocument lifetime is
    // longer than tab lifetime, so it cannot delimit this choice.
    this.readerResources.add(uri.toString());
    if (!navigationSettings(uri).single) return Promise.resolve();
    return this.serial(() => this.explicit(async () => {
      const current = this.group(column).activeTab;
      if (!current || !isReader(current) || !sameUri(uriOf(current), uri)) return;
      const others = vscode.window.tabGroups.all.flatMap(group => group.tabs).filter(tab => tab !== current && isReader(tab) && !tab.isDirty);
      if (others.length) await vscode.window.tabGroups.close(others, true);
    }, false));
  }
  open(uri: vscode.Uri, beside: boolean) {
    return this.serial(() => this.explicit(async () => {
      const current = this.group();
      let column = current.viewColumn;
      if (beside) {
        const document = await vscode.workspace.openTextDocument(uri);
        await this.showPair(document, current, undefined, false);
        return;
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
    if (tab && isReader(tab)) {
      const uri = uriOf(tab)!, key = uri.toString();
      if (this.lastSource?.tab === tab && this.lastSource.uri === key) return;
      this.lastSource = { tab, uri: key };
      // Native Quick Open remembers the last editor type. It can open a reader
      // directly, without the source-editor event normally used for auto-open.
      if (navigationSettings(uri).open === 'sideBySide' && !this.companion(uri, group)) await this.explicit(async () => {
        await this.showPair(await vscode.workspace.openTextDocument(uri), group);
      }, false);
      return;
    }
    if (!editor || !tab || !(tab.input instanceof vscode.TabInputText) || !sameUri(tab.input.uri, editor.document.uri)) { this.lastSource = undefined; return; }
    const key = editor.document.uri.toString();
    if (this.lastSource?.tab === tab && this.lastSource.uri === key) return;
    this.lastSource = { tab, uri: key };
    if (this.explicitSources.get(tab) === key) return;
    if (!markdown(editor.document)) return;
    const settings = navigationSettings(editor.document.uri);
    if (settings.open === 'none') return;
    if (settings.open === 'reader' && this.readerResources.has(key)) return;
    await this.explicit(async () => {
      if (settings.open === 'reader') {
        await this.showReader({ uri: key }, group.viewColumn);
        // A source view is only replaced when its buffer is safe to retain via
        // the custom text editor. Dirty tabs remain available for explicit save.
        if (!tab.isDirty && group.tabs.includes(tab)) await vscode.window.tabGroups.close(tab, true);
      } else {
        await this.showPair(editor.document, group, tab);
      }
    }, false);
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
      if (step.companion) this.rememberPair(step.companion.group, current);
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
