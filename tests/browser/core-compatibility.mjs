import { expect } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';

const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="240" height="120"><rect width="240" height="120" fill="#607456"/></svg>';
const media = `# Core compatibility

==Read-only Markdown highlight==

![Missing local](./missing.svg)

![Corrupt local](./corrupt.svg)

<figure src="./missing-figure.svg" alt="Missing figure" caption="The caption remains readable." />

| Image |
| --- |
| ![Missing table](./missing-table.svg) |

[![Missing linked](./missing-link.svg)](#destination)

## Destination
`;
const themes = ['playground', 'playground-light', 'playground-dark', 'auto', 'vscode-light', 'vscode-dark', 'one-dark-pro', 'one-dark-pro-darker'];
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

export async function runCoreCompatibilityAcceptance({ page, frame, host, artifacts }) {
  const evidence = [], errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const record = async value => { evidence.push(value); console.log(value.check); await writeFile(path.join(artifacts, 'checks.json'), JSON.stringify(evidence, null, 2)); };
  const root = frame.locator('.lv-scroll');
  const image = alt => frame.locator(`img[alt="${alt}"]`);
  const fallback = alt => image(alt).locator('..').locator('[data-limr-image-fallback]');
  await host('configure', { values: { language: 'en', theme: 'playground-dark', editingEnabled: false, sidebarMode: 'hidden', tocMode: 'hidden', syncScroll: false, 'plugins.enabled': false } });
  const inlineSource = '# Inline layout\n\nInline code `' + 'longMemberName.'.repeat(32) + '` stays readable.\n\nInline math $' + 'a_1 + '.repeat(40) + 'z$ stays within the reader.\n';
  await host('configure', { values: { typography: 'knuth-plass' } });
  await host('replaceSource', { source: inlineSource });
  const code = frame.locator('.limr-reader-content p code.limr-inline-code');
  for (const sourceSize of [.78, .45]) {
    await host('layout', { sourceSize });
    await code.scrollIntoViewIfNeeded();
    await expect(code.locator('..')).toHaveAttribute('data-limr-kp', /.+/);
    await expect.poll(() => code.evaluate(element => {
      const rects = [...element.getClientRects()];
      return new Set(rects.filter(rect => rect.width).map(rect => Math.round(rect.top))).size;
    })).toBeGreaterThan(1);
    const math = frame.locator('.limr-math-inline');
    await math.scrollIntoViewIfNeeded();
    await expect.poll(() => frame.locator('.limr-reader-content p').evaluateAll(elements => Math.max(...elements.map(element => element.scrollWidth - element.clientWidth)))).toBeLessThanOrEqual(1);
    await page.screenshot({ path: path.join(artifacts, `compat-inline-${sourceSize}.png`) });
  }
  await host('configure', { values: { typography: 'standard' } });
  await expect(frame.locator('[data-limr-kp]')).toHaveCount(0);
  expect((await host('snapshot')).source).toBe(inlineSource);
  await record({ check: 'LiMR 1.3.7 inline code and math wrap in narrow and wide readers with the typography adapter, and switching back preserves source' });
  await host('writeFiles', { files: { 'corrupt.svg': 'This file is not a valid image.', 'repaired/missing.svg': svg } });
  await host('replaceSource', { source: media });
  await expect(frame.getByRole('heading', { name: 'Core compatibility', exact: true })).toBeVisible();
  for (const alt of ['Missing local', 'Corrupt local', 'Missing figure', 'Missing table', 'Missing linked']) {
    await image(alt).locator('..').scrollIntoViewIfNeeded();
    await expect(fallback(alt)).toBeVisible();
    await expect(fallback(alt)).toHaveAccessibleName(`${alt}: Unable to load image. The link may be broken or the file may not exist.`);
    await expect(image(alt)).toBeHidden();
    await expect(image(alt)).not.toHaveAttribute('role', 'button');
    await expect(fallback(alt)).toHaveCSS('border-top-width', '0px');
    await expect(fallback(alt).locator('.limr-image-fallback-icon')).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
    await expect(fallback(alt)).toHaveCSS('border-radius', await image(alt).evaluate(element => getComputedStyle(element).borderRadius));
  }
  await record({ check: 'Missing and corrupt local images use the core localized fallback in Markdown, figures, tables and links; borderless icon and matching corners are preserved' });
  await expect(fallback('Missing figure')).toHaveAttribute('data-compact');
  await expect(fallback('Missing figure').locator('.limr-image-fallback-message')).toBeHidden();
  const compact = await fallback('Missing figure').evaluate(element => {
    const box = element.getBoundingClientRect(), icon = element.querySelector('.limr-image-fallback-icon').getBoundingClientRect();
    return { height: box.height, x: icon.left + icon.width / 2 - (box.left + box.width / 2), y: icon.top + icon.height / 2 - (box.top + box.height / 2), overflow: getComputedStyle(element).overflow };
  });
  expect(compact.height).toBeCloseTo(120, 2);
  expect(Math.abs(compact.x)).toBeLessThan(1); expect(Math.abs(compact.y)).toBeLessThan(1);
  expect(compact.overflow).toBe('clip');
  await record({ check: 'LiMR 1.3.7 compact image fallback centers its icon within the reserved figure height without scrollbars', compact });

  const colors = {};
  for (const theme of themes) {
    await host('configure', { values: { theme } });
    await expect(frame.locator('body')).toHaveAttribute('data-reader-theme', theme);
    await fallback('Missing local').scrollIntoViewIfNeeded();
    colors[theme] = await fallback('Missing local').evaluate(element => {
      const style = getComputedStyle(element), title = getComputedStyle(element.querySelector('.limr-image-fallback-title'));
      const probe = document.createElement('span'); element.append(probe);
      probe.style.color = 'var(--limr-text, #292621)'; const expectedTitle = getComputedStyle(probe).color;
      probe.style.color = 'var(--limr-secondary, #736e66)'; const expectedText = getComputedStyle(probe).color;
      probe.remove();
      return { text: style.color, background: style.backgroundColor, title: title.color, expectedTitle, expectedText };
    });
    expect(colors[theme].title).toBe(colors[theme].expectedTitle);
    expect(colors[theme].text).toBe(colors[theme].expectedText);
    const highlight = frame.locator('.limr-reader-content mark').filter({ hasText: 'Read-only Markdown highlight' });
    await highlight.click();
    const toolbar = frame.getByRole('toolbar');
    await expect(toolbar).toBeVisible();
    // The host deliberately keeps AI context copying beside Copy, including
    // read-only inline highlights. Core's narrow explanatory hint stays gone.
    await expect(toolbar.getByRole('button')).toHaveCount(2);
    await expect(toolbar.locator('.limr-toolbar-readonly-hint')).toHaveCount(0);
    await expect(toolbar.getByRole('button', { name: 'Copy', exact: true })).toBeVisible();
    await expect(toolbar.getByRole('button', { name: 'Question context', exact: true })).toBeVisible();
    await page.screenshot({ path: path.join(artifacts, `compat-${theme}.png`) });
    await frame.locator('body').press('Escape');
  }
  expect(colors['vscode-light'].text).not.toBe(colors['vscode-dark'].text);
  expect(colors['playground-light'].text).not.toBe(colors['playground-dark'].text);
  await record({ check: 'All eight reader themes style the core fallback and keep read-only highlight toolbars to Copy and host AI context, without hints or mutation actions', colors });

  await host('configure', { values: { theme: 'auto' } });
  for (const colorTheme of ['Default High Contrast', 'Default High Contrast Light']) {
    await host('configureWorkbench', { values: { colorTheme } });
    await expect(frame.locator('body')).toHaveAttribute('data-reader-contrast', 'high');
    await expect(frame.locator('body')).toHaveAttribute('data-reader-brightness', colorTheme.endsWith('Light') ? 'light' : 'dark');
    await fallback('Missing local').scrollIntoViewIfNeeded();
    await expect(fallback('Missing local')).toBeVisible();
    const color = await fallback('Missing local').locator('.limr-image-fallback-title').evaluate(element => getComputedStyle(element).color);
    expect(color).toBe(await frame.locator('body').evaluate(element => getComputedStyle(element).color));
    await page.screenshot({ path: path.join(artifacts, `compat-${colorTheme.replaceAll(' ', '-')}.png`) });
  }
  await host('configureWorkbench', { values: { colorTheme: 'Default Dark Modern' } });
  await host('configure', { values: { theme: 'playground-light', language: 'zh-CN' } });
  await expect(fallback('Missing local')).toContainText('图片无法加载');
  await host('layout', { sourceSize: .78 });
  for (const alt of ['Missing local', 'Missing figure', 'Missing table']) {
    await fallback(alt).scrollIntoViewIfNeeded();
    const box = await fallback(alt).evaluate(element => { const rect = element.getBoundingClientRect(); return { left: rect.left, right: rect.right, viewport: innerWidth }; });
    expect(box.left).toBeGreaterThanOrEqual(0); expect(box.right).toBeLessThanOrEqual(box.viewport);
  }
  await page.screenshot({ path: path.join(artifacts, 'compat-narrow-zh.png') });
  expect((await host('snapshot')).source).toBe(media);
  await record({ check: 'High-contrast dark/light, Chinese fallback messages and narrow editor groups remain readable without horizontal overflow or source edits' });

  // Retain the same React image while only the host image directory changes.
  await host('configure', { values: { 'images.pathMode': 'folder', 'images.baseFolder': 'repaired' } });
  await expect(image('Missing local')).toHaveJSProperty('naturalWidth', 240);
  await expect(image('Missing local')).toBeVisible();
  await expect(fallback('Missing local')).toHaveCount(0);
  await host('configure', { values: { 'images.pathMode': 'auto', 'images.baseFolder': '' } });
  await expect(fallback('Missing local')).toBeVisible();
  await record({ check: 'Changing the local image directory recovers and fails the retained core image correctly without rewriting Markdown' });

  await host('layout', { sourceSize: .12 });
  await host('configure', { values: { language: 'en', theme: 'playground-dark', sidebarMode: 'always', maxWidth: 600, tocMode: 'always' } });
  const prose = 'Ordinary prose keeps enough space between annotated sections. '.repeat(30);
  const section = (index, count = 4) => `# Section ${index}\n\nBefore ::%%limr%%{<#r${index}}**Shared reference ${index}**::%%limr%%{>#r${index}} after.\n\n`
    + Array.from({ length: count }, (_, n) => `:::limr-annotation{#n${index}-${n} ranges="r${index}" type="question"}\nNote ${index}-${n}. ${'A longer explanation for this question. '.repeat(5)}\n:::\n\n`).join('')
    + Array.from({ length: 12 }, () => prose + '\n\n').join('');
  const positions = () => frame.locator('.limr-sidebar').evaluate(rail => {
    const origin = rail.getBoundingClientRect().top;
    return [...rail.querySelectorAll('.limr-sidebar-card')].map(card => ({ id: card.dataset.occurrence, top: card.getBoundingClientRect().top - origin, viewportTop: card.getBoundingClientRect().top, height: card.getBoundingClientRect().height }));
  });
  for (const windowed of [false, true]) for (const collapse of [false, true]) {
    await page.mouse.move(2, 2);
    await host('configure', { values: { sidebarAutoCollapse: collapse, syncScroll: windowed } });
    const title = `Sidebar ${windowed ? 'windowed' : 'small'} ${collapse}`;
    const source = `# ${title}\n\n` + (windowed ? Array.from({ length: 20 }, (_, i) => section(i)).join('') : section(0));
    await host('replaceSource', { source });
    // Refresh retains the old reading position, so a distant first heading
    // need not be mounted. Wait on the full TOC, then navigate explicitly.
    const beginning = frame.locator('.limr-toc').getByRole('link', { name: title, exact: true });
    await expect(beginning).toBeVisible({ timeout: 60000 });
    await expect(frame.locator('.lv-app')).toHaveAttribute('data-reader-ready', 'true', { timeout: 60000 });
    // Leave the previous fixture's pinned note through the reader's own blank
    // space. A click outside the webview cannot clear core interaction state.
    await root.click({ position: { x: 8, y: 8 } });
    await beginning.click();
    await expect(frame.getByRole('heading', { name: title, exact: true })).toBeInViewport();
    await frame.evaluate(() => document.fonts.ready);
    if (windowed) await expect(frame.locator('[data-limr-windowed]').first()).toBeVisible();
    for (const index of windowed ? [0, 10, 19] : [0]) {
      await root.click({ position: { x: 8, y: 8 } });
      await frame.locator('.limr-toc').getByRole('link', { name: `Section ${index}`, exact: true }).click();
      const reference = frame.locator('.limr-reader-content strong').filter({ hasText: `Shared reference ${index}` });
      await expect(reference).toBeInViewport(); await wait(700);
      const cards = frame.locator('.limr-sidebar-card'), before = await positions();
      for (const n of [2, 1, 0, 2]) {
        const card = cards.filter({ hasText: `Note ${index}-${n}.` }), box = await card.boundingBox();
        await page.mouse.move(box.x + 30, box.y + 20);
        await expect(card).toHaveAttribute('data-active', 'true');
        await expect.poll(() => reference.evaluate(element => {
          const range = document.createRange(); range.selectNodeContents(element);
          const active = document.querySelector('.limr-sidebar-card[data-active="true"]');
          return active ? Math.abs(range.getBoundingClientRect().top - active.getBoundingClientRect().top) : Infinity;
        })).toBeLessThan(1);
        const after = await positions();
        await writeFile(path.join(artifacts, `sidebar-hover-${windowed}-${collapse}-${index}-${n}.json`), JSON.stringify({ before, after }, null, 2));
        // Virtual block measurement can compensate native scroll and rail
        // coordinates together. What the user sees must stay at the same pixel.
        expect(Math.max(...after.filter(card => before.some(old => old.id === card.id)).map(card => Math.abs(card.viewportTop - before.find(old => old.id === card.id).viewportTop)))).toBeLessThan(1);
      }
      const first = cards.filter({ hasText: `Note ${index}-0.` }), box = await first.boundingBox();
      await page.mouse.move(box.x + 30, box.y + 20); await expect(first).toHaveAttribute('data-active', 'true');
      const stack = await positions();
      let distance = 0;
      for (const n of [1, 2]) {
        const current = cards.filter({ hasText: `Note ${index}-${n}.` }), previous = cards.filter({ hasText: `Note ${index}-${n - 1}.` });
        const step = (await current.boundingBox()).y - (await previous.boundingBox()).y;
        distance += step;
        await page.mouse.wheel(0, step); await expect(current).toHaveAttribute('data-active', 'true');
        await expect.poll(() => reference.evaluate(element => {
          const range = document.createRange(); range.selectNodeContents(element);
          const active = document.querySelector('.limr-sidebar-card[data-active="true"]');
          return active ? Math.abs(range.getBoundingClientRect().top - active.getBoundingClientRect().top) : Infinity;
        })).toBeLessThan(1);
        const after = await positions();
        expect(Math.max(...after.filter(card => stack.some(old => old.id === card.id)).map(card => Math.abs(card.viewportTop + distance - stack.find(old => old.id === card.id).viewportTop)))).toBeLessThan(1.5);
      }
      const target = cards.filter({ hasText: `Note ${index}-2.` });
      await target.locator('.limr-sidebar-card-heading').click(); await expect(target).toHaveAttribute('data-expanded', 'true');
      await page.mouse.move(2, 2); await wait(600); const pinned = (await target.boundingBox()).y;
      // A prior wheel can partially clip the previous card. Use its visible
      // hit area so Playwright cannot scroll it into view and move the pin.
      const previousBox = await cards.filter({ hasText: `Note ${index}-1.` }).boundingBox(), viewport = await root.boundingBox();
      await page.mouse.move(previousBox.x + 30, Math.max(previousBox.y + 20, viewport.y + 20)); await page.mouse.move(2, 2);
      await expect.poll(async () => Math.abs((await target.boundingBox()).y - pinned)).toBeLessThan(1);
      if (windowed) expect(await frame.locator('[data-limr-block]').count()).toBeLessThan(120);
    }
    await page.screenshot({ path: path.join(artifacts, `sidebar-${windowed}-${collapse}.png`) });
    await record({ check: 'Sidebar hover, wheel retargeting and pinned expansion keep cards stable and align source text', windowed, collapse, sourceCharacters: source.length });
  }
  expect(errors).toEqual([]);
  return evidence;
}
