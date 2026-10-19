import { expect } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';

export async function runTocColorsAcceptance({ page, frame, host, artifacts }) {
  const evidence = [], observe = process.env.LIMR_TEST_OBSERVE_ONLY === '1';
  await host('configure', { values: { language: 'en', maxWidth: 740, tocMode: 'always', sidebarMode: 'hidden', syncScroll: false, 'plugins.enabled': false } });
  await host('replaceSource', { source: '# Contents\n\n[External reference](https://example.com/)\n\n' + 'Paragraph text.\n\n'.repeat(25) + '## Section Two\n\n' + 'More text.\n\n'.repeat(25) + '## Section Three\n\nLast paragraph.\n' });
  const colors = locator => locator.evaluate(element => {
    const probe = document.createElement('span'); element.appendChild(probe);
    const resolve = property => { probe.style.color = `var(${property}, var(${property.replace('--limr-', '--lv-')}))`; return getComputedStyle(probe).color; };
    const result = { color: getComputedStyle(element).color, decoration: getComputedStyle(element).textDecorationLine, muted: resolve('--limr-muted'), heading: resolve('--limr-heading'), current: element.hasAttribute('aria-current') };
    probe.remove(); return result;
  });
  for (const theme of ['playground-light', 'playground-dark', 'vscode-light', 'vscode-dark']) {
    for (const width of ['wide', 'narrow']) {
      await host('layout', { sourceSize: width === 'wide' ? .12 : .72 });
      await page.waitForTimeout(500);
      await writeFile(path.join(artifacts, 'layout.json'), JSON.stringify({ theme, width, snapshot: await host('snapshot'), groups: await page.locator('.editor-group-container').evaluateAll(elements => elements.map(e => ({ box: e.getBoundingClientRect().toJSON(), className: e.className }))), frame: await frame.evaluate(() => ({ width: innerWidth, scroll: document.querySelector('.lv-scroll')?.clientWidth })) }, null, 2));
      await host('configure', { values: { theme } });
      await expect(frame.locator('body')).toHaveAttribute('data-reader-theme', theme);
      await frame.locator('[data-testid="reader-scroll"]').evaluate(element => { element.scrollTop = 0; });
      const toc = frame.locator(width === 'wide' ? '.limr-reader-toc' : '.limr-reader-mobile-toc');
      if (width === 'narrow') {
        const toggle = toc.locator('.limr-mobile-toc-toggle');
        if (await toggle.getAttribute('aria-expanded') !== 'true') await toggle.click();
      }
      const link = toc.getByRole('link', { name: 'Section Two', exact: true });
      await expect(link).toBeVisible();
      await frame.getByRole('heading', { name: 'Contents', exact: true }).hover();
      const normal = await colors(link);
      await link.hover(); const hover = await colors(link);
      const proseLink = await colors(frame.locator('.limr-reader-content').getByRole('link', { name: 'External reference' }));
      evidence.push({ theme, width, normal, hover, proseLink });
      await page.screenshot({ path: path.join(artifacts, `${theme}-${width}.png`) });
      await writeFile(path.join(artifacts, 'checks.json'), JSON.stringify(evidence, null, 2));
      if (!observe) {
        expect(normal.color).toBe(normal.current ? normal.heading : normal.muted);
        expect(normal.decoration).toBe('none');
        expect(hover.color).toBe(hover.heading);
        expect(proseLink.color).not.toBe(normal.muted);
      }
      await link.click();
      await expect(frame.getByRole('heading', { name: 'Section Two', exact: true })).toBeInViewport();
      if (width === 'wide') {
        await expect(link).toHaveAttribute('aria-current');
        const active = await colors(link);
        if (!observe) expect(active.color).toBe(active.heading);
        evidence.at(-1).active = active;
        const third = toc.getByRole('link', { name: 'Section Three', exact: true });
        await third.focus(); await third.press('ArrowRight');
        if (!observe) expect((await colors(third)).decoration).toContain('underline');
      }
      console.log(`${theme} ${width}: ${normal.color} (expected ${normal.current ? normal.heading : normal.muted})`);
    }
  }
  await writeFile(path.join(artifacts, 'checks.json'), JSON.stringify(evidence, null, 2));
  return evidence;
}
