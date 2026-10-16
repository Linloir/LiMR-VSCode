import * as vscode from 'vscode';
import type { LiMRExtensionApi, LiMRPluginContribution } from '../api';
import { parsePluginEntry, type PluginEntry } from './plugin-manifest';

export interface RegisteredPlugin extends PluginEntry {
  readonly extensionId: string;
  readonly extensionUri: vscode.Uri;
}

/** Host-side registration only: extension assets execute in the reader webview. */
export class PluginRegistry implements vscode.Disposable {
  private readonly plugins = new Map<string, RegisteredPlugin>();
  private readonly changes = new vscode.EventEmitter<void>();
  readonly onDidChange = this.changes.event;
  private readonly installed = vscode.extensions.onDidChange(() => {
    let changed = false;
    for (const [id, entry] of this.plugins) if (!this.available(entry)) { this.plugins.delete(id); changed = true; }
    if (changed) this.changes.fire();
  });
  private disposed = false;

  registerPlugin(extensionId: string, contribution: LiMRPluginContribution): vscode.Disposable {
    if (this.disposed) throw new Error('LiMR plugin registration is no longer available.');
    const extension = typeof extensionId === 'string' && vscode.extensions.getExtension(extensionId);
    if (!extension) throw new Error('Register a LiMR plugin using the installed extension’s context.extension.id.');
    const plugin = parsePluginEntry(contribution);
    const id = `extension:${extension.id.toLowerCase()}/${plugin.id}`;
    if (this.plugins.has(id)) throw new Error(`LiMR plugin ${id} is already registered.`);
    const entry = Object.freeze({ ...plugin, id, extensionId: extension.id, extensionUri: extension.extensionUri });
    this.plugins.set(id, entry); this.changes.fire();
    return new vscode.Disposable(() => {
      if (this.plugins.get(id) !== entry) return;
      this.plugins.delete(id); this.changes.fire();
    });
  }
  private available(entry: RegisteredPlugin) {
    return vscode.extensions.getExtension(entry.extensionId)?.extensionUri.toString() === entry.extensionUri.toString();
  }
  entries(): readonly RegisteredPlugin[] { return [...this.plugins.values()].filter(entry => this.available(entry)); }
  dispose() { this.disposed = true; this.installed.dispose(); this.plugins.clear(); this.changes.dispose(); }
}

export function createExtensionApi(registry: PluginRegistry): LiMRExtensionApi {
  return Object.freeze({ apiVersion: 1 as const, viewType: 'limr.reader' as const,
    registerPlugin: (extensionId: string, plugin: LiMRPluginContribution) => registry.registerPlugin(extensionId, plugin),
  });
}
