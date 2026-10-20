import { expect } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';

export async function runSearchInteractionsAcceptance({ page, frame, host, artifacts }) {
  const evidence = [], errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const record = async check => {
    evidence.push({ check });
    console.log(check);
    await writeFile(path.join(artifacts, 'checks.json'), JSON.stringify(evidence, null, 2));
  };
  const reset = async source => {
    await host('replaceSource', { source });
    const heading = source.split('\n')[0].slice(2);
    await expect.poll(async () => {
      for (const candidate of page.frames()) {
        if (await candidate.locator('.limr-reader h1').first().textContent({ timeout: 200 }).catch(() => '') === heading) {
          frame = candidate; return true;
        }
      }
      return false;
    }, { timeout: 90_000 }).toBe(true);
    await expect(frame.locator('.lv-app')).toHaveAttribute('data-reader-ready', 'true', { timeout: 90_000 });
  };
  expect(await host('readConfiguration', { keys: ['search.rememberQuery'] })).toEqual({ 'search.rememberQuery': false });
  await host('configure', { values: {
    language: 'en', theme: 'playground-dark', syncScroll: false, sidebarMode: 'hidden',
    tocMode: 'hidden', typography: 'standard', 'plugins.enabled': false,
  } });
  for (const large of [false, true]) {
    const label = large ? 'virtualized document' : 'ordinary document';
    const paragraphs = large ? 900 : 140;
    const source = `# Search interactions ${large}\n\nBefore **selected plain text** after. Search needle and another Search needle.\n\n`
      + Array.from({ length: paragraphs }, (_, i) => `Paragraph ${i + 1}. ViewportToken_${i + 1}_end. `
        + 'Reading text with a stable paragraph height. '.repeat(3)
        + (i === 20 || i === paragraphs - 20 ? ' FarOnlyTarget' : '') + '\n\n').join('');
    await reset(source);
    await expect(frame.locator('[data-limr-windowed]')).toHaveCount(large ? 1 : 0);
    const input = frame.locator('.limr-document-search input');
    const count = frame.locator('.limr-search-count');
    const close = frame.locator('.limr-search-close');
    const scroll = frame.locator('.lv-scroll');
    const settled = () => expect.poll(async () => {
      const before = await scroll.evaluate(element => element.scrollTop);
      await page.waitForTimeout(200);
      return Math.abs(before - await scroll.evaluate(element => element.scrollTop));
    }).toBeLessThan(.1);
    const open = () => host('command', { command: 'limr.find' });
    const empty = async () => {
      await expect(input).toHaveValue('');
      await expect(input).toBeFocused();
      await expect(count).toHaveText('0/0');
      await expect(frame.locator('[data-search-current]')).toHaveCount(0);
    };
    const query = async () => {
      await input.fill('Search needle');
      await expect(count).toHaveText('1/2', { timeout: 20_000 });
    };

    const strong = frame.locator('.limr-reader-content strong').first();
    await strong.click();
    await strong.evaluate(element => {
      const range = document.createRange(); range.selectNodeContents(element);
      const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range);
      document.dispatchEvent(new Event('selectionchange'));
    });
    await page.keyboard.press('Control+f');
    await expect(input).toHaveValue('selected plain text');
    await expect(input).toBeFocused();
    await expect(count).toHaveText('1/1');
    await expect(page.locator('.simple-find-part[aria-hidden="false"]')).toHaveCount(0);
    await page.keyboard.press('Escape');
    await open();
    await empty();
    await record(`${label}: native Ctrl+F seeds selected plain text without Markdown delimiters`);

    await input.pressSequentially('hello');
    await page.keyboard.press('Control+z');
    await expect(input).toHaveValue('');
    await page.keyboard.press('Control+y');
    await expect(input).toHaveValue('hello');
    await page.keyboard.press('Control+a');
    await input.pressSequentially('replacement');
    await page.keyboard.press('Control+z');
    await expect(input).toHaveValue('hello');
    await page.keyboard.press('Control+Shift+z');
    await expect(input).toHaveValue('replacement');
    expect((await host('snapshot')).source).toBe(source);
    await record(`${label}: Ctrl+Z/Ctrl+Y/Ctrl+Shift+Z edit only the search input`);

    await query();
    await page.keyboard.press('Control+f');
    await expect(input).toHaveValue('Search needle');
    await page.keyboard.press('Escape');
    await open();
    await empty();
    await query();
    await close.click();
    await open();
    await empty();
    await record(`${label}: Escape and close button clear by default; Ctrl+F while open preserves the query`);

    await host('configure', { values: { 'search.rememberQuery': true } });
    await query();
    await page.keyboard.press('Escape');
    await open();
    await expect(input).toHaveValue('Search needle');
    await expect(count).toHaveText('1/2');
    await close.click();
    await open();
    await expect(input).toHaveValue('Search needle');
    await expect(count).toHaveText('1/2');
    await record(`${label}: rememberQuery retains the query through both close paths`);

    const matchCase = frame.getByRole('button', { name: 'Match case', exact: true });
    const regex = frame.getByRole('button', { name: 'Use regular expression', exact: true });
    await matchCase.click(); await regex.click();
    await host('configure', { values: { 'search.rememberQuery': false } });
    await expect(input).toHaveValue('Search needle');
    await close.click();
    await host('command', { command: 'limr.findNext' });
    await empty();
    await expect(matchCase).toHaveAttribute('aria-pressed', 'true');
    await expect(regex).toHaveAttribute('aria-pressed', 'true');
    await matchCase.click(); await regex.click();
    await host('configure', { values: { 'search.rememberQuery': true } });
    await query();
    await close.click();
    await host('configure', { values: { 'search.rememberQuery': false } });
    await open();
    await empty();
    await close.click();
    await record(`${label}: settings apply live and while closed; Find Next reopens empty without losing search modes`);

    // Use the real inner reader scroller. Large documents must remount their
    // middle window before choosing the visible search target.
    await scroll.evaluate(element => element.scrollTo({ top: element.scrollHeight / 2, behavior: 'instant' }));
    const middle = async () => frame.locator('.limr-reader-content p').evaluateAll(elements => {
      const root = document.querySelector('.lv-scroll').getBoundingClientRect();
      const paragraph = elements.find(element => {
        const box = element.getBoundingClientRect();
        return box.top > root.top + 80 && box.bottom < root.bottom - 80 && /ViewportToken_\d+_end/.test(element.textContent);
      });
      return paragraph?.textContent.match(/ViewportToken_\d+_end/)?.[0] ?? '';
    });
    await expect.poll(middle).toMatch(/^ViewportToken_\d+_end$/);
    // Let the virtual window publish its measured heights before recording the
    // position; search must preserve this settled position, not its estimate.
    await settled();
    const token = await middle();
    const anchor = await scroll.evaluate(element => element.scrollTop);
    const unchanged = async () => expect(Math.abs(await scroll.evaluate(element => element.scrollTop) - anchor)).toBeLessThan(2);
    await open();
    await input.fill(token);
    await expect(count).toHaveText('1/1', { timeout: 20_000 });
    await unchanged();
    await input.fill('no_result_during_typing');
    await expect(count).toHaveText('0/0');
    await unchanged();
    await input.fill(token);
    await expect(count).toHaveText('1/1');
    await unchanged();
    await record(`${label}: visible result selection and a mistyped query preserve the middle reading position`);

    await input.fill('FarOnlyTarget');
    await expect(count).toHaveText('?/2');
    await unchanged();
    await page.keyboard.press('F3');
    await expect(count).toHaveText('2/2');
    const last = frame.locator('.limr-reader-content p').filter({ hasText: `ViewportToken_${paragraphs - 19}_end` });
    await expect(last).toBeInViewport();
    await settled();
    await record(`${label}: distant results show ?/2; native F3 selects the nearest following result once`);

    await scroll.evaluate((element, top) => element.scrollTo({ top, behavior: 'instant' }), anchor);
    await settled();
    await expect.poll(middle).toMatch(/^ViewportToken_\d+_end$/);
    await input.fill('no_result_during_typing');
    await expect(count).toHaveText('0/0');
    await input.fill('FarOnlyTarget');
    await expect(count).toHaveText('?/2');
    await input.focus();
    await page.keyboard.press('Shift+F3');
    await expect(count).toHaveText('1/2');
    await expect(frame.locator('.limr-reader-content p').filter({ hasText: 'ViewportToken_21_end' })).toBeInViewport();
    await page.screenshot({ path: path.join(artifacts, `search-${large ? 'virtual' : 'ordinary'}.png`) });
    await page.keyboard.press('Escape');
    expect((await host('snapshot')).source).toBe(source);
    await record(`${label}: native Shift+F3 selects the nearest preceding result; Markdown remains unchanged`);
  }

  for (const theme of ['auto', 'playground-light', 'playground-dark', 'one-dark-pro']) {
    await host('configure', { values: { theme } });
    await reset(`# Search loading ${theme}\n\nA short search example.`);
    await host('command', { command: 'limr.find' });
    const panel = frame.locator('.limr-document-search');
    // Deterministically expose the actual loading control for style inspection.
    // Worker execution and search completion are covered above and in reader-tools.
    await panel.evaluate(element => element.setAttribute('data-loading', ''));
    await expect(panel.locator('.limr-search-loading')).toHaveCSS('opacity', '1');
    await expect.poll(() => panel.evaluate(element =>
      getComputedStyle(element.querySelector('.limr-loading')).color === getComputedStyle(element.querySelector('.limr-search-previous')).color,
    )).toBe(true);
    await expect(panel.locator('.limr-loading-arc')).toHaveCSS('stroke-width', '2.5px');
    await panel.screenshot({ path: path.join(artifacts, `loading-${theme}.png`) });
    await page.keyboard.press('Escape');
    await record(`${theme}: loading ring matches adjacent search controls`);
  }
  expect(errors).toEqual([]);
  return evidence;
}
