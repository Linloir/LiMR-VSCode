import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type * as vscode from 'vscode';

const api = vi.hoisted(() => {
  class Disposable { constructor(private callback: () => void) {} dispose() { this.callback(); } }
  class EventEmitter<T> {
    private listeners = new Set<(event: T) => void>();
    event = (listener: (event: T) => void) => { this.listeners.add(listener); return new Disposable(() => this.listeners.delete(listener)); };
    fire(event: T) { for (const listener of this.listeners) listener(event); }
    dispose() { this.listeners.clear(); }
  }
  class Uri {
    constructor(private value: URL) {}
    static file(path: string) { const url = new URL('file:///'); url.pathname = path; return new Uri(url); }
    static parse(value: string) { return new Uri(new URL(value)); }
    static joinPath(base: Uri, ...parts: string[]) {
      const segments: string[] = [];
      for (const segment of [base.path, ...parts].join('/').split('/')) {
        if (segment === '..') segments.pop(); else if (segment && segment !== '.') segments.push(segment);
      }
      const url = new URL(base.toString()); url.pathname = '/' + segments.join('/'); return new Uri(url);
    }
    get scheme() { return this.value.protocol.slice(0, -1); }
    get authority() { return this.value.host; }
    get path() { return decodeURIComponent(this.value.pathname); }
    get fsPath() { return this.path; }
    with(change: { scheme?: string; authority?: string; query?: string }) {
      const url = new URL(this.value); if (change.scheme) url.protocol = change.scheme + ':';
      if (change.authority) url.host = change.authority;
      if (change.query !== undefined) url.search = change.query;
      return new Uri(url);
    }
    toString() { return this.value.toString(); }
  }
  class FileSystemError extends Error { constructor(readonly code: string) { super(code); } }
  const installed = new Map<string, { id: string; extensionUri: Uri }>();
  const changed = new EventEmitter<void>();
  const remoteFiles = new Map<string, string>();
  const config = { enabled: true, manifest: '.limr/plugins/manifest.json' };
  const workspace = {
    isTrusted: true,
    folder: undefined as { uri: Uri } | undefined,
    getWorkspaceFolder: (_uri: Uri) => workspace.folder,
    getConfiguration: () => ({ get: (key: string, fallback: unknown) => key === 'plugins.enabled' ? config.enabled : key === 'plugins.manifest' ? config.manifest : fallback }),
    fs: { readFile: vi.fn(async (uri: Uri): Promise<Uint8Array> => {
      if (uri.scheme === 'file') return (await import('node:fs/promises')).readFile(uri.fsPath);
      const source = remoteFiles.get(uri.toString());
      if (source === undefined) throw new FileSystemError('FileNotFound');
      return new TextEncoder().encode(source);
    }) },
  };
  return { Disposable, EventEmitter, Uri, FileSystemError, installed, changed, remoteFiles, config, workspace,
    extensions: { getExtension: (id: string) => installed.get(id.toLowerCase()), onDidChange: changed.event } };
});
vi.mock('vscode', () => api);

import { createExtensionApi, PluginRegistry } from '../src/plugin-registry';
import { loadReaderPlugins, replacePluginResourceRoots } from '../src/plugins';

let temporary: string, registry: PluginRegistry;
const uri = (path: string) => api.Uri.file(path) as unknown as vscode.Uri;
const webview = { asWebviewUri: (resource: vscode.Uri) => api.Uri.parse(`https://resource.test${resource.path.split('/').map(encodeURIComponent).join('/')}`) } as unknown as vscode.Webview;
const load = () => loadReaderPlugins(uri(join(temporary, 'document.md')), webview, registry);
async function extension(id: string, files: Record<string, string> = { 'reader.mjs': 'export default () => ({ name: "same-name" });' }) {
  const directory = join(temporary, id); await mkdir(directory, { recursive: true });
  for (const [name, source] of Object.entries(files)) { await mkdir(join(directory, name, '..'), { recursive: true }); await writeFile(join(directory, name), source); }
  const result = { id, extensionUri: api.Uri.file(directory) };
  api.installed.set(id.toLowerCase(), result); return result;
}
beforeEach(async () => {
  temporary = await mkdtemp(join(tmpdir(), 'limr-plugin-registry-'));
  api.installed.clear(); api.remoteFiles.clear(); api.config.enabled = true; api.config.manifest = '.limr/plugins/manifest.json';
  api.workspace.isTrusted = true; api.workspace.folder = undefined; api.workspace.fs.readFile.mockClear();
  registry = new PluginRegistry();
});
afterEach(async () => { registry.dispose(); await rm(temporary, { recursive: true, force: true }); });

