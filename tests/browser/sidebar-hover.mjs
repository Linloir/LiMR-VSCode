import { expect } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';

export async function runSidebarHoverAcceptance({ page, frame, host, artifacts }) {
  const evidence = [], errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await host('configure', { values: {
    language: 'en', editingEnabled: true, syncScroll: false, sidebarMode: 'always',
    tocMode: 'hidden', theme: 'playground-dark', 'plugins.enabled': false,
  } });
  await host('layout', { sourceSize: .18 });
  for (const collapse of [false, true]) {
    await host('configure', { values: { sidebarAutoCollapse: collapse } });
    const heading = `Pinned sidebar hover ${collapse}`;
    const source = `# ${heading}\n\n`
      + Array.from({ length: 8 }, (_, i) => `Paragraph ${i + 1} has a ::%%limr%%{<#range-${i}}selected passage ${i + 1}::%%limr%%{>#range-${i}} with a nearby note. Reading continues after this range.\n\n`).join('')
      + Array.from({ length: 14 }, (_, i) => `Trailing paragraph ${i + 1} keeps both the article and its sidebar inside a real scrollable document.\n\n`).join('')
      + Array.from({ length: 8 }, (_, i) => `:::limr-annotation{#note-${i} ranges="range-${i}" type="margin-note"}\n`
        + `Note ${i + 1} has enough content for an expanded card and a shorter collapsed preview.\n\n`
        + 'A second paragraph explains why the note remains pinned while the pointer visits other cards.\n\n'
        + 'A third paragraph gives this card a measurable bottom edge.\n:::\n\n').join('');
    await host('replaceSource', { source });
    await expect.poll(async () => {
      for (const candidate of page.frames()) {
        if (await candidate.locator('.limr-reader h1').first().textContent({ timeout: 200 }).catch(() => '') === heading) {
          frame = candidate; return true;
        }
      }
      return false;
    }, { timeout: 60_000 }).toBe(true);
    await expect(frame.locator('.lv-app')).toHaveAttribute('data-reader-ready', 'true');
    await frame.evaluate(() => document.fonts.ready);
    const rail = frame.locator('.limr-reader > .limr-sidebar');
    if (collapse) await expect(rail).toHaveAttribute('data-collapse-overflow', 'true');
    else await expect(rail).not.toHaveAttribute('data-collapse-overflow');
    const settled = async () => {
      await expect(rail).not.toHaveAttribute('data-moving');
      await expect.poll(() => frame.locator('.limr-reader').evaluate(element =>
        element.getAnimations({ subtree: true }).filter(animation => animation.playState === 'running').length,
      )).toBe(0);
    };
    const leaveCards = async () => {
      // Stay inside the nested webview so CDP delivers pointerleave to the
      // previous card; moving to the workbench can retain its hover state.
      await frame.locator('.lv-scroll').hover({ position: { x: 20, y: 20 } });
      await expect(rail.locator('.limr-sidebar-card:hover')).toHaveCount(0);
      await expect(rail.locator('[data-pointer-locked]')).toHaveCount(0);
      await settled();
    };
    await settled();
    const cards = rail.locator('.limr-sidebar-card');
    await expect(cards).toHaveCount(8);
    const card = cards.nth(3);
    await card.locator('.limr-sidebar-card-heading').click();
    await leaveCards();
    await cards.nth(2).hover();
    await leaveCards();
    await card.scrollIntoViewIfNeeded(); await settled();
    const before = await card.evaluate(element => ({
      cardTop: element.getBoundingClientRect().top,
      proseTop: document.querySelector('.limr-reader-content > .limr-prose').getBoundingClientRect().top,
      scroll: document.querySelector('.lv-scroll').scrollTop,
    }));
    for (const edge of [false, true]) {
      const box = await card.boundingBox();
      const local = await card.evaluate((element, edge) => {
        const rect = element.getBoundingClientRect();
        return { x: rect.x + rect.width / 2, y: rect.y + (edge ? rect.height - 2 : rect.height / 2) };
      }, edge);
      const y = box.y + (edge ? box.height - 2 : box.height / 2);
      expect(y).toBeGreaterThan(0);
      expect(y).toBeLessThan(page.viewportSize().height);
      // A stationary real pointer exposes enter/leave loops that locator.hover()
      // can hide by retrying at the card's latest coordinates.
      await page.mouse.move(box.x + box.width / 2, y);
      const samples = await card.evaluate(async (element, point) => {
        const samples = [];
        for (let i = 0; i < 45; i++) {
          await new Promise(requestAnimationFrame);
          samples.push({
            cardTop: element.getBoundingClientRect().top,
            proseTop: document.querySelector('.limr-reader-content > .limr-prose').getBoundingClientRect().top,
            scroll: document.querySelector('.lv-scroll').scrollTop,
            hit: document.elementFromPoint(point.x, point.y)?.closest('.limr-sidebar-card') === element,
          });
        }
        return samples;
      }, local);
      const check = {
        collapse, edge,
        cardDrift: Math.max(...samples.map(sample => Math.abs(sample.cardTop - before.cardTop))),
        proseDrift: Math.max(...samples.map(sample => Math.abs(sample.proseTop - before.proseTop))),
        scrollDrift: Math.max(...samples.map(sample => Math.abs(sample.scroll - before.scroll))),
        pointerStayedInside: samples.every(sample => sample.hit),
      };
      evidence.push(check);
      await writeFile(path.join(artifacts, 'checks.json'), JSON.stringify(evidence, null, 2));
      console.log(JSON.stringify(check));
      if (!process.env.LIMR_TEST_OBSERVE_ONLY) {
        expect(check.cardDrift).toBeLessThan(1);
        expect(check.proseDrift).toBeLessThan(1);
        expect(check.scrollDrift).toBe(0);
        expect(check.pointerStayedInside).toBe(true);
      }
      await expect(card).toHaveAttribute('data-expanded', 'true');
      await leaveCards();
    }
    expect((await host('snapshot')).source).toBe(source);
    await page.screenshot({ path: path.join(artifacts, `pinned-hover-${collapse}.png`) });
  }
  expect(errors).toEqual([]);
  return evidence;
}
