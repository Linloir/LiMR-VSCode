import { expect } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

export async function runScrollReloadAcceptance({ page, frame: initialFrame, host, artifacts }) {
  const file = process.env.LIMR_TEST_LARGE_DOCUMENT;
  if (!file) throw new Error('LIMR_TEST_LARGE_DOCUMENT is required for the restored-reader regression.');
  const source = await readFile(file, 'utf8');
  const errors = [], evidence = [];
  page.on('pageerror', error => errors.push(error.stack ?? error.message));
  await page.exposeBinding('__limrReloadWindowError', (_context, message) => errors.push(message));
  const observeWindowErrors = () => window.addEventListener('error', event => {
    // ResizeObserver depth errors have a message but no Error object, and may
    // not reach Playwright's pageerror event. Retain them across webview reloads.
    if (typeof event.message === 'string') void window.__limrReloadWindowError?.(event.message).catch(() => {});
  });
  await page.addInitScript(observeWindowErrors);
  await initialFrame.evaluate(observeWindowErrors);
  page.on('console', message => {
    if (/Minified React error|Maximum update depth|LiMR plugin:/.test(message.text())) {
      errors.push(message.text());
      void writeFile(path.join(artifacts, 'react-errors.json'), JSON.stringify(errors, null, 2));
    }
  });
  if (process.env.LIMR_TEST_WIDTH) await page.setViewportSize({ width: Number(process.env.LIMR_TEST_WIDTH), height: Number(process.env.LIMR_TEST_HEIGHT ?? 1080) });
  await host('configure', { values: { syncScroll: true, typography: 'knuth-plass', theme: 'one-dark-pro', tocMode: 'wide', sidebarMode: 'hidden', 'plugins.enabled': false,
    'images.pathMode': 'folder', 'images.baseFolder': path.dirname(file) } });
  await host('configureEditor', { values: { wordWrap: 'off', smoothScrolling: false } });
  await host('layout', { sourceSize: .5 });
  await host('replaceSource', { source });
  let frame = initialFrame;
  await expect(frame.locator('.lv-app')).toHaveAttribute('data-reader-ready', 'true', { timeout: 90_000 });
  await host('activateSource');
  await host('scrollSource', { line: 41 });
  await delay(1000);
  const offsets = [0];
  for (let i = 0; i < source.length; i++) if (source[i] === '\n') offsets.push(i + 1);
  for (const mode of ['display', 'height']) {
    await frame.evaluate(mode => {
      const root = document.querySelector('.lv-scroll');
      window.__restoredWindow = root.querySelector('[data-limr-windowed]');
      if (mode === 'display') root.style.display = 'none';
      else { root.style.maxHeight = '0px'; root.style.padding = '0px'; }
    }, mode);
    await expect.poll(() => frame.locator('.lv-scroll').evaluate(el => el.clientHeight)).toBe(0);
    // Keep only the latest seek while the webview has no measurable viewport.
    await host('scrollSource', { line: 500 });
    await delay(120);
    await host('scrollSource', { line: 550 });
    await delay(250);
    await frame.locator('.lv-scroll').evaluate(el => { for (const property of ['display', 'max-height', 'padding']) el.style.removeProperty(property); });
    const target = offsets[550];
    await expect.poll(() => frame.evaluate(target => {
      const root = document.querySelector('.lv-scroll'), edge = root.getBoundingClientRect().top;
      return [...root.querySelectorAll('[data-window-slot]:not([data-window-parked]) [data-source-start]')].some(el => {
        const rect = el.getBoundingClientRect();
        return Number(el.dataset.sourceStart) <= target && Number(el.dataset.sourceEnd) > target && rect.bottom > edge && rect.top < edge + root.clientHeight;
      });
    }, target), { timeout: 15_000 }).toBe(true);
    await delay(250);
    const result = await frame.evaluate(() => ({
      top: document.querySelector('.lv-scroll').scrollTop,
      sameWindow: document.querySelector('[data-limr-windowed]') === window.__restoredWindow,
      navigating: !!document.querySelector('[data-source-navigation]'),
    }));
    evidence.push({ mode, ...result, errors: [...errors] });
    await writeFile(path.join(artifacts, 'checks.json'), JSON.stringify(evidence, null, 2));
    console.log(JSON.stringify(evidence.at(-1)));
    expect(errors).toEqual([]);
    expect(result.sameWindow).toBe(true);
    expect(result.top).toBeGreaterThan(5000);
    expect(result.navigating, 'the deferred source seek converges').toBe(false);
  }
  for (const round of [1, 2]) {
    await frame.evaluate(() => { window.__reloadRegressionOldDocument = true; });
    await host('command', { command: 'workbench.action.webview.reloadWebviewAction', args: [] });
    await expect.poll(async () => {
      for (const candidate of page.frames()) {
        if (!candidate.isDetached() && await candidate.locator('.lv-scroll').count().catch(() => 0)
          && !await candidate.evaluate(() => window.__reloadRegressionOldDocument).catch(() => true)) { frame = candidate; return true; }
      }
      return false;
    }, { timeout: 60_000 }).toBe(true);
    const editor = page.locator('.editor-group-container').first().locator('.monaco-editor').first();
    await editor.hover({ position: { x: 160, y: 240 } });
    for (let i = 0; i < 20; i++) { await page.mouse.wheel(0, 80); await delay(40); }
    await expect(frame.locator('.lv-app')).toHaveAttribute('data-reader-ready', 'true', { timeout: 90_000 });
    await expect(frame.locator('[data-limr-windowed]')).toHaveCount(1);
    const before = await frame.locator('.lv-scroll').evaluate(el => el.scrollTop);
    for (let i = 0; i < 20; i++) { await page.mouse.wheel(0, 80); await delay(40); }
    await delay(500);
    const after = await frame.locator('.lv-scroll').evaluate(el => el.scrollTop);
    evidence.push({ round, before, after, errors: [...errors] });
    await writeFile(path.join(artifacts, 'checks.json'), JSON.stringify(evidence, null, 2));
    console.log(JSON.stringify(evidence.at(-1)));
    expect(errors).toEqual([]);
    expect(after).toBeGreaterThan(before + 200);
    expect((await host('snapshot')).source).toBe(source);
  }
  return evidence;
}