describe('public extension plugin registration', () => {
  it('exports a versioned API and isolates same local IDs across extensions', async () => {
    await extension('publisher.first'); await extension('publisher.second');
    const publicApi = createExtensionApi(registry), changed = vi.fn(); registry.onDidChange(changed);
    expect(publicApi.apiVersion).toBe(1); expect(publicApi.viewType).toBe('limr.reader');
    const mutable = { id: 'card', module: 'reader.mjs' };
    const first = publicApi.registerPlugin('PUBLISHER.FIRST', mutable);
    publicApi.registerPlugin('publisher.second', { id: 'card', module: 'reader.mjs' });
    mutable.module = '../outside.js';
    expect(registry.entries().map(item => item.id)).toEqual(['extension:publisher.first/card', 'extension:publisher.second/card']);
    expect(registry.entries()[0].module).toBe('reader.mjs');
    expect(() => publicApi.registerPlugin('publisher.first', { id: 'card', module: 'reader.mjs' })).toThrow(/already registered/);
    first.dispose(); first.dispose();
    const replacement = publicApi.registerPlugin('publisher.first', { id: 'card', module: 'reader.mjs' });
    first.dispose(); expect(registry.entries()).toHaveLength(2);
    replacement.dispose(); expect(changed).toHaveBeenCalledTimes(5);
  });
  it('requires an installed owner and rejects traversal, absolute paths and invalid assets', async () => {
    expect(() => registry.registerPlugin('missing.extension', { id: 'card', module: 'reader.mjs' })).toThrow(/installed extension/);
    await extension('publisher.addon');
    for (const module of ['../outside.js', '/tmp/file.js', 'file:///tmp/file.js', 'x/%2e%2e/a.js', 'x\\a.js', 'reader.mjs?token=x', './reader.mjs', 'reader.ts'])
      expect(() => registry.registerPlugin('publisher.addon', { id: 'card', module }), module).toThrow();
    expect(() => registry.registerPlugin('publisher.addon', { id: 'Card', module: 'reader.mjs' })).toThrow();
    expect(() => registry.registerPlugin('publisher.addon', { id: 'card' })).toThrow();
    expect(() => registry.registerPlugin('publisher.addon', { id: 'card', stylesheet: 'style.js' })).toThrow(/CSS/);
    expect(api.workspace.fs.readFile).not.toHaveBeenCalled();
  });
  it('removes registrations when their extension is uninstalled or replaced', async () => {
    await extension('publisher.first'); await extension('publisher.second');
    registry.registerPlugin('publisher.first', { id: 'card', module: 'reader.mjs' });
    registry.registerPlugin('publisher.second', { id: 'card', module: 'reader.mjs' });
    const changed = vi.fn(); registry.onDidChange(changed);
    api.installed.delete('publisher.first'); api.changed.fire();
    expect(registry.entries().map(item => item.extensionId)).toEqual(['publisher.second']);
    api.installed.get('publisher.second')!.extensionUri = api.Uri.file(join(temporary, 'replacement'));
    api.changed.fire(); expect(registry.entries()).toEqual([]); expect(changed).toHaveBeenCalledTimes(2);
    expect((await load()).resourceRoots).toEqual([]);
    registry.dispose(); expect(() => registry.registerPlugin('publisher.second', { id: 'card', module: 'reader.mjs' })).toThrow(/no longer available/);
  });
});

