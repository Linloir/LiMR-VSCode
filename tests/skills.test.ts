import { beforeEach, describe, expect, it, vi } from 'vitest';
import { posix } from 'node:path';

const api = vi.hoisted(() => {
  class Uri {
    constructor(readonly path: string) {}
    get fsPath() { return this.path; }
    toString() { return `file://${this.path}`; }
    static file(path: string) { return new Uri(path); }
    static joinPath(uri: Uri, ...parts: string[]) { return new Uri([uri.path, ...parts].join('/').replace(/\/+/g, '/')); }
  }
  class FileSystemError extends Error { constructor(readonly code: string) { super(code); } }
  const files = new Map<string, string>();
  const directories = new Set<string>();
  const config = { language: 'en', prompt: true, globalPrompt: undefined as boolean | undefined, update: vi.fn(async () => {}) };
  const fs = {
    stat: vi.fn(async (uri: Uri) => {
      if (files.has(uri.path)) return { type: 1 };
      if (directories.has(uri.path)) return { type: 2 };
      throw new FileSystemError('FileNotFound');
    }),
    readFile: vi.fn(async (uri: Uri) => {
      if (!files.has(uri.path)) throw new FileSystemError('FileNotFound');
      return new TextEncoder().encode(files.get(uri.path)!);
    }),
    writeFile: vi.fn(async (uri: Uri, value: Uint8Array) => { files.set(uri.path, new TextDecoder().decode(value)); }),
    createDirectory: vi.fn(async (uri: Uri) => { directories.add(uri.path); }),
    readDirectory: vi.fn(async (uri: Uri) => {
      const result: [string, number][] = [];
      for (const path of directories) if (path.startsWith(`${uri.path}/`) && !path.slice(uri.path.length + 1).includes('/')) result.push([path.slice(uri.path.length + 1), 2]);
      for (const path of files.keys()) if (path.startsWith(`${uri.path}/`) && !path.slice(uri.path.length + 1).includes('/')) result.push([path.slice(uri.path.length + 1), 1]);
      return result;
    }),
  };
  const workspace = {
    isTrusted: true,
    workspaceFolders: [] as { uri: Uri; name: string; index: number }[],
    getWorkspaceFolder: (uri: Uri) => workspace.workspaceFolders.find(folder => uri.path === folder.uri.path || uri.path.startsWith(`${folder.uri.path}/`)),
    getConfiguration: vi.fn(() => ({ get: (key: string, fallback: unknown) => key === 'language' ? config.language : key === 'skills.promptOnStartup' ? config.prompt : fallback, inspect: () => ({ globalValue: config.globalPrompt }), update: config.update })),
    fs,
    openTextDocument: vi.fn(async (uri: Uri) => ({ uri })),
  };
  const window = {
    showInformationMessage: vi.fn(async (..._args: unknown[]): Promise<string | undefined> => undefined),
    showWarningMessage: vi.fn(async (..._args: unknown[]): Promise<string | undefined> => undefined),
    showErrorMessage: vi.fn(async (..._args: unknown[]) => undefined),
    showQuickPick: vi.fn(async (_items: unknown[], _options: unknown): Promise<any> => undefined),
    showOpenDialog: vi.fn(async () => undefined),
    showWorkspaceFolderPick: vi.fn(async () => undefined),
    showTextDocument: vi.fn(async () => undefined),
  };
  const env = { language: 'en', clipboard: { writeText: vi.fn(async (_text: string) => {}) } };
  return { Uri, FileSystemError, files, directories, config, workspace, window, env };
});
vi.mock('vscode', () => ({ ...api, FileType: { File: 1, Directory: 2 }, ConfigurationTarget: { Global: 1, Workspace: 2, WorkspaceFolder: 3 } }));
vi.mock('node:os', () => ({ homedir: () => '/home/test-user' }));

import type * as vscode from 'vscode';
import { copySkillInstallPrompt, installGlobalSkill, installSkill, maybePromptSkillInstall, showSkillGuide } from '../src/skills';

const skill = '---\nname: limr-annotations\ndescription: Test bundled skill\n---\n# Skill\n';
function memento() {
  const values = new Map<string, unknown>();
  return { get: (key: string) => values.get(key), update: vi.fn(async (key: string, value: unknown) => { values.set(key, value); }) };
}
function context() {
  return { extensionUri: api.Uri.file('/extension'), workspaceState: memento(), globalState: memento() } as unknown as vscode.ExtensionContext;
}
function folder(path = '/workspace') {
  const result = { uri: api.Uri.file(path), name: posix.basename(path), index: api.workspace.workspaceFolders.length };
  api.workspace.workspaceFolders.push(result);
  return result;
}
const uri = (path: string) => api.Uri.file(path) as unknown as vscode.Uri;
function promptCalls() { return api.window.showInformationMessage.mock.calls.filter(call => String(call[0]).startsWith('Install the LiMR AI Skill?') || String(call[0]).startsWith('安装 LiMR AI Skill？')); }

