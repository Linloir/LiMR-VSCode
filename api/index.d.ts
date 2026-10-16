import type { Disposable } from 'vscode';

/** Browser assets packaged inside the registering VS Code extension. */
export interface LiMRPluginContribution {
  /** Unique within the extension; start with a lowercase letter, followed by lowercase letters, digits or hyphens. */
  readonly id: string;
  /** Extension-relative .js/.mjs ESM; default export is ({ React, limr }) => RendererExtension (or a promise). */
  readonly module?: string;
  /** Extension-relative CSS file. At least one of module/stylesheet is required. */
  readonly stylesheet?: string;
}

/** The value returned by vscode.extensions.getExtension('linloir.limr-vscode').activate(). */
export interface LiMRExtensionApi {
  readonly apiVersion: 1;
  readonly viewType: 'limr.reader';
  /**
   * Pass context.extension.id. Paths must stay inside that installed extension;
   * absolute paths, URI strings, traversal and symlink escapes are rejected.
   * Duplicate local IDs throw. Keep the returned disposable in subscriptions.
   * Registration/disposal refresh open readers. Assets only load in trusted
   * windows with limr.plugins.enabled; registration itself is permitted earlier.
   * Factories share the reader's React/LiMR instances. Module names are namespaced;
   * syntax tag/directive/annotation type names remain the author's responsibility.
   */
  registerPlugin(extensionId: string, plugin: LiMRPluginContribution): Disposable;
}
