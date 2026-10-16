import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, readFile, writeFile, rm, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type * as vscode from 'vscode';

const api = vi.hoisted(() => {
  class Uri {
    constructor(readonly url: URL) {}
    static file(path: string) { return new Uri(new URL(`file://${path}`)); }
    static joinPath(uri: Uri, ...segments: string[]) {
      const normalized: string[] = [];
      for (const part of [uri.path, ...segments].join('/').split('/')) {
        if (part === '..') normalized.pop(); else if (part && part !== '.') normalized.push(part);
      }
      return Uri.file('/' + normalized.join('/'));
    }
    get path() { return decodeURIComponent(this.url.pathname); }
    get fsPath() { return this.path; }
    get scheme() { return this.url.protocol.slice(0, -1); }
    with({ query }: { query: string }) { const copy = new URL(this.url); copy.search = query; return new Uri(copy); }
    toString() { return this.url.href; }
  }
  class FileSystemError extends Error { constructor(readonly code: string) { super(code); } }
  const state = { trusted: true, enabled: true, folder: undefined as { uri: Uri } | undefined };
  const workspace = {
    get isTrusted() { return state.trusted; },
    getWorkspaceFolder: () => state.folder,
    getConfiguration: () => ({ get: (name: string, fallback: unknown) => name === 'plugins.enabled' ? state.enabled : fallback }),
    fs: { readFile: vi.fn(async (_uri: Uri): Promise<Uint8Array> => new Uint8Array()) },
  };
  return { Uri, FileSystemError, state, workspace };
});
vi.mock('vscode', () => api);
import { loadWorkspacePlugins } from '../src/plugins';

let isolated: string;
let workspace: string;
const webview = { asWebviewUri: vi.fn((uri: { path: string }) => new api.Uri(new URL(`https://webview.example${uri.path}`))) };
const inputUri = () => api.Uri.file(join(workspace, 'document.md')) as unknown as vscode.Uri;
const view = () => webview as unknown as vscode.Webview;
async function fixture() {
  const directory = join(workspace, '.limr', 'plugins');
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, 'manifest.json'), JSON.stringify({ plugins: [{ id: 'sample', stylesheet: 'sample.css', module: 'sample.js' }] }));
  await writeFile(join(directory, 'sample.css'), '.sample { color: red; }');
  await writeFile(join(directory, 'sample.js'), 'export default () => ({ name: "sample" });');
  return directory;
}
beforeEach(async () => {
  isolated = await mkdtemp(join(tmpdir(), 'limr-plugin-host-'));
  workspace = join(isolated, 'workspace'); await mkdir(workspace);
  api.state.trusted = true; api.state.enabled = true; api.state.folder = { uri: api.Uri.file(workspace) };
  api.workspace.fs.readFile.mockReset().mockImplementation(uri => readFile(uri.fsPath));
  webview.asWebviewUri.mockClear();
});
afterEach(async () => { await rm(isolated, { recursive: true, force: true }); });

describe('workspace plugin host', () => {
  it('does not read or expose plugin files in untrusted, disabled, or folderless workspaces', async () => {
    await fixture();
    api.state.trusted = false; expect(await loadWorkspacePlugins(inputUri(), view())).toEqual([]);
    api.state.trusted = true; api.state.enabled = false; expect(await loadWorkspacePlugins(inputUri(), view())).toEqual([]);
    api.state.enabled = true; api.state.folder = undefined; expect(await loadWorkspacePlugins(inputUri(), view())).toEqual([]);
    expect(api.workspace.fs.readFile).not.toHaveBeenCalled();
    expect(webview.asWebviewUri).not.toHaveBeenCalled();
  });

  it('loads trusted local entries and invalidates only changed entry content', async () => {
    const directory = await fixture();
    const first = await loadWorkspacePlugins(inputUri(), view());
    expect(first[0].module).toMatch(/^https:\/\/webview\.example.*sample\.js\?v=[a-f0-9]{16}$/);
    expect(await loadWorkspacePlugins(inputUri(), view())).toEqual(first);
    await writeFile(join(directory, 'sample.css'), '.sample { color: blue; }');
    const changed = await loadWorkspacePlugins(inputUri(), view());
    expect(changed[0].stylesheet).not.toBe(first[0].stylesheet);
    expect(changed[0].module).toBe(first[0].module);
  });

  it('allows an absent manifest but reports a missing referenced entry', async () => {
    expect(await loadWorkspacePlugins(inputUri(), view())).toEqual([]);
    const directory = await fixture(); await rm(join(directory, 'sample.js'));
    await expect(loadWorkspacePlugins(inputUri(), view())).rejects.toThrow();
  });

  it('rejects an entry symlink that resolves outside the workspace before exposing its URI', async () => {
    const directory = await fixture();
    const outside = join(isolated, 'outside.js'); await writeFile(outside, 'export default () => ({ name: "outside" });');
    await rm(join(directory, 'sample.js')); await symlink(outside, join(directory, 'sample.js'));
    await expect(loadWorkspacePlugins(inputUri(), view())).rejects.toThrow('inside their registered directory');
    expect(webview.asWebviewUri.mock.calls.some(([uri]) => uri.path.endsWith('sample.js'))).toBe(false);
  });

  it('rejects a manifest symlink outside the workspace without reading its contents', async () => {
    const directory = await fixture();
    const outside = join(isolated, 'manifest.json'); await writeFile(outside, '{"plugins": []}');
    await rm(join(directory, 'manifest.json')); await symlink(outside, join(directory, 'manifest.json'));
    await expect(loadWorkspacePlugins(inputUri(), view())).rejects.toThrow('inside their registered directory');
    expect(api.workspace.fs.readFile).not.toHaveBeenCalled();
    expect(webview.asWebviewUri).not.toHaveBeenCalled();
  });
});
