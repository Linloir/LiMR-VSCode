import { expect } from '@playwright/test';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

async function readClipboardHTML(frame) {
  try {
    return await frame.evaluate(async () => {
      const items = await navigator.clipboard.read();
      for (const item of items) if (item.types.includes('text/html')) return (await item.getType('text/html')).text();
      return '';
    });
  } catch (error) {
    if (!process.env.LIMR_TEST_WINDOWS_CODE) throw error;
    // CDP cannot always focus a Windows OOPIF from WSL. Read the actual Windows
    // clipboard through its native API without changing focus or permissions.
    const script = "Add-Type -AssemblyName System.Windows.Forms; $html = [System.Windows.Forms.Clipboard]::GetText([System.Windows.Forms.TextDataFormat]::Html); [Console]::Write([Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($html)))";
    const { stdout } = await promisify(execFile)('/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe', ['-NoProfile', '-NonInteractive', '-STA', '-Command', script], { maxBuffer: 1024 * 1024 });
    return Buffer.from(stdout.trim(), 'base64').toString('utf8');
  }
}

const namedSource = `# LiMR acceptance

Before ::%%limr%%{<#r1}**selected words**::%%limr%%{>#r1} after.

- [ ] An editable task

:::limr-annotation{#h1 ranges="r1" type="highlight" color="#E5C07B"}
:::

:::limr-annotation{#n1 ranges="r1" type="margin-note" agent="codex" threadId="fixture-thread" turnId="fixture-turn" unknownScalar="keep-me"}
Existing **margin note**.
:::

:::limr-annotation{#q1 ranges="r1" type="question"}
Why share this range?
:::
`;

