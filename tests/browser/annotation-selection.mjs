import { expect } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';

export async function runAnnotationSelectionAcceptance({ page, frame, host, artifacts }) {
  const evidence = [];
  const observe = process.env.LIMR_TEST_OBSERVE_ONLY === '1';
  await host('configure', { values: { language: 'en', editingEnabled: false, tocMode: 'hidden', syncScroll: false, 'plugins.enabled': false } });
  for (const theme of ['playground-light', 'playground-dark']) {
    for (const mode of ['overlay', 'expanded-overlay', 'sidebar', 'fixed-sidebar']) {
      await frame.locator('body').press('Escape');
      await host('layout', { sourceSize: mode.includes('sidebar') ? .12 : .76 });
      await host('configure', { values: { theme, sidebarMode: 'always', sidebarAutoCollapse: mode !== 'fixed-sidebar' } });
      const phrase = `Select ${evidence.length} annotation words`;
      const source = `# Annotation selection\n\nBefore ::%%limr%%{<#r1}annotated words::%%limr%%{>#r1} after.\n\n:::limr-annotation{#q1 ranges="r1" type="question"}\n**${phrase}** with \`inline code\` and [a link](#annotation-selection).\n\nA second paragraph stays readable.\n:::\n`.replaceAll('q1', `q${evidence.length}`).replaceAll('r1', `r${evidence.length}`);
      await host('replaceSource', { source });
      await expect(frame.locator('.lv-app')).toHaveAttribute('aria-busy', 'false');
      let card;
      if (mode.includes('sidebar')) {
        card = frame.locator('.limr-sidebar-card[data-type="question"]');
        await card.locator('.limr-sidebar-card-heading').click();
        await expect(card).toHaveAttribute('data-expanded', 'true');
      } else {
        const marker = frame.locator('.limr-reader-content').getByRole('button', { name: 'Question', exact: true });
        if (mode === 'overlay') await marker.hover();
        else await marker.click();
        card = frame.locator('.limr-annotation-overlay');
        await expect(card.getByRole('button', { name: mode === 'overlay' ? 'Expand' : 'Collapse', exact: true })).toBeVisible();
      }
      const text = card.locator('.limr-annotation-markdown strong');
      await expect(text).toHaveText(phrase);
      await frame.evaluate(() => document.fonts.ready);
      await text.hover();
      await text.click({ trial: true });
      // Use native mouse input. Programmatically creating a Range bypasses
      // user-select and can conceal the original interaction failure.
      const local = await text.evaluate(element => {
        const range = document.createRange(); range.selectNodeContents(element);
        const rects = [...range.getClientRects()].filter(rect => rect.width && rect.height);
        const first = rects[0], last = rects.at(-1), box = element.getBoundingClientRect();
        return { start: { x: first.left - box.left + .2, y: first.top - box.top + first.height / 2 }, end: { x: last.right - box.left - .2, y: last.top - box.top + last.height / 2 } };
      });
      const box = await text.boundingBox();
      await page.mouse.move(box.x + local.start.x, box.y + local.start.y);
      await page.mouse.down();
      await page.mouse.move(box.x + local.end.x, box.y + local.end.y, { steps: 18 });
      await page.mouse.up();
      const result = await text.evaluate(element => ({ selected: getSelection()?.toString(), selectionColor: getComputedStyle(element, '::selection').backgroundColor, userSelect: getComputedStyle(element).userSelect, painted: element.closest('[data-limr-painted]')?.className }));
      await page.keyboard.press('Control+c');
      if (!observe) await expect.poll(() => host('clipboard')).toBe(phrase);
      else if (result.selected) await expect.poll(() => host('clipboard'), { timeout: 1000 }).toBe(result.selected).catch(() => {});
      const clipboard = await host('clipboard');
      await page.screenshot({ path: path.join(artifacts, `${theme}-${mode}.png`) });
      evidence.push({ theme, mode, phrase, ...result, clipboard });
      await writeFile(path.join(artifacts, 'checks.json'), JSON.stringify(evidence, null, 2));
      console.log(JSON.stringify(evidence.at(-1)));
      if (!observe) {
        expect(result.selected).toBe(phrase);
        expect(result.selectionColor).not.toMatch(/^(transparent|rgba\(0, 0, 0, 0\))$/);
        await expect(card).toBeVisible();
        if (mode.includes('sidebar')) await expect(card).toHaveAttribute('data-expanded', 'true');
        expect((await host('snapshot')).source).toBe(source);
      }
    }
  }
  return evidence;
}
