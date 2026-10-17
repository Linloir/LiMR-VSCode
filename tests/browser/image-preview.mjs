import { expect } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const svg = (color, width = 2400, height = 1400) => `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="${color}"/><circle cx="${width / 2}" cy="${height / 2}" r="${height / 3}" fill="#fbf3da"/><text x="${width / 2}" y="${height / 2}" text-anchor="middle" dominant-baseline="middle" fill="#253248" font-family="sans-serif" font-size="120">LiMR</text></svg>`;
const source = `# Image preview

![Landscape](./images/landscape.svg)

![Reference image][picture]

[picture]: ./images/landscape.svg "Reference title"

<figure src="./images/landscape.svg" alt="Figure image" caption="A source-mapped caption." />

[![Linked image](./images/landscape.svg)](./target.md)

![Missing image](./images/missing.svg)

- [ ] Keep task editing available
`;

export async function runImagePreviewAcceptance({ page, frame, host, artifacts }) {
  const evidence = [], errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const save = async value => { evidence.push(value); await writeFile(path.join(artifacts, 'checks.json'), JSON.stringify(evidence, null, 2)); console.log(value.check); };
  const dialog = () => frame.getByRole('dialog').filter({ has: frame.locator('.limr-image-preview-stage') });
  const close = () => dialog().getByRole('button', { name: /关闭图片预览|Close image preview/ });
  const settled = () => dialog().evaluate(element => Promise.all(element.getAnimations({ subtree: true }).map(animation => animation.finished.catch(() => {}))));
  const target = alt => frame.locator('.lv-reader').getByAltText(alt, { exact: true });
  const scrollTop = () => frame.getByTestId('reader-scroll').evaluate(element => element.scrollTop);
  const tabs = snapshot => snapshot.groups.flatMap(group => group.tabs).map(tab => `${tab.uri}:${tab.custom ?? tab.webview ?? 'text'}`);
  await host('configure', { values: { language: 'zh-CN', theme: 'playground-dark', editingEnabled: false, tocMode: 'hidden', sidebarMode: 'hidden', syncScroll: false, 'plugins.enabled': false } });
  await host('writeFiles', { files: { 'images/landscape.svg': svg('#365d80'), 'images/changed.svg': svg('#607456', 1800, 900), 'target.md': '# Linked destination\n' } });
  await host('replaceSource', { source });
  await expect(frame.getByRole('heading', { name: 'Image preview', exact: true })).toBeVisible();
  const before = await host('snapshot');
  for (const alt of ['Landscape', 'Reference image', 'Figure image', 'Linked image']) {
    const image = target(alt);
    await image.scrollIntoViewIfNeeded();
    await expect(image).toHaveJSProperty('naturalWidth', 2400);
    await expect(image).toHaveAttribute('role', 'button');
    await expect(image).toHaveClass(/limr-previewable-image/);
    const originalScroll = await scrollTop();
    const resolved = await image.evaluate(element => element.currentSrc);
    await image.click();
    await expect(dialog()).toBeVisible();
    await expect(dialog()).toHaveClass(/limr-image-preview/);
    await expect(dialog()).toHaveAttribute('aria-label', '图片预览');
    await expect(dialog().getByAltText(alt, { exact: true })).toHaveAttribute('src', resolved);
    await expect(dialog().getByAltText(alt, { exact: true })).toHaveJSProperty('naturalWidth', 2400);
    await expect(close()).toBeFocused();
    // Native modal focus stays within the preview in both tab directions.
    await close().press('Tab');
    expect(await dialog().evaluate(element => element.contains(document.activeElement))).toBe(true);
    const keyboardFocus = await dialog().evaluate(element => {
      const active = element.ownerDocument.activeElement, style = getComputedStyle(active);
      return { visible: active.matches(':focus-visible'), outline: style.outlineStyle, width: parseFloat(style.outlineWidth) };
    });
    expect(keyboardFocus.visible).toBe(true);
    expect(keyboardFocus.outline).not.toBe('none');
    expect(keyboardFocus.width).toBeGreaterThan(0);
    await frame.locator(':focus').press('Shift+Tab');
    expect(await dialog().evaluate(element => element.contains(document.activeElement))).toBe(true);
    if (alt === 'Landscape') {
      await settled();
      const dimensions = await dialog().getByAltText(alt).evaluate(image => {
        const stage = image.closest('.limr-image-preview-stage');
        return { imageWidth: image.getBoundingClientRect().width, imageHeight: image.getBoundingClientRect().height, stageWidth: stage.clientWidth, stageHeight: stage.clientHeight };
      });
      expect(dimensions.imageWidth).toBeLessThanOrEqual(dimensions.stageWidth);
      expect(dimensions.imageHeight).toBeLessThanOrEqual(dimensions.stageHeight);
      await page.screenshot({ path: path.join(artifacts, 'preview-dark-fit.png') });
      await dialog().getByRole('button', { name: '原始大小', exact: true }).click();
      await expect(dialog().locator('.limr-image-preview-stage')).toHaveAttribute('data-original', 'true');
      await settled();
      expect(await dialog().getByAltText(alt).evaluate(image => image.getBoundingClientRect().width)).toBe(2400);
      expect(await dialog().locator('.limr-image-preview-stage').evaluate(element => element.scrollWidth > element.clientWidth)).toBe(true);
      await dialog().getByRole('button', { name: '铺满窗口', exact: true }).click();
      await expect(dialog().locator('.limr-image-preview-stage')).toHaveAttribute('data-mode', 'fill');
      await dialog().getByRole('button', { name: '适应窗口', exact: true }).click();
      await expect(dialog().locator('.limr-image-preview-stage')).toHaveAttribute('data-mode', 'fit');
      const fitScale = Number(await dialog().locator('.limr-image-preview-stage').getAttribute('data-scale'));
      await dialog().getByRole('button', { name: '放大', exact: true }).click();
      expect(Number(await dialog().locator('.limr-image-preview-stage').getAttribute('data-scale'))).toBeGreaterThan(fitScale);
      await dialog().getByRole('button', { name: '缩小', exact: true }).click();
      expect(Number(await dialog().locator('.limr-image-preview-stage').getAttribute('data-scale'))).toBeCloseTo(fitScale);
      await settled();
      const sizes = await dialog().locator('.limr-image-preview-toolbar > button').evaluateAll(buttons => buttons.map(button => {
        const box = button.getBoundingClientRect(); return [box.width, box.height];
      }));
      expect(sizes).toEqual(Array.from({ length: 5 }, () => [42, 42]));
      await page.screenshot({ path: path.join(artifacts, 'preview-dark-controls.png') });
    }
    await close().press('Escape');
    await expect(dialog()).toHaveCount(0);
    await expect(image).toBeFocused();
    expect(Math.abs(await scrollTop() - originalScroll)).toBeLessThan(2);
    expect(tabs(await host('snapshot'))).toEqual(tabs(before));
  }
  expect((await host('snapshot')).source).toBe(source);
  await save({ check: 'Ordinary, reference, figure and linked images open in the reader with resolved local resources; modal focus, fit/actual size, Escape, restored focus, scroll and source preservation pass' });

  await target('Landscape').focus();
  await target('Landscape').press('Tab');
  await frame.locator(':focus').press('Shift+Tab');
  await expect(target('Landscape')).toBeFocused();
  expect(await target('Landscape').evaluate(element => element.matches(':focus-visible') && getComputedStyle(element).outlineStyle !== 'none')).toBe(true);
  await target('Landscape').press('Enter');
  await expect(dialog()).toBeVisible();
  await close().click();
  await expect(target('Landscape')).toBeFocused();
  await target('Landscape').press('Space');
  await expect(dialog()).toBeVisible();
  await dialog().locator('.limr-image-preview-stage').click({ position: { x: 3, y: 3 } });
  await expect(dialog()).toHaveCount(0);
  const missing = target('Missing image');
  await expect(missing).toHaveAttribute('data-lv-image-error', 'missing');
  await expect(missing).not.toHaveAttribute('role', 'button');
  await save({ check: 'Keyboard Enter/Space, close button and background click work; missing images have no misleading preview affordance' });

  await host('configure', { values: { language: 'en', theme: 'playground-light' } });
  await host('layout', { sourceSize: .77 });
  await target('Landscape').click();
  await expect(dialog()).toHaveAttribute('aria-label', 'Image preview');
  await expect(dialog().getByRole('button', { name: 'Actual size', exact: true })).toBeVisible();
  const bounds = await dialog().evaluate(element => ({ right: element.getBoundingClientRect().right, viewport: innerWidth, width: element.clientWidth, content: element.scrollWidth }));
  expect(bounds.right).toBeLessThanOrEqual(bounds.viewport);
  expect(bounds.content).toBe(bounds.width);
  await page.screenshot({ path: path.join(artifacts, 'preview-light-narrow.png') });
  await close().click();
  await host('layout', { sourceSize: .4 });
  await target('Landscape').click();
  await expect(dialog()).toBeVisible();
  await host('replaceSource', { source: source.replace('![Landscape](./images/landscape.svg)', '![Landscape](./images/changed.svg)') });
  await expect(dialog()).toHaveCount(0);
  await expect(target('Landscape')).toHaveJSProperty('naturalWidth', 1800);
  await target('Landscape').click();
  await expect(dialog().getByAltText('Landscape')).toHaveJSProperty('naturalWidth', 1800);
  await close().click();
  await save({ check: 'Light theme, English controls, narrow groups and source-driven image replacement work without stale previews' });
  const palettes = [];
  for (const theme of ['auto', 'vscode-light', 'vscode-dark', 'one-dark-pro', 'one-dark-pro-darker', 'playground', 'playground-light', 'playground-dark']) {
    await host('configure', { values: { theme } });
    if (!await dialog().count()) await target('Landscape').click();
    await expect.poll(() => frame.locator('body').getAttribute('data-reader-theme')).toBe(theme);
    const colors = await dialog().evaluate(element => {
      const computed = getComputedStyle(element), body = getComputedStyle(document.body);
      return { text: computed.getPropertyValue('--limr-text').trim(), expected: body.getPropertyValue('--lv-text').trim(),
        button: getComputedStyle(element.querySelector('.limr-image-preview-close')).color,
        toolbar: getComputedStyle(element.querySelector('.limr-image-preview-toolbar')).backgroundColor };
    });
    expect(colors.text).toBe(colors.expected);
    expect(colors.toolbar).not.toBe('rgba(0, 0, 0, 0)');
    palettes.push({ theme, ...colors });
  }
  await page.screenshot({ path: path.join(artifacts, 'preview-theme-toolbar.png') });
  await close().click();
  await save({ check: 'All eight reader palettes update the native image toolbar, including changing palettes with the preview open', palettes });
  await host('configure', { values: { theme: 'auto' } });
  for (const theme of ['Default High Contrast', 'Default High Contrast Light']) {
    await host('configureWorkbench', { values: { colorTheme: theme } });
    await target('Landscape').click();
    await expect(frame.locator('body')).toHaveAttribute('data-reader-contrast', 'high');
    const surface = await dialog().locator('.limr-image-preview-toolbar').evaluate(element => {
      const style = getComputedStyle(element); return { background: style.backgroundColor, border: style.boxShadow };
    });
    expect(surface.border).not.toBe('none');
    await close().press('Tab');
    const focused = await dialog().evaluate(element => getComputedStyle(element.ownerDocument.activeElement).outlineStyle);
    expect(focused).not.toBe('none');
    await close().click();
  }
  await host('configureWorkbench', { values: { colorTheme: 'Default Dark Modern' } });
  const png = await readFile(new URL('../../media/limr-icon.png', import.meta.url));
  await host('writeFiles', { files: { 'images/copy.png': png.toString('base64') }, encoding: 'base64' });
  await host('replaceSource', { source: '# Copy image pixels\n\n![Clipboard image](./images/copy.png)\n' });
  await expect(target('Clipboard image')).toHaveAttribute('role', 'button');
  const expected = await target('Clipboard image').evaluate(element => ({ width: element.naturalWidth, height: element.naturalHeight }));
  await target('Clipboard image').click();
  await dialog().getByRole('button', { name: 'Copy image', exact: true }).click();
  await expect(dialog().getByRole('button', { name: 'Copied', exact: true })).toBeVisible();
  const pixels = await frame.evaluate(async () => {
    const items = await navigator.clipboard.read(), item = items.find(item => item.types.includes('image/png'));
    if (!item) return null;
    const blob = await item.getType('image/png'), bitmap = await createImageBitmap(blob);
    const result = { width: bitmap.width, height: bitmap.height, bytes: blob.size }; bitmap.close(); return result;
  });
  expect(pixels).toMatchObject(expected); expect(pixels.bytes).toBeGreaterThan(0);
  await close().click();
  await save({ check: 'Both high contrast themes retain visible toolbar/focus cues; copying a local PNG writes real image pixels to the system clipboard', pixels });
  expect(errors).toEqual([]);
  return evidence;
}
