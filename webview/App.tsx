import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Reader, chinese, english, codeHighlight, standard, ToolIcon, type SourceChange } from '@linloir/limr';
import type { HostMessage, ReaderFileSettings, ReaderState } from '../src/shared/protocol';
import { readingAnnotations } from './annotations';
import { readerActions } from './actions';
import { listen, post } from './bridge';
import { DraftStore, EditorContext } from './editor-context';
import { languageTypography } from './typography';
import { readerTranslations, TranslationPreferences } from './translations';
import { PluginBoundary, useWorkspacePlugins } from './plugins';
import { ReaderScrollSync } from './scroll-sync';
import { ReaderImages } from './images';
import { readerFrontmatter } from './frontmatter';
import { useReaderSidebar } from './sidebar';

interface PendingEdit {
  id: string; baseVersion: number; baseSource: string; source: string;
  promise: Promise<void>; resolve(): void; reject(error: Error): void;
}
const noExternalAnnotations = Object.freeze([]);
const noWorkspacePlugins = Object.freeze([]);

export function App() {
  const [state, setState] = useState<ReaderState | null>(null);
  const [source, setSource] = useState('');
  const [busy, setBusy] = useState(false);
  const [scrollRoot, setScrollRoot] = useState<HTMLDivElement | null>(null);
  const [readerWidth, setReaderWidth] = useState(0);
  const stateRef = useRef(state), pending = useRef<PendingEdit | null>(null);
  const drafts = useRef(new DraftStore());
  const scrollSync = useRef<ReaderScrollSync | null>(null);
  const notify = useCallback((message: string, error = false) => {
    post({ type: 'notify', message, error });
  }, []);
  const locale = state?.settings.locale ?? 'en';
  const workspacePlugins = useWorkspacePlugins(state?.plugins ?? noWorkspacePlugins, notify);
  const sidebarEnabled = useReaderSidebar(scrollRoot, state?.settings.sidebarMode ?? 'content', state?.document.uri);
  const updateFileSettings = useCallback((fileOverrides: ReaderFileSettings) => {
    const current = stateRef.current;
    if (!current) return;
    const next = { ...current, settings: { ...current.settings, fileOverrides,
      typography: fileOverrides.typography ?? current.settings.typography,
      translationMode: fileOverrides.translationMode ?? current.settings.translationMode,
    } };
    stateRef.current = next; setState(next);
    post({ type: 'setFileSettings', settings: fileOverrides });
  }, []);
  const applyState = useCallback((incoming: ReaderState, force = false) => {
    const current = stateRef.current;
    // A delayed acknowledgement must never replace a newer editor revision.
    const next = current?.document.uri === incoming.document.uri && current.document.version > incoming.document.version
      ? { ...incoming, document: current.document } : incoming;
    stateRef.current = next; setState(next);
    const edit = pending.current;
    if (force || !edit || next.document.version > edit.baseVersion || next.document.source !== edit.baseSource) setSource(next.document.source);
  }, []);
  useEffect(() => {
    const receive = (message: HostMessage) => {
      if (message.type === 'state') applyState(message.state);
      else if (message.type === 'editResult') {
        const edit = pending.current;
        if (!edit || edit.id !== message.requestId) { applyState(message.state); return; }
        pending.current = null; setBusy(false); applyState(message.state, true);
        if (message.success) edit.resolve();
        else {
          const error = new Error(message.error || (stateRef.current?.settings.locale === 'zh-CN' ? '无法写入 Markdown，已恢复编辑器中的内容。' : 'Could not write Markdown. The editor content has been restored.'));
          edit.reject(error); notify(error.message, true);
        }
      } else if (message.type === 'notice') notify(message.message, message.error);
      else if (message.type === 'reveal') scrollSync.current?.reveal(message.offset);
    };
    const dispose = listen(receive); post({ type: 'ready' });
    return dispose;
  }, [applyState, notify]);

  const editSource = useCallback((nextSource: string, change: SourceChange): boolean => {
    const current = stateRef.current;
    if (!current?.settings.editingEnabled || !current.trusted || pending.current) return false;
    if (change.document.source !== current.document.source) {
      notify(current.settings.locale === 'zh-CN' ? 'Markdown 已在编辑器中更新。请在同步后重试。' : 'Markdown changed in the editor. Please retry after synchronization.', true); return false;
    }
    let resolve!: () => void, reject!: (error: Error) => void;
    const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
    // Checkbox/highlighter commands do not await a promise, so keep rejection handled here too.
    void promise.catch(() => {});
    const id = crypto.randomUUID();
    pending.current = { id, baseVersion: current.document.version, baseSource: current.document.source, source: nextSource, promise, resolve, reject };
    setBusy(true); setSource(nextSource);
    post({ type: 'edit', requestId: id, baseVersion: current.document.version, baseSource: current.document.source,
      source: nextSource, edits: change.edits.map(edit => ({ range: { ...edit.range }, text: edit.text })) });
    return true;
  }, [notify]);
  const editingEnabled = !!state?.settings.editingEnabled && !!state?.trusted;
  const editorSession = useMemo(() => ({ busy, editingEnabled, drafts: drafts.current,
    waitForCommit: () => pending.current?.promise ?? Promise.resolve(), notify,
  }), [busy, editingEnabled, notify]);
  const actions = useMemo(() => readerActions({
    getDocument: () => stateRef.current!.document,
    canWrite: () => !!stateRef.current?.settings.editingEnabled && !!stateRef.current?.trusted,
    getLanguage: () => stateRef.current?.settings.locale ?? 'en',
    isBusy: () => !!pending.current, notify,
  }), [notify, locale]);
  const selectedTheme = state?.settings.theme ?? 'playground';
  const playground = selectedTheme.startsWith('playground');
  const isDark = selectedTheme === 'auto' || selectedTheme === 'playground'
    ? state?.themeKind === 'dark' || state?.themeKind === 'high-contrast'
    : selectedTheme !== 'vscode-light' && selectedTheme !== 'playground-light';
  const oneDark = selectedTheme.startsWith('one-dark') || selectedTheme === 'auto' && /one dark pro/i.test(state?.themeName ?? '');
  const extensions = useMemo(() => [
    ...standard().filter(extension => extension.name !== 'code-highlight'),
    codeHighlight({ lightTheme: playground ? 'github-light' : 'light-plus', darkTheme: playground ? 'github-dark' : oneDark ? 'one-dark-pro' : 'dark-plus' }),
    readerFrontmatter(), readingAnnotations(locale), languageTypography(), readerTranslations(),
  ], [oneDark, playground, locale]);

  useLayoutEffect(() => {
    if (!state) return;
    document.body.dataset.readerTheme = selectedTheme;
    document.body.dataset.readerBrightness = isDark ? 'dark' : 'light';
    document.body.dataset.readerContrast = state.themeKind.startsWith('high-contrast') ? 'high' : 'normal';
    document.documentElement.lang = locale;
    document.body.style.colorScheme = isDark ? 'dark' : 'light';
    const settings = state.settings, style = document.body.style;
    const values: Record<string, string> = {
      '--lv-font-body': settings.bodyFontFamily || '"Noto Serif SC Variable", Georgia, serif',
      '--lv-font-chinese': settings.chineseFontFamily || 'var(--lv-font-body)',
      '--lv-font-other': settings.otherFontFamily || 'var(--lv-font-body)',
      '--lv-font-code': settings.codeFontFamily || '"LiMR Maple Mono NF CN", "Maple Mono NF CN", "Maple Mono", "SFMono-Regular", Consolas, monospace',
      '--lv-body-size': `${settings.bodyFontSize}px`, '--lv-code-size': `${settings.codeFontSize}px`,
      '--lv-chinese-ratio': String((settings.chineseFontSize || settings.bodyFontSize) / settings.bodyFontSize),
      '--lv-other-ratio': String((settings.otherFontSize || settings.bodyFontSize) / settings.bodyFontSize),
      '--lv-line-height': String(settings.lineHeight), '--lv-content-width': `${settings.maxWidth}px`,
    };
    Object.entries(values).forEach(([key, value]) => style.setProperty(key, value));
    let base = document.head.querySelector<HTMLBaseElement>('base[data-reader-resources]');
    if (!base) { base = document.createElement('base'); base.dataset.readerResources = ''; document.head.append(base); }
    base.href = state.resourceBase.endsWith('/') ? state.resourceBase : `${state.resourceBase}/`;
  }, [state, isDark, selectedTheme, locale]);

  useEffect(() => {
    const click = (event: MouseEvent) => {
      const anchor = event.target instanceof Element ? event.target.closest('a') : null;
      const href = anchor?.getAttribute('href');
      if (!href || event.defaultPrevented) return;
      event.preventDefault();
      if (href.startsWith('#')) {
        let id = href.slice(1); try { id = decodeURIComponent(id); } catch { /* literal anchor */ }
        document.getElementById(id)?.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'start' });
      } else post({ type: 'openLink', href });
    };
    document.addEventListener('click', click); return () => document.removeEventListener('click', click);
  }, []);
  useEffect(() => {
    if (!scrollRoot) return;
    const sync = new ReaderScrollSync(scrollRoot, () => !!stateRef.current?.settings.syncScroll,
      offset => post({ type: 'revealSource', offset }));
    scrollSync.current = sync;
    return () => { sync.dispose(); scrollSync.current = null; };
  }, [scrollRoot]);

  const imageConfiguration = JSON.stringify([state?.settings.imagePathMode, state?.settings.imageBaseFolder, state?.settings.imageSearchPaths]);
  useLayoutEffect(() => {
    if (!scrollRoot || !state?.document.uri) return;
    const images = new ReaderImages(document.body, (requestId, src) => post({ type: 'resolveImage', requestId, src }));
    const dispose = listen(message => { if (message.type === 'imageResolved') images.accept(message); });
    return () => { dispose(); images.dispose(); };
  }, [scrollRoot, state?.document.uri, imageConfiguration]);

  useLayoutEffect(() => {
    if (!scrollRoot) return;
    // The content box excludes the outer gutters and scrollbar. Reserve equal
    // rails only when the full reading measure and a usable TOC both fit.
    const observer = new ResizeObserver(([entry]) => setReaderWidth(entry.contentRect.width));
    observer.observe(scrollRoot);
    return () => observer.disconnect();
  }, [scrollRoot]);

  if (!state) return <div className="lv-loading" role="status"><p>Opening Markdown…</p></div>;
  const centeredToc = readerWidth >= state.settings.maxWidth + 2 * (200 + 24);
  const sideTocAvailable = sidebarEnabled && readerWidth >= 1120 || centeredToc;
  const tocVisible = state.settings.tocMode === 'always' || state.settings.tocMode === 'wide' && sideTocAvailable;
  return <div className={`lv-app${busy ? ' is-saving' : ''}`} data-testid="reader-app" data-editing={editingEnabled} aria-busy={busy}>
    <div className="lv-scroll" ref={setScrollRoot} data-testid="reader-scroll">
      <EditorContext.Provider value={editorSession}>
        <TranslationPreferences.Provider value={{ settings: state.settings, update: updateFileSettings }}>
        <PluginBoundary plugins={workspacePlugins} notify={notify}>{plugins => <Reader key={state.document.uri} className={`lv-reader${centeredToc ? ' lv-centered-toc' : ''}`} source={source} documentId={state.document.uri}
          theme={isDark ? 'dark' : 'light'} appearance={playground ? 'classic' : 'vscode'} locale={locale === 'zh-CN' ? chinese : english} extensions={extensions} plugins={plugins}
          actions={actions} annotations={noExternalAnnotations} onSourceChange={editingEnabled ? editSource : undefined}
          typography={state.settings.typography}
          sidebar={sidebarEnabled} sidebarBreakpoint={tocVisible ? 1120 : 900} sidebarCollapse={state.settings.sidebarAutoCollapse} toc={tocVisible}
          scrollRoot={scrollRoot} scrollOffset={18} />}</PluginBoundary>
        </TranslationPreferences.Provider>
      </EditorContext.Provider>
      {!source.trim() && <div className="lv-empty"><ToolIcon name="note" /><p>{locale === 'zh-CN' ? '这份 Markdown 还是空白。' : 'This Markdown document is empty.'}</p><button type="button" onClick={() => post({ type: 'openSource' })}><span className="limr-underline">{locale === 'zh-CN' ? '在编辑器中开始书写' : 'Start writing in the editor'}</span></button></div>}
    </div>
  </div>;
}
