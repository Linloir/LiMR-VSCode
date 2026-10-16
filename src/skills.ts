import { homedir } from 'node:os';
import * as vscode from 'vscode';

const skillName = 'limr-annotations';
const startupKey = 'limr.skills.startupPrompted.v1';
const globallySuppressedKey = 'limr.skills.globallySuppressed.v1';
const promptTasks = new WeakMap<vscode.ExtensionContext, Promise<void>>();
type Scope = 'global' | 'workspace';
type Tool = 'codex' | 'claude';

function localized(resource?: vscode.Uri) {
  const language = vscode.workspace.getConfiguration('limr', resource).get<string>('language', 'auto');
  const chinese = (language === 'auto' ? vscode.env.language : language).toLowerCase().startsWith('zh');
  return (zh: string, en: string) => chinese ? zh : en;
}
function bundledSkill(context: vscode.ExtensionContext) {
  return vscode.Uri.joinPath(context.extensionUri, 'skills', skillName);
}
function globalParent(tool: Tool) {
  return vscode.Uri.joinPath(vscode.Uri.file(homedir()), tool === 'codex' ? '.agents' : '.claude', 'skills');
}
function workspaceFolder(resource?: vscode.Uri) {
  return (resource && vscode.workspace.getWorkspaceFolder(resource))
    || (vscode.workspace.workspaceFolders?.length === 1 ? vscode.workspace.workspaceFolders[0] : undefined);
}
function promptKey(folder?: vscode.WorkspaceFolder) {
  return folder ? `limr.skills.prompted.v1:${folder.uri.toString()}` : startupKey;
}
function isMissing(error: unknown) {
  return error instanceof vscode.FileSystemError && error.code === 'FileNotFound';
}
async function exists(uri: vscode.Uri) {
  try { await vscode.workspace.fs.stat(uri); return true; }
  catch (error) { if (isMissing(error)) return false; throw error; }
}
/** A leftover directory or an interrupted copy is not an installed skill. */
async function hasSkill(parent: vscode.Uri) {
  try {
    const bytes = await vscode.workspace.fs.readFile(vscode.Uri.joinPath(parent, skillName, 'SKILL.md'));
    const source = new TextDecoder().decode(bytes);
    return /^---\r?\n[\s\S]*?\bname:\s*["']?limr-annotations["']?\s*\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/.test(source);
  } catch (error) { if (isMissing(error)) return false; throw error; }
}
async function hasGlobalSkill() {
  const parents = [globalParent('codex'), globalParent('claude'), vscode.Uri.joinPath(vscode.Uri.file(homedir()), '.codex', 'skills')];
  if (process.env.CODEX_HOME) parents.push(vscode.Uri.joinPath(vscode.Uri.file(process.env.CODEX_HOME), 'skills'));
  return (await Promise.all(parents.map(hasSkill))).some(Boolean);
}
async function hasWorkspaceSkill(folder: vscode.WorkspaceFolder) {
  return (await Promise.all(['.agents', '.claude'].map(directory => hasSkill(vscode.Uri.joinPath(folder.uri, directory, 'skills'))))).some(Boolean);
}

export async function showSkillGuide(context: vscode.ExtensionContext, resource?: vscode.Uri) {
  const t = localized(resource);
  const document = await vscode.workspace.openTextDocument(vscode.Uri.joinPath(context.extensionUri, 'docs', t('ai-guide.md', 'ai-guide.en.md')));
  await vscode.window.showTextDocument(document, { preview: true });
}

export async function installSkill(context: vscode.ExtensionContext, resource?: vscode.Uri, scope?: Scope) {
  const t = localized(resource);
  if (!vscode.workspace.isTrusted) {
    await vscode.window.showWarningMessage(t('请先信任此工作区，再安装 AI 技能。', 'Trust this workspace before installing AI skills.'));
    return;
  }
  const targets: (vscode.QuickPickItem & { tool?: Tool; scope?: Scope })[] = [];
  for (const targetScope of (scope ? [scope] : ['global', 'workspace'] as const)) {
    for (const tool of ['codex', 'claude'] as const) {
      const directory = tool === 'codex' ? '.agents' : '.claude';
      targets.push({ tool, scope: targetScope,
        label: `${tool === 'codex' ? 'Codex' : 'Claude Code'} · ${targetScope === 'global' ? t('全局', 'Global') : t('当前工作区', 'Current workspace')}`,
        description: `${targetScope === 'global' ? '~/' : ''}${directory}/skills/${skillName}`,
        detail: targetScope === 'global'
          ? t('安装到当前扩展宿主的用户目录，供所有工作区使用。', 'Install in your user directory on this extension host for all workspaces.')
          : t('安装到当前项目目录，可随项目一起共享给协作者。', 'Install in this project so the skill can be shared with collaborators.'),
      });
    }
  }
  if (!scope) targets.push({ label: t('导出到其他目录…', 'Export to another directory…'), description: t('为其他 AI 工具选择技能目录', 'Choose a skills directory for another AI tool'),
    detail: t('在所选目录中创建 limr-annotations 文件夹，包含完整技能及参考文档。', 'Create a limr-annotations folder with the complete skill and reference documents in your chosen directory.') });
  const target = await vscode.window.showQuickPick(targets, {
    title: t('安装 LiMR AI Skill', 'Install LiMR AI Skill'),
    placeHolder: t('支持标注编辑和阅读器样式、语法扩展', 'Annotation editing, reader styles, and custom syntax'),
    matchOnDescription: true, matchOnDetail: true,
  });
  if (!target) return;
  let parent: vscode.Uri | undefined;
  if (!target.tool) parent = (await vscode.window.showOpenDialog({ canSelectFolders: true, canSelectFiles: false, canSelectMany: false, openLabel: t('安装到此目录', 'Install here') }))?.[0];
  else if (target.scope === 'global') parent = globalParent(target.tool);
  else {
    let folder = workspaceFolder(resource);
    if (!folder && vscode.workspace.workspaceFolders?.length) folder = await vscode.window.showWorkspaceFolderPick({ placeHolder: t('选择安装技能的工作区', 'Choose a workspace for the skill') });
    if (!folder) {
      await vscode.window.showInformationMessage(t('请先打开工作区文件夹，或选择全局安装、导出。', 'Open a workspace folder, or choose global installation or export.'));
      return;
    }
    parent = vscode.Uri.joinPath(folder.uri, target.tool === 'codex' ? '.agents' : '.claude', 'skills');
  }
  if (!parent) return;
  const destination = vscode.Uri.joinPath(parent, skillName);
  try {
    if (await exists(destination)) {
      const update = t('更新技能', 'Update skill');
      const answer = await vscode.window.showWarningMessage(
        t(`此位置已有文件：${destination.fsPath}。更新其中的同名技能文件？`, `Files already exist at ${destination.fsPath}. Update matching skill files?`), { modal: true }, update);
      if (answer !== update) return;
    }
    await copyDirectory(bundledSkill(context), destination);
    const view = t('查看技能', 'View skill');
    const answer = await vscode.window.showInformationMessage(
      t(`LiMR 技能已安装到 ${destination.fsPath}。可在 AI 对话中调用 limr-annotations。`, `LiMR skill installed at ${destination.fsPath}. Invoke limr-annotations in your AI conversation.`), view);
    if (answer === view) await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(vscode.Uri.joinPath(destination, 'SKILL.md')));
  } catch (error) {
    await vscode.window.showErrorMessage(t(`LiMR 技能安装失败：${String(error)}`, `LiMR skill installation failed: ${String(error)}`));
  }
}

