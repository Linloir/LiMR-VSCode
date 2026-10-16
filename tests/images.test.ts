import { describe, expect, it, vi } from 'vitest';
import { resolveReaderImage } from '../src/images';

const root = 'vscode-remote://wsl+Ubuntu/home/user/project';
const documentUri = `${root}/playground/presets/readme.md`;
const run = (src: string, files: string[], extra = {}) => resolveReaderImage({ documentUri, workspaceUri: root, src, ...extra }, async uri => files.includes(uri));
describe('reader image locations', () => {
  it('keeps exact document-relative images ahead of workspace copies', async () => {
    const exact = `${root}/playground/presets/papers/a.png`;
    expect(await run('./papers/a.png', [exact, `${root}/papers/a.png`])).toMatchObject({ kind: 'local', uri: exact });
  });
  it('tries the containing workspace when a document-relative image is absent', async () => {
    const uri = `${root}/papers/feature-neuron.png`;
    expect(await run('./papers/feature-neuron.png', [uri])).toEqual({ kind: 'local', uri, query: '', fragment: '' });
    expect(await run('papers/feature-neuron.png', [uri], { documentUri: `${root}/playground/presets/en/readme.md` })).toMatchObject({ kind: 'local', uri });
  });
  it('supports workspace-root paths and exact parent paths without guessing static directories', async () => {
    for (const [src, uri] of [['/images/a.png', `${root}/images/a.png`], ['../images/a.png', `${root}/playground/images/a.png`]])
      expect(await run(src, [uri])).toMatchObject({ kind: 'local', uri });
    expect(await run('../missing.png', [`${root}/public/missing.png`])).toEqual({ kind: 'missing' });
    expect(await run('./papers/a.png', [`${root}/playground/public/papers/a.png`])).toEqual({ kind: 'missing' });
  });
  it('does not silently choose between equally plausible fallbacks', async () => {
    expect(await run('/a.png', [`${root}/a.png`, 'vscode-remote://wsl+Ubuntu/a.png'])).toEqual({ kind: 'ambiguous' });
  });
  it('preserves spaces, Unicode, encoded punctuation and URL suffixes separately', async () => {
    const uri = `${root}/playground/presets/a%20%E4%B8%AD%23b.svg`;
    expect(await run('a 中%23b.svg?v=1#icon', [uri])).toEqual({ kind: 'local', uri, query: 'v=1', fragment: 'icon' });
    expect(await run('a#b.png', [`${root}/playground/presets/a%23b.png`])).toMatchObject({ kind: 'local', uri: `${root}/playground/presets/a%23b.png` });
  });
  it('preserves remote providers for file URIs and absolute POSIX paths', async () => {
    const uri = 'vscode-remote://wsl+Ubuntu/home/user/image.png';
    expect(await run('file:///home/user/image.png', [uri])).toMatchObject({ kind: 'local', uri });
    expect(await run('/home/user/image.png', [uri])).toMatchObject({ kind: 'local', uri });
    expect(await run('vscode-remote://ssh-remote+elsewhere/home/user/image.png', [uri])).toEqual({ kind: 'unsupported' });
  });
  it('handles Windows separators and maps explicit Windows drives on WSL', async () => {
    const uri = `${root}/playground/presets/images/a.png`;
    expect(await run('.\\images\\a.png', [uri])).toMatchObject({ kind: 'local', uri });
    const mounted = 'vscode-remote://wsl+Ubuntu/mnt/c/Images/a%20b.png';
    expect(await run('C:\\Images\\a b.png', [mounted], { wsl: true })).toMatchObject({ kind: 'local', uri: mounted });
    expect(await run('file:///C:/Images/a%20b.png', [mounted], { wsl: true })).toMatchObject({ kind: 'local', uri: mounted });
    const native = 'file:///C:/Images/a.png';
    expect(await run('C:\\Images\\a.png', [native], { documentUri: 'file:///C:/Project/readme.md', workspaceUri: 'file:///C:/Project' })).toMatchObject({ kind: 'local', uri: native });
  });
  it('never probes remote URLs and does not search outside the containing workspace', async () => {
    const stat = vi.fn(async (_uri: string) => false);
    for (const src of ['https://example.com/a.png?q=x', 'http://example.com/a.png', 'data:image/png;base64,AA==', 'blob:https://example.com/id'])
      expect(await resolveReaderImage({ documentUri, src }, stat)).toEqual({ kind: 'external', uri: src });
    expect(stat).not.toHaveBeenCalled();
    expect(await resolveReaderImage({ documentUri, workspaceUri: root, src: 'absent.png' }, stat)).toEqual({ kind: 'missing' });
    expect(stat.mock.calls.every(([uri]) => uri.startsWith(`${root}/`))).toBe(true);
    expect(stat.mock.calls.length).toBe(2);
  });
  it('rejects executable sources and malformed escapes', async () => {
    for (const src of ['javascript:alert(1)', 'command:run', 'a%xx.png', 'a\0.png']) expect(await run(src, [])).toEqual({ kind: 'unsupported' });
  });
  it('honors file, workspace and fixed-folder preferences before ordered search paths', async () => {
    const local = `${root}/playground/presets/a.png`, workspace = `${root}/a.png`, fixed = `${root}/resources/a.png`;
    const files = [local, workspace, fixed, `${root}/first/a.png`, `${root}/second/a.png`];
    expect(await run('./a.png', files, { mode: 'file' })).toMatchObject({ uri: local });
    expect(await run('./a.png', files, { mode: 'workspace' })).toMatchObject({ uri: workspace });
    expect(await run('./a.png', files, { mode: 'folder', baseFolder: 'resources' })).toMatchObject({ uri: fixed });
    expect(await run('./a.png', files, { mode: 'folder', baseFolder: 'missing', searchPaths: ['second', 'first'] })).toMatchObject({ uri: `${root}/second/a.png` });
    expect(await run('./a.png', [workspace], { mode: 'file' })).toEqual({ kind: 'missing' });
    expect(await run('./a.png', [local], { mode: 'workspace' })).toEqual({ kind: 'missing' });
    expect(await run('./a.png', files, { mode: 'folder' })).toEqual({ kind: 'missing' });
  });
  it('supports absolute and home search folders while keeping their explicit order', async () => {
    const home = 'vscode-remote://wsl+Ubuntu/home/user/Images/a.png';
    expect(await run('a.png', [home], { mode: 'folder', baseFolder: '~/Images', homeUri: 'file:///home/user' })).toMatchObject({ uri: home });
    expect(await run('a.png', [home], { mode: 'file', searchPaths: ['/home/user/Images'] })).toMatchObject({ uri: home });
    expect(await run('a.png', [home], { mode: 'file', searchPaths: ['file:///home/user/Images'] })).toMatchObject({ uri: home });
  });
  it('does not interpret query or fragment text as filesystem traversal or filename escapes', async () => {
    const uri = `${root}/a.svg`;
    expect(await run('a.svg?path=/../x%xx#icon%20one', [uri])).toEqual({ kind: 'local', uri, query: 'path=/../x%xx', fragment: 'icon%20one' });
    expect(await run('%2e%2e/a.svg', [uri])).toEqual({ kind: 'missing' });
  });
  it('resolves relative configuration folders against the document when no workspace is open', async () => {
    const uri = `${root}/playground/presets/images/a.png`;
    expect(await run('./a.png', [uri], { workspaceUri: undefined, mode: 'folder', baseFolder: 'images' })).toMatchObject({ uri });
    expect(await run('./a.png', [uri], { workspaceUri: undefined, mode: 'workspace' })).toEqual({ kind: 'missing' });
  });
  it('keeps parent traversal relative to the chosen base and never rebases it onto search folders', async () => {
    expect(await run('../missing.png', [`${root}/missing.png`], { searchPaths: ['resources'] })).toEqual({ kind: 'missing' });
    const uri = 'vscode-remote://wsl+Ubuntu/home/user/a.png';
    expect(await run('../a.png', [uri], { mode: 'workspace' })).toMatchObject({ kind: 'local', uri });
  });
  it('does not change a remote authority through a configured UNC directory', async () => {
    const stat = vi.fn(async (_uri: string) => true);
    expect(await resolveReaderImage({ documentUri, workspaceUri: root, src: 'a.png', mode: 'folder', baseFolder: '\\\\elsewhere\\share' }, stat)).toEqual({ kind: 'missing' });
    expect(stat).not.toHaveBeenCalled();
  });
});
