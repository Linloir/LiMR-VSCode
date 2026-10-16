import { expect } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';

async function globalSkillFiles() {
  const parents = [path.join(os.homedir(), '.agents', 'skills'), path.join(os.homedir(), '.codex', 'skills'), path.join(os.homedir(), '.claude', 'skills')];
  if (process.env.CODEX_HOME) parents.push(path.join(process.env.CODEX_HOME, 'skills'));
  return Object.fromEntries(await Promise.all([...new Set(parents)].map(async parent => {
    const file = path.join(parent, 'limr-annotations', 'SKILL.md');
    try { return [file, createHash('sha256').update(await readFile(file)).digest('hex')]; }
    catch (error) { if (error.code === 'ENOENT') return [file, null]; throw error; }
  })));
}

export async function runSkillAcceptance({ page, host, artifacts, fixture }) {
  const evidence = [];
  const globalsBefore = await globalSkillFiles();
  const save = async item => {
    evidence.push(item);
    await writeFile(path.join(artifacts, 'skill-progress.json'), JSON.stringify(evidence, null, 2));
    console.log(`Skill checked: ${item.check}`);
  };
  const quickInput = page.locator('.quick-input-widget');
  const prompt = page.getByText('安装 LiMR AI Skill？支持 AI 编辑标注、自定义样式和语法。', { exact: true });
  // The runner provides a disposable extension bundle with an empty skill home.
  // Real user skill files are independently hashed before and after the test.
  await expect(prompt).toBeVisible();
  const notification = page.locator('.notification-list-item').filter({ has: prompt });
  const checkLayout = async label => {
    await notification.hover();
    await expect(notification.getByRole('button', { name: '安装…', exact: true })).toBeVisible();
    await expect(notification.getByRole('button', { name: '提醒设置…', exact: true })).toBeVisible();
    const geometry = await notification.evaluate(node => {
      const rect = element => {
        if (!element) return null;
        const { x, y, width, height } = element.getBoundingClientRect();
        return { x, y, width, height, right: x + width, bottom: y + height };
      };
      return {
        item: rect(node), source: rect(node.querySelector('.notification-list-item-source')),
        message: rect(node.querySelector('.notification-list-item-message')),
        buttons: [...node.querySelectorAll('.monaco-button')].map(rect),
        classes: [...node.querySelectorAll('[class]')].map(element => element.className),
      };
    });
    await writeFile(path.join(artifacts, `skill-prompt-${label}.json`), JSON.stringify(geometry, null, 2));
    expect(geometry.buttons).toHaveLength(2);
    expect(geometry.source?.width).toBeGreaterThan(0);
    // Zoom can leave shared flex boundaries a fraction of a CSS pixel apart.
    const intersects = (a, b) => a.x < b.right - 0.5 && b.x < a.right - 0.5 && a.y < b.bottom - 0.5 && b.y < a.bottom - 0.5;
    for (const button of geometry.buttons) {
      expect(button.x).toBeGreaterThanOrEqual(geometry.item.x);
      expect(button.right).toBeLessThanOrEqual(geometry.item.right + 1);
      expect(intersects(geometry.source, button), `${label}: source must not overlap action buttons`).toBe(false);
      expect(intersects(geometry.message, button), `${label}: message must not overlap action buttons`).toBe(false);
    }
    await page.screenshot({ path: path.join(artifacts, `skill-prompt-${label}.png`) });
    delete geometry.classes;
    await save({ check: `First-use notification has two short actions without source/message overlap (${label})`, geometry });
  };
  await checkLayout('toast');
  await host('command', { command: 'notifications.showList' });
  await page.setViewportSize({ width: 900, height: 800 });
  await checkLayout('center-narrow');
  await host('command', { command: 'workbench.action.zoomIn' });
  await host('command', { command: 'workbench.action.zoomIn' });
  await checkLayout('center-narrow-zoomed');
  await host('command', { command: 'workbench.action.zoomReset' });
  await page.setViewportSize({ width: 1920, height: 1080 });
  if (process.env.LIMR_TEST_SKILL_ACTION === 'reminders') {
    await notification.getByRole('button', { name: '提醒设置…', exact: true }).click();
    await expect(quickInput).toBeVisible();
    await expect(page.locator('.quick-input-list').getByText('当前工作区不再提醒', { exact: true })).toBeVisible();
    await expect(page.locator('.quick-input-list').getByText('以后不再提醒', { exact: true })).toBeVisible();
    await page.screenshot({ path: path.join(artifacts, 'skill-reminder-choices.png') });
    await page.locator('.quick-input-list').getByText('当前工作区不再提醒', { exact: true }).click();
    await expect(quickInput).not.toBeVisible();
    await expect.poll(() => host('readConfiguration', { keys: ['skills.promptOnStartup'] })).toEqual({ 'skills.promptOnStartup': false });
    await save({ check: 'Reminder settings offers both opt-out scopes and persists the workspace choice' });
    await host('command', { command: 'limr.installSkill', wait: false });
  } else {
    await notification.getByRole('button', { name: '安装…', exact: true }).click();
  }
  await expect(quickInput).toBeVisible();
  await expect(page.locator('.quick-input-list').getByText('Codex · 全局', { exact: true })).toBeVisible();
  await expect(page.locator('.quick-input-list').getByText('Claude Code · 全局', { exact: true })).toBeVisible();
  await expect(page.locator('.quick-input-list').getByText('Claude Code · 当前工作区', { exact: true })).toBeVisible();
  await page.locator('.quick-input-list').getByText('Codex · 当前工作区', { exact: true }).click();
  await expect(quickInput).not.toBeVisible();
  const files = ['SKILL.md', 'references/source-annotations.md', 'references/reader-plugins.md'].map(file => `.agents/skills/limr-annotations/${file}`);
  let installed;
  await expect.poll(async () => {
    try { installed = await host('readWorkspaceFiles', { paths: files }); return true; } catch { return false; }
  }).toBe(true);
  expect(installed[files[0]]).toContain('name: limr-annotations');
  expect(installed[files[1]]).toContain('LiMR 1.2.2');
  expect(installed[files[1]]).toContain('::%%limr%%{<#range-id}');
  expect(installed[files[2]]).toContain('"plugins": [');
  expect(installed[files[2]]).toContain('React, limr');
  await save({ check: 'Workspace installation copies SKILL.md and both syntax/plugin references; independent file readback confirms LiMR 1.2.2', files });
  await host('command', { command: 'notifications.clearAll' });
  await host('command', { command: 'notifications.hideList' });

  await host('command', { command: 'limr.installGlobalSkill', wait: false });
  await expect(quickInput).toBeVisible();
  await expect(page.locator('.quick-input-list').getByText('Codex · 全局', { exact: true })).toBeVisible();
  await expect(page.locator('.quick-input-list').getByText('Claude Code · 全局', { exact: true })).toBeVisible();
  await expect(page.locator('.quick-input-list').getByText('Codex · 当前工作区', { exact: true })).toHaveCount(0);
  await page.screenshot({ path: path.join(artifacts, 'skill-global-choices.png') });
  await page.keyboard.press('Escape');
  await expect(quickInput).not.toBeVisible();
  await save({ check: 'Global install command offers only global Codex/Claude choices; cancelled before writing user directories' });

  await host('command', { command: 'limr.copySkillInstallPrompt', wait: false });
  await expect.poll(() => host('clipboard')).toContain('请帮我安装 LiMR');
  const chinese = await host('clipboard');
  expect(chinese).toContain(`当前工作区：${path.dirname(fixture)}`);
  expect(chinese).toContain('~/.agents/skills');
  expect(chinese).toContain('~/.claude/skills');
  await host('command', { command: 'notifications.clearAll' });
  await host('configure', { values: { language: 'en' } });
  await host('command', { command: 'limr.copySkillInstallPrompt', wait: false });
  await expect.poll(() => host('clipboard')).toContain('Help me install the LiMR');
  const english = await host('clipboard');
  expect(english).toContain(`Current workspace: ${path.dirname(fixture)}`);
  expect(english).toContain('Bundled source directory:');
  await save({ check: 'Clipboard installation instructions use the selected language and actual bundled/workspace paths', chineseLength: chinese.length, englishLength: english.length });
  await host('command', { command: 'notifications.clearAll' });
  await host('reopenReader');
  await expect(prompt).toHaveCount(0);
  expect(await globalSkillFiles()).toEqual(globalsBefore);
  await save({ check: 'Reopening the reader does not repeat onboarding; global skill files are unchanged' });
  return evidence;
}
