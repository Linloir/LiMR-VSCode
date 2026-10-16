import * as vscode from 'vscode';
import { createHash } from 'node:crypto';
import { realpath } from 'node:fs/promises';
import { relative, isAbsolute } from 'node:path';
import { localPluginPath, parsePluginManifest, type PluginEntry } from './plugin-manifest';
import type { PluginRegistry } from './plugin-registry';

const enabled = (uri: vscode.Uri) => vscode.workspace.isTrusted && vscode.workspace.getConfiguration('limr', uri).get('plugins.enabled', true);

async function contained(base: vscode.Uri, file: vscode.Uri) {
  if (file.scheme !== base.scheme || file.authority !== base.authority
    || !file.path.startsWith(base.path.replace(/\/$/, '') + '/')) throw new Error('Plugin files must stay inside their registered directory.');
  if (file.scheme !== 'file') return;
  const [root, target] = await Promise.all([realpath(base.fsPath), realpath(file.fsPath)]);
  const path = relative(root, target);
  if (path === '..' || path.startsWith('../') || path.startsWith('..\\') || isAbsolute(path)) throw new Error('Plugin files must stay inside their registered directory.');
}

async function loadAssets(entry: PluginEntry, directory: vscode.Uri, root: vscode.Uri, webview: vscode.Webview): Promise<PluginEntry> {
  const resolved: PluginEntry = { id: entry.id };
  for (const key of ['stylesheet', 'module'] as const) if (entry[key]) {
    const file = vscode.Uri.joinPath(directory, entry[key]);
    await contained(root, file);
    const content = await vscode.workspace.fs.readFile(file);
    const revision = createHash('sha256').update(content).digest('hex').slice(0, 16);
    resolved[key] = webview.asWebviewUri(file).with({ query: `v=${revision}` }).toString();
  }
  return resolved;
}

export async function loadWorkspacePlugins(uri: vscode.Uri, webview: vscode.Webview): Promise<PluginEntry[]> {
  const config = vscode.workspace.getConfiguration('limr', uri);
  const folder = vscode.workspace.getWorkspaceFolder(uri);
  if (!folder || !enabled(uri)) return [];
  const manifest = vscode.Uri.joinPath(folder.uri, localPluginPath(config.get('plugins.manifest', '.limr/plugins/manifest.json')));
  let source: Uint8Array;
  try { await contained(folder.uri, manifest); source = await vscode.workspace.fs.readFile(manifest); }
  catch (error) { if (error instanceof vscode.FileSystemError && error.code === 'FileNotFound' || (error as NodeJS.ErrnoException)?.code === 'ENOENT') return []; throw error; }
  const entries = parsePluginManifest(new TextDecoder().decode(source));
  return Promise.all(entries.map(entry => loadAssets({ ...entry, id: `workspace:${entry.id}` }, vscode.Uri.joinPath(manifest, '..'), folder.uri, webview)));
}

export interface LoadedReaderPlugins { entries: PluginEntry[]; resourceRoots: vscode.Uri[]; errors: string[] }

/** Keep a broken add-on isolated from every other extension/workspace plugin. */
export async function loadReaderPlugins(uri: vscode.Uri, webview: vscode.Webview, registry: PluginRegistry): Promise<LoadedReaderPlugins> {
  const empty = (): LoadedReaderPlugins => ({ entries: [], resourceRoots: [], errors: [] });
  if (!enabled(uri)) return empty();
  const result = empty();
  const registered = registry.entries();
  const loaded = await Promise.all(registered.map(async entry => {
    try { return { entry, plugin: await loadAssets(entry, entry.extensionUri, entry.extensionUri, webview) }; }
    catch (error) { return { entry, error: `${entry.id}: ${error instanceof Error ? error.message : String(error)}` }; }
  }));
  try { result.entries.push(...await loadWorkspacePlugins(uri, webview)); }
  catch (error) { result.errors.push(`workspace: ${error instanceof Error ? error.message : String(error)}`); }
  // Registration/configuration can change while the filesystem awaits complete.
  if (!enabled(uri)) return empty();
  const current = new Set(registry.entries());
  for (const item of loaded) if (current.has(item.entry)) {
    if (item.plugin) { result.entries.push(item.plugin); result.resourceRoots.push(item.entry.extensionUri); }
    else if (item.error) result.errors.push(item.error);
  }
  result.resourceRoots = [...new Map(result.resourceRoots.map(root => [root.toString(), root])).values()];
  return result;
}

/** Remove obsolete add-on grants while preserving document/workspace/image roots. */
export function replacePluginResourceRoots(existing: readonly vscode.Uri[], previous: readonly vscode.Uri[], next: readonly vscode.Uri[], required: readonly vscode.Uri[], images: readonly vscode.Uri[] = []) {
  const removed = new Set(previous.map(root => root.toString()));
  const roots = [...new Map([...existing.filter(root => !removed.has(root.toString())), ...required, ...next].map(root => [root.toString(), root])).values()];
  for (const image of images) if (!roots.some(root => root.scheme === image.scheme && root.authority === image.authority
    && (root.path === image.path || image.path.startsWith(root.path.replace(/\/?$/, '/'))))) roots.push(image);
  return roots;
}
