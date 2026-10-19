import { expect } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';

export async function runOpenModesAcceptance({ page, host, artifacts }) {
  const evidence = [];
  const record = async check => {
    evidence.push({ check, snapshot: await host('snapshot') }); console.log(check);
    await writeFile(path.join(artifacts, 'checks.json'), JSON.stringify(evidence, null, 2));
  };
  const current = async (column, label, custom) => {
    await expect.poll(async () => {
      const tab = (await host('snapshot')).groups.find(group => group.viewColumn === column)?.tabs.find(tab => tab.active);
      return tab && [tab.label, tab.custom];
    }, { timeout: 15000 }).toEqual([label, custom]);
  };
  const reset = async () => {
    await host('configure', { values: { markdownOpenMode: 'none', singleReader: false } });
    await host('command', { command: 'workbench.action.closeAllEditors', args: [] });
    await host('command', { command: 'workbench.action.joinAllGroups', args: [] });
  };
  const quickOpen = async name => {
    await host('command', { command: 'workbench.action.quickOpen', args: [], wait: false });
    const input = page.locator('.quick-input-widget input[type="text"]');
    await input.fill(name);
    await expect(page.locator('.quick-input-list .monaco-list-row.focused')).toContainText(name);
    await input.press('Enter');
    await expect(input).not.toBeVisible();
  };
  await host('writeFiles', { files: Object.fromEntries(['none.md', 'reader.md', 'pair.md', 'change.md', 'next.md'].map(name => [name, `# ${name}\n\nOpening modes fixture.\n`])) });
  for (const [mode, name] of [['none', 'none.md'], ['reader', 'reader.md'], ['sideBySide', 'pair.md']]) {
    await reset();
    await host('configure', { values: { markdownOpenMode: mode } });
    await quickOpen(name);
    await current(1, name, mode === 'reader' ? 'limr.reader' : undefined);
    if (mode === 'sideBySide') {
      await current(2, name, 'limr.reader');
      await quickOpen('next.md');
      await current(1, 'next.md'); await current(2, 'next.md', 'limr.reader');
      expect((await host('snapshot')).groups).toHaveLength(2);
    }
    await record(`Quick Open respects ${mode}, including reuse of both columns`);
  }
  for (const mode of ['reader', 'sideBySide']) {
    await reset(); await host('openRelativeSource', { relative: 'change.md', viewColumn: 1 }); await current(1, 'change.md');
    // Ensure the active source has already been observed under the old setting.
    await page.waitForTimeout(300);
    await host('configure', { values: { markdownOpenMode: mode } });
    await current(1, 'change.md', mode === 'reader' ? 'limr.reader' : undefined);
    if (mode === 'sideBySide') await current(2, 'change.md', 'limr.reader');
    await record(`Changing the setting immediately applies ${mode} to the current source`);
  }
  await reset(); await host('openRelativeReader', { relative: 'change.md', viewColumn: 1 });
  await host('command', { command: 'workbench.action.closeAllEditors', args: [] });
  await host('configure', { values: { markdownOpenMode: 'sideBySide' } });
  await quickOpen('change.md');
  await expect.poll(async () => {
    const groups = (await host('snapshot')).groups;
    return groups.length === 2 && groups.every(group => group.tabs.some(tab => tab.active && tab.label === 'change.md'))
      && groups.flatMap(group => group.tabs).filter(tab => tab.custom === 'limr.reader').length === 1;
  }).toBe(true);
  await record('Default split also works when native Quick Open remembers the LiMR editor');
  const readerColumn = (await host('snapshot')).groups.find(group => group.tabs.some(tab => tab.custom === 'limr.reader')).viewColumn;
  await host('openRelativeReader', { relative: 'change.md', viewColumn: readerColumn });
  await page.waitForTimeout(300);
  expect((await host('snapshot')).activeCustom).toBe('limr.reader');
  await record('Focusing an existing reader in a default split does not move focus back to its source');
  await reset(); await host('configure', { values: { markdownOpenMode: 'reader' } });
  await quickOpen('change.md'); await current(1, 'change.md', 'limr.reader');
  await host('command', { command: 'workbench.action.reopenTextEditor', args: [] });
  await current(1, 'change.md');
  await host('configure', { values: { markdownOpenMode: 'sideBySide' } });
  await page.waitForTimeout(300);
  await current(1, 'change.md');
  expect((await host('snapshot')).groups.flatMap(group => group.tabs).filter(tab => tab.custom)).toHaveLength(0);
  await record('Explicit Reopen with Text Editor remains usable after a settings change');
  await page.screenshot({ path: path.join(artifacts, 'open-modes.png') });
  return evidence;
}
