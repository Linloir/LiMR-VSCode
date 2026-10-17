import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { chinese, english, standard, ToolIcon, type SourceChange, type DocumentSnapshot } from '@linloir/limr';
import type { HostMessage, ReaderFileSettings, ReaderState } from '../src/shared/protocol';
import { readingAnnotations } from './annotations';
import { readerActions } from './actions';
import { listen, post } from './bridge';
import { DraftStore, EditorContext } from './editor-context';
import { languageTypography } from './typography';
import { useTranslationParameters } from './translations';
import { readerCodeHighlight } from './reader-extensions';
import { HostedReader, ReaderIntegration, type ReaderCommands } from './reader-integration';
import { PluginBoundary, useWorkspacePlugins } from './plugins';
import { ReaderScrollSync } from './scroll-sync';
import { ReaderImages } from './images';
import { readerFrontmatter } from './frontmatter';
import { useReaderViewState } from './reader-view-state';
import { applyReaderConfiguration } from './reader-state';
import { loadErrorMessage, fitsPreviewLimit } from '../src/shared/load-limits';

interface PendingEdit {
  id: string; baseVersion: number; baseSource: string; source: string;
  promise: Promise<void>; resolve(): void; reject(error: Error): void;
}
const noExternalAnnotations = Object.freeze([]);
const noWorkspacePlugins = Object.freeze([]);
const MemoReader = memo(HostedReader);

