import * as vscode from 'vscode';
import { randomBytes } from 'node:crypto';
import { basename } from 'node:path';
import { homedir } from 'node:os';
import { readerSettings, setReaderSetting, themeKind, themes, readerLocale, typographyModes, translationModes, topBarButtons, bottomBarButtons } from './settings';
import { installSkill, installGlobalSkill, copySkillInstallPrompt, maybePromptSkillInstall, showSkillGuide } from './skills';
import { loadReaderPlugins, replacePluginResourceRoots } from './plugins';
import { createExtensionApi, PluginRegistry } from './plugin-registry';
import type { LiMRExtensionApi } from '../api';
import { validateFileSettings } from './file-settings';
import { validateTransaction } from './transactions';
import { resolveReaderLink } from './links';
import { resolveReaderImage } from './images';
import { SourceSyntaxHighlighting } from './syntax-highlighting';
import { ScrollThrottle } from './shared/scroll-sync';
import type { HostMessage, ReaderState, WebviewMessage, ReaderFileSettings, ReaderButton } from './shared/protocol';

const viewType = 'limr.reader';
const localized = (uri: vscode.Uri | undefined, zh: string, en: string) => readerLocale(vscode.workspace.getConfiguration('limr', uri).get('language', 'auto')) === 'zh-CN' ? zh : en;
const isMarkdown = (document: vscode.TextDocument) => /^(?:markdown|prompt|instructions|chatagent|skill)$/.test(document.languageId) || /\.(?:md|markdown)$/i.test(document.uri.path);
interface ReaderScrollTarget {
  offset: number; from: number; last: number; direction: number; smooth: boolean; released: boolean;
  timer: ReturnType<typeof setTimeout>;
}
function settingScope(uri: vscode.Uri | undefined, key: string) {
  const existing = vscode.workspace.getConfiguration('limr', uri).inspect(key);
  const t = (zh: string, en: string) => localized(uri, zh, en);
  if (existing?.workspaceFolderValue !== undefined) return {
    label: t('工作区文件夹默认', 'Workspace folder default'),
    detail: t('保存到当前工作区文件夹的默认设置。', 'Saved as this workspace folder’s default.'),
  };
  if (existing?.workspaceValue !== undefined) return {
    label: t('工作区默认', 'Workspace default'),
    detail: t('保存到当前工作区的默认设置。', 'Saved as this workspace’s default.'),
  };
  return {
    label: t('用户默认', 'User default'),
    detail: t('保存到用户设置，作为所有工作区的默认值。', 'Saved as the default for all workspaces.'),
  };
}

export function activate(context: vscode.ExtensionContext): LiMRExtensionApi {
  context.subscriptions.push(new SourceSyntaxHighlighting(context.asAbsolutePath('dist/syntax-worker.cjs')));
  const pluginRegistry = new PluginRegistry();
  context.subscriptions.push(pluginRegistry);
  const provider = new ReaderProvider(context, pluginRegistry);
  context.subscriptions.push(provider, vscode.window.registerCustomEditorProvider(viewType, provider, {
    webviewOptions: { retainContextWhenHidden: true }, supportsMultipleEditorsPerDocument: true,
  }));
  const command = (name: string, callback: (...args: any[]) => unknown) => context.subscriptions.push(vscode.commands.registerCommand(name, async (...args: any[]) => {
    try { return await callback(...args); }
    catch (error) { await vscode.window.showErrorMessage(`LiMR：${error instanceof Error ? error.message : String(error)}`); }
  }));
  const resource = (uri?: vscode.Uri) => uri instanceof vscode.Uri ? uri : provider.activeUri ?? (vscode.window.activeTextEditor && isMarkdown(vscode.window.activeTextEditor.document) ? vscode.window.activeTextEditor.document.uri : undefined);
  const open = async (uri: vscode.Uri | undefined, beside: boolean) => {
    const target = resource(uri);
    if (!target) { await vscode.window.showInformationMessage(localized(undefined, '请先打开一个 Markdown 文件。', 'Open a Markdown file first.')); return; }
    const document = await vscode.workspace.openTextDocument(target);
    if (!isMarkdown(document)) { await vscode.window.showInformationMessage(localized(target, 'LiMR 支持 .md 和 .markdown 文件。', 'LiMR supports .md and .markdown files.')); return; }
    if (beside) {
      const editor = vscode.window.visibleTextEditors.find(item => item.document.uri.toString() === target.toString());
      await vscode.window.showTextDocument(document, { viewColumn: editor?.viewColumn ?? vscode.ViewColumn.Active, preview: false });
    }
    await vscode.commands.executeCommand('vscode.openWith', target, viewType, { viewColumn: beside ? vscode.ViewColumn.Beside : vscode.ViewColumn.Active, preview: false });
  };
  command('limr.openPreview', (uri?: vscode.Uri) => open(uri, false));
  command('limr.openPreviewToSide', (uri?: vscode.Uri) => open(uri, true));
  command('limr.openSource', async (uri?: vscode.Uri) => { const target = resource(uri); if (target) await provider.openSource(target); });
  command('limr.openSettings', () => vscode.commands.executeCommand('workbench.action.openSettings', '@ext:linloir.limr-vscode'));
  command('limr.chooseTheme', async () => {
    const uri = resource();
    const t = (zh: string, en: string) => localized(uri, zh, en);
    const labels: Record<string, string> = { playground: t('Playground（跟随 VS Code 明暗）', 'Playground (follow VS Code brightness)'), auto: t('跟随 VS Code', 'Follow VS Code') };
    const details: Record<string, string> = {
      playground: t('使用 LiMR 阅读配色，并跟随 VS Code 自动切换明暗。', 'Use LiMR reading colors and switch light/dark with VS Code.'),
      'playground-light': t('始终使用 LiMR 的浅色阅读配色。', 'Always use LiMR’s light reading colors.'),
      'playground-dark': t('始终使用 LiMR 的深色阅读配色。', 'Always use LiMR’s dark reading colors.'),
      auto: t('使用当前 VS Code 主题的实际颜色，并随主题变化。', 'Use the active VS Code theme’s actual colors and follow theme changes.'),
      'vscode-light': t('使用固定的 VS Code 浅色阅读配色。', 'Use a fixed VS Code light reading palette.'),
      'vscode-dark': t('使用固定的 VS Code 深色阅读配色。', 'Use a fixed VS Code dark reading palette.'),
      'one-dark-pro': t('使用 One Dark Pro 风格的深色阅读配色。', 'Use a dark reading palette inspired by One Dark Pro.'),
      'one-dark-pro-darker': t('使用 One Dark Pro Darker 风格的更深阅读配色。', 'Use a darker reading palette inspired by One Dark Pro Darker.'),
    };
    const current = vscode.workspace.getConfiguration('limr', uri).get('theme', 'playground'), scope = settingScope(uri, 'theme');
    const pick = await vscode.window.showQuickPick(themes.map(theme => ({
      ...theme, label: labels[theme.value] ?? theme.label,
      description: current === theme.value ? t('当前', 'Current') : '', detail: details[theme.value],
    })), { title: `${t('LiMR 阅读主题', 'LiMR reader theme')} · ${scope.label}`, placeHolder: scope.detail, matchOnDescription: true, matchOnDetail: true });
    if (pick) await setReaderSetting(uri, 'theme', pick.value);
  });
  command('limr.toggleEditing', async () => {
    const uri = resource(); if (!uri) return;
    if (!vscode.workspace.isTrusted) { await vscode.window.showWarningMessage(localized(uri, '请先信任工作区，再启用 Markdown 编辑。', 'Trust this workspace before enabling Markdown editing.')); return; }
    await setReaderSetting(uri, 'editingEnabled', !readerSettings(uri).editingEnabled);
  });
  command('limr.chooseTypography', () => provider.choosePreference('typography', resource()));
  command('limr.chooseTranslationMode', () => provider.choosePreference('translationMode', resource()));
  command('limr.configureTopBar', () => provider.chooseButtons('topBarButtons', resource()));
  command('limr.configureBottomBar', () => provider.chooseButtons('bottomBarButtons', resource()));
  command('limr.resetFileSettings', async () => { const uri = resource(); if (uri) await provider.setFileSettings(uri, {}, true); });
  command('limr.reloadPlugins', () => provider.reloadPlugins());
  command('limr.installGlobalSkill', () => installGlobalSkill(context, resource()));
  command('limr.copySkillInstallPrompt', () => copySkillInstallPrompt(context, resource()));
  command('limr.openSkillGuide', () => showSkillGuide(context, resource()));
  command('limr.installSkill', () => installSkill(context, resource()));
  void maybePromptSkillInstall(context, resource()).catch(error => console.error('LiMR skill prompt', error));
  return createExtensionApi(pluginRegistry);
}