describe('plugin assets in the extension host', () => {
  it('loads module and CSS without a workspace manifest, with versioned webview URLs', async () => {
    const owner = await extension('publisher.addon', { 'assets/reader.mjs': 'export default () => ({ name: "card" });', 'assets/style.css': '.card { color: teal; }' });
    registry.registerPlugin(owner.id, { id: 'card', module: 'assets/reader.mjs', stylesheet: 'assets/style.css' });
    const first = await load(); expect(first.errors).toEqual([]); expect(first.entries).toHaveLength(1);
    expect(first.entries[0].module).toMatch(/\/assets\/reader\.mjs\?v=[a-f0-9]{16}$/);
    expect(first.entries[0].stylesheet).toMatch(/\/assets\/style\.css\?v=[a-f0-9]{16}$/);
    expect(first.resourceRoots.map(root => root.toString())).toEqual([owner.extensionUri.toString()]);
    await writeFile(join(owner.extensionUri.fsPath, 'assets/reader.mjs'), 'export default () => ({ name: "updated" });');
    expect((await load()).entries[0].module).not.toBe(first.entries[0].module);
  });
  it('reads nothing until both workspace trust and the resource plugin setting allow it', async () => {
    await extension('publisher.addon'); registry.registerPlugin('publisher.addon', { id: 'card', module: 'reader.mjs' });
    api.workspace.isTrusted = false; expect(await load()).toEqual({ entries: [], resourceRoots: [], errors: [] });
    api.workspace.isTrusted = true; api.config.enabled = false; expect(await load()).toEqual({ entries: [], resourceRoots: [], errors: [] });
    expect(api.workspace.fs.readFile).not.toHaveBeenCalled();
    api.config.enabled = true; expect((await load()).entries).toHaveLength(1);
  });
  it('keeps valid workspace and extension plugins when another extension asset is missing', async () => {
    const workspace = join(temporary, 'workspace'); await mkdir(join(workspace, '.limr/plugins'), { recursive: true });
    await writeFile(join(workspace, '.limr/plugins/manifest.json'), JSON.stringify({ plugins: [{ id: 'card', stylesheet: 'style.css' }] }));
    await writeFile(join(workspace, '.limr/plugins/style.css'), '.workspace-card {}');
    api.workspace.folder = { uri: api.Uri.file(workspace) };
    await extension('publisher.good'); await extension('publisher.bad', {});
    registry.registerPlugin('publisher.good', { id: 'card', module: 'reader.mjs' });
    registry.registerPlugin('publisher.bad', { id: 'card', module: 'missing.mjs' });
    const result = await load();
    expect(result.errors.filter(error => error.startsWith('workspace:'))).toEqual([]);
    expect(result.entries.map(entry => entry.id)).toEqual(['workspace:card', 'extension:publisher.good/card']);
    expect(result.errors).toHaveLength(1); expect(result.errors[0]).toContain('extension:publisher.bad/card');
    expect(result.resourceRoots).toHaveLength(1);
    await writeFile(join(workspace, '.limr/plugins/manifest.json'), '{invalid');
    const brokenWorkspace = await load(); expect(brokenWorkspace.entries.map(entry => entry.id)).toEqual(['extension:publisher.good/card']);
  });
  it('rejects symlink escapes from the real installed extension directory', async () => {
    const owner = await extension('publisher.addon', {}), outside = join(temporary, 'outside.mjs');
    await writeFile(outside, 'export default () => ({ name: "outside" });');
    await symlink(outside, join(owner.extensionUri.fsPath, 'reader.mjs'));
    registry.registerPlugin(owner.id, { id: 'card', module: 'reader.mjs' });
    const result = await load(); expect(result.entries).toEqual([]); expect(result.resourceRoots).toEqual([]);
    expect(result.errors[0]).toMatch(/inside their registered directory/);
    expect(api.workspace.fs.readFile).not.toHaveBeenCalled();
  });
  it('preserves a remote extension provider and authority while resolving relative assets', async () => {
    const extensionUri = api.Uri.parse('vscode-remote://ssh-remote+host/home/extensions/publisher.addon');
    api.installed.set('publisher.addon', { id: 'publisher.addon', extensionUri });
    const moduleUri = api.Uri.joinPath(extensionUri, 'assets/reader.mjs'); api.remoteFiles.set(moduleUri.toString(), 'export default () => ({ name: "remote" });');
    registry.registerPlugin('publisher.addon', { id: 'card', module: 'assets/reader.mjs' });
    const result = await load(); expect(result.entries).toHaveLength(1); expect(result.errors).toEqual([]);
    expect(api.workspace.fs.readFile.mock.calls[0][0].toString()).toBe(moduleUri.toString());
    expect(result.resourceRoots[0].toString()).toBe(extensionUri.toString());
  });
  it('does not resurrect a registration disposed during asset reads', async () => {
    const owner = await extension('publisher.addon');
    const registration = registry.registerPlugin(owner.id, { id: 'card', module: 'reader.mjs' });
    let release!: () => void, entered!: () => void;
    const reading = new Promise<void>(resolve => { entered = resolve; });
    api.workspace.fs.readFile.mockImplementationOnce(async resource => { entered(); await new Promise<void>(resolve => { release = resolve; }); return readFile(resource.fsPath); });
    const loading = load(); await reading; registration.dispose(); release();
    expect(await loading).toEqual({ entries: [], resourceRoots: [], errors: [] });
  });
  it('withdraws asset grants when disabled or removed without losing existing image/document roots', async () => {
    const base = uri(join(temporary, 'base')), image = uri(join(temporary, 'outside/image.png')), addon = uri(join(temporary, 'addon'));
    const loaded = replacePluginResourceRoots([base, image], [], [addon], [base]);
    expect(loaded.map(root => root.toString())).toEqual([base, image, addon].map(root => root.toString()));
    expect(replacePluginResourceRoots(loaded, [addon], [], [base])).toEqual([base, image]);
    // A workspace may itself be an extension's development directory.
    expect(replacePluginResourceRoots([addon], [addon], [], [addon])).toEqual([addon]);
    const addonImage = uri(join(temporary, 'addon/image.png'));
    expect(replacePluginResourceRoots([base, addon], [addon], [addon], [base], [addonImage])).toEqual([base, addon]);
    expect(replacePluginResourceRoots([base, addon], [addon], [], [base], [addonImage])).toEqual([base, addonImage]);
  });
});
