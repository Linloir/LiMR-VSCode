import * as vscode from 'vscode';
import { createHash } from 'node:crypto';
import { realpath } from 'node:fs/promises';
import { relative, isAbsolute } from 'node:path';
import { localPluginPath, parsePluginManifest, type PluginEntry } from './plugin-manifest';

export async function loadWorkspacePlugins(uri: vscode.Uri, webview: vscode.Webview): Promise<PluginEntry[]> {
  const config = vscode.workspace.getConfiguration('limr', uri);
  const folder = vscode.workspace.getWorkspaceFolder(uri);
  if (!vscode.workspace.isTrusted || !folder || !config.get('plugins.enabled', true)) return [];
  const manifest = vscode.Uri.joinPath(folder.uri, localPluginPath(config.get('plugins.manifest', '.limr/plugins/manifest.json')));
  const contained = async (file: vscode.Uri) => {
    if (file.scheme !== 'file') return;
    const [base, target] = await Promise.all([realpath(folder.uri.fsPath), realpath(file.fsPath)]);
    const path = relative(base, target);
    if (path === '..' || path.startsWith('../') || path.startsWith('..\\') || isAbsolute(path)) throw new Error('Plugin files must stay inside the workspace.');
  };
  let source: Uint8Array;
  try { await contained(manifest); source = await vscode.workspace.fs.readFile(manifest); }
  catch (error) { if (error instanceof vscode.FileSystemError && error.code === 'FileNotFound' || (error as NodeJS.ErrnoException)?.code === 'ENOENT') return []; throw error; }
  const entries = parsePluginManifest(new TextDecoder().decode(source));
  return Promise.all(entries.map(async entry => {
    const resolved: PluginEntry = { id: entry.id };
    for (const key of ['stylesheet', 'module'] as const) if (entry[key]) {
      const file = vscode.Uri.joinPath(manifest, '..', entry[key]);
      await contained(file);
      const content = await vscode.workspace.fs.readFile(file);
      const revision = createHash('sha256').update(content).digest('hex').slice(0,16);
      resolved[key] = webview.asWebviewUri(file).with({ query: `v=${revision}` }).toString();
    }
    return resolved;
  }));
}