export function App() {
  const [state, setState] = useState<ReaderState | null>(null);
  const [source, setSourceState] = useState('');
  const requestedSource = useRef(''), readerReadyRef = useRef(false);
  const setSource = useCallback((next: string) => {
    // Native reveal messages can arrive before React commits a replacement.
    // Invalidate the old bridge immediately, then let the new reader publish it.
    if (requestedSource.current !== next) { requestedSource.current = next; readerReadyRef.current = false; }
    setSourceState(next);
  }, []);
  const [busy, setBusy] = useState(false);
  const [scrollRoot, setScrollRoot] = useState<HTMLDivElement | null>(null);
  const [readerWidth, setReaderWidth] = useState(0);
  const readerCommands = useRef<ReaderCommands | null>(null);
  const [readerContent, setReaderContent] = useState<{ uri: string; source: string; complete: boolean; hasContent: boolean } | null>(null);
  const stateRef = useRef(state), pending = useRef<PendingEdit | null>(null);
  const drafts = useRef(new DraftStore());
  const scrollSync = useRef<ReaderScrollSync | null>(null);
  const pendingSourceReveal = useRef<number | undefined>(undefined);
  const sourceScrollInput = useRef<{ generation: number; epoch?: number }>({ generation: 0 });
  const notify = useCallback((message: string, error = false) => {
    post({ type: 'notify', message, error });
  }, []);
  const locale = state?.settings.locale ?? 'en';
  const workspacePlugins = useWorkspacePlugins(state?.plugins ?? noWorkspacePlugins, notify);
  const readerReady = useMemo(() => readerContent?.uri === state?.document.uri && readerContent?.source === source && !!readerContent?.complete, [readerContent, state?.document.uri, source]);
  readerReadyRef.current = readerReady;
  useEffect(() => {
    // Echoed reader edits and unchanged-text editor revisions can reuse a
    // completed engine without a new AsyncReader session notification.
    const commands = readerCommands.current;
    if (readerReady && state && !state.loadError && commands?.isDocumentComplete()
      && commands.document.getSnapshot().source === state.document.source)
      post({ type: 'loadProgress', progress: { uri: state.document.uri, version: state.document.version,
        requestId: 'rendered', status: 'ready', phase: 'ready', percent: 100 } });
  }, [readerReady, state?.document.uri, state?.document.version, state?.loadError]);
  const sidebarEnabled = state?.settings.sidebarMode === 'always' || state?.settings.sidebarMode === 'content' && readerContent?.uri === state?.document.uri && !!readerContent?.hasContent;
  useReaderViewState(scrollRoot, state?.document.uri, readerReady, readerCommands);
  const updateFileSettings = useCallback((fileOverrides: ReaderFileSettings, translationEpoch?: number, documentVersion?: number) => {
    const current = stateRef.current;
    if (!current) return;
    const next = { ...current, settings: { ...current.settings, fileOverrides,
      typography: fileOverrides.typography ?? current.settings.typography,
      translationMode: fileOverrides.translationMode ?? current.settings.translationMode,
    } };
    stateRef.current = next; setState(next);
    post({ type: 'setFileSettings', settings: fileOverrides, translationEpoch, documentVersion });
  }, []);
  const translationRequest = useMemo(() => state ? { uri: state.document.uri, version: state.document.version, source } : undefined,
    [state?.document.uri, state?.document.version, source]);
  const { parameters, onDocument: translationDocument, cancel: cancelPendingTranslation } = useTranslationParameters(state?.settings, updateFileSettings, translationRequest, state?.translationEpoch ?? 0);
  const readerParameters = useMemo(() => ({ ...parameters, tableLayout: state?.settings.tableLayoutEnabled === false ? false as const : undefined }), [parameters, state?.settings.tableLayoutEnabled]);
  const readerAvailable = useCallback((commands: ReaderCommands, document: DocumentSnapshot, hasContent: boolean) => {
    readerCommands.current = commands;
    const complete = commands.isDocumentComplete();
    translationDocument(document, complete);
    setReaderContent(previous => {
      // Derived table notes leave the DOM with their table. Keep the rail stable
      // for this revision once it was needed; ordinary source edits reset it.
      const content = hasContent || previous?.uri === document.id && previous.source === document.source && previous.hasContent;
      return previous?.uri === document.id && previous.source === document.source && previous.complete === complete && previous.hasContent === content
        ? previous : { uri: document.id, source: document.source, complete, hasContent: content };
    });
    scrollSync.current?.refresh();
  }, [translationDocument]);
  const readerDisposed = useCallback((commands: ReaderCommands) => { if (readerCommands.current === commands) readerCommands.current = null; }, []);
  const applyState = useCallback((incoming: ReaderState, force = false) => {
    const current = stateRef.current;
    // A delayed acknowledgement must never replace a newer editor revision.
    const next = current?.document.uri === incoming.document.uri && current.document.version > incoming.document.version
      ? { ...incoming, document: current.document } : incoming;
    stateRef.current = next; setState(next);
    if (next.loadError) setReaderContent(null);
    const edit = pending.current;
    if (force || !edit || next.document.version > edit.baseVersion || next.document.source !== edit.baseSource) setSource(next.document.source);
  }, []);
  useEffect(() => {
    const receive = (message: HostMessage) => {
      if (message.type === 'state') {
        const incoming = message.sourceBytes instanceof ArrayBuffer
          ? { ...message.state, document: { ...message.state.document,
            source: new TextDecoder('utf-8', { ignoreBOM: true }).decode(message.sourceBytes) } } : message.state;
        applyState(incoming);
      }
      else if (message.type === 'translationIntent') { if (message.uri === stateRef.current?.document.uri) cancelPendingTranslation(message.epoch); }
      else if (message.type === 'configuration') {
        const next = applyReaderConfiguration(stateRef.current, message);
        if (next) { stateRef.current = next; setState(next); }
      }
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
      else if (message.type === 'reveal') {
        if (scrollSync.current) scrollSync.current.reveal(message.offset);
        else pendingSourceReveal.current = message.offset;
      }
      else if (message.type === 'scrollIntent') {
        if (message.generation >= sourceScrollInput.current.generation) sourceScrollInput.current = message;
        scrollSync.current?.sourceInput(message.generation, message.epoch);
      }
    };
    const dispose = listen(receive); post({ type: 'ready' });
    return dispose;
  }, [applyState, notify, cancelPendingTranslation]);

  const editSource = useCallback((nextSource: string, change: SourceChange): boolean => {
    const current = stateRef.current;
    if (!current?.settings.editingEnabled || !current.trusted || pending.current) return false;
    if (!fitsPreviewLimit(nextSource)) {
      notify(loadErrorMessage('too-large', current.settings.locale), true); return false;
    }
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
  // Parser instances survive palette/locale changes. Only the view-only layer
  // below changes, so AsyncReader keeps its completed engine and reading state.
  const parserExtensions = useMemo(() => [
    ...standard().filter(extension => extension.name !== 'code-highlight'),
    readerCodeHighlight(), readerFrontmatter(), readingAnnotations(), languageTypography(),
  ], []);
  const extensions = useMemo(() => {
    const code = readerCodeHighlight({ lightTheme: playground ? 'github-light' : 'light-plus', darkTheme: playground ? 'github-dark' : oneDark ? 'one-dark-pro' : 'dark-plus' });
    return [...parserExtensions, { name: 'vscode-reader-presentation', components: code.components,
      virtualization: code.virtualization, annotationTypes: readingAnnotations(locale).annotationTypes }];
  }, [parserExtensions, oneDark, playground, locale]);

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
      if (!href || (event.type === 'auxclick' && event.button !== 1)) return;
      // VS Code's window listener forwards links even when defaultPrevented.
      // Also contain anchors already handled by LiMR or a plugin below us.
      event.stopPropagation();
      if (event.defaultPrevented) return;
      event.preventDefault();
      if (href.startsWith('#')) {
        let id = href.slice(1); try { id = decodeURIComponent(id); } catch { /* literal anchor */ }
        const target = document.getElementById(id) ?? document.getElementById(`${stateRef.current?.document.uri}-${id}`);
        target?.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'start' });
      } else post({ type: 'openLink', href });
    };
    document.addEventListener('click', click);
    document.addEventListener('auxclick', click);
    return () => { document.removeEventListener('click', click); document.removeEventListener('auxclick', click); };
  }, []);
  useEffect(() => {
    if (!scrollRoot) return;
    const sync = new ReaderScrollSync(scrollRoot, () => !!stateRef.current?.settings.syncScroll,
      (offset, epoch, generation) => post({ type: 'revealSource', offset, epoch, generation }), (active, epoch, generation) => post({ type: 'scrollIntent', active, epoch, generation }),
      () => readerReadyRef.current && readerCommands.current?.document.id === stateRef.current?.document.uri && readerCommands.current?.isDocumentComplete() ? readerCommands.current : null);
    scrollSync.current = sync;
    sync.sourceInput(sourceScrollInput.current.generation, sourceScrollInput.current.epoch);
    if (pendingSourceReveal.current !== undefined) { sync.reveal(pendingSourceReveal.current); pendingSourceReveal.current = undefined; }
    return () => { sync.dispose(); scrollSync.current = null; };
  }, [scrollRoot]);
  useEffect(() => { scrollSync.current?.reset(); }, [state?.settings.syncScroll]);
  useLayoutEffect(() => { if (readerReady) scrollSync.current?.refresh(); }, [readerReady]);

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
  return <div className={`lv-app${busy ? ' is-saving' : ''}`} data-testid="reader-app" data-editing={editingEnabled} data-reader-ready={readerReady} aria-busy={busy || !readerReady}>
    <div className="lv-scroll" ref={setScrollRoot} data-testid="reader-scroll">
      {state.loadError ? <div className="lv-load-error" role="alert">
        <span>{loadErrorMessage(state.loadError, locale)}</span>
        {state.loadError === 'timeout' && <button type="button" onClick={() => post({ type: 'retryLoad' })}>{locale === 'zh-CN' ? '重试' : 'Retry'}</button>}
        <button type="button" onClick={() => post({ type: 'openSource' })}>{locale === 'zh-CN' ? '打开源码' : 'Open source'}</button>
      </div> : <EditorContext.Provider value={editorSession}>
        <PluginBoundary plugins={workspacePlugins} notify={notify}>{plugins => <MemoReader key={state.document.uri} className={`lv-reader${centeredToc ? ' lv-centered-toc' : ''}`} source={source} documentId={state.document.uri}
          theme={isDark ? 'dark' : 'light'} appearance={playground ? 'classic' : 'vscode'} locale={locale === 'zh-CN' ? chinese : english} extensions={extensions} plugins={plugins}
          actions={actions} annotations={noExternalAnnotations} onSourceChange={editingEnabled ? editSource : undefined}
          typography={state.settings.typography} parameters={readerParameters} loadingMode={state.settings.loadingMode} documentVersion={state.document.version}
          sidebar={sidebarEnabled} sidebarBreakpoint={tocVisible ? 1120 : 900} sidebarCollapse={state.settings.sidebarAutoCollapse} toc={tocVisible}
          scrollRoot={scrollRoot} scrollOffset={18}><ReaderIntegration onReader={readerAvailable} onDispose={readerDisposed} /></MemoReader>}</PluginBoundary>
      </EditorContext.Provider>}
      {!state.loadError && !source.trim() && <div className="lv-empty"><ToolIcon name="note" /><p>{locale === 'zh-CN' ? '这份 Markdown 还是空白。' : 'This Markdown document is empty.'}</p><button type="button" onClick={() => post({ type: 'openSource' })}><span className="limr-underline">{locale === 'zh-CN' ? '在编辑器中开始书写' : 'Start writing in the editor'}</span></button></div>}
    </div>
  </div>;
}