export async function installGlobalSkill(context: vscode.ExtensionContext, resource?: vscode.Uri) {
  await installSkill(context, resource, 'global');
}

export async function copySkillInstallPrompt(context: vscode.ExtensionContext, resource?: vscode.Uri) {
  const t = localized(resource);
  const source = bundledSkill(context);
  const folder = workspaceFolder(resource);
  const location = folder ? folder.uri.fsPath : t('尚未打开工作区', 'No workspace is open');
  const prompt = t(
    `请帮我安装 LiMR 的 limr-annotations skill（支持 LiMR 1.2.3 标注，以及 VS Code 阅读器样式和语法插件）。\n\n技能来源目录：${source.fsPath}\n技能来源 URI：${source.toString()}\n当前工作区：${location}\n\n请先读取来源 SKILL.md，并保留完整目录结构及 references。使用我指定的 AI 工具和安装范围；若尚未指定，询问全局还是当前工作区。Codex 全局目录为 ~/.agents/skills，工作区目录为 .agents/skills；Claude Code 全局目录为 ~/.claude/skills，工作区目录为 .claude/skills。目标为上述目录下的 limr-annotations。已有文件时先比较，保留用户自定义内容。安装后确认 SKILL.md 和引用文档可读，告诉我如何调用。若你无法访问这个扩展宿主上的来源目录，请指导我在 VS Code 中运行 “LiMR: Install AI Skill…” 或 “LiMR: Install AI Skill Globally…”；不要假装已经安装。`,
    `Help me install the LiMR limr-annotations skill (LiMR 1.2.3 annotations and VS Code reader style/syntax plugins).\n\nBundled source directory: ${source.fsPath}\nBundled source URI: ${source.toString()}\nCurrent workspace: ${location}\n\nRead the source SKILL.md first and preserve its complete directory and references. Use my chosen AI tool and installation scope; if unspecified, ask whether to install globally or in this workspace. Codex uses ~/.agents/skills globally and .agents/skills in a workspace; Claude Code uses ~/.claude/skills globally and .claude/skills in a workspace. The destination is limr-annotations under that directory. Compare existing files and preserve user customizations. Verify SKILL.md and referenced files are readable and explain how to invoke the skill. If you cannot access the source on this extension host, guide me to run “LiMR: Install AI Skill…” or “LiMR: Install AI Skill Globally…” in VS Code; do not claim it is installed.`,
  );
  await vscode.env.clipboard.writeText(prompt);
  await vscode.window.showInformationMessage(t('已复制技能安装指引，可粘贴给 AI 助手。', 'Skill installation instructions copied. Paste them into your AI assistant.'));
}

