import { beforeEach, expect, it, vi } from 'vitest';
import type * as vscode from 'vscode';

const state = vi.hoisted(() => ({ appName: 'Cursor', enabled: true, supported: true, workspace: false, pins: ['other.action'] as string[], fail: false, updates: [] as unknown[] }));
vi.mock('vscode', () => ({
  env: { get appName() { return state.appName; } },
  ConfigurationTarget: { Global: 1, Workspace: 2 },
  workspace: { getConfiguration: (section: string) => section === 'limr'
    ? { get: () => state.enabled }
    : { inspect: () => state.supported ? { ...(state.workspace ? { workspaceValue: state.pins } : { globalValue: state.pins }) } : undefined,
      get: () => state.pins,
      update: async (key: string, value: string[], target: number) => { if (state.fail) throw new Error('Write failed'); state.pins = value; state.updates.push({ key, value, target }); } } },
}));
import { initializeCursorTitleActions } from '../src/cursor';

function memento() {
  const values = new Map<string, unknown>();
  return { get: (key: string) => values.get(key), update: async (key: string, value: unknown) => { values.set(key, value); } };
}
let context: vscode.ExtensionContext;
beforeEach(() => {
  Object.assign(state, { appName: 'Cursor', enabled: true, supported: true, workspace: false, pins: ['other.action'], fail: false, updates: [] });
  context = { globalState: memento(), workspaceState: memento() } as unknown as vscode.ExtensionContext;
});
it('preserves other pinned actions and leaves later user removals intact', async () => {
  await initializeCursorTitleActions(context);
  expect(state.pins).toContain('other.action'); expect(state.pins).toContain('limr.openPreviewToSide');
  expect(new Set(state.pins).size).toBe(state.pins.length);
  state.pins = ['other.action'];
  await initializeCursorTitleActions(context);
  expect(state.pins).toEqual(['other.action']); expect(state.updates).toHaveLength(1);
});
it.each(['vscode', 'disabled', 'unsupported'])('does not change settings for %s', async mode => {
  if (mode === 'vscode') state.appName = 'Visual Studio Code';
  if (mode === 'disabled') state.enabled = false;
  if (mode === 'unsupported') state.supported = false;
  await initializeCursorTitleActions(context); expect(state.updates).toEqual([]);
});
it('respects an existing workspace pin list without marking the user settings migrated', async () => {
  state.workspace = true; await initializeCursorTitleActions(context);
  expect(state.updates[0]).toMatchObject({ target: 2 });
  state.workspace = false; state.pins = ['user.action']; await initializeCursorTitleActions(context);
  expect(state.updates[1]).toMatchObject({ target: 1 }); expect(state.pins).toContain('user.action');
});
it('retries after a failed settings write', async () => {
  state.fail = true; await expect(initializeCursorTitleActions(context)).rejects.toThrow('Write failed');
  state.fail = false; await initializeCursorTitleActions(context);
  expect(state.pins).toContain('limr.openPreviewToSide'); expect(state.updates).toHaveLength(1);
});
