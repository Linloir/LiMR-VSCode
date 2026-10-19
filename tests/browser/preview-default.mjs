import { expect } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';

export async function runPreviewDefaultAcceptance({ page, host, ready, artifacts }) {
  const evidence = [];
  const record = async check => {
    evidence.push({ check, snapshot: await host('snapshot') }); console.log(check);
    await writeFile(path.join(artifacts, 'checks.json'), JSON.stringify(evidence, null, 2));
  };
  const actions = page.locator('.editor-group-container.active .editor-actions');
  const book = actions.locator('.codicon-book');
  const native = actions.locator('.codicon-open-preview');
  await expect(book).toBeVisible(); await expect(native).toHaveCount(0);
  await book.click();
  await expect.poll(async () => (await host('snapshot')).activeCustom).toBe('limr.reader');
  await record('The default preview title button opens LiMR');
  await host('activateSource');
  await book.click({ modifiers: ['Alt'] });
  await expect.poll(async () => (await host('snapshot')).groups.flatMap(group => group.tabs).some(tab => /markdown.*preview/i.test(tab.webview ?? ''))).toBe(true);
  await record('Alt-click still opens the built-in Markdown preview');
  await host('activateSource');
  await host('configure', { values: { previewButtonMode: 'separate' } });
  await expect(native).toBeVisible(); await expect(book).toBeVisible();
  await host('configure', { values: { previewButtonMode: 'merged' } });
  await expect(native).toHaveCount(0);
  await record('Explicit separate and merged settings update the title buttons immediately');
  if (/cursor/i.test(ready.appName)) {
    await page.mouse.move(100, 300); await page.keyboard.press('Escape');
    await page.locator('.editor-group-container.active .markdown-mode-tabs').getByRole('button', { name: 'Preview', exact: true }).click();
    await expect(page.locator('.editor-group-container.active .markdown-mode-tab.active')).toHaveText('Preview');
    await record('Cursor Preview uses its internal editor independently of extension title buttons');
    await page.screenshot({ path: path.join(artifacts, 'cursor-native-preview.png') });
    await host('configureWorkbench', { values: { editorAssociations: { '*.md': 'limr.reader' } } });
    await host('command', { command: 'workbench.action.closeAllEditors', args: [] });
    await host('openRelativeDefault', { relative: 'reader.md', viewColumn: 1 });
    await expect.poll(async () => (await host('snapshot')).activeCustom).toBe('limr.reader');
    await record('A default editor association opens LiMR even after Cursor remembers its internal Preview');
    await page.locator('.editor-group-container.active .markdown-mode-tabs').getByRole('button', { name: 'Markdown', exact: true }).click();
    await expect.poll(async () => (await host('snapshot')).activeEditor?.language).toBe('markdown');
    await book.click();
    await expect.poll(async () => (await host('snapshot')).activeCustom).toBe('limr.reader');
    await record('Returning from Cursor Preview to Markdown retains the LiMR entry point');
  }
  return evidence;
}
