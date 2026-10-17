import * as vscode from 'vscode';
import type { ReaderButton, ReaderFileSettings, ReaderLanguage, ReaderSettings, ReaderSidebarMode, ReaderTheme, ReaderTranslationMode, ReaderTypography } from './shared/protocol';

export const typographyModes: readonly ReaderTypography[] = ['standard', 'justify', 'knuth-plass'];
export const translationModes: readonly ReaderTranslationMode[] = ['bilingual', 'original', 'translated', 'paragraph'];
export const topBarButtons: readonly ReaderButton[] = ['theme', 'editing', 'typography', 'translation', 'ai', 'settings', 'source'];
export const bottomBarButtons: readonly ReaderButton[] = ['editing', 'typography', 'translation', 'theme', 'settings'];
export const defaultBottomBarButtons: readonly ReaderButton[] = ['editing', 'typography', 'translation'];

export function readerLocale(language: ReaderLanguage, systemLanguage = vscode.env.language): 'zh-CN' | 'en' {
  return language === 'zh-CN' || language === 'auto' && /^zh(?:-|$)/i.test(systemLanguage) ? 'zh-CN' : 'en';
}
const choice = <T extends string>(value: unknown, allowed: readonly T[], fallback: T): T => allowed.includes(value as T) ? value as T : fallback;
const buttons = (value: unknown, allowed: readonly ReaderButton[], fallback: readonly ReaderButton[]): ReaderButton[] =>
  Array.isArray(value) ? [...new Set(value.filter((item): item is ReaderButton => allowed.includes(item)))] : [...fallback];

export const themes: { label: string; value: ReaderTheme }[] = [
  { label: 'Playground（跟随 VS Code 明暗）', value: 'playground' },
  { label: 'Playground Light', value: 'playground-light' }, { label: 'Playground Dark', value: 'playground-dark' },
  { label: '跟随 VS Code', value: 'auto' }, { label: 'VS Code Light', value: 'vscode-light' },
  { label: 'VS Code Dark', value: 'vscode-dark' }, { label: 'One Dark Pro', value: 'one-dark-pro' },
  { label: 'One Dark Pro Darker', value: 'one-dark-pro-darker' },
];
export function readerSettings(uri: vscode.Uri, fileOverrides: ReaderFileSettings = {}): ReaderSettings {
  const config = vscode.workspace.getConfiguration('limr', uri);
  const language = choice(config.get('language'), ['auto', 'zh-CN', 'en'] as const, 'auto');
  const tocMode = choice(config.get('tocMode'), ['always', 'wide', 'hidden'] as const, 'always');
  const sidebarSetting = config.inspect<ReaderSidebarMode>('sidebarMode');
  const explicitSidebarMode = sidebarSetting && [sidebarSetting.globalValue, sidebarSetting.workspaceValue, sidebarSetting.workspaceFolderValue,
    sidebarSetting.globalLanguageValue, sidebarSetting.workspaceLanguageValue, sidebarSetting.workspaceFolderLanguageValue].some(value => value !== undefined);
  // Keep an existing opt-out until the user chooses the replacement setting.
  const sidebarMode = !explicitSidebarMode && config.get('showSidebar') === false ? 'hidden'
    : choice(config.get('sidebarMode'), ['always', 'content', 'hidden'] as const, 'content');
  const imageSearchPaths = config.get<unknown>('images.searchPaths', []);
  return {
    theme: config.get<ReaderTheme>('theme', 'playground'), editingEnabled: config.get<boolean>('editingEnabled', false) && vscode.workspace.isTrusted && vscode.workspace.fs.isWritableFileSystem(uri.scheme) !== false,
    bodyFontFamily: config.get<string>('bodyFontFamily', ''),
    chineseFontFamily: config.get<string>('chineseFontFamily', ''),
    otherFontFamily: config.get<string>('otherFontFamily', ''), bodyFontSize: config.get<number>('bodyFontSize', 16),
    chineseFontSize: config.get<number>('chineseFontSize', 0), otherFontSize: config.get<number>('otherFontSize', 0),
    codeFontFamily: config.get<string>('codeFontFamily', ''), codeFontSize: config.get<number>('codeFontSize', 14),
    lineHeight: config.get<number>('lineHeight', 1.8), maxWidth: config.get<number>('maxWidth', 860),
    sidebarMode, sidebarAutoCollapse: config.get<boolean>('sidebarAutoCollapse', true), showToc: tocMode !== 'hidden', tocMode,
    imagePathMode: choice(config.get('images.pathMode'), ['auto', 'file', 'workspace', 'folder'] as const, 'auto'),
    imageBaseFolder: config.get<string>('images.baseFolder', ''),
    imageSearchPaths: Array.isArray(imageSearchPaths) ? imageSearchPaths.filter((value): value is string => typeof value === 'string' && !!value.trim()) : [],
    typography: choice(fileOverrides.typography ?? config.get('typography'), typographyModes, 'standard'),
    translationMode: choice(fileOverrides.translationMode ?? config.get('translationMode'), translationModes, 'paragraph'),
    language, locale: readerLocale(language), fileOverrides,
    topBarButtons: buttons(config.get('topBarButtons'), topBarButtons, topBarButtons),
    bottomBarButtons: buttons(config.get('bottomBarButtons'), bottomBarButtons, defaultBottomBarButtons),
    syncScroll: config.get<boolean>('syncScroll', true),
    loadingMode: choice(config.get('loadingMode'), ['blocking', 'progressive'] as const, 'blocking'),
  };
}
export async function setReaderSetting(uri: vscode.Uri | undefined, key: string, value: unknown): Promise<void> {
  const configuration = vscode.workspace.getConfiguration('limr', uri);
  const existing = configuration.inspect(key);
  // Update a scope that actually controls this document. Otherwise a workspace
  // override silently wins over a toolbar change written only to user settings.
  // Without an existing override, keep preferences personal and avoid creating
  // workspace metadata merely to change the reader's appearance.
  const target = existing?.workspaceFolderValue !== undefined ? vscode.ConfigurationTarget.WorkspaceFolder
    : existing?.workspaceValue !== undefined ? vscode.ConfigurationTarget.Workspace
      : vscode.ConfigurationTarget.Global;
  await configuration.update(key, value, target);
}
export function themeKind() {
  switch (vscode.window.activeColorTheme.kind) {
    case vscode.ColorThemeKind.Light: return 'light' as const;
    case vscode.ColorThemeKind.HighContrast: return 'high-contrast' as const;
    case vscode.ColorThemeKind.HighContrastLight: return 'high-contrast-light' as const;
    default: return 'dark' as const;
  }
}
