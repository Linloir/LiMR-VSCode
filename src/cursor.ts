import * as vscode from 'vscode';

const titleActions = [
  'limr.openPreviewToSide', 'limr.chooseTheme', 'limr.toggleEditingLocked', 'limr.toggleEditing',
  'limr.chooseTypography', 'limr.chooseTranslationMode', 'limr.openSettings', 'limr.openSource',
  'submenuitem.limr.aiMenu',
];

/** Cursor hides extension title actions by default. Use its supported pin list
 * once per settings scope, so later user removals survive extension reloads. */
export async function initializeCursorTitleActions(context: vscode.ExtensionContext): Promise<void> {
  if (!/cursor/i.test(vscode.env.appName ?? '') || !vscode.workspace.getConfiguration('limr').get('cursor.pinTitleActions', true)) return;
  const configuration = vscode.workspace.getConfiguration('cursor.general');
  const existing = configuration.inspect<string[]>('pinnedTitleActions');
  if (!existing) return; // Older Cursor versions do not expose this setting.
  const target = existing.workspaceValue !== undefined ? vscode.ConfigurationTarget.Workspace : vscode.ConfigurationTarget.Global;
  const state = target === vscode.ConfigurationTarget.Workspace ? context.workspaceState : context.globalState;
  const key = 'limr.cursor.titleActionsPinned.v1';
  if (state.get<boolean>(key)) return;
  const current = configuration.get<string[]>('pinnedTitleActions', []);
  if (!Array.isArray(current) || current.some(value => typeof value !== 'string')) return;
  const merged = [...new Set([...current, ...titleActions])];
  if (merged.length !== current.length) await configuration.update('pinnedTitleActions', merged, target);
  await state.update(key, true);
}
