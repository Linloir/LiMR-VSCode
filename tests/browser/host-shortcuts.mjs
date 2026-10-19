import { expect } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const generated = '# Workbench shortcuts\n\n' + Array.from({ length: 400 }, (_, index) =>
  `## Section ${index + 1}\n\n${'A reader keyboard shortcut must keep VS Code in control without preparing another complete document. '.repeat(8)}\n\n`).join('');

export async function runHostShortcutsAcceptance({ page, frame, host, artifacts }) {
  const file = process.env.LIMR_TEST_LARGE_DOCUMENT;
  const source = file ? await readFile(file, 'utf8') : generated;
  const evidence = [], errors = [];
  page.on('pageerror', error => errors.push(error.stack ?? error.message));
  await host('configure', { values: { syncScroll: false, typography: 'standard', sidebarMode: 'hidden', tocMode: 'hidden', 'plugins.enabled': false,
    ...(file ? { 'images.pathMode': 'folder', 'images.baseFolder': path.dirname(file) } : {}) } });
  await host('replaceSource', { source });
  await expect(frame.locator('.limr-reader h1').first()).toContainText(source.split('\n')[0].replace(/^#+\s*/, ''), { timeout: 90_000 });
  await expect(frame.locator('.lv-app')).toHaveAttribute('data-reader-ready', 'true', { timeout: 90_000 });
  await expect(frame.locator('[data-limr-windowed]')).toHaveCount(1);
  await frame.evaluate(() => {
    window.__hostShortcutJournal = { keys: [], printSurfaces: [] };
    window.__hostShortcutObserver = new MutationObserver(records => {
      for (const record of records) for (const node of record.addedNodes) {
        if (!(node instanceof Element)) continue;
        const surfaces = [node, ...node.querySelectorAll('.limr-print-progress, .limr-print-document')]
          .filter(element => element.matches('.limr-print-progress, .limr-print-document'));
        for (const element of surfaces) if (window.__hostShortcutJournal.printSurfaces.length < 10)
          window.__hostShortcutJournal.printSurfaces.push({ className: element.className, text: element.textContent?.slice(0, 200) });
      }
    });
    window.__hostShortcutObserver.observe(document.body, { childList: true, subtree: true });
    document.addEventListener('keydown', event => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'p') window.__hostShortcutJournal.keys.push({
        key: event.key, shift: event.shiftKey, trusted: event.isTrusted, prevented: event.defaultPrevented,
      });
    });
  });
  const quickInput = page.locator('.quick-input-widget');
  const input = quickInput.locator('.quick-input-box input');
  try {
    for (const [key, name, commandPalette] of [['Control+Shift+P', 'command-palette', true], ['Control+P', 'quick-open', false]]) {
      await frame.locator('.limr-reader h1').first().click();
      await expect.poll(() => frame.evaluate(() => document.hasFocus())).toBe(true);
      await page.keyboard.press(key);
      await expect(quickInput).toBeVisible();
      const result = await frame.evaluate(() => ({
        popupCount: document.querySelectorAll('.limr-print-progress').length,
        printDocumentCount: document.querySelectorAll('article.limr-print-document').length,
        popupText: document.querySelector('.limr-print-progress')?.textContent ?? '',
        documentLoadingCount: document.querySelectorAll('.limr-document-loading').length,
        journal: window.__hostShortcutJournal,
      }));
      const value = await input.inputValue(), placeholder = await input.getAttribute('placeholder');
      const unchanged = (await host('snapshot')).source === source;
      evidence.push({ name, key, characters: source.length, ...result, value, placeholder, unchanged, errors: [...errors] });
      await writeFile(path.join(artifacts, 'checks.json'), JSON.stringify(evidence, null, 2));
      await page.screenshot({ path: path.join(artifacts, `${name}.png`) });
      console.log(JSON.stringify(evidence.at(-1)));
      expect(result.popupCount, 'workbench shortcut must not show print preparation').toBe(0);
      expect(result.printDocumentCount, 'workbench shortcut must not build a duplicate full document').toBe(0);
      expect(result.journal.printSurfaces, 'no transient print preparation').toEqual([]);
      expect(result.documentLoadingCount, 'document loading uses the top progress bar').toBe(0);
      expect(result.journal.keys.at(-1)?.trusted, 'real keyboard event reaches the focused reader').toBe(true);
      expect(commandPalette ? value.startsWith('>') : value === '', 'correct VS Code picker opens').toBe(true);
      expect(unchanged).toBe(true);
      expect(errors).toEqual([]);
      await page.keyboard.press('Escape');
      await expect(quickInput).toBeHidden();
    }
  } finally {
    // A baseline failure can have started expensive print preparation. Cancel
    // it before the harness exits, without attempting the next shortcut.
    await frame.evaluate(() => {
      for (const button of document.querySelectorAll('.limr-print-progress button'))
        if (/^(Cancel|取消|Close|关闭)$/.test(button.textContent?.trim() ?? '')) button.click();
      window.__hostShortcutObserver?.disconnect();
    }).catch(() => {});
    await page.keyboard.press('Escape').catch(() => {});
  }
  return evidence;
}