/** Call on activation and reader open. The persisted key is per workspace root,
 * with a separate empty-window key; one in-flight prompt covers concurrent opens. */
export async function maybePromptSkillInstall(context: vscode.ExtensionContext, resource?: vscode.Uri): Promise<void> {
  const existing = promptTasks.get(context);
  if (existing) {
    await existing;
    // Check this caller's root as well after the visible prompt finishes.
    return maybePromptSkillInstall(context, resource);
  }
  const task = promptSkillInstall(context, resource);
  promptTasks.set(context, task);
  try { await task; } finally { if (promptTasks.get(context) === task) promptTasks.delete(context); }
}
async function promptSkillInstall(context: vscode.ExtensionContext, resource?: vscode.Uri) {
  if (!vscode.workspace.isTrusted) return;
  // A multi-root window with no active document uses its first root. Opening a
  // document from another root later gets that root's own one-time decision.
  const folder = workspaceFolder(resource) ?? vscode.workspace.workspaceFolders?.[0];
  const config = vscode.workspace.getConfiguration('limr', folder?.uri ?? resource);
  const configuredGlobally = config.inspect<boolean>('skills.promptOnStartup')?.globalValue;
  if (context.globalState.get<boolean>(globallySuppressedKey)) {
    if (configuredGlobally === true) await context.globalState.update(globallySuppressedKey, undefined);
    else return;
  }
  // An explicit user-level opt-out takes priority over workspace defaults.
  if (configuredGlobally === false || !config.get<boolean>('skills.promptOnStartup', true)) return;
  const state = folder ? context.workspaceState : context.globalState;
  const key = promptKey(folder);
  if (state.get<boolean>(key)) return;
  try {
    if (await hasGlobalSkill() || (folder && await hasWorkspaceSkill(folder))) return;
  } catch {
    // Permission/provider errors are not evidence of an absent installation.
    // Leave the key unset so the next activation can retry safely.
    return;
  }
  await state.update(key, true);
  const t = localized(folder?.uri ?? resource);
  // Native notifications share a fixed-width footer with the source label.
  // Keep actions short; scope choices belong in the responsive Quick Pick.
  const install = t('安装…', 'Install…');
  const reminders = t('提醒设置…', 'Reminders…');
  const answer = await vscode.window.showInformationMessage(
    t('安装 LiMR AI Skill？支持 AI 编辑标注、自定义样式和语法。', 'Install the LiMR AI Skill? Edit annotations and customize reader styles and syntax with AI.'), install, reminders);
  if (answer === install) {
    await installSkill(context, folder?.uri ?? resource);
    return;
  }
  if (answer !== reminders) return;
  const choice = await vscode.window.showQuickPick([
    ...(folder ? [{ label: t('当前工作区不再提醒', 'Do not remind in this workspace'),
      description: folder.name,
      detail: t('仅关闭此工作区的自动安装提示，其它工作区仍可提醒。', 'Turn off automatic installation prompts here; other workspaces can still show them.'), scope: 'workspace' as const }] : []),
    { label: t('以后不再提醒', 'Do not remind again'),
      description: t('所有工作区', 'All workspaces'),
      detail: t('在所有工作区关闭自动安装提示，仍可通过命令手动安装。', 'Turn off automatic installation prompts everywhere. Manual installation commands remain available.'), scope: 'global' as const },
  ], { title: t('Skill 安装提醒', 'Skill installation reminders'),
    placeHolder: t('选择关闭提醒的范围；可在 LiMR 设置中重新开启。', 'Choose where to turn off reminders. Re-enable them in LiMR settings.') });
  if (choice?.scope === 'global') {
    await context.globalState.update(globallySuppressedKey, true);
    await config.update('skills.promptOnStartup', false, vscode.ConfigurationTarget.Global);
  }
  else if (choice?.scope === 'workspace') await config.update('skills.promptOnStartup', false, vscode.workspace.workspaceFolders!.length > 1 ? vscode.ConfigurationTarget.WorkspaceFolder : vscode.ConfigurationTarget.Workspace);
}

async function copyDirectory(source: vscode.Uri, destination: vscode.Uri): Promise<void> {
  await vscode.workspace.fs.createDirectory(destination);
  // Write the entrypoint last so an interrupted fresh install is not detected as complete.
  const entries = await vscode.workspace.fs.readDirectory(source);
  entries.sort(([a], [b]) => Number(a === 'SKILL.md') - Number(b === 'SKILL.md'));
  for (const [name, type] of entries) {
    const src = vscode.Uri.joinPath(source, name), dst = vscode.Uri.joinPath(destination, name);
    if (type === vscode.FileType.Directory) await copyDirectory(src, dst);
    else if (type === vscode.FileType.File) await vscode.workspace.fs.writeFile(dst, await vscode.workspace.fs.readFile(src));
  }
}
