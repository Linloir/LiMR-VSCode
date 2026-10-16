import { expect } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';

const source = `# LiMR settings acceptance

A paragraph long enough to test the visible reading measure. The reader keeps the same content while changing typography, translation preferences and the available table of contents.

## Translation examples

<translations id="first" default="origin">
<origin>First original paragraph.</origin>
<translation>第一段译文。</translation>
</translations>

<translations id="second" default="translation">
<origin>Second original paragraph.</origin>
<translation>第二段译文。</translation>
</translations>

## Custom syntax

:::aside
Workspace plugin content.
:::
`;

export async function runFeatureAcceptance({ page, frame, host, artifacts }) {
  const evidence = [], errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const heading = () => frame.getByRole('heading', { name: 'LiMR settings acceptance', exact: true });
  const article = () => frame.locator('.limr-reader-content > .limr-prose');
  const translations = () => frame.locator('.limr-reader-content .limr-translations');
  const modes = () => translations().evaluateAll(blocks => blocks.map(block => block.dataset.mode));
  const save = async item => {
    evidence.push(item);
    await writeFile(path.join(artifacts, 'feature-progress.json'), JSON.stringify(evidence, null, 2));
    console.log(`Feature checked: ${item.check}`);
  };
  const screenshot = name => page.screenshot({ path: path.join(artifacts, `feature-${name}.png`) });
  const capturedPickers = new Set();
  async function capturePicker(name, details) {
    if (capturedPickers.has(name)) return;
    const input = page.locator('.quick-input-widget');
    await expect(input).toBeVisible();
    for (const detail of details) await expect(input.getByText(detail, { exact: true })).toBeVisible();
    const rows = await input.locator('.quick-input-list .monaco-list-row').evaluateAll(elements => elements.map(element => {
      const rect = element.getBoundingClientRect();
      return { text: element.innerText, top: rect.top, bottom: rect.bottom, height: rect.height };
    }).filter(row => row.height > 0));
    expect(rows.length).toBeGreaterThan(1);
    for (let index = 1; index < rows.length; index++) expect(rows[index].top).toBeGreaterThanOrEqual(rows[index - 1].bottom - 1);
    const placeholder = await input.locator('input').first().evaluate(element => {
      const style = getComputedStyle(element), placeholderStyle = getComputedStyle(element, '::placeholder');
      const context = document.createElement('canvas').getContext('2d');
      context.font = placeholderStyle.font;
      return { text: element.placeholder, width: context.measureText(element.placeholder).width,
        available: element.clientWidth - Number.parseFloat(style.paddingLeft) - Number.parseFloat(style.paddingRight) };
    });
    expect(placeholder.width).toBeLessThanOrEqual(placeholder.available + 1);
    await screenshot(name);
    await save({ check: `${name}: native QuickPick renders explanatory details in separate non-overlapping rows with an unclipped placeholder`, rows, placeholder });
    capturedPickers.add(name);
  }
  async function reopen() {
    await host('save');
    await host('reopenReader');
    await expect.poll(async () => {
      const replacement = page.frames().find(candidate => candidate !== frame && !candidate.isDetached() && candidate.url().includes('index.html'));
      for (const candidate of replacement ? [replacement, ...page.frames()] : page.frames()) {
        if (!candidate.isDetached() && await candidate.locator('.limr-reader').count().catch(() => 0)) { frame = candidate; return true; }
      }
      return false;
    }, { timeout: 30_000 }).toBe(true);
    await expect(heading()).toBeVisible();
    await heading().click();
  }
  async function pick(command, scope, value) {
    await host('command', { command, wait: false });
    const input = page.locator('.quick-input-widget');
    await expect(input).toBeVisible();
    await capturePicker(`${command}-scope-zh`, ['仅对本文件生效；关闭后仍保留，不修改 Markdown。']);
    await page.locator('.quick-input-list').getByText(scope, { exact: true }).click();
    if (value) {
      await capturePicker(`${command}-modes-zh`, command === 'limr.chooseTypography'
        ? ['自然换行、左侧对齐，保留普通 Markdown 的阅读排版。', '整体优化段落断行，让两端对齐时的行间疏密更均匀。']
        : ['所有翻译块同时展示原文和译文。', '各段分别使用已保存的显示方式；未调整的段落遵循正文中的配置。']);
      await page.locator('.quick-input-list').getByText(value, { exact: true }).click();
    }
    await expect(input).not.toBeVisible();
    await heading().click();
  }
  const headingTop = () => heading().evaluate(element => element.getBoundingClientRect().top - document.querySelector('.lv-scroll').getBoundingClientRect().top);
  const visibleToolbarButton = name => page.getByRole('button', { name: new RegExp(name) }).first();

  await host('configure', { values: { editingEnabled: false, language: 'zh-CN', sidebarMode: 'hidden', tocMode: 'always', maxWidth: 760,
    typography: 'standard', translationMode: 'paragraph', syncScroll: false, theme: 'playground', 'plugins.enabled': false,
    topBarButtons: ['theme', 'editing', 'typography', 'translation', 'ai', 'settings', 'source'], bottomBarButtons: ['editing', 'typography', 'translation'] } });
  await host('command', { command: 'limr.resetFileSettings' });
  await host('replaceSource', { source });
  await host('layout', { sourceSize: .7 });
  await expect(heading()).toBeVisible();
  await frame.locator('.lv-scroll').evaluate(element => element.scrollTop = 0);

  const toggle = () => frame.locator('.limr-mobile-toc-toggle');
  await expect(toggle()).toBeVisible();
  await expect(toggle()).toHaveText('目录');
  const regularStyle = await toggle().evaluate(element => {
    const style = getComputedStyle(element), scroll = document.querySelector('.lv-scroll');
    return { background: style.backgroundColor, leftPadding: style.paddingLeft, topPadding: getComputedStyle(scroll).paddingTop,
      labelLeft: element.querySelector('.limr-underline').getBoundingClientRect().left - element.getBoundingClientRect().left };
  });
  await toggle().hover();
  await expect(toggle().locator('.limr-underline')).toHaveCSS('background-size', '100% 1px');
  const hoverStyle = await toggle().evaluate(element => ({ background: getComputedStyle(element).backgroundColor, underline: getComputedStyle(element.querySelector('.limr-underline')).backgroundSize }));
  expect(regularStyle.background).toBe('rgba(0, 0, 0, 0)');
  expect(hoverStyle.background).toBe(regularStyle.background);
  expect(regularStyle.leftPadding).toBe('0px');
  expect(regularStyle.labelLeft).toBeLessThan(1);
  expect(Number.parseFloat(regularStyle.topPadding)).toBeLessThanOrEqual(18);
  expect(hoverStyle.underline).toBe('100% 1px');
  const alwaysTop = await headingTop();
  await host('configure', { values: { tocMode: 'wide' } });
  await expect(toggle()).toHaveCount(0);
  const wideNarrowTop = await headingTop();
  await host('configure', { values: { tocMode: 'hidden' } });
  await expect(frame.locator('.limr-reader-toc')).toHaveCount(0);
  const hiddenTop = await headingTop();
  expect(Math.abs(wideNarrowTop - hiddenTop)).toBeLessThan(1);
  expect(alwaysTop - hiddenTop).toBeGreaterThan(20);
  await host('configure', { values: { tocMode: 'wide' } });
  await host('layout', { sourceSize: .16 });
  await expect(frame.locator('.limr-reader-toc .limr-toc')).toBeVisible();
  await expect(toggle()).not.toBeVisible();
  await screenshot('toc-wide');
  await save({ check: 'LiMR 1.2.3 narrow TOC has transparent hover, zero text padding and underline animation; wide mode has no narrow placeholder and restores its rail when space permits', regularStyle, hoverStyle, alwaysTop, wideNarrowTop, hiddenTop });

  await host('layout', { sourceSize: .48 });
  await host('configure', { values: { tocMode: 'hidden' } });
  await pick('limr.chooseTypography', '默认配置', '两端对齐');
  await expect(article()).toHaveAttribute('data-limr-typography', 'justify');
  expect((await host('readConfiguration', { keys: ['typography'] })).typography).toBe('justify');
  await pick('limr.chooseTypography', '当前文件', 'Knuth–Plass');
  await expect(article()).toHaveAttribute('data-limr-typography', 'knuth-plass');
  await expect(page.locator('.statusbar-item').filter({ hasText: 'Knuth–Plass' })).toBeVisible();
  await reopen();
  await expect(article()).toHaveAttribute('data-limr-typography', 'knuth-plass');
  expect((await host('readConfiguration', { keys: ['typography'] })).typography).toBe('justify');
  await pick('limr.chooseTypography', '当前文件恢复默认');
  await expect(article()).toHaveAttribute('data-limr-typography', 'justify');
  await pick('limr.chooseTypography', '当前文件', '标准');
  await expect(article()).toHaveAttribute('data-limr-typography', 'standard');
  await save({ check: 'Typography uses native settings dialogs: default justification, per-file Knuth–Plass survives closing and reopening, reset follows default, and standard remains selectable' });

  await expect.poll(modes).toEqual(['origin', 'translation']);
  await pick('limr.chooseTranslationMode', '默认配置', '对照');
  await expect.poll(modes).toEqual(['both', 'both']);
  await translations().first().locator('[data-translation-switch]').click();
  await expect.poll(modes).toEqual(['origin', 'both']);
  await expect(page.locator('.statusbar-item').filter({ hasText: '按段落' })).toBeVisible();
  const defaults = await host('readConfiguration', { keys: ['translationMode'] });
  expect(defaults.translationMode).toBe('bilingual');
  expect((await host('snapshot')).source).toBe(source);
  await reopen();
  await expect.poll(modes).toEqual(['origin', 'both']);
  await translations().last().locator('[data-translation-switch]').focus();
  await translations().last().locator('[data-translation-switch]').press('Enter');
  await expect.poll(modes).toEqual(['origin', 'origin']);
  await expect(translations().last().locator('[data-translation-switch]')).toBeFocused();
  await pick('limr.chooseTranslationMode', '当前文件', '仅译文');
  await expect.poll(modes).toEqual(['translation', 'translation']);
  await translations().last().locator('[data-translation-switch]').click();
  await expect.poll(modes).toEqual(['translation', 'both']);
  await pick('limr.chooseTranslationMode', '当前文件', '仅原文');
  await expect.poll(modes).toEqual(['origin', 'origin']);
  await pick('limr.chooseTranslationMode', '当前文件恢复默认');
  await expect.poll(modes).toEqual(['both', 'both']);
  expect((await host('readConfiguration', { keys: ['translationMode'] })).translationMode).toBe('bilingual');
  await save({ check: 'Translation defaults and per-file modes work in read-only documents; switching one paragraph snapshots the others, persists across reopen, preserves keyboard focus and never edits Markdown or defaults', defaults });

  // Inspect the selected default while the current file has a different mode.
  await host('command', { command: 'limr.chooseTypography', wait: false });
  await expect(page.locator('.quick-input-widget')).toBeVisible();
  await page.locator('.quick-input-list').getByText('默认配置', { exact: true }).click();
  await expect(page.locator('.quick-input-list .monaco-list-row').filter({ has: page.getByText('两端对齐', { exact: true }) })).toContainText('当前');
  await expect(page.locator('.quick-input-list .monaco-list-row').filter({ has: page.getByText('标准', { exact: true }) })).not.toContainText('当前');
  await screenshot('default-current-indicator');
  await page.keyboard.press('Escape');

  await host('configure', { values: { tocMode: 'always', language: 'en' } });
  await expect(toggle()).toHaveText('Contents');
  await expect(frame.locator('html')).toHaveAttribute('lang', 'en');
  await expect(translations().first().locator('[data-translation-switch]')).toHaveAttribute('aria-label', /Showing bilingual/);
  await expect(page.locator('.statusbar-item').filter({ hasText: 'LiMR · Read only' })).toBeVisible();
  await host('command', { command: 'limr.chooseTranslationMode', wait: false });
  await capturePicker('translation-scope-en', ['Only affects this file; saved across sessions. Markdown is unchanged.']);
  await page.locator('.quick-input-list').getByText('This file', { exact: true }).click();
  await capturePicker('translation-modes-en', ['Show both the original and translation in every translation block.']);
  await page.keyboard.press('Escape');
  await host('command', { command: 'limr.chooseTheme', wait: false });
  await capturePicker('theme-en', ['Use LiMR reading colors and switch light/dark with VS Code.']);
  await page.keyboard.press('Escape');
  await host('command', { command: 'limr.configureBottomBar', wait: false });
  await capturePicker('buttons-en', ['Choose standard, justified, or Knuth–Plass typography.']);
  await page.keyboard.press('Escape');
  await host('configure', { values: { language: 'zh-CN' } });
  await expect(toggle()).toHaveText('目录');
  await expect(translations().first().locator('[data-translation-switch]')).toHaveAttribute('aria-label', '当前对照，切换到原文');
  await save({ check: 'Reader locale switches Chinese and English including TOC, translation accessibility labels and host status bar; switching back restores Chinese' });

  await host('configure', { values: { topBarButtons: [], bottomBarButtons: [] } });
  for (const name of ['Choose Reader Theme', 'Toggle Markdown Editing', 'Choose Typography', 'Choose Translation Display', 'Reader Settings', 'Open Markdown Source']) await expect(visibleToolbarButton(name)).not.toBeVisible();
  await expect(page.locator('.statusbar-item').filter({ hasText: /LiMR ·|按段落|对照|Knuth–Plass/ })).toHaveCount(0);
  await host('configure', { values: { topBarButtons: ['settings', 'typography'], bottomBarButtons: ['translation'] } });
  await expect(visibleToolbarButton('Reader Settings')).toBeVisible();
  await expect(visibleToolbarButton('Choose Typography')).toBeVisible();
  await expect(visibleToolbarButton('Choose Reader Theme')).not.toBeVisible();
  await expect(page.locator('.statusbar-item').filter({ hasText: '对照' })).toBeVisible();
  await expect(page.locator('.statusbar-item').filter({ hasText: 'LiMR ·' })).toHaveCount(0);
  await screenshot('configurable-controls');
  await save({ check: 'Title and status controls accept empty and selected button sets; hidden commands remain usable through the command palette' });

  await host('configure', { values: { tocMode: 'hidden' } });
  const originalColor = await heading().evaluate(element => getComputedStyle(element).color);
  await host('writeFiles', { files: {
    '.limr/plugins/manifest.json': JSON.stringify({ plugins: [{ id: 'callout', module: 'callout.mjs', stylesheet: 'theme.css' }] }),
    '.limr/plugins/callout.mjs': "export default ({ React, limr }) => limr.defineBlock({ name: 'aside', component: ({ children }) => React.createElement('aside', { 'data-custom-aside': 'yes' }, children) });",
    '.limr/plugins/theme.css': '.limr-reader h1 { color: rgb(117, 139, 165); }',
  } });
  await host('configure', { values: { 'plugins.enabled': true } });
  await host('command', { command: 'limr.reloadPlugins' });
  await expect(frame.locator('[data-custom-aside="yes"]')).toHaveText('Workspace plugin content.');
  await expect(heading()).toHaveCSS('color', 'rgb(117, 139, 165)');
  await host('writeFiles', { files: { '.limr/plugins/theme.css': '.limr-reader h1 { color: rgb(165, 139, 117); }' } });
  await host('command', { command: 'limr.reloadPlugins' });
  await expect(heading()).toHaveCSS('color', 'rgb(165, 139, 117)');
  await host('configure', { values: { 'plugins.enabled': false } });
  await expect(frame.locator('[data-custom-aside]')).toHaveCount(0);
  await expect(heading()).toHaveCSS('color', originalColor);
  await host('writeFiles', { files: { '.limr/plugins/callout.mjs': "export default ({ limr }) => limr.defineBlock({ name: 'aside', component: () => { throw new Error('Intentional fixture plugin failure'); } });" } });
  await host('configure', { values: { 'plugins.enabled': true } });
  await host('command', { command: 'limr.reloadPlugins' });
  await expect(frame.locator('.limr-extension-error')).toContainText('Workspace plugin content.');
  await expect(heading()).toBeVisible();
  await expect(frame.locator('[data-custom-aside]')).toHaveCount(0);
  await host('configure', { values: { 'plugins.enabled': false } });
  await expect(heading()).toHaveCSS('color', originalColor);
  await save({ check: 'A trusted workspace plugin loads real ESM custom syntax and CSS; stylesheet revisions refresh, disabling unloads both, and a crashing custom renderer falls back to readable Markdown', originalColor });

  await host('configure', { values: { previewButtonMode: 'separate' } });
  await host('command', { command: 'limr.openSource' });
  const activeActions = () => page.locator('.editor-group-container.active .editor-actions');
  await expect(activeActions().getByRole('button', { name: /^Open Reader to the Side/ })).toBeVisible();
  await expect(activeActions().getByRole('button', { name: /^Open Preview to the Side/ })).toBeVisible();
  await host('configure', { values: { previewButtonMode: 'merged' } });
  await expect(activeActions().getByRole('button', { name: /^Open Preview to the Side/ })).toHaveCount(0);
  await activeActions().getByRole('button', { name: /^Open Reader to the Side/ }).click();
  await expect.poll(async () => (await host('snapshot')).activeCustom).toBe('limr.reader');
  await host('command', { command: 'limr.openSource' });
  await page.keyboard.down('Alt');
  try {
    await expect(activeActions().getByRole('button', { name: /^Open Preview to the Side/ })).toBeVisible();
    await activeActions().getByRole('button', { name: /^Open Preview to the Side/ }).click({ modifiers: ['Alt'] });
  } finally { await page.keyboard.up('Alt'); }
  await expect.poll(async () => (await host('snapshot')).groups.flatMap(group => group.tabs).some(tab => /markdown.*preview/i.test(tab.webview ?? ''))).toBe(true);
  await save({ check: 'Merged source preview hides the duplicate built-in button; the remaining default opens LiMR and Alt opens the built-in Markdown preview' });

  const unexpectedErrors = errors.filter(message => !message.includes('Intentional fixture plugin failure'));
  expect(unexpectedErrors).toEqual([]);
  await screenshot('complete');
  return evidence;
}