class ReaderProvider implements vscode.CustomTextEditorProvider, vscode.Disposable {
  private readonly panels = new Map<vscode.WebviewPanel, vscode.TextDocument>();
  private readonly subscriptions: vscode.Disposable[] = [];
  private readonly pending = new Map<string, Promise<void>>();
  private readonly plugins = new Map<vscode.WebviewPanel, NonNullable<ReaderState['plugins']>>();
  private readonly pluginRevisions = new Map<vscode.WebviewPanel, number>();
  private readonly pluginRoots = new Map<vscode.WebviewPanel, readonly vscode.Uri[]>();
  private readonly imageRoots = new Map<vscode.WebviewPanel, Map<string, vscode.Uri>>();
  private readonly extraStatus = new Map<ReaderButton, vscode.StatusBarItem>();
  private readonly fileWrites = new Map<string, Promise<void>>();
  private mergedPreview: boolean | undefined;
  private readonly status = vscode.window.createStatusBarItem('limr.reader', vscode.StatusBarAlignment.Right, 105);
  private pluginTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly readerScrollTargets = new Map<vscode.TextEditor, ReaderScrollTarget>();
  private readonly readerScrollOwners = new Map<string, { panel: vscode.WebviewPanel; epoch: number }>();
  private readonly sourceScrollGenerations = new Map<string, number>();
  private sourceScrollOffsets = new WeakMap<vscode.TextEditor, number>();
  private readonly sourceScroll = new ScrollThrottle<vscode.TextEditor, number>((editor, offset) => {
    if (!vscode.window.visibleTextEditors.includes(editor) || !readerSettings(editor.document.uri).syncScroll || this.readerScrollOwners.has(editor.document.uri.toString())) return;
    for (const [panel, document] of this.panels) if (panel.visible && document.uri.toString() === editor.document.uri.toString())
      this.post(panel, { type: 'reveal', offset });
  });
  activeUri: vscode.Uri | undefined;
  constructor(private readonly context: vscode.ExtensionContext, private readonly pluginRegistry: PluginRegistry) {
    this.status.name = 'LiMR Reader';
    this.status.command = 'limr.toggleEditing';
    for (const [index, name] of ['typography', 'translation', 'theme', 'settings'].entries()) {
      const item = vscode.window.createStatusBarItem(`limr.${name}`, vscode.StatusBarAlignment.Right, 104 - index);
      item.name = `LiMR ${name}`;
      item.command = { typography: 'limr.chooseTypography', translation: 'limr.chooseTranslationMode', theme: 'limr.chooseTheme', settings: 'limr.openSettings' }[name];
      this.extraStatus.set(name as ReaderButton, item); this.subscriptions.push(item);
    }
    const watcher = vscode.workspace.createFileSystemWatcher('**/*.{json,css,js,mjs}');
    const onPluginFile = (uri: vscode.Uri) => {
      const affected = [...this.panels.values()].some(document => {
        const folder = vscode.workspace.getWorkspaceFolder(document.uri); if (!folder) return false;
        const manifest = vscode.workspace.getConfiguration('limr', document.uri).get<string>('plugins.manifest', '.limr/plugins/manifest.json');
        const directory = vscode.Uri.joinPath(folder.uri, manifest, '..').toString().replace(/\/?$/, '/');
        return uri.toString().startsWith(directory);
      });
      if (affected) { clearTimeout(this.pluginTimer); this.pluginTimer = setTimeout(() => { void this.reloadPlugins(); }, 120); }
    };
    this.subscriptions.push(watcher, watcher.onDidChange(onPluginFile), watcher.onDidCreate(onPluginFile), watcher.onDidDelete(onPluginFile));
    this.subscriptions.push(
      this.status,
      pluginRegistry.onDidChange(() => { void this.reloadPlugins(); }),
      vscode.workspace.onDidChangeTextDocument(event => { if (event.contentChanges.length) this.broadcast(event.document); }),
      vscode.workspace.onDidSaveTextDocument(document => this.broadcast(document)),
      vscode.workspace.onDidChangeConfiguration(event => {
        if (event.affectsConfiguration('limr.syncScroll')) this.resetScrollSynchronization();
        if (['limr', 'editor.fontFamily', 'editor.fontSize', 'workbench.colorTheme'].some(name => event.affectsConfiguration(name))) { this.broadcast(); void this.reloadPlugins(); }
      }),
      vscode.window.onDidChangeActiveColorTheme(() => this.broadcast()),
      vscode.workspace.onDidGrantWorkspaceTrust(() => { this.broadcast(); void this.reloadPlugins(); void maybePromptSkillInstall(context, this.activeUri); }),
      vscode.window.onDidChangeActiveTextEditor(editor => {
        if (editor && isMarkdown(editor.document)) { this.activeUri = editor.document.uri; this.releaseReaderInput(editor.document.uri); }
        this.updateStatus();
      }),
      vscode.window.onDidChangeTextEditorSelection(event => {
        if (event.kind === vscode.TextEditorSelectionChangeKind.Keyboard || event.kind === vscode.TextEditorSelectionChangeKind.Mouse)
          this.releaseReaderInput(event.textEditor.document.uri);
      }),
      vscode.window.onDidChangeWindowState(event => { if (!event.focused) this.resetScrollSynchronization(); }),
      vscode.window.tabGroups.onDidChangeTabs(() => this.updateStatus()),
      vscode.window.onDidChangeTextEditorVisibleRanges(event => {
        const editor = event.textEditor, range = event.visibleRanges[0];
        if (!range || !readerSettings(editor.document.uri).syncScroll) return;
        const offset = editor.document.offsetAt(range.start);
        const target = this.readerScrollTargets.get(editor);
        if (this.readerScrollOwners.has(editor.document.uri.toString())) {
          if (target) {
            target.direction = Math.sign(offset - target.last) || target.direction; target.last = offset;
          }
          this.sourceScrollOffsets.set(editor, offset); return;
        }
        // AtTop reserves native sticky/cursor padding: the first visible line
        // can precede the requested line. Acknowledge that editor's resulting
        // viewport, including intermediate frames of native smooth scrolling.
        const reached = target && event.visibleRanges.some(visible => editor.document.offsetAt(visible.start) <= target.offset && editor.document.offsetAt(visible.end) >= target.offset);
        const approaching = target && offset >= Math.min(target.from, target.offset) && offset <= Math.max(target.from, target.offset);
        const reversedInput = target?.released && target.direction && Math.sign(offset - target.last) === -target.direction;
        if (target && !reversedInput && (reached || target.smooth && approaching)) {
          // Leaving the reader is not itself source input: retain matching
          // animation tails, while reversal or movement outside the requested
          // viewport hands control to the source immediately.
          // This target expires relative to the reveal command, never relative
          // to acknowledgements. Extending it on every viewport notification
          // can swallow an unlimited same-direction wheel gesture in source.
          target.last = offset;
          this.sourceScrollOffsets.set(editor, offset); return;
        }
        this.clearReaderScrollTarget(editor);
        if (this.sourceScrollOffsets.get(editor) === offset) return;
        // A native wheel need not focus the editor or change its selection.
        // Once a viewport event is accepted as source input, invalidate reader
        // claims already in transit even if no reader owner has arrived yet.
        this.releaseReaderInput(editor.document.uri);
        this.sourceScrollOffsets.set(editor, offset);
        this.sourceScroll.push(editor, offset);
      }),
    );
    this.updateStatus();
  }
  private clearReaderScrollTarget(editor: vscode.TextEditor) {
    const target = this.readerScrollTargets.get(editor);
    if (target) { clearTimeout(target.timer); this.readerScrollTargets.delete(editor); }
  }
  private releaseReaderInput(uri: vscode.Uri, sourceInput = true) {
    const key = uri.toString(), owner = this.readerScrollOwners.get(key);
    const panels = [...this.panels].filter(([, document]) => document.uri.toString() === key).map(([panel]) => panel);
    if (!sourceInput && !owner || sourceInput && !owner && !panels.length) return;
    this.readerScrollOwners.delete(key);
    for (const editor of new Set([...vscode.window.visibleTextEditors, ...this.readerScrollTargets.keys()])) if (editor.document.uri.toString() === key) {
      if (sourceInput) {
        this.clearReaderScrollTarget(editor); this.sourceScroll.cancel(editor); this.sourceScrollOffsets.delete(editor);
      }
      else { const target = this.readerScrollTargets.get(editor); if (target) target.released = true; }
    }
    // A local pointerleave already released the webview. Echoing it back could
    // race with a newer reader gesture, so only native input sends a release.
    if (sourceInput) {
      const generation = (this.sourceScrollGenerations.get(key) ?? 0) + 1;
      this.sourceScrollGenerations.set(key, generation);
      for (const panel of panels) this.post(panel, { type: 'scrollIntent', active: false, generation, epoch: owner?.panel === panel ? owner.epoch : undefined });
    }
  }
  private resetScrollSynchronization() {
    this.sourceScroll.dispose(); this.sourceScrollOffsets = new WeakMap();
    const documents = new Map([...this.panels.values()].map(document => [document.uri.toString(), document]));
    for (const document of documents.values()) this.releaseReaderInput(document.uri);
    this.readerScrollOwners.clear();
    this.readerScrollTargets.forEach((_, editor) => this.clearReaderScrollTarget(editor));
  }
  dispose() { this.sourceScroll.dispose(); this.readerScrollOwners.clear(); this.sourceScrollGenerations.clear(); this.readerScrollTargets.forEach((_, editor) => this.clearReaderScrollTarget(editor)); clearTimeout(this.pluginTimer); this.subscriptions.forEach(item => item.dispose()); this.panels.clear(); this.plugins.clear(); this.pluginRoots.clear(); this.imageRoots.clear(); if (this.mergedPreview) void vscode.commands.executeCommand('setContext', 'hasCustomMarkdownPreview', false); }
  private baseResourceRoots(document: vscode.TextDocument) {
    return [...new Map([vscode.Uri.joinPath(this.context.extensionUri, 'dist', 'webview'),
      vscode.Uri.joinPath(document.uri, '..'), ...(vscode.workspace.workspaceFolders?.map(folder => folder.uri) ?? [])]
      .map(root => [root.toString(), root])).values()];
  }
  private updatePluginRoots(panel: vscode.WebviewPanel, document: vscode.TextDocument, next: readonly vscode.Uri[]) {
    const existing = panel.webview.options.localResourceRoots ?? [];
    const roots = replacePluginResourceRoots(existing, this.pluginRoots.get(panel) ?? [], next, this.baseResourceRoots(document), [...this.imageRoots.get(panel)?.values() ?? []]);
    // Updating webview options can recreate its guest; avoid any write when the
    // effective permissions are unchanged (including normal config reloads).
    if (JSON.stringify(existing.map(root => root.toString())) !== JSON.stringify(roots.map(root => root.toString())))
      panel.webview.options = { ...panel.webview.options, localResourceRoots: roots };
    this.pluginRoots.set(panel, next);
  }
  resolveCustomTextEditor(document: vscode.TextDocument, panel: vscode.WebviewPanel): void {
    this.panels.set(panel, document); this.activeUri = document.uri;
    void maybePromptSkillInstall(this.context, document.uri).catch(error => console.error('LiMR skill prompt', error));
    panel.webview.options = { enableScripts: true, localResourceRoots: this.baseResourceRoots(document) };
    panel.webview.html = this.html(panel.webview);
    const events = [
      panel.webview.onDidReceiveMessage(message => { void this.message(document, panel, message).catch(error => {
        void vscode.window.showErrorMessage(`LiMR：${error instanceof Error ? error.message : String(error)}`);
      }); }),
      panel.onDidChangeViewState(() => { if (panel.active) this.activeUri = document.uri; if (panel.visible) this.sendState(panel, document); else if (this.readerScrollOwners.get(document.uri.toString())?.panel === panel) this.releaseReaderInput(document.uri); this.updateStatus(); }),
    ];
    panel.onDidDispose(() => {
      events.forEach(event => event.dispose()); this.panels.delete(panel);
      if (this.readerScrollOwners.get(document.uri.toString())?.panel === panel) this.releaseReaderInput(document.uri);
      if (![...this.panels.values()].some(item => item.uri.toString() === document.uri.toString())) this.sourceScrollGenerations.delete(document.uri.toString());
      this.plugins.delete(panel); this.pluginRevisions.delete(panel); this.pluginRoots.delete(panel); this.imageRoots.delete(panel); this.updateStatus();
    });
    this.updateStatus();
  }
  private state(document: vscode.TextDocument, webview: vscode.Webview): ReaderState {
    return {
      document: { uri: document.uri.toString(), fsPath: document.uri.fsPath, relativePath: vscode.workspace.asRelativePath(document.uri, false), name: basename(document.uri.path), source: document.getText(), version: document.version, isDirty: document.isDirty },
      settings: this.settings(document.uri), plugins: this.pluginsFor(webview), themeKind: themeKind(), themeName: vscode.workspace.getConfiguration('workbench').get<string>('colorTheme', ''),
      resourceBase: webview.asWebviewUri(vscode.Uri.joinPath(document.uri, '..')).toString().replace(/\/?$/, '/'), trusted: vscode.workspace.isTrusted,
    };
  }
  private pluginsFor(webview: vscode.Webview) {
    const panel = [...this.panels.keys()].find(panel => panel.webview === webview);
    return panel ? this.plugins.get(panel) ?? [] : [];
  }
  private settings(uri: vscode.Uri) { return readerSettings(uri, this.context.workspaceState.get<ReaderFileSettings>(`limr.fileSettings:${uri.toString()}`, {})); }
  private text(uri: vscode.Uri | undefined, zh: string, en: string) { return localized(uri, zh, en); }
  private post(panel: vscode.WebviewPanel, message: HostMessage) { void panel.webview.postMessage(message); }
  private sendState(panel: vscode.WebviewPanel, document: vscode.TextDocument) { this.post(panel, { type: 'state', state: this.state(document, panel.webview) }); }
  private broadcast(document?: vscode.TextDocument) {
    for (const [panel, current] of this.panels) if (!document || current.uri.toString() === document.uri.toString()) this.sendState(panel, current);
    this.updateStatus();
  }
  private updateStatus() {
    const activeTab = vscode.window.tabGroups.activeTabGroup.activeTab;
    const document = activeTab?.input instanceof vscode.TabInputCustom && activeTab.input.viewType === viewType
      ? [...this.panels].find(([panel]) => panel.active)?.[1] : undefined;
    const uri = document?.uri ?? this.activeUri;
    const config = vscode.workspace.getConfiguration('limr', uri);
    const merged = config.get<string>('previewButtonMode', 'separate') === 'merged';
    if (this.mergedPreview !== merged) {
      // Built-in Markdown explicitly offers this integration context key.
      if (merged || this.mergedPreview) void vscode.commands.executeCommand('setContext', 'hasCustomMarkdownPreview', merged);
      this.mergedPreview = merged;
    }
    const settings = uri ? this.settings(uri) : undefined;
    for (const name of topBarButtons) void vscode.commands.executeCommand('setContext', `limr.show.${name}`, settings?.topBarButtons.includes(name) ?? true);
    const editing = !!document && !!settings?.editingEnabled;
    void vscode.commands.executeCommand('setContext', 'limr.readerEditing', editing);
    this.status.hide(); this.extraStatus.forEach(item => item.hide());
    if (!document || !settings) return;
    const t = (zh: string, en: string) => this.text(uri, zh, en);
    const saving = this.pending.has(document.uri.toString());
    this.status.text = saving ? `$(sync~spin) LiMR · ${t('正在同步', 'Syncing')}` : editing ? `$(edit) LiMR · ${t('可编辑', 'Editable')}` : `$(lock) LiMR · ${t('只读', 'Read only')}`;
    this.status.tooltip = `${basename(document.uri.path)}\n${t('点击切换 Markdown 编辑权限。', 'Toggle Markdown editing. Changes use VS Code undo and save.')}`;
    if (settings.bottomBarButtons.includes('editing')) this.status.show();
    const details: Record<string, [string, string]> = {
      typography: ['$(text-size) ' + ({ standard: t('标准', 'Standard'), justify: t('两端对齐', 'Justified'), 'knuth-plass': 'Knuth–Plass' }[settings.typography]), t('排版方式', 'Typography')],
      translation: ['$(globe) ' + ({ bilingual: t('对照', 'Bilingual'), original: t('原文', 'Original'), translated: t('译文', 'Translated'), paragraph: t('按段落', 'Per paragraph') }[settings.translationMode]), t('翻译块展示', 'Translation display')],
      theme: ['$(color-mode) ' + settings.theme, t('阅读主题', 'Reader theme')],
      settings: ['$(settings-gear)', t('阅读设置', 'Reader settings')],
    };
    this.extraStatus.forEach((item, name) => {
      const detail = details[name]; if (!detail) return;
      item.text = detail[0]; item.tooltip = detail[1];
      if (name === 'typography' || name === 'translation') item.tooltip += settings.fileOverrides[name === 'typography' ? 'typography' : 'translationMode'] ? t(' · 当前文件', ' · This file') : t(' · 默认配置', ' · Default');
      if (settings.bottomBarButtons.includes(name)) item.show();
    });
  }
  async setFileSettings(uri: vscode.Uri, incoming: ReaderFileSettings, replace = false) {
    const settings = validateFileSettings(incoming);
    const key = `limr.fileSettings:${uri.toString()}`;
    const previous = this.fileWrites.get(key) ?? Promise.resolve();
    const next = previous.catch(() => {}).then(async () => {
      const merged = replace ? settings : { ...this.context.workspaceState.get<ReaderFileSettings>(key, {}), ...settings };
      await this.context.workspaceState.update(key, Object.keys(merged).length ? merged : undefined);
      this.broadcast();
    });
    this.fileWrites.set(key, next);
    try { await next; } finally { if (this.fileWrites.get(key) === next) this.fileWrites.delete(key); }
  }
  async choosePreference(key: 'typography' | 'translationMode', uri?: vscode.Uri) {
    const t = (zh: string, en: string) => this.text(uri, zh, en);
    const labels: Record<string, string> = { standard: t('标准', 'Standard'), justify: t('两端对齐', 'Justified'), 'knuth-plass': 'Knuth–Plass', bilingual: t('对照', 'Bilingual'), original: t('仅原文', 'Original only'), translated: t('仅译文', 'Translation only'), paragraph: t('按照段落配置', 'Per paragraph') };
    const title = key === 'typography' ? t('排版方式', 'Typography') : t('翻译块展示', 'Translation display');
    const defaultScope = settingScope(uri, key);
    const defaultValue = vscode.workspace.getConfiguration('limr', uri).get<string>(key, key === 'typography' ? 'standard' : 'paragraph');
    const fileValue = uri ? this.settings(uri)[key] : defaultValue;
    const scope = await vscode.window.showQuickPick([
      ...(uri ? [{
        label: t('当前文件', 'This file'), value: 'file', description: `${t('当前：', 'Current: ')}${labels[fileValue]}`,
        detail: t('仅对本文件生效；关闭后仍保留，不修改 Markdown。', 'Only affects this file; saved across sessions. Markdown is unchanged.'),
      }, {
        label: t('当前文件恢复默认', 'Reset this file to default'), value: 'reset', description: `${t('恢复为：', 'Restore: ')}${labels[defaultValue]}`,
        detail: key === 'typography'
          ? t('清除此文件的排版覆盖，重新使用默认配置。', 'Clear this file’s typography override and use the default again.')
          : t('清除此文件的翻译模式及各段落显示覆盖，重新使用默认配置。', 'Clear this file’s mode and paragraph overrides to use the default.'),
      }] : []),
      {
        label: t('默认配置', 'Default settings'), value: 'default', description: `${defaultScope.label} · ${labels[defaultValue]}`,
        detail: `${defaultScope.detail} ${t('已有单独设置的文件保留原设置。', 'Keeps existing file overrides.')}`,
      },
    ], { title, placeHolder: t('选择设置的生效范围', 'Choose where this setting applies'), matchOnDescription: true, matchOnDetail: true });
    if (!scope) return;
    if (scope.value === 'reset' && uri) {
      const settings = { ...this.settings(uri).fileOverrides }; delete settings[key];
      if (key === 'translationMode') delete settings.translationParagraphs;
      await this.setFileSettings(uri, settings, true); return;
    }
    const current = scope.value === 'file' ? fileValue : defaultValue;
    const details: Record<string, string> = {
      standard: t('自然换行、左侧对齐，保留普通 Markdown 的阅读排版。', 'Use natural line breaks and left alignment for standard Markdown reading.'),
      justify: t('调整词间距，使段落左右两侧对齐。', 'Adjust spacing to align both edges of each paragraph.'),
      'knuth-plass': t('整体优化段落断行，让两端对齐时的行间疏密更均匀。', 'Optimize line breaks across each paragraph for more even justified spacing.'),
      bilingual: t('所有翻译块同时展示原文和译文。', 'Show both the original and translation in every translation block.'),
      original: t('所有翻译块只展示原文。', 'Show only the original in every translation block.'),
      translated: t('所有翻译块只展示译文。', 'Show only the translation in every translation block.'),
      paragraph: t('各段分别使用已保存的显示方式；未调整的段落遵循正文中的配置。', 'Use each paragraph’s saved display mode, falling back to its Markdown configuration.'),
    };
    const placeHolder = key === 'translationMode'
      ? t('单独切换某段后，当前文件自动改为“按照段落配置”，其它段保持原显示。', 'Changing one paragraph sets this file to “Per paragraph”; others stay as shown.')
      : scope.value === 'file'
        ? t('仅为当前文件保存排版方式，不修改正文', 'Save typography for this file only, without changing Markdown')
        : defaultScope.detail;
    const pick = await vscode.window.showQuickPick((key === 'typography' ? typographyModes : translationModes).map(value => ({
      label: labels[value], value, description: current === value ? t('当前', 'Current') : '', detail: details[value],
    })), { title: `${title} · ${scope.value === 'file' ? t('当前文件', 'This file') : defaultScope.label}`, placeHolder, matchOnDescription: true, matchOnDetail: true });
    if (!pick) return;
    if (scope.value === 'file' && uri) await this.setFileSettings(uri, { [key]: pick.value });
    else await setReaderSetting(uri, key, pick.value);
  }
  async chooseButtons(key: 'topBarButtons' | 'bottomBarButtons', uri?: vscode.Uri) {
    const t = (zh: string, en: string) => this.text(uri, zh, en);
    const labels: Record<ReaderButton, string> = { theme: t('主题', 'Theme'), editing: t('编辑权限', 'Editing'), typography: t('排版', 'Typography'), translation: t('翻译', 'Translation'), ai: 'AI Skill', settings: t('设置', 'Settings'), source: t('源文件', 'Source') };
    const details: Record<ReaderButton, string> = {
      theme: t('切换阅读配色及跟随 VS Code 主题的方式。', 'Choose reader colors and how they follow the VS Code theme.'),
      editing: t('切换 Markdown 编辑权限；关闭时仍可阅读和复制。', 'Toggle Markdown editing; reading and copying remain available when off.'),
      typography: t('设置标准、两端对齐或 Knuth–Plass 排版。', 'Choose standard, justified, or Knuth–Plass typography.'),
      translation: t('设置原文、译文、对照或按段落展示。', 'Choose original, translation, bilingual, or per-paragraph display.'),
      ai: t('打开 AI Skill 使用指引，了解标注编辑和阅读器定制。', 'Open the AI Skill guide for annotation editing and reader customization.'),
      settings: t('打开 LiMR 的全部 VS Code 设置。', 'Open all LiMR settings in VS Code.'),
      source: t('打开当前 Markdown 文件的原文编辑器。', 'Open the source editor for the current Markdown file.'),
    };
    const names = key === 'topBarButtons' ? topBarButtons : bottomBarButtons;
    const current = vscode.workspace.getConfiguration('limr', uri).get<readonly ReaderButton[]>(key, names), scope = settingScope(uri, key);
    const title = key === 'topBarButtons' ? t('顶栏按钮', 'Top bar buttons') : t('底栏按钮', 'Bottom bar buttons');
    const selected = await vscode.window.showQuickPick(names.map(value => ({ label: labels[value], value, picked: current.includes(value), detail: details[value] })), {
      canPickMany: true, title: `${title} · ${scope.label}`,
      placeHolder: t('勾选要显示的按钮，确认后保存；可全部取消。', 'Select buttons to show; confirm to save. Clear all to hide them.'),
      matchOnDetail: true,
    });
    if (selected) await setReaderSetting(uri, key, selected.map(item => item.value));
  }
  async reloadPlugins() {
    await Promise.all([...this.panels].map(async ([panel, document]) => {
      const revision = (this.pluginRevisions.get(panel) ?? 0) + 1; this.pluginRevisions.set(panel, revision);
      try {
        const loaded = await loadReaderPlugins(document.uri, panel.webview, this.pluginRegistry);
        if (this.pluginRevisions.get(panel) !== revision || !this.panels.has(panel)) return;
        this.updatePluginRoots(panel, document, loaded.resourceRoots);
        const plugins = loaded.entries;
        if (JSON.stringify(plugins) !== JSON.stringify(this.plugins.get(panel))) { this.plugins.set(panel, plugins); this.sendState(panel, document); }
        for (const error of loaded.errors) void vscode.window.showErrorMessage(`LiMR plugins: ${error}`);
      } catch (error) {
        if (this.pluginRevisions.get(panel) !== revision || !this.panels.has(panel)) return;
        this.updatePluginRoots(panel, document, []);
        this.pluginRoots.delete(panel);
        this.plugins.set(panel, []); this.sendState(panel, document);
        void vscode.window.showErrorMessage(`LiMR plugins: ${error instanceof Error ? error.message : String(error)}`);
      }
    }));
  }
  private fileViewColumn(uri: vscode.Uri, readerColumn = vscode.window.tabGroups.activeTabGroup.viewColumn): vscode.ViewColumn {
    const others = vscode.window.tabGroups.all.filter(group => group.viewColumn !== readerColumn);
    // Reuse even a background tab in another group; the reader keeps its group.
    const existing = others.find(group => group.tabs.some(tab =>
      (tab.input instanceof vscode.TabInputText || tab.input instanceof vscode.TabInputCustom) && tab.input.uri.toString() === uri.toString()));
    return existing?.viewColumn ?? others.sort((a, b) => Math.abs(a.viewColumn - readerColumn) - Math.abs(b.viewColumn - readerColumn))[0]?.viewColumn ?? vscode.ViewColumn.Beside;
  }
  async openSource(uri: vscode.Uri, offset?: number, readerColumn?: vscode.ViewColumn): Promise<void> {
    const document = await vscode.workspace.openTextDocument(uri);
    const existing = readerColumn === undefined ? vscode.window.visibleTextEditors.find(editor => editor.document.uri.toString() === uri.toString()) : undefined;
    const editor = await vscode.window.showTextDocument(document, { viewColumn: existing?.viewColumn ?? this.fileViewColumn(uri, readerColumn), preview: false });
    if (Number.isSafeInteger(offset)) {
      const position = document.positionAt(Math.max(0, offset!)); editor.selection = new vscode.Selection(position, position);
      editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenterIfOutsideViewport);
    }
  }
  private async message(document: vscode.TextDocument, panel: vscode.WebviewPanel, candidate: unknown): Promise<void> {
    if (!this.panels.has(panel) || !candidate || typeof candidate !== 'object' || !('type' in candidate)) return;
    const message = candidate as WebviewMessage;
    switch (message.type) {
      case 'ready': {
        if (this.readerScrollOwners.get(document.uri.toString())?.panel === panel) this.releaseReaderInput(document.uri);
        this.sendState(panel, document);
        this.post(panel, { type: 'scrollIntent', active: false, generation: this.sourceScrollGenerations.get(document.uri.toString()) ?? 0 });
        this.updateStatus(); await this.reloadPlugins(); break;
      }
      case 'resolveImage': {
        if (typeof message.requestId !== 'string' || message.requestId.length > 100 || typeof message.src !== 'string' || message.src.length > 8192) break;
        const settings = this.settings(document.uri);
        const result = await resolveReaderImage({ documentUri: document.uri.toString(),
          workspaceUri: vscode.workspace.getWorkspaceFolder(document.uri)?.uri.toString(), src: message.src,
          wsl: !!process.env.WSL_DISTRO_NAME || document.uri.authority.toLowerCase().startsWith('wsl+'),
          mode: settings.imagePathMode, baseFolder: settings.imageBaseFolder, searchPaths: settings.imageSearchPaths,
          homeUri: vscode.Uri.file(homedir()).toString(),
        }, async uri => {
          try { return !!((await vscode.workspace.fs.stat(vscode.Uri.parse(uri))).type & vscode.FileType.File); }
          catch { return false; }
        });
        if (!this.panels.has(panel)) break;
        if (result.kind === 'local') {
          const resource = vscode.Uri.parse(result.uri);
          let imageRoots = this.imageRoots.get(panel);
          if (!imageRoots) this.imageRoots.set(panel, imageRoots = new Map());
          imageRoots.set(resource.toString(), resource);
          const roots = panel.webview.options.localResourceRoots ?? [];
          // Explicit parent/absolute paths can be outside the workspace. Grant
          // only this existing file, never an entire filesystem root.
          if (!roots.some(root => root.scheme === resource.scheme && root.authority === resource.authority &&
            (root.path === resource.path || resource.path.startsWith(root.path.replace(/\/?$/, '/')))))
            panel.webview.options = { ...panel.webview.options, localResourceRoots: [...roots, resource] };
          // The resolver retains URL-encoded suffixes; Uri.with expects decoded
          // fields and would double-escape SVG fragment IDs such as #icon%20one.
          const uri = panel.webview.asWebviewUri(resource).toString() + (result.query ? `?${result.query}` : '') + (result.fragment ? `#${result.fragment}` : '');
          this.post(panel, { type: 'imageResolved', requestId: message.requestId, src: message.src, uri });
        } else if (result.kind === 'external') this.post(panel, { type: 'imageResolved', requestId: message.requestId, src: message.src, uri: result.uri });
        else this.post(panel, { type: 'imageResolved', requestId: message.requestId, src: message.src, reason: result.kind });
        break;
      }
      case 'notify':
        if (typeof message.message !== 'string') return;
        if (message.error) void vscode.window.showErrorMessage(`LiMR：${message.message}`);
        else void vscode.window.showInformationMessage(`LiMR：${message.message}`);
        break;
      case 'edit': {
        const key = document.uri.toString(), previous = this.pending.get(key) ?? Promise.resolve();
        const next = previous.catch(() => {}).then(() => this.applySourceEdit(document, panel, message));
        this.pending.set(key, next);
        this.updateStatus();
        try { await next; } finally { if (this.pending.get(key) === next) this.pending.delete(key); this.updateStatus(); }
        break;
      }
      case 'openSource': await this.openSource(document.uri, message.offset); break;
      case 'scrollIntent': {
        if (!Number.isSafeInteger(message.epoch) || message.epoch < 0) break;
        const generation = this.sourceScrollGenerations.get(document.uri.toString()) ?? 0;
        if (message.generation !== generation) {
          this.post(panel, { type: 'scrollIntent', active: false, generation, epoch: message.epoch }); break;
        }
        if (message.active === true && panel.visible && readerSettings(document.uri).syncScroll) {
          const owner = this.readerScrollOwners.get(document.uri.toString());
          if (owner?.panel === panel && owner.epoch > message.epoch) break;
          this.readerScrollOwners.set(document.uri.toString(), { panel, epoch: message.epoch });
          for (const editor of vscode.window.visibleTextEditors) if (editor.document.uri.toString() === document.uri.toString()) this.sourceScroll.cancel(editor);
        } else if (message.active === false) {
          const owner = this.readerScrollOwners.get(document.uri.toString());
          if (owner?.panel === panel && owner.epoch === message.epoch) this.releaseReaderInput(document.uri, false);
        }
        break;
      }
      case 'revealSource': {
        if (!panel.visible || !readerSettings(document.uri).syncScroll || !Number.isSafeInteger(message.offset)) break;
        const generation = this.sourceScrollGenerations.get(document.uri.toString()) ?? 0;
        if (message.generation !== generation) {
          this.post(panel, { type: 'scrollIntent', active: false, generation, epoch: message.epoch }); break;
        }
        const owner = this.readerScrollOwners.get(document.uri.toString());
        if (owner?.panel !== panel || owner.epoch !== message.epoch) break;
        const editor = vscode.window.visibleTextEditors.find(item => item.document.uri.toString() === document.uri.toString());
        if (editor) {
          const position = document.positionAt(Math.max(0, message.offset));
          this.sourceScroll.cancel(editor);
          if (editor.visibleRanges[0]?.start.isEqual(position)) break;
          const smooth = vscode.workspace.getConfiguration('editor', document).get('smoothScrolling', false);
          const previous = this.readerScrollTargets.get(editor);
          const from = document.offsetAt(editor.visibleRanges[0]?.start ?? position);
          this.clearReaderScrollTarget(editor);
          this.readerScrollTargets.set(editor, { offset: document.offsetAt(position), from, last: from, direction: previous?.direction ?? 0,
            smooth, released: false,
            // Native smooth scrolling runs for 125 ms. Allow one frame/message
            // of delivery slack after that animation, without extending the
            // deadline when source input begins while the target is visible.
            timer: setTimeout(() => this.clearReaderScrollTarget(editor), smooth ? 150 : 32) });
          // Use a source range, as VS Code's Markdown preview does, so wrapped
          // text is revealed from this character through the next source line.
          const end = position.line + 1 < document.lineCount ? new vscode.Position(position.line + 1, 0) : document.lineAt(position.line).range.end;
          editor.revealRange(new vscode.Range(position, end), vscode.TextEditorRevealType.AtTop);
        }
        break;
      }
      case 'openSettings': await vscode.commands.executeCommand('limr.openSettings'); break;
      case 'openSkillGuide': await showSkillGuide(this.context, document.uri); break;
      case 'installSkill': await installSkill(this.context, document.uri); break;
      case 'setFileSettings': await this.setFileSettings(document.uri, message.settings); break;
      case 'setTheme': if (themes.some(theme => theme.value === message.theme)) await setReaderSetting(document.uri, 'theme', message.theme); break;
      case 'setEditing':
        if (typeof message.enabled !== 'boolean') return;
        if (message.enabled && !vscode.workspace.isTrusted) throw new Error(this.text(document.uri, '请先信任工作区，再启用 Markdown 编辑。', 'Trust this workspace before enabling Markdown editing.'));
        await setReaderSetting(document.uri, 'editingEnabled', message.enabled); break;
      case 'copyFallback':
        if (typeof message.text !== 'string') return;
        await vscode.env.clipboard.writeText(message.text);
        void vscode.window.showInformationMessage(this.text(document.uri, 'LiMR：已复制文本上下文，可粘贴给 AI 助手。', 'LiMR: Context copied. Paste it into your AI assistant.')); break;
      case 'openLink': if (typeof message.href === 'string') await this.openLink(document.uri, message.href, panel.viewColumn); break;
    }
  }
  private async applySourceEdit(document: vscode.TextDocument, panel: vscode.WebviewPanel, message: Extract<WebviewMessage, { type: 'edit' }>): Promise<void> {
    try {
      if (!readerSettings(document.uri).editingEnabled) throw new Error(this.text(document.uri, '当前处于只读模式，未修改 Markdown。', 'The reader is read-only. Markdown was not changed.'));
      if (document.isClosed || message.baseVersion !== document.version || message.baseSource !== document.getText()) throw new Error(this.text(document.uri, 'Markdown 已被其他编辑更新。已刷新阅读器，请重新提交修改。', 'Markdown changed in another editor. The reader has refreshed; please submit again.'));
      if (typeof message.requestId !== 'string') throw new Error(this.text(document.uri, '无效的修改请求。', 'Invalid edit request.'));
      const edits = validateTransaction(document.getText(), message.edits, message.source);
      const transaction = new vscode.WorkspaceEdit();
      for (const edit of edits) transaction.replace(document.uri, new vscode.Range(document.positionAt(edit.range.start), document.positionAt(edit.range.end)), edit.text);
      const accepted = await vscode.workspace.applyEdit(transaction);
      if (!accepted) throw new Error(this.text(document.uri, 'VS Code 未能应用修改，请重试。', 'VS Code could not apply the changes. Please retry.'));
      if (document.getText() !== message.source) throw new Error(this.text(document.uri, '文档在提交期间发生了变化，请检查最新内容。', 'The document changed during submission. Check the latest content.'));
      this.post(panel, { type: 'editResult', requestId: message.requestId, success: true, state: this.state(document, panel.webview) });
    } catch (error) {
      this.post(panel, { type: 'editResult', requestId: message.requestId, success: false, error: error instanceof Error ? error.message : String(error), state: this.state(document, panel.webview) });
    }
  }
  private async openLink(documentUri: vscode.Uri, href: string, readerColumn?: vscode.ViewColumn): Promise<void> {
    const link = resolveReaderLink({ documentUri: documentUri.toString(), workspaceUri: vscode.workspace.getWorkspaceFolder(documentUri)?.uri.toString(), href });
    if (link.kind === 'external') { await vscode.env.openExternal(vscode.Uri.parse(link.uri)); return; }
    if (link.kind === 'anchor') return;
    const uri = vscode.Uri.parse(link.uri);
    if (!/\.(?:md|markdown)$/i.test(uri.path) && link.line === undefined) {
      await vscode.commands.executeCommand('vscode.open', uri, { viewColumn: this.fileViewColumn(uri, readerColumn), preview: false }); return;
    }
    const doc = await vscode.workspace.openTextDocument(uri);
    await this.openSource(uri, link.line ? doc.offsetAt(new vscode.Position(link.line - 1, 0)) : undefined, readerColumn);
  }
  private html(webview: vscode.Webview): string {
    const nonce = randomBytes(24).toString('base64');
    const assets = vscode.Uri.joinPath(this.context.extensionUri, 'dist', 'webview');
    const script = webview.asWebviewUri(vscode.Uri.joinPath(assets, 'main.js'));
    const style = webview.asWebviewUri(vscode.Uri.joinPath(assets, 'main.css'));
    const csp = `default-src 'none'; base-uri ${webview.cspSource}; img-src ${webview.cspSource} https: http: data: blob:; media-src ${webview.cspSource} https: blob:; font-src ${webview.cspSource} data:; style-src ${webview.cspSource} 'unsafe-inline'; script-src ${webview.cspSource} 'nonce-${nonce}' 'wasm-unsafe-eval'; connect-src ${webview.cspSource}; worker-src ${webview.cspSource} blob:;`;
    return `<!DOCTYPE html><html lang="${readerLocale(vscode.workspace.getConfiguration('limr').get('language', 'auto'))}"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><meta http-equiv="Content-Security-Policy" content="${csp}"><link rel="stylesheet" href="${style}"><title>LiMR Reader</title></head><body><div id="root"></div><script type="module" nonce="${nonce}" src="${script}"></script></body></html>`;
  }
}

export function deactivate() {}