export async function runReaderAcceptance({ page, frame, host, source, artifacts, theme, fixture }) {
  const evidence = [];
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const app = frame.locator('.lv-app');
  const select = async () => {
    await frame.locator('.limr-reader-content strong').first().evaluate(element => {
      const selection = getSelection();
      const range = document.createRange(); range.selectNodeContents(element);
      selection.removeAllRanges(); selection.addRange(range);
      document.dispatchEvent(new Event('selectionchange'));
    });
    await expect(frame.getByRole('toolbar')).toBeVisible();
    return frame.getByRole('toolbar');
  };
  const sourceIncludes = async text => expect.poll(async () => (await host('snapshot')).source, { timeout: 10_000 }).toContain(text);
  const reset = async value => { await host('replaceSource', { source: value }); await expect(frame.getByRole('heading', { name: 'LiMR acceptance', exact: true })).toBeVisible(); };
  const snapshot = async name => page.screenshot({ path: path.join(artifacts, `${name}.png`) });
  if (theme === 'One Dark Pro') {
    // VS Code's extension-development startup can temporarily choose its first
    // contributed theme. Trigger a real user setting change after it is ready.
    await host('configureWorkbench', { values: { colorTheme: 'Default Light Modern' } });
    await expect.poll(() => page.locator('.monaco-workbench').evaluate(element => getComputedStyle(element).getPropertyValue('--vscode-editor-background').trim())).toBe('#ffffff');
    await host('configureWorkbench', { values: { colorTheme: 'One Dark Pro' } });
    await expect.poll(() => page.locator('.monaco-workbench').evaluate(element => getComputedStyle(element).getPropertyValue('--vscode-editor-background').trim())).toBe('#282c34');
  }
  await expect(frame.getByRole('heading', { name: 'LiMR acceptance', exact: true })).toBeVisible();
  await expect(frame.locator('.lv-header,.lv-status')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Choose Reader Theme/ }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: /Toggle Markdown Editing/ }).first()).toBeVisible();
  const sourceAction = page.getByRole('button', { name: /Open Markdown Source/ }).first();
  if (await sourceAction.isVisible()) await expect(sourceAction).toBeVisible();
  else {
    // Other installed extensions can push this native editor action into VS Code's overflow.
    const more = page.locator('.editor-group-container.active .editor-actions').getByRole('button', { name: /More Actions/ });
    await expect(more).toBeVisible();
    await more.click();
    await expect(page.getByRole('menuitem', { name: /Open Markdown Source/ })).toBeVisible();
    await page.keyboard.press('Escape');
  }
  await expect(page.locator('.statusbar-item').filter({ hasText: 'LiMR · 只读' })).toBeVisible();
  await expect(frame.locator('body')).toHaveAttribute('data-reader-theme', 'playground');
  await expect(frame.locator('body')).toHaveCSS('background-color', 'rgb(27, 26, 24)');
  const fonts = await frame.evaluate(async () => {
    await document.fonts.load('16px "Noto Serif SC Variable"', '中文Latin');
    await document.fonts.load('14px "LiMR Maple Mono NF CN"', 'const answer = 42;');
    await document.fonts.ready;
    return { noto: document.fonts.check('16px "Noto Serif SC Variable"', '中文Latin'), maple: document.fonts.check('14px "LiMR Maple Mono NF CN"', 'const answer = 42;'), loaded: [...document.fonts].filter(font => font.status === 'loaded').map(font => font.family) };
  });
  expect(fonts.noto).toBe(true); expect(fonts.maple).toBe(true);
  expect(fonts.loaded.some(family => family.includes('Noto Serif SC Variable'))).toBe(true);
  expect(fonts.loaded.some(family => family.includes('LiMR Maple Mono NF CN'))).toBe(true);
  evidence.push({ check: 'Header/footer are absent; bundled Noto Serif and Maple fonts load under default Playground dark appearance', fonts });
  await expect(frame.locator('.limr-reader-content strong').first()).toHaveText('selected words');
  const initial = await host('snapshot');
  expect(initial.source).toBe(source);
  expect(initial.isDirty).toBe(false);
  expect(initial.editingEnabled).toBe(false);
  evidence.push({ check: 'Source and actual LiMR webview render side by side without changing Markdown', groups: initial.groups });
  await snapshot('reader-initial');

  const task = frame.locator('.limr-reader-content input[type="checkbox"]').first();
  await expect(task).toBeDisabled();
  let toolbar = await select();
  await expect(toolbar.getByRole('button', { name: '添加旁注', exact: true })).toHaveCount(0);
  await expect(toolbar.getByRole('button', { name: '添加提问', exact: true })).toHaveCount(0);
  await toolbar.getByRole('button', { name: '提问上下文', exact: true }).hover();
  await expect(toolbar).toContainText('复制后，粘贴给 AI 助手提问');
  await toolbar.getByRole('button', { name: '提问上下文', exact: true }).click();
  await expect(toolbar.getByRole('button', { name: '已复制上下文', exact: true })).toBeVisible();
  const richClipboard = await readClipboardHTML(frame);
  expect(richClipboard).toContain('at-mention-path');
  expect(richClipboard).toContain('at-mention-fs-path');
  expect(richClipboard).toContain('reader.md');
  const copied = await host('clipboard');
  expect(copied).toContain('reader.md');
  expect(copied).toContain(fixture);
  expect(copied).toContain('selected words');
  const context = JSON.parse(copied.match(/```json\n([\s\S]*?)\n```/)?.[1] ?? 'null');
  expect(context).toMatchObject({ format: 'limr-context-v3', file: fixture, version: initial.version,
    allowSourceEdits: false, selectedText: 'selected words' });
  const selectedStart = source.indexOf('**selected words**');
  expect(context.selections).toHaveLength(1);
  expect(context.selections[0]).toMatchObject({ start: selectedStart, end: selectedStart + '**selected words**'.length,
    raw: '**selected words**' });
  expect((await host('snapshot')).source).toBe(source);
  evidence.push({ check: 'Read-only mode disables Markdown mutation while AI context copying writes real HTML file mentions and a plain text fallback', clipboard: copied, clipboardHTML: richClipboard });
  await page.keyboard.press('Escape');

  const colors = {};
  for (const [value, label] of [['playground-light', 'Playground Light'], ['playground-dark', 'Playground Dark'], ['playground', 'Playground（跟随 VS Code 明暗）'], ['vscode-light', 'VS Code Light'], ['vscode-dark', 'VS Code Dark'], ['one-dark-pro', 'One Dark Pro'], ['one-dark-pro-darker', 'One Dark Pro Darker'], ['auto', '跟随 VS Code']]) {
    await host('command', { command: 'limr.chooseTheme', wait: false });
    await expect(page.locator('.quick-input-widget')).toBeVisible();
    await page.locator('.quick-input-list .label-name').filter({ hasText: new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`) }).click();
    await expect(page.locator('.quick-input-widget')).not.toBeVisible();
    await expect(frame.locator('body')).toHaveAttribute('data-reader-theme', value);
    colors[value] = await frame.locator('body').evaluate(element => ({ color: getComputedStyle(element).color, background: getComputedStyle(element).backgroundColor }));
  }
  expect(colors['vscode-light'].background).not.toBe(colors['vscode-dark'].background);
  expect(colors['one-dark-pro'].background).not.toBe(colors['one-dark-pro-darker'].background);
  if (theme === 'One Dark Pro') await expect.poll(() => frame.locator('body').evaluate(element => getComputedStyle(element).backgroundColor), { timeout: 15_000 }).toBe('rgb(40, 44, 52)');
  evidence.push({ check: 'All eight theme choices update the rendered reader, including the actual installed theme', colors });

  await host('configure', { values: { bodyFontFamily: 'Georgia, serif', chineseFontFamily: 'serif', otherFontFamily: 'monospace', bodyFontSize: 18, chineseFontSize: 22, otherFontSize: 20, codeFontSize: 13 } });
  await expect(frame.locator('.lv-script-chinese').first()).toHaveCSS('font-size', '22px');
  await expect(frame.locator('.limr-reader-content > article > p .lv-script-latin').first()).toHaveCSS('font-size', '18px');
  await expect(frame.locator('.limr-reader-content pre code').first()).toHaveCSS('font-size', '13px');
  evidence.push({ check: 'Separate Chinese, Latin and code font size settings are applied to rendered content' });
  await host('configure', { values: { bodyFontFamily: '', chineseFontFamily: '"Noto Sans CJK SC", "Microsoft YaHei", sans-serif', bodyFontSize: 16, chineseFontSize: 0, otherFontSize: 0, codeFontSize: 14 } });

  await page.getByRole('button', { name: /Toggle Markdown Editing/ }).first().click();
  await expect(task).toBeEnabled();
  await expect(page.locator('.statusbar-item').filter({ hasText: 'LiMR · 可编辑' })).toBeVisible();
  await frame.getByRole('heading', { name: 'LiMR acceptance', exact: true }).click();
  await expect(frame.getByRole('toolbar')).toHaveCount(0);
  await task.click();
  await sourceIncludes('- [x] An editable task');
  expect((await host('snapshot')).isDirty).toBe(true);
  await host('undo');
  await expect.poll(async () => (await host('snapshot')).source).toBe(source);
  await expect(task).not.toBeChecked();
  await host('redo');
  await sourceIncludes('- [x] An editable task');
  await host('undo');
  await expect.poll(async () => (await host('snapshot')).source).toBe(source);
  evidence.push({ check: 'Checkbox writes the real TextDocument and participates in VS Code undo and redo' });

  toolbar = await select();
  await toolbar.getByRole('button', { name: '添加旁注', exact: true }).click();
  let editor = frame.getByRole('textbox', { name: '旁注内容', exact: true });
  await expect(editor).toBeVisible();
  await editor.fill('A **new margin note**.');
  await editor.press('Control+Enter');
  await sourceIncludes('A **new margin note**.');
  let updated = (await host('snapshot')).source;
  expect(updated).toContain('type="margin-note"');
  expect(updated).toContain('type="highlight"');
  expect(updated).toContain('::%%limr%%{<#');
  await expect(editor).toHaveCount(0);
  const overlay = frame.locator('.limr-annotation-overlay');
  if (!await overlay.isVisible()) await frame.locator('.limr-reader-content').getByRole('button', { name: '旁注', exact: true }).first().click();
  await expect(overlay).toBeVisible();
  const editButton = overlay.getByRole('button', { name: '编辑旁注', exact: true });
  await expect(editButton).toBeVisible();
  await expect(overlay.getByRole('button', { name: '删除旁注', exact: true })).toBeVisible();
  await page.mouse.move(0, 0);
  await expect(editButton.locator('.limr-underline')).toHaveCSS('background-size', '0% 1px');
  await editButton.hover();
  await expect(editButton.locator('.limr-underline')).toHaveCSS('background-size', '100% 1px');
  expect(await editButton.locator('.limr-underline').evaluate(element => getComputedStyle(element).transitionDuration)).not.toBe('0s');
  await snapshot('annotation-overlay');
  await editButton.click();
  editor = frame.getByRole('textbox', { name: '旁注内容', exact: true });
  await editor.fill('Edited **from the overlay**.');
  await editor.press('Control+Enter');
  await sourceIncludes('Edited **from the overlay**.');
  await overlay.getByRole('button', { name: '删除旁注', exact: true }).click();
  await expect.poll(async () => (await host('snapshot')).source).not.toContain('type="margin-note"');
  expect((await host('snapshot')).source).toContain('type="highlight"');
  evidence.push({ check: 'Create, edit and delete an inline margin note in the overlay; text buttons have hover underline animation; shared highlight survives deletion' });

  await reset(source);
  toolbar = await select();
  await toolbar.getByRole('button', { name: '添加提问', exact: true }).click();
  editor = frame.getByRole('textbox', { name: '提问内容', exact: true });
  await editor.fill('Why **this implementation**?');
  await editor.press('Control+Enter');
  await sourceIncludes('Why **this implementation**?');
  expect((await host('snapshot')).source).toContain('type="question"');
  evidence.push({ check: 'The question toolbar action creates a separate editable question annotation in Markdown' });

  await reset(namedSource);
  await host('layout', { sourceSize: 0.18 });
  const sidebar = frame.locator('.limr-sidebar-card[data-type="margin-note"]').first();
  await expect(sidebar).toBeVisible();
  await expect(sidebar.getByRole('button', { name: '编辑旁注', exact: true })).toBeVisible();
  await expect(sidebar.getByRole('button', { name: '删除旁注', exact: true })).toBeVisible();
  await sidebar.getByRole('button', { name: '编辑旁注', exact: true }).click();
  editor = sidebar.getByRole('textbox', { name: '旁注内容', exact: true });
  await expect(editor).toBeVisible();
  await editor.fill('Edited **from the sidebar**.');
  await editor.press('Control+Enter');
  await sourceIncludes('Edited **from the sidebar**.');
  const metadataSource = (await host('snapshot')).source;
  for (const metadata of ['agent="codex"', 'threadId="fixture-thread"', 'turnId="fixture-turn"', 'unknownScalar="keep-me"']) expect(metadataSource).toContain(metadata);
  await snapshot('annotation-sidebar');
  await sidebar.getByRole('button', { name: '删除旁注', exact: true }).click();
  await expect.poll(async () => (await host('snapshot')).source).not.toContain('#n1');
  updated = (await host('snapshot')).source;
  expect(updated).toContain('#q1');
  expect(updated).toContain('#h1');
  expect(updated).toContain('Why share this range?');
  await expect(frame.locator('.limr-reader-content').getByRole('button', { name: '提问', exact: true })).toBeVisible();
  evidence.push({ check: 'Sidebar text actions preserve agent/threadId/turnId/unknown metadata on edit, and delete one annotation while preserving other annotations on the same range' });

  await host('command', { command: 'limr.toggleEditing' });
  await expect(frame.getByRole('button', { name: '编辑提问', exact: true })).toHaveCount(0);
  await expect(frame.getByRole('button', { name: '删除提问', exact: true })).toHaveCount(0);
  await expect(task).toBeDisabled();
  await host('save');
  evidence.push({ check: 'Turning editing off immediately removes mutation actions; normal document Save succeeds' });

  await reset('# LiMR acceptance\n\n![Local sample](sample.svg)\n\nInline math $E = mc^2$.\n\n```mermaid\nflowchart LR\n  Read --> Annotate\n```\n');
  await expect(frame.getByAltText('Local sample', { exact: true })).toBeVisible();
  await expect.poll(() => frame.getByAltText('Local sample', { exact: true }).evaluate(element => element.naturalWidth)).toBe(120);
  await expect(frame.locator('.katex')).toBeVisible();
  await expect(frame.locator('.limr-mermaid-block')).toHaveAttribute('data-mermaid-state', 'ready', { timeout: 20_000 });
  await expect(frame.locator('.limr-mermaid-canvas svg')).toBeVisible();
  await snapshot('markdown-resources');
  evidence.push({ check: 'Real webview CSP and resource URLs load local images, mathematical typesetting and lazy Mermaid rendering' });

  await host('command', { command: 'limr.installSkill', wait: false });
  await page.locator('.quick-input-list').getByText('Codex · 当前工作区', { exact: true }).click();
  const installedSkill = path.join(path.dirname(fixture), '.agents', 'skills', 'limr-annotations', 'SKILL.md');
  await expect.poll(async () => readFile(installedSkill, 'utf8').catch(() => ''), { timeout: 10_000 }).toContain('limr-annotations');
  evidence.push({ check: 'Native Skill installation command creates the bundled Codex skill in the disposable workspace', installedSkill });
  expect(errors).toEqual([]);
  return evidence;
}
