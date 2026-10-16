import { describe, expect, it } from 'vitest';
import { resolveReaderLink } from '../src/links';

const documentUri = 'vscode-remote://wsl+Ubuntu/home/user/project/docs/readme.md';
const workspaceUri = 'vscode-remote://wsl+Ubuntu/home/user/project';

describe('reader links', () => {
  it('resolves parent assets and strips file query without losing the remote provider', () => {
    expect(resolveReaderLink({ documentUri, workspaceUri, href: '../images/diagram%20one.svg?raw=true' }))
      .toEqual({ kind: 'internal', uri: 'vscode-remote://wsl+Ubuntu/home/user/project/images/diagram%20one.svg' });
  });

  it('resolves leading-slash Markdown links against the workspace root', () => {
    expect(resolveReaderLink({ documentUri, workspaceUri, href: '/guide.md?preview=1#L12-L20' }))
      .toEqual({ kind: 'internal', uri: 'vscode-remote://wsl+Ubuntu/home/user/project/guide.md', line: 12, fragment: 'L12-L20' });
  });

  it('preserves encoded filename punctuation and decodes the fragment separately', () => {
    expect(resolveReaderLink({ documentUri, href: 'a%23b%3Fc%20d.md?view=raw#%E4%B8%AD%E6%96%87' }))
      .toEqual({ kind: 'internal', uri: 'vscode-remote://wsl+Ubuntu/home/user/project/docs/a%23b%3Fc%20d.md', fragment: '中文' });
    expect(resolveReaderLink({ documentUri, href: '#%E4%B8%AD%E6%96%87' }))
      .toEqual({ kind: 'anchor', id: '中文' });
  });

  it('preserves Windows file drives for relative, workspace-root and filesystem-root links', () => {
    const windows = 'file:///C:/Projects/Notes/docs/readme.md';
    expect(resolveReaderLink({ documentUri: windows, href: '..\\images\\a.png' }))
      .toEqual({ kind: 'internal', uri: 'file:///C:/Projects/Notes/images/a.png' });
    expect(resolveReaderLink({ documentUri: windows, workspaceUri: 'file:///C:/Projects/Notes', href: '/intro.md#L3C2' }))
      .toEqual({ kind: 'internal', uri: 'file:///C:/Projects/Notes/intro.md', line: 3, fragment: 'L3C2' });
    expect(resolveReaderLink({ documentUri: windows, href: '/elsewhere.md' }))
      .toEqual({ kind: 'internal', uri: 'file:///C:/elsewhere.md' });
  });

  it('keeps external HTTP and mailto query data intact', () => {
    expect(resolveReaderLink({ documentUri, href: 'https://example.com/page?q=x#part' }))
      .toEqual({ kind: 'external', uri: 'https://example.com/page?q=x#part' });
    expect(resolveReaderLink({ documentUri, href: 'mailto:reader@example.com?subject=LiMR' }))
      .toEqual({ kind: 'external', uri: 'mailto:reader@example.com?subject=LiMR' });
  });

  it('rejects executable schemes, protocol-relative links and malformed escapes', () => {
    for (const href of ['command:workbench.action.closeWindow', 'javascript:alert(1)', 'data:text/html,hello',
      '//example.com/file', '\\\\example.com\\file', 'other.md%xx', 'java\nscript:alert(1)']) {
      expect(() => resolveReaderLink({ documentUri, href })).toThrow();
    }
  });
});
