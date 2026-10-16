export type ReaderTheme = 'playground' | 'playground-light' | 'playground-dark' | 'auto' | 'vscode-light' | 'vscode-dark' | 'one-dark-pro' | 'one-dark-pro-darker';
export type ReaderTypography = 'standard' | 'justify' | 'knuth-plass';
export type ReaderTranslationMode = 'bilingual' | 'original' | 'translated' | 'paragraph';
export type ParagraphTranslationMode = 'origin' | 'translation' | 'both';
export type ReaderTocMode = 'always' | 'wide' | 'hidden';
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
  lineHeight: number;
  maxWidth: number;
  sidebarMode: ReaderSidebarMode;
  sidebarAutoCollapse: boolean;
  imagePathMode: ReaderImagePathMode;
  imageBaseFolder: string;
  imageSearchPaths: string[];
  showToc: boolean;
  tocMode: ReaderTocMode;
  typography: ReaderTypography;
  translationMode: ReaderTranslationMode;
  language: ReaderLanguage;
  locale: 'zh-CN' | 'en';
  topBarButtons: ReaderButton[];
  bottomBarButtons: ReaderButton[];
  fileOverrides: ReaderFileSettings;
  syncScroll: boolean;
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
  document: ReaderDocument;
  settings: ReaderSettings;
  themeKind: 'light' | 'dark' | 'high-contrast' | 'high-contrast-light';
  themeName: string;
  resourceBase: string;
  trusted: boolean;
  plugins?: { id: string; stylesheet?: string; module?: string }[];
}
export interface SourceEdit { range: { start: number; end: number }; text: string }
export type HostMessage =
  | { type: 'state'; state: ReaderState }
  | { type: 'imageResolved'; requestId: string; src: string; uri?: string; reason?: 'missing' | 'ambiguous' | 'unsupported' }
  | { type: 'editResult'; requestId: string; success: boolean; state: ReaderState; error?: string }
  | { type: 'reveal'; offset: number }
  | { type: 'notice'; message: string; error?: boolean };
export type WebviewMessage =
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
  | { type: 'setFileSettings'; settings: ReaderFileSettings }
  | { type: 'copyFallback'; text: string }
  | { type: 'openLink'; href: string }
  | { type: 'revealSource'; offset: number };
