import { expect } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';

export async function runEntrypointsAcceptance({ page, host, ready, artifacts }) {
  const evidence = [];
  expect(ready.automaticallyActivated).toBe(true);
  const actions = page.locator('.editor-group-container.active .editor-actions');
  const sourceState = { check: 'Markdown source editor actions', host: ready.appName, snapshot: await host('snapshot'), buttons: await actions.getByRole('button').evaluateAll(elements => elements.map(element => ({ title: element.getAttribute('title'), label: element.getAttribute('aria-label'), className: element.className }))) };
  evidence.push(sourceState);
  await writeFile(path.join(artifacts, 'checks.json'), JSON.stringify(evidence, null, 2));
  await page.screenshot({ path: path.join(artifacts, 'source-actions.png') });
  if (process.env.LIMR_TEST_OBSERVE_ONLY === '1') return evidence;
  const record = async check => {
    evidence.push({ check }); console.log(check);
    await writeFile(path.join(artifacts, 'checks.json'), JSON.stringify(evidence, null, 2));
  };
  const book = actions.getByRole('button', { name: /^Open Reader to the Side/ });
  await expect(book).toBeVisible({ timeout: 15000 });
  await page.screenshot({ path: path.join(artifacts, 'source-actions-pinned.png') });
  await book.click();
  await expect.poll(async () => (await host('snapshot')).activeCustom).toBe('limr.reader');
  for (const name of ['Choose Reader Theme', 'Toggle Markdown Editing', 'Choose Typography', 'Choose Translation Display', 'Reader Settings', 'Open Markdown Source']) {
    await expect(actions.getByRole('button', { name: new RegExp(name) })).toBeVisible();
  }
  // Cursor exposes the submenu as a menuitem; newer VS Code uses a button.
  await expect(actions.locator('.codicon-sparkle')).toBeVisible();
  await page.screenshot({ path: path.join(artifacts, 'reader-actions-pinned.png') });
  await record('Source and reader title buttons are directly visible and the book button opens LiMR');

  await host('writeFiles', { files: { 'shortcut.md': '# Shortcut current\n', 'shortcut.MARKDOWN': '# Shortcut side\n', 'chord.md': '# Shortcut chord\n' } });
  const cases = [['shortcut.md', false, false], ['shortcut.MARKDOWN', true, false]];
  if (!/cursor/i.test(ready.appName)) cases.push(['chord.md', true, true]);
  for (const [relative, side, chord] of cases) {
    await host('command', { command: 'workbench.action.closeAllEditors', args: [] });
    await host('command', { command: 'workbench.action.joinAllGroups', args: [] });
    await host('openRelativeSource', { relative, viewColumn: 1 });
    await page.locator('.editor-group-container.active .monaco-editor .view-lines').click();
    if (chord) { await page.keyboard.press('Control+k'); await page.keyboard.press('v'); }
    else await page.keyboard.press(side ? 'Control+Alt+v' : 'Control+Shift+v');
    await expect.poll(async () => (await host('snapshot')).activeCustom).toBe('limr.reader');
    const snapshot = await host('snapshot');
    const reader = snapshot.groups.find(group => group.active);
    expect(reader.viewColumn).toBe(side ? 2 : 1);
    expect(reader.tabs.find(tab => tab.active).label).toBe(relative);
    if (side) expect(snapshot.groups.find(group => group.viewColumn === 1).tabs.some(tab => tab.label === relative && !tab.custom)).toBe(true);
    await record(`${chord ? 'Ctrl+K V' : side ? 'Ctrl+Alt+V' : 'Ctrl+Shift+V'} opens ${relative} in the ${side ? 'side' : 'current'} group`);
  }
  return evidence;
}
