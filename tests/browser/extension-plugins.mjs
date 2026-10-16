import { expect } from '@playwright/test';
import { access, writeFile } from 'node:fs/promises';
import path from 'node:path';

const addonId = 'limr-examples.limr-reader-addon';
const pluginId = `extension:${addonId}/research-card`;
const paragraph = index => `Paragraph ${index}. Ordinary reading content stays available before and after an add-on is registered. `;
const source = '# Installed LiMR add-on\n\n' + Array.from({ length: 65 }, (_, index) => paragraph(index)).join('\n\n')
  + '\n\n:::example-research-card\nA card from the installed extension.\n:::\n\n' + Array.from({ length: 30 }, (_, index) => paragraph(index + 65)).join('\n\n');

export async function runExtensionPluginsAcceptance({ page, host, fixture, artifacts }) {
  const evidence = [];
  const save = async item => { evidence.push(item); await writeFile(path.join(artifacts, 'checks.json'), JSON.stringify(evidence, null, 2)); };
  const reader = async () => {
    let match;
    await expect.poll(async () => {
      for (const frame of page.frames()) if (await frame.locator('.lv-scroll .limr-reader').count().catch(() => 0)) { match = frame; return true; }
      return false;
    }, { timeout: 15_000 }).toBe(true);
    return match;
  };
  const cardCount = async () => (await reader()).locator('.limr-example-research-card').count().catch(() => -1);
  const styleCount = async () => (await reader()).locator(`link[data-limr-plugin="${pluginId}"]`).count().catch(() => -1);
  const position = async () => (await reader()).locator('.lv-scroll').evaluate(node => ({ top: node.scrollTop, height: node.scrollHeight, viewport: node.clientHeight, fonts: document.fonts.status }));
  const anchor = async (text) => (await reader()).locator('.lv-scroll').evaluate((node, targetText) => {
    const paragraphs = [...node.querySelectorAll('.limr-reader p')];
    const match = targetText ? paragraphs.find(item => item.textContent === targetText)
      : paragraphs.find(item => item.getBoundingClientRect().top >= node.getBoundingClientRect().top && item.getBoundingClientRect().bottom <= node.getBoundingClientRect().bottom);
    return match && { text: match.textContent, y: match.getBoundingClientRect().top - node.getBoundingClientRect().top };
  }, text);
  const invoke = command => host('command', { command });
  await expect(access(path.join(path.dirname(fixture), '.limr/plugins/manifest.json'))).rejects.toMatchObject({ code: 'ENOENT' });
  await host('configure', { values: { 'plugins.enabled': true, syncScroll: false, tocMode: 'hidden', sidebarMode: 'hidden' } });
  await host('replaceSource', { source });
  await invoke('limrExample.enable');
  const installed = await host('extensionInfo', { extensionId: addonId });
  expect(installed.active).toBe(true);
  expect(installed.dependencies).toContain('linloir.limr-vscode');
  expect(installed.extensionUri).not.toContain(path.dirname(fixture));
  await expect.poll(cardCount).toBe(1);
  await expect.poll(styleCount).toBe(1);
  const computed = await (await reader()).locator('.limr-example-research-card').evaluate(node => {
    const style = getComputedStyle(node); return { border: style.borderInlineStartWidth, padding: style.paddingInlineStart, text: node.textContent };
  });
  expect(computed.border).toBe('2px'); expect(Number.parseFloat(computed.padding)).toBeGreaterThan(0);
  expect(computed.text).toContain('A card from the installed extension.');
  await save({ check: 'A real installed companion extension activates via extensionDependencies and API v1; its browser module and extension-local CSS render without a workspace plugin manifest', installed, computed });

  await (await reader()).locator('.lv-scroll').evaluate(node => { node.scrollTop = 900; });
  await expect.poll(async () => (await position()).top).toBeGreaterThan(850);
  // Allow the small persistent view-state throttle to flush before exercising a guest reload.
  await page.waitForTimeout(120);
  const before = await position(), beforeAnchor = await anchor(), previousGuest = await (await reader()).evaluate(() => performance.timeOrigin);
  expect(beforeAnchor).toBeTruthy();
  await invoke('limrExample.disable');
  await expect.poll(cardCount).toBe(0); await expect.poll(styleCount).toBe(0);
  await expect.poll(async () => Math.abs((await anchor(beforeAnchor.text)).y - beforeAnchor.y)).toBeLessThan(8);
  const currentGuest = await (await reader()).evaluate(() => performance.timeOrigin);
  expect(currentGuest).not.toBe(previousGuest);
  await save({ check: 'Disposing the registration removes module/CSS, returns custom syntax to fallback, and preserves the visible reading paragraph when VS Code recreates the guest for resource grants', before, after: await position(), beforeAnchor, afterAnchor: await anchor(beforeAnchor.text), previousGuest, currentGuest });

  await invoke('limrExample.enable'); await expect.poll(cardCount).toBe(1); await expect.poll(styleCount).toBe(1);
  await expect.poll(async () => Math.abs((await anchor(beforeAnchor.text)).y - beforeAnchor.y)).toBeLessThan(8);
  await save({ check: 'Re-registration retains the original visible paragraph', position: await position(), anchor: await anchor(beforeAnchor.text) });
  await host('configure', { values: { 'plugins.enabled': false } });
  await expect.poll(cardCount).toBe(0); await expect.poll(styleCount).toBe(0);
  await host('configure', { values: { 'plugins.enabled': true } });
  await expect.poll(cardCount).toBe(1); await expect.poll(styleCount).toBe(1);
  await expect.poll(async () => Math.abs((await anchor(beforeAnchor.text)).y - beforeAnchor.y)).toBeLessThan(8);
  await save({ check: 'The shared plugins.enabled switch refreshes an already-open reader without source edits or loss of the original visible paragraph', position: await position(), anchor: await anchor(beforeAnchor.text) });

  await invoke('limrExampleTest.missing');
  await expect(page.getByText(/extension:limr-examples\.limr-reader-addon\/missing:/).first()).toBeVisible();
  await expect.poll(cardCount).toBe(1);
  await invoke('limrExampleTest.throwing');
  await expect(page.getByText(/Expected add-on factory failure/).first()).toBeVisible();
  await expect.poll(cardCount).toBe(1); await expect.poll(styleCount).toBe(1);
  await invoke('limrExampleTest.clear');
  await expect.poll(cardCount).toBe(1);
  await invoke('limrExample.disable'); await expect.poll(cardCount).toBe(0);
  await invoke('limrExampleTest.pending');
  await expect.poll(async () => (await reader()).evaluate(() => window.limrTestPendingFactory).catch(() => false)).toBe(true);
  await invoke('limrExample.enable');
  await expect.poll(cardCount).toBe(1); await expect.poll(styleCount).toBe(1);
  await invoke('limrExampleTest.clear'); await expect.poll(cardCount).toBe(1);
  expect((await host('snapshot')).source).toBe(source);
  await (await reader()).locator('.limr-example-research-card').scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(artifacts, 'installed-addon.png') });
  await save({ check: 'Missing assets, a throwing factory, and a preceding never-resolving async factory do not block the working add-on; Markdown remains unchanged' });
  return evidence;
}