beforeEach(() => {
  vi.clearAllMocks();
  api.files.clear(); api.directories.clear(); api.workspace.workspaceFolders = [];
  api.workspace.isTrusted = true; api.config.language = 'en'; api.config.prompt = true; api.config.globalPrompt = undefined; api.env.language = 'en';
  api.window.showInformationMessage.mockReset().mockResolvedValue(undefined);
  api.window.showWarningMessage.mockReset().mockResolvedValue(undefined);
  api.window.showQuickPick.mockReset().mockResolvedValue(undefined);
  api.workspace.fs.readFile.mockClear();
  api.files.set('/extension/skills/limr-annotations/SKILL.md', skill);
  api.files.set('/extension/skills/limr-annotations/references/source-annotations.md', 'Paired boundary reference');
  api.files.set('/extension/skills/limr-annotations/references/reader-plugins.md', 'Workspace plugin reference');
  api.directories.add('/extension/skills/limr-annotations/references');
});

describe('skill installation and onboarding', () => {
  it('prompts once per workspace, including a new workspace after the first dismissal', async () => {
    const ctx = context(); folder(); folder('/second');
    await maybePromptSkillInstall(ctx, uri('/workspace/a.md'));
    await maybePromptSkillInstall(ctx, uri('/workspace/b.md'));
    await maybePromptSkillInstall(ctx, uri('/second/a.md'));
    expect(promptCalls()).toHaveLength(2);
    expect(api.workspace.fs.writeFile).not.toHaveBeenCalled();
    expect(api.workspace.fs.createDirectory).not.toHaveBeenCalled();
  });

  it('coalesces concurrent opens into one prompt', async () => {
    const ctx = context(); folder();
    await Promise.all(Array.from({ length: 5 }, () => maybePromptSkillInstall(ctx, uri('/workspace/a.md'))));
    expect(promptCalls()).toHaveLength(1);
  });


  it('checks a second root after a concurrent prompt completes', async () => {
    const ctx = context(); folder(); folder('/second');
    await Promise.all([maybePromptSkillInstall(ctx, uri('/workspace/a.md')), maybePromptSkillInstall(ctx, uri('/second/a.md'))]);
    expect(promptCalls()).toHaveLength(2);
  });

  it('keeps a global opt-out across workspace overrides and permits an explicit global re-enable', async () => {
    const ctx = context(); folder(); folder('/second');
    api.window.showInformationMessage.mockResolvedValueOnce('Reminders…');
    api.window.showQuickPick.mockResolvedValueOnce({ scope: 'global' });
    await maybePromptSkillInstall(ctx, uri('/workspace/a.md'));
    api.config.prompt = true;
    await maybePromptSkillInstall(ctx, uri('/second/a.md'));
    expect(promptCalls()).toHaveLength(1);
    api.config.globalPrompt = true;
    await maybePromptSkillInstall(ctx, uri('/second/a.md'));
    expect(promptCalls()).toHaveLength(2);
  });

  it('does not treat provider errors as absence and retries without consuming the first-use prompt', async () => {
    const ctx = context(); folder();
    api.workspace.fs.readFile.mockRejectedValueOnce(new api.FileSystemError('NoPermissions'));
    await maybePromptSkillInstall(ctx);
    expect(promptCalls()).toHaveLength(0);
    await maybePromptSkillInstall(ctx);
    expect(promptCalls()).toHaveLength(1);
  });

  it('prompts in a workspace even if the initial empty-window prompt was dismissed', async () => {
    const ctx = context();
    await maybePromptSkillInstall(ctx);
    await maybePromptSkillInstall(ctx);
    folder(); await maybePromptSkillInstall(ctx);
    expect(promptCalls()).toHaveLength(2);
  });

  it('does not mistake an empty skill directory or malformed SKILL.md for an installation', async () => {
    folder(); const ctx = context();
    api.directories.add('/home/test-user/.agents/skills/limr-annotations');
    api.files.set('/workspace/.agents/skills/limr-annotations/SKILL.md', 'unfinished');
    await maybePromptSkillInstall(ctx);
    expect(promptCalls()).toHaveLength(1);
  });

  it.each(['.agents', '.claude', '.codex'])('detects an installed global skill in %s', async directory => {
    folder(); api.files.set(`/home/test-user/${directory}/skills/limr-annotations/SKILL.md`, skill);
    await maybePromptSkillInstall(context());
    expect(promptCalls()).toHaveLength(0);
  });

  it('detects an installed workspace skill without suppressing a different workspace', async () => {
    folder(); folder('/second'); const ctx = context();
    api.files.set('/workspace/.claude/skills/limr-annotations/SKILL.md', skill);
    await maybePromptSkillInstall(ctx, uri('/workspace/a.md'));
    await maybePromptSkillInstall(ctx, uri('/second/a.md'));
    expect(promptCalls()).toHaveLength(1);
  });

  it('defers untrusted workspaces and honors disabled prompting', async () => {
    folder(); const ctx = context(); api.workspace.isTrusted = false;
    await maybePromptSkillInstall(ctx);
    await installGlobalSkill(ctx);
    expect(promptCalls()).toHaveLength(0);
    expect(api.workspace.fs.writeFile).not.toHaveBeenCalled();
    api.workspace.isTrusted = true; api.config.prompt = false;
    await maybePromptSkillInstall(ctx);
    expect(promptCalls()).toHaveLength(0);
    api.config.prompt = true;
    await maybePromptSkillInstall(ctx);
    expect(promptCalls()).toHaveLength(1);
  });

  it('persists global and current-workspace reminder choices at the requested scope', async () => {
    folder(); api.window.showInformationMessage.mockResolvedValueOnce('Reminders…');
    api.window.showQuickPick.mockResolvedValueOnce({ scope: 'workspace' });
    await maybePromptSkillInstall(context());
    expect(api.config.update).toHaveBeenCalledWith('skills.promptOnStartup', false, 2);
    api.window.showInformationMessage.mockResolvedValueOnce('Reminders…');
    api.window.showQuickPick.mockResolvedValueOnce({ scope: 'global' });
    await maybePromptSkillInstall(context());
    expect(api.config.update).toHaveBeenCalledWith('skills.promptOnStartup', false, 1);
  });

  it('offers compact notification actions and keeps both installation scopes in the picker', async () => {
    folder(); api.window.showInformationMessage.mockResolvedValueOnce('Install…');
    await maybePromptSkillInstall(context());
    expect(promptCalls()[0].slice(1)).toEqual(['Install…', 'Reminders…']);
    const targets = api.window.showQuickPick.mock.calls[0][0] as { tool?: string; scope?: string }[];
    expect(targets.filter(target => target.tool === 'codex').map(target => target.scope)).toEqual(['global', 'workspace']);
    expect(api.workspace.fs.writeFile).not.toHaveBeenCalled();
  });

  it('cancelling reminder choices changes no configuration or installation', async () => {
    folder(); api.window.showInformationMessage.mockResolvedValueOnce('Reminders…');
    await maybePromptSkillInstall(context());
    expect(api.window.showQuickPick).toHaveBeenCalledOnce();
    expect(api.config.update).not.toHaveBeenCalled();
    expect(api.workspace.fs.writeFile).not.toHaveBeenCalled();
  });

  it('installs all bundled reference files globally without changing the workspace', async () => {
    folder(); api.window.showQuickPick.mockImplementationOnce(async items => (items as any[]).find(item => item.tool === 'codex'));
    await installGlobalSkill(context());
    expect(api.files.get('/home/test-user/.agents/skills/limr-annotations/SKILL.md')).toBe(skill);
    expect(api.files.get('/home/test-user/.agents/skills/limr-annotations/references/reader-plugins.md')).toBe('Workspace plugin reference');
    expect([...api.files.keys()].some(path => path.startsWith('/workspace/'))).toBe(false);
    expect(api.window.showQuickPick.mock.calls[0][0]).toHaveLength(2);
  });

  it('installs to the selected workspace and respects refusal to update existing files', async () => {
    folder(); api.window.showQuickPick.mockResolvedValue({ tool: 'claude', scope: 'workspace' });
    api.directories.add('/workspace/.claude/skills/limr-annotations');
    api.files.set('/workspace/.claude/skills/limr-annotations/SKILL.md', 'customized');
    await installSkill(context(), uri('/workspace/a.md'), 'workspace');
    expect(api.files.get('/workspace/.claude/skills/limr-annotations/SKILL.md')).toBe('customized');
    expect(api.workspace.fs.writeFile).not.toHaveBeenCalled();
    api.window.showWarningMessage.mockResolvedValueOnce('Update skill');
    await installSkill(context(), uri('/workspace/a.md'), 'workspace');
    expect(api.files.get('/workspace/.claude/skills/limr-annotations/SKILL.md')).toBe(skill);
  });

  it('copies actual bundle and workspace paths without installing or sending messages', async () => {
    folder(); await copySkillInstallPrompt(context(), uri('/workspace/a.md'));
    const text = api.env.clipboard.writeText.mock.calls[0][0];
    expect(text).toContain('/extension/skills/limr-annotations');
    expect(text).toContain('Current workspace: /workspace');
    expect(text).toContain('~/.agents/skills');
    expect(api.workspace.fs.writeFile).not.toHaveBeenCalled();
  });

  it('uses the explicit reader language and follows VS Code when set to auto', async () => {
    folder(); api.config.language = 'zh-CN';
    await maybePromptSkillInstall(context());
    expect(String(promptCalls()[0][0]).startsWith('安装 LiMR AI Skill？')).toBe(true);
    await showSkillGuide(context());
    expect(api.workspace.openTextDocument.mock.calls.at(-1)?.[0].path).toBe('/extension/docs/ai-guide.md');
    api.config.language = 'auto'; api.env.language = 'en';
    await showSkillGuide(context());
    expect(api.workspace.openTextDocument.mock.calls.at(-1)?.[0].path).toBe('/extension/docs/ai-guide.en.md');
  });
});
