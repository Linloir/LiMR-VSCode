import { expect } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';

export async function runAnnotationControlsAcceptance({ page, frame, host, artifacts }) {
  const evidence = [], errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const record = async value => {
    evidence.push(value);
    console.log(JSON.stringify(value));
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
    }, { timeout: 60_000 }).toBe(true);
    await expect(frame.locator('.lv-app')).toHaveAttribute('data-reader-ready', 'true');
  };
  const verifyControls = async (card, sidebar) => {
    const title = card.locator(sidebar ? '.limr-sidebar-card-heading' : '.limr-overlay-header > span').first();
    const font = await title.evaluate(element => ({ size: getComputedStyle(element).fontSize, family: getComputedStyle(element).fontFamily }));
    if (!sidebar) {
      const toggle = card.locator('.limr-overlay-controls button').first();
      await expect(toggle).toHaveCSS('font-size', font.size);
      await expect(toggle).toHaveCSS('font-family', font.family);
      await expect(card).not.toHaveAttribute('data-motion');
      const alignment = await card.evaluate(element => {
        const title = element.querySelector('.limr-overlay-header > span').getBoundingClientRect();
        const toggle = element.querySelector('.limr-overlay-controls button > span').getBoundingClientRect();
        return Math.abs(title.y - toggle.y);
      });
      expect(alignment).toBeLessThan(.1);
    }
    const actions = card.locator(sidebar ? '.limr-sidebar-card-content .limr-annotation-actions' : '.limr-annotation-actions');
    for (const button of await actions.locator('button').all()) {
      await expect(button).toHaveCSS('font-size', font.size);
      await expect(button).toHaveCSS('font-family', font.family);
      await expect(button.locator('svg')).toHaveCount(1);
      const icon = await button.evaluate(element => ({
        size: element.querySelector('svg').getBoundingClientRect().width,
        font: parseFloat(getComputedStyle(element).fontSize),
      }));
      expect(icon.size).toBeCloseTo(icon.font * 1.15, 1);
    }
    const underline = actions.locator('.limr-underline').first();
    await underline.hover();
    await expect(underline).toHaveCSS('background-size', '100% 1px');
    return font;
  };
  await host('configure', { values: {
    language: 'zh-CN', editingEnabled: true, syncScroll: false, tocMode: 'hidden', 'plugins.enabled': false,
  } });
  for (const sidebar of [false, true]) for (const theme of ['playground-light', 'playground-dark']) {
    await host('layout', { sourceSize: sidebar ? .18 : .5 });
    await host('configure', { values: { sidebarMode: sidebar ? 'always' : 'hidden', theme } });
    const source = `# Card ${sidebar} ${theme}\n\nBefore ::%%limr%%{<#de1234}selected words::%%limr%%{>#de1234} after.\n\n`
      + ':::limr-annotation{id="abc123" ranges="de1234" type="margin-note"}\n123\n:::';
    await reset(source);
    await frame.locator('.limr-reader-content').getByRole('button', { name: '旁注', exact: true }).first().click();
    const card = frame.locator(sidebar ? '.limr-sidebar-card[data-active]' : '.limr-annotation-overlay');
    await expect(card).toBeVisible();
    await expect(card.locator('.limr-annotation-markdown').first()).toHaveCSS('font-size', '14px');
    for (const editing of [false, true]) {
      if (editing) await card.getByRole('button', { name: '编辑旁注', exact: true }).click();
      const font = await verifyControls(card, sidebar);
      await record({ check: 'Annotation action text and icons match title; hover underline animates', sidebar, theme, editing, font });
    }
    await page.screenshot({ path: path.join(artifacts, `${sidebar ? 'sidebar' : 'overlay'}-${theme}.png`) });
    await card.getByRole('button', { name: '取消', exact: true }).click();
    await frame.evaluate(() => { getSelection()?.removeAllRanges(); document.dispatchEvent(new Event('selectionchange')); });
    await page.keyboard.press('Escape');
    expect((await host('snapshot')).source).toBe(source);

    const long = 'ExtraordinaryHeader'.repeat(25);
    const tableSource = `# Table ${sidebar} ${theme}\n\n| **${long}** | Value |\n| --- | --- |\n| short | 1 |`;
    await reset(tableSource);
    const table = frame.locator('.limr-table-layout');
    await expect(table).toHaveAttribute('data-table-ready', 'true');
    const marker = table.getByRole('button', { name: '单元格完整内容', exact: true }).first();
    await marker.click();
    const preview = frame.locator(sidebar ? '.limr-sidebar-card[data-type="table-cell-overflow"][data-active]' : '.limr-annotation-overlay[data-type="table-cell-overflow"]');
    await expect(preview).toBeVisible();
    const font = await verifyControls(preview, sidebar);
    await preview.getByRole('button', { name: '复制 Markdown', exact: true }).click();
    await expect.poll(async () => (await host('clipboard')).replace(/\r\n/g, '\n')).toContain(`**${long}**`);
    await preview.getByRole('button', { name: '在表格中展开', exact: true }).click();
    const cell = table.locator('th').first();
    await expect(cell).toHaveAttribute('data-cell-expanded', 'true');
    const collapse = cell.getByRole('button', { name: '收起', exact: true });
    await expect(collapse.locator('svg')).toHaveCount(1);
    await expect(collapse).toHaveText('');
    await expect(collapse).toHaveClass(/limr-action-mark/);
    await expect(collapse).toHaveAttribute('aria-expanded', 'true');
    await collapse.scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(artifacts, `table-expanded-${sidebar}-${theme}.png`) });
    await collapse.click();
    await expect(cell).not.toHaveAttribute('data-cell-expanded');
    await expect(marker).toBeVisible();
    expect((await host('snapshot')).source).toBe(tableSource);
    await record({ check: 'Table preview action fonts/icons/underlines match title; icon corner marker collapses without editing Markdown', sidebar, theme, font });
  }
  expect(errors).toEqual([]);
  return evidence;
}
