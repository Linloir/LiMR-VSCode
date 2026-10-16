import { beforeEach, describe, expect, it, vi } from 'vitest';

const values = vi.hoisted(() => ({ config: {} as Record<string, unknown>, language: 'en' }));
vi.mock('vscode', () => ({
  env: { get language() { return values.language; } },
  workspace: {
    isTrusted: true,
    fs: { isWritableFileSystem: () => true },
    getConfiguration: () => ({
      get: (name: string, fallback: unknown) => values.config[name] ?? fallback,
      inspect: (name: string) => ({ workspaceValue: values.config[name] }),
    }),
  },
}));
import { readerLocale, readerSettings } from '../src/settings';

describe('reader preferences', () => {
  beforeEach(() => { values.config = {}; values.language = 'en'; });
  const uri = { scheme: 'file' } as Parameters<typeof readerSettings>[0];

  it('follows VS Code language unless the reader language is explicit', () => {
    values.language = 'zh-tw';
    expect(readerSettings(uri).locale).toBe('zh-CN');
    values.config.language = 'en';
    expect(readerSettings(uri).locale).toBe('en');
    expect(readerLocale('zh-CN', 'en')).toBe('zh-CN');
    expect(readerLocale('auto', 'de')).toBe('en');
  });
  it('applies file typography and translation overrides without changing defaults', () => {
    values.config = { typography: 'justify', translationMode: 'bilingual' };
    const defaults = readerSettings(uri);
    const current = readerSettings(uri, { typography: 'knuth-plass', translationMode: 'paragraph', translationParagraphs: { paragraph: 'origin' } });
    expect(defaults.typography).toBe('justify');
    expect(defaults.translationMode).toBe('bilingual');
    expect(current.typography).toBe('knuth-plass');
    expect(current.translationMode).toBe('paragraph');
    expect(current.fileOverrides.translationParagraphs).toEqual({ paragraph: 'origin' });
    expect(readerSettings(uri)).toEqual(defaults);
  });
  it('allows empty toolbars and filters unsupported or repeated buttons', () => {
    values.config = { topBarButtons: [], bottomBarButtons: ['translation', 'translation', 'unsupported', 'ai'] };
    const settings = readerSettings(uri);
    expect(settings.topBarButtons).toEqual([]);
    expect(settings.bottomBarButtons).toEqual(['translation']);
    values.config.tocMode = 'hidden';
    expect(readerSettings(uri).showToc).toBe(false);
    values.config.tocMode = 'wide';
    expect(readerSettings(uri).tocMode).toBe('wide');
  });
  it('defaults to content-aware sidebars and preserves an existing explicit opt-out', () => {
    expect(readerSettings(uri).sidebarMode).toBe('content');
    values.config = { showSidebar: false };
    expect(readerSettings(uri).sidebarMode).toBe('hidden');
    for (const sidebarMode of ['always', 'content', 'hidden']) {
      values.config.sidebarMode = sidebarMode;
      expect(readerSettings(uri).sidebarMode).toBe(sidebarMode);
    }
    values.config.sidebarMode = 'unsupported';
    expect(readerSettings(uri).sidebarMode).toBe('content');
  });
  it('exposes image strategy and preserves the configured fallback directory order', () => {
    expect(readerSettings(uri)).toMatchObject({ imagePathMode: 'auto', imageBaseFolder: '', imageSearchPaths: [] });
    values.config = { 'images.pathMode': 'folder', 'images.baseFolder': '~/Pictures/My Images', 'images.searchPaths': ['assets', '/shared/图片', 'file:///tmp/images', '', 7] };
    expect(readerSettings(uri)).toMatchObject({ imagePathMode: 'folder', imageBaseFolder: '~/Pictures/My Images', imageSearchPaths: ['assets', '/shared/图片', 'file:///tmp/images'] });
    for (const imagePathMode of ['auto', 'file', 'workspace']) {
      values.config['images.pathMode'] = imagePathMode;
      expect(readerSettings(uri).imagePathMode).toBe(imagePathMode);
    }
    values.config['images.pathMode'] = 'unsupported';
    values.config['images.searchPaths'] = 'assets';
    expect(readerSettings(uri)).toMatchObject({ imagePathMode: 'auto', imageSearchPaths: [] });
  });
});
