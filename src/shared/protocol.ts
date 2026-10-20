export type ReaderTheme = 'playground' | 'playground-light' | 'playground-dark' | 'auto' | 'vscode-light' | 'vscode-dark' | 'one-dark-pro' | 'one-dark-pro-darker';
export type ReaderTypography = 'standard' | 'justify' | 'knuth-plass';
export type ReaderTranslationMode = 'bilingual' | 'original' | 'translated' | 'paragraph';
export type ParagraphTranslationMode = 'origin' | 'translation' | 'both';
export type ReaderTocMode = 'always' | 'wide' | 'hidden';
export type ReaderContentAlignment = 'window' | 'remaining';
export type ReaderSidebarMode = 'always' | 'content' | 'hidden';
export type ReaderImagePathMode = 'auto' | 'file' | 'workspace' | 'folder';
export type ReaderLanguage = 'auto' | 'zh-CN' | 'en';
export type ReaderButton = 'theme' | 'editing' | 'typography' | 'translation' | 'ai' | 'settings' | 'source';
export interface ReaderFileSettings {
  typography?: ReaderTypography;
  translationMode?: ReaderTranslationMode;
  translationParagraphs?: Record<string, ParagraphTranslationMode>;
}
export interface ReaderSettings {
  theme: ReaderTheme;
  editingEnabled: boolean;
  bodyFontFamily: string;
  chineseFontFamily: string;
  otherFontFamily: string;
  bodyFontSize: number;
  chineseFontSize: number;
  otherFontSize: number;
  codeFontFamily: string;
  codeFontSize: number;
  codeBlockLineNumbers: boolean;
  codeBlockAutoCollapse: boolean;
  codeBlockWrap: boolean;
  lineHeight: number;
  maxWidth: number;
  sidebarMode: ReaderSidebarMode;
  sidebarAutoCollapse: boolean;
  imagePathMode: ReaderImagePathMode;
  imageBaseFolder: string;
  imageSearchPaths: string[];
  showToc: boolean;
  tocMode: ReaderTocMode;
  contentAlignment: ReaderContentAlignment;
  typography: ReaderTypography;
  translationMode: ReaderTranslationMode;
  language: ReaderLanguage;
  locale: 'zh-CN' | 'en';
  topBarButtons: ReaderButton[];
  bottomBarButtons: ReaderButton[];
  fileOverrides: ReaderFileSettings;
  syncScroll: boolean;
  tableLayoutEnabled: boolean;
  /** Preview first by default; blocking waits for the complete document. */
  loadingMode?: 'blocking' | 'progressive';
}
/** Small host-facing state: never transfer an engine, AST, source or controls. */
export interface ReaderLoadProgress {
  uri: string;
  version: number;
  requestId: string;
  status: 'loading' | 'ready' | 'cancelled' | 'error';
  phase: 'read' | 'parse' | 'index' | 'ready';
  percent: number;
  error?: string;
}
export interface ReaderDocument {
  uri: string;
  fsPath: string;
  relativePath: string;
  name: string;
  source: string;
  version: number;
  isDirty: boolean;
}
export interface ReaderState {
  loadError?: import('./load-limits').ReaderLoadError;
  /** Host-local ordering for provisional translation preferences. */
  translationEpoch?: number;
  document: ReaderDocument;
  settings: ReaderSettings;
  themeKind: 'light' | 'dark' | 'high-contrast' | 'high-contrast-light';
  themeName: string;
  resourceBase: string;
  trusted: boolean;
  plugins?: { id: string; stylesheet?: string; module?: string }[];
}
export interface SourceEdit { range: { start: number; end: number }; text: string }
export type ReaderFindCommand = 'find' | 'findNext' | 'findPrevious';
export type ReaderCommand = ReaderFindCommand | 'selectionAction';
/** View preferences never carry another copy of the Markdown buffer. */
export type ReaderConfiguration = Omit<ReaderState, 'document'>;
export type HostMessage =
  | { type: 'readerCommand'; command: ReaderCommand; actionId?: string }
  | { type: 'questionContext'; requestId: string; context?: import('./ai-context').AIContext; error?: string }
  | { type: 'requestHistory'; direction: 'back' | 'forward' }
  | { type: 'navigateTo'; location: import('../navigation').ReaderLocation }
  | { type: 'loadingAction'; requestId: string; action: 'cancel' | 'retry' }
  | { type: 'translationIntent'; uri: string; epoch: number }
  | { type: 'state'; state: ReaderState; sourceBytes?: ArrayBuffer; sourceCharacters?: number }
  | { type: 'configuration'; configuration: ReaderConfiguration; document: Omit<ReaderDocument, 'source'> }
  | { type: 'imageResolved'; requestId: string; src: string; uri?: string; reason?: 'missing' | 'ambiguous' | 'unsupported' }
  | { type: 'editResult'; requestId: string; success: boolean; state: ReaderState; error?: string }
  | { type: 'reveal'; offset: number }
  | { type: 'scrollIntent'; active: false; generation: number; epoch?: number }
  | { type: 'notice'; message: string; error?: boolean };
export type WebviewMessage =
  | { type: 'prepareQuestionContext'; requestId: string; version: number; input: Pick<import('./ai-context').AIContextInput, 'ranges' | 'selectedText' | 'rangeIds' | 'annotationIds' | 'peers'> }
  | { type: 'retryLoad' }
  | { type: 'loadProgress'; progress: ReaderLoadProgress }
  | { type: 'ready' }
  | { type: 'resolveImage'; requestId: string; src: string }
  | { type: 'notify'; message: string; error?: boolean }
  | { type: 'edit'; requestId: string; baseVersion: number; baseSource: string; source: string; edits: SourceEdit[] }
  | { type: 'openSource'; offset?: number }
  | { type: 'openSettings' }
  | { type: 'openSkillGuide' }
  | { type: 'installSkill' }
  | { type: 'setTheme'; theme: ReaderTheme }
  | { type: 'setEditing'; enabled: boolean }
  | { type: 'setFileSettings'; settings: ReaderFileSettings; translationEpoch?: number; documentVersion?: number }
  | { type: 'copyFallback'; text: string }
  | { type: 'openLink'; href: string; position?: { source: number; offset: number } }
  | { type: 'navigateHistory'; direction: 'back' | 'forward'; position?: { source: number; offset: number } }
  | { type: 'revealSource'; offset: number; epoch: number; generation: number }
  | { type: 'scrollIntent'; active: boolean; epoch: number; generation: number };
