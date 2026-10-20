import { expect } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';

const code = Array.from({ length: 48 }, (_, index) => `const row${index + 1} = "${'wide code '.repeat(16)}${index === 37 ? 'folded_code_needle' : 'value'}";`).join('\n');
const short = '# Reader tools\n\nBefore **selected words** after. Search needle and another Search needle.\n\n:::example-research-card\nCustom module searchable text.\n:::\n\n```typescript\n' + code + '\n```\n';
const long = '# Long reader tools\n\nBefore **selected words** after.\n\n'
  + Array.from({ length: 1000 }, (_, index) => `Paragraph ${index + 1}. ${'Long document reading text. '.repeat(14)}${index === 800 ? 'remote_search_needle' : ''}\n\n`).join('')
  + '```typescript\n' + code + '\n```\n';

export async function runReaderToolsAcceptance({ page, frame, host, artifacts }) {
  const evidence = [], errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const record = async item => {
    evidence.push(item);
    await writeFile(path.join(artifacts, 'checks.json'), JSON.stringify(evidence, null, 2));
    console.log(JSON.stringify(item));
  };
  const ready = () => expect(frame.locator('.lv-app')).toHaveAttribute('data-reader-ready', 'true', { timeout: 90_000 });
  const reset = async source => {
    await host('replaceSource', { source });
    // Disabling plugin resources can recreate the guest; resolve its new frame.
    await expect.poll(async () => {
      for (const candidate of page.frames()) {
        if (await candidate.locator('.limr-reader h1').first().textContent({ timeout: 200 }).catch(() => '') === source.split('\n')[0].slice(2)) {
          frame = candidate; return true;
        }
      }
      return false;
    }, { timeout: 90_000 }).toBe(true);
    await ready();
  };
  const select = async () => {
    const strong = frame.locator('.limr-reader-content strong').first();
    await strong.click();
    await strong.evaluate(element => {
      const range = document.createRange(); range.selectNodeContents(element);
      const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range);
      document.dispatchEvent(new Event('selectionchange'));
    });
    await expect(frame.getByRole('toolbar', { name: 'Text actions' })).toBeVisible();
  };
  const sourceHas = text => expect.poll(async () => (await host('snapshot')).source, { timeout: 20_000 }).toContain(text);
  const sourceIs = text => expect.poll(async () => (await host('snapshot')).source, { timeout: 20_000 }).toBe(text);
  await host('configure', { values: { language: 'en', editingEnabled: true, syncScroll: false, sidebarMode: 'hidden', tocMode: 'hidden', typography: 'standard', 'plugins.enabled': true } });
  await reset(short);
  await frame.locator('h1').first().click();
  await page.keyboard.press('Control+f');
  const ordinaryFind = frame.locator('.limr-document-search input');
  const ordinaryCount = frame.locator('.limr-document-search [role="status"]');
  await expect(ordinaryFind).toBeVisible();
  await expect(frame.locator('[data-limr-windowed]')).toHaveCount(0);
  await expect(page.locator('.simple-find-part[aria-hidden="false"]')).toHaveCount(0);
  await ordinaryFind.fill('missing_search_needle');
  await expect(ordinaryCount).toHaveText('0/0');
  await ordinaryFind.fill('Search needle');
  await expect(ordinaryCount).toHaveText('1/2');
  await page.keyboard.press('Enter');
  await expect(ordinaryCount).toHaveText('2/2');
  await page.keyboard.press('Shift+F3');
  await expect(ordinaryCount).toHaveText('1/2');
  await ordinaryFind.fill('Custom module searchable text.');
  await expect(ordinaryCount).toHaveText('1/1');
  await expect(frame.locator('.limr-example-research-card')).toBeInViewport();
  await ordinaryFind.fill('example-research-card');
  await expect(ordinaryCount).toHaveText('0/0');
  await ordinaryFind.fill('SEARCH NEEDLE');
  await expect(ordinaryCount).toHaveText('1/2');
  await page.screenshot({ path: path.join(artifacts, 'ordinary-find.png') });
  await page.keyboard.press('Escape');
  await expect(ordinaryFind).toHaveCount(0);
  await sourceIs(short);
  await record({ check: 'Ctrl+F searches ordinary documents and custom module children through core; Enter, Shift+F3 and Escape work' });

  await select();
  await page.keyboard.press('Control+Alt+h');
  await sourceHas('type="highlight"');
  await ready();
  await frame.locator('h1').first().click();
  await page.keyboard.press('Control+z');
  await sourceIs(short);
  await ready();
  await record({ check: 'Highlight shortcut writes the selection and real Ctrl+Z restores the Markdown' });
  await select();
  await page.keyboard.press('Control+Alt+m');
  await sourceHas('type="margin-note"');
  await expect(frame.locator('textarea').first()).toBeVisible();
  await frame.locator('textarea').first().fill('Shortcut margin note.');
  // AnnotationEditor saves with Ctrl/Cmd+Enter; typing and Undo stay local to it.
  await page.keyboard.press('Control+Enter');
  await sourceHas('Shortcut margin note.');
  await reset(short);
  await record({ check: 'Margin-note shortcut opens an editable annotation and Ctrl+Enter saves its text' });
  await select();
  await page.keyboard.press('Control+Alt+c');
  await expect.poll(() => host('clipboard')).toContain('"selectedText":"selected words"');
  await page.keyboard.press('Control+Alt+q');
  await sourceHas('type="question"');
  await expect(frame.locator('textarea').first()).toBeVisible();
  await frame.locator('textarea').first().fill('Shortcut question.');
  await page.keyboard.press('Control+Enter');
  await sourceHas('Shortcut question.');
  await ready();
  await select();
  await page.keyboard.press('Control+Alt+Backspace');
  await expect.poll(async () => (await host('snapshot')).source).not.toContain(':::limr-annotation');
  await reset(short);
  await frame.locator('h1').first().click();
  await page.keyboard.press('Control+Alt+e');
  await expect(frame.locator('.lv-app')).toHaveAttribute('data-editing', 'false');
  await page.keyboard.press('Control+Alt+e');
  await expect(frame.locator('.lv-app')).toHaveAttribute('data-editing', 'true');
  await page.keyboard.press('Control+Shift+v');
  await expect.poll(async () => (await host('snapshot')).activeEditor?.language).toBe('markdown');
  await frame.locator('h1').first().click();
  await record({ check: 'Context copy, question creation, selected annotation deletion, editing toggle and return-to-source shortcuts work' });

  await expect.poll(async () => (await host('extensionInfo', { extensionId: 'limr-examples.limr-reader-addon' }))?.active).toBe(true);
  await select();
  await page.keyboard.press('Control+Alt+n');
  await sourceHas('type="research-footnote"');
  await ready();
  await host('undo');
  await sourceIs(short);
  await host('configure', { values: { editingEnabled: false } });
  await select();
  await host('command', { command: 'limr.runSelectionAction', args: [{ actionId: 'limrExample.addFootnote' }] });
  await sourceIs(short);
  await expect(frame.getByRole('button', { name: 'Add research footnote', exact: true })).toHaveCount(0);
  await host('configure', { values: { editingEnabled: true, 'plugins.enabled': false } });
  await reset(short);
  await record({ check: 'A companion add-on registers Ctrl+Alt+N for its own footnote action; source Undo and read-only gating hold' });

  const block = frame.locator('.limr-code-block').first();
  await expect(block).toHaveAttribute('data-collapsed', 'true');
  await expect(block).not.toHaveAttribute('data-wrap');
  await expect(block).not.toHaveAttribute('data-line-numbers');
  await host('configure', { values: { 'codeBlock.lineNumbers': true, 'codeBlock.autoCollapse': false, 'codeBlock.wrap': true } });
  await expect(block).not.toHaveAttribute('data-collapsed');
  await expect(block).toHaveAttribute('data-wrap', 'true');
  await expect(block).toHaveAttribute('data-line-numbers', 'true');
  await expect(block.locator('.limr-code-line')).toHaveCount(48);
  await block.locator('.limr-code-copy').click();
  // The Windows clipboard converts line endings to CRLF across the WSL bridge.
  await expect.poll(async () => (await host('clipboard')).replace(/\r\n/g, '\n')).toBe(code);
  await sourceIs(short);
  await page.screenshot({ path: path.join(artifacts, 'code-settings.png') });
  await record({ check: 'Code defaults and live overrides work; numbered/wrapped code copies exactly without line numbers or source edits' });
  await host('configure', { values: { 'codeBlock.lineNumbers': false, 'codeBlock.autoCollapse': true, 'codeBlock.wrap': false } });
  await expect(block).toHaveAttribute('data-collapsed', 'true');
  await frame.locator('h1').first().click();
  await page.keyboard.press('Control+f');
  // Disabling the add-on above recreates the webview resource roots/frame.
  await frame.locator('.limr-document-search input').fill('folded_code_needle');
  await expect(frame.locator('.limr-document-search [role="status"]')).toHaveText('1/1');
  await expect(block).not.toHaveAttribute('data-collapsed');
  await expect(block).toBeInViewport();
  await page.keyboard.press('Escape');
  await sourceIs(short);
  await record({ check: 'Ordinary-document search also unfolds code, excludes module syntax and matches without case sensitivity' });

  await reset(long);
  await expect(frame.locator('[data-limr-windowed]')).toHaveCount(1);
  await frame.locator('h1').first().click();
  await page.keyboard.press('Control+f');
  const virtualFind = frame.locator('.limr-document-search input');
  await expect(virtualFind).toBeVisible();
  await expect(page.locator('.simple-find-part[aria-hidden="false"]')).toHaveCount(0);
  await virtualFind.fill('remote_search_needle');
  await expect(frame.locator('.limr-document-search [role="status"]')).toHaveText('1/1', { timeout: 20_000 });
  await expect(frame.locator('.limr-reader-content p').filter({ hasText: 'remote_search_needle' })).toBeInViewport();
  await virtualFind.fill('folded_code_needle');
  await expect(frame.locator('.limr-document-search [role="status"]')).toHaveText('1/1', { timeout: 20_000 });
  await expect(frame.locator('.limr-code-block')).not.toHaveAttribute('data-collapsed');
  await expect(frame.locator('.limr-code-block')).toBeInViewport();
  await virtualFind.fill('Long document reading text.');
  await expect(frame.locator('.limr-document-search [role="status"]')).toHaveText('1/14000', { timeout: 20_000 });
  await page.keyboard.press('F3');
  await expect(frame.locator('.limr-document-search [role="status"]')).toHaveText('2/14000');
  await page.keyboard.press('Shift+F3');
  await expect(frame.locator('.limr-document-search [role="status"]')).toHaveText('1/14000');
  await page.keyboard.press('Escape');
  await expect(virtualFind).toHaveCount(0);
  await sourceIs(long);
  await record({ check: 'Long-document search covers unmounted paragraphs and folded code; F3/Shift+F3 navigate without opening duplicate native find' });

  // Return to the opening selection without replacing the complete worker engine.
  await frame.locator('.lv-scroll').evaluate(element => element.scrollTo({ top: 0, behavior: 'instant' }));
  await select();
  await frame.evaluate(() => {
    window.__readerEditTrace = { start: performance.now(), messages: [], ready: [] };
    window.addEventListener('message', event => {
      if (['state', 'editResult'].includes(event.data?.type))
        window.__readerEditTrace.messages.push({ type: event.data.type, at: performance.now() - window.__readerEditTrace.start, success: event.data.success });
    });
    new MutationObserver(() => window.__readerEditTrace.ready.push({ at: performance.now() - window.__readerEditTrace.start, value: document.querySelector('.lv-app')?.dataset.readerReady }))
      .observe(document.querySelector('.lv-app'), { attributes: true, attributeFilter: ['data-reader-ready'] });
  });
  await page.keyboard.press('Control+Alt+h');
  await sourceHas('type="highlight"');
  await ready();
  const trace = await frame.evaluate(() => window.__readerEditTrace);
  expect(trace.messages.some(message => message.type === 'editResult' && message.success)).toBe(true);
  await host('undo');
  await sourceIs(long);
  await ready();
  await record({ check: 'Reader highlight refreshes a long document and native Undo restores it', characters: long.length, trace });
  expect(errors).toEqual([]);
  return evidence;
}
