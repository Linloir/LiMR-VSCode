import { expect } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';

const denseRanges = Array.from({ length: 8 }, (_, index) => `::%%limr%%{<#dense-${index + 1}}${index + 1}::%%limr%%{>#dense-${index + 1}}`).join(' ');
const denseNotes = Array.from({ length: 8 }, (_, index) => `:::limr-annotation{#dense-note-${index + 1} ranges="dense-${index + 1}" type="margin-note"}
Note ${index + 1} has enough text to create a two-line preview and a measurable folded sidebar window.

Its second paragraph remains available when this note is expanded.
:::`).join('\n\n');
const fixture = `# Dense sidebar motion

Eight nearby ranges: ${denseRanges}.

${Array.from({ length: 9 }, (_, index) => `Reading paragraph ${index + 1} leaves space between the dense annotations and the independent final note.`).join('\n\n')}

An ::%%limr%%{<#distant}independent later range::%%limr%%{>#distant} keeps the neighboring cluster spacing measurable.

${Array.from({ length: 4 }, (_, index) => `Trailing paragraph ${index + 1} gives the sidebar real document height.`).join('\n\n')}

${denseNotes}

:::limr-annotation{#distant-note ranges="distant" type="margin-note"}
This independent annotation verifies that animated groups keep a nonnegative gap.
:::
`;

/** Observe the RAF-driven sidebar in real time. Never pause animations or seek
 * currentTime: its layout clock is JavaScript, separate from CSS transitions. */
export async function runSidebarMotionAcceptance({ page, frame, host, artifacts }) {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await host('configure', { values: { editingEnabled: true, sidebarMode: 'always', syncScroll: false, theme: 'playground-dark' } });
  await host('replaceSource', { source: fixture });
  await host('layout', { sourceSize: .18 });
  const heading = frame.getByRole('heading', { name: 'Dense sidebar motion', exact: true });
  await expect(heading).toBeVisible();
  await frame.evaluate(() => document.fonts.ready);
  const rail = frame.locator('.limr-sidebar[data-collapse-overflow="true"]');
  await expect(rail).toBeVisible();
  await heading.hover();
  // Source/font measurements can change cluster membership during initial layout.
  await expect.poll(() => rail.locator('.limr-sidebar-cluster[data-collapsible]').count()).toBeGreaterThan(0);
  await expect.poll(() => rail.locator('.limr-sidebar-cluster').count()).toBeGreaterThan(1);
  await frame.evaluate(() => new Promise(resolve => setTimeout(resolve, 750)));
  await expect(rail).not.toHaveAttribute('data-moving');

  const cluster = rail.locator('.limr-sidebar-cluster[data-collapsible]').first();
  const group = await cluster.getAttribute('data-group');
  const occurrences = await cluster.locator('.limr-sidebar-card').evaluateAll(elements => elements.map(element => element.dataset.occurrence));
  expect(occurrences.length, 'The fixture actually contains a folded group of multiple ranges').toBeGreaterThanOrEqual(3);
  const first = occurrences[0], last = occurrences.at(-1);
  const selectorFor = id => `[data-limr-anchor=${JSON.stringify(id)}]`;
  const firstMarker = frame.locator(selectorFor(first));
  const lastMarker = frame.locator(selectorFor(last));
  await expect(firstMarker).toBeVisible();
  await expect(lastMarker).toBeVisible();
  // Resolve actionability/coordinates before arming. A locator.hover() round trip
  // through Windows/WSL can itself consume a complete 460ms animation interval.
  const center = async locator => {
    const box = await locator.boundingBox();
    expect(box).toBeTruthy();
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  };
  const firstPoint = await center(firstMarker), lastPoint = await center(lastMarker);

  async function record(duration = 1000) {
    await frame.evaluate(({ duration, first, last }) => {
      const rail = document.querySelector('.limr-sidebar[data-collapse-overflow="true"]');
      const samples = [], triggers = [], removers = [];
      const start = performance.now();
      let lastTriggerAt;
      const motionDuration = getComputedStyle(rail).getPropertyValue('--limr-motion-slow');
      const observe = () => {
        const boxes = [...rail.querySelectorAll(':scope > .limr-sidebar-cluster')].map(group => {
          const viewport = group.querySelector('.limr-sidebar-cluster-list');
          const content = group.querySelector('.limr-sidebar-cluster-items');
          const rect = viewport.getBoundingClientRect();
          const cards = [...content.children].map(card => {
            const rect = card.getBoundingClientRect();
            return { id: card.dataset.occurrence, top: rect.top, bottom: rect.bottom, inert: card.inert };
          });
          const contentY = new DOMMatrixReadOnly(getComputedStyle(content).transform).m42;
          return { id: group.dataset.group, top: rect.top, bottom: rect.bottom, height: rect.height, contentY, cards };
        }).sort((a, b) => a.top - b.top);
        const groupGaps = boxes.slice(1).map((box, index) => box.top - boxes[index].bottom);
        const cardGaps = boxes.flatMap(box => box.cards.slice(1).map((card, index) => card.top - box.cards[index].bottom));
        samples.push({ time: performance.now() - start, moving: rail.hasAttribute('data-moving'), boxes, groupGaps, cardGaps });
      };
      for (const id of [first, last]) {
        const marker = document.querySelector(`[data-limr-anchor="${CSS.escape(id)}"]`);
        const entered = () => { lastTriggerAt = performance.now(); triggers.push({ id, time: lastTriggerAt - start }); };
        marker.addEventListener('pointerenter', entered);
        removers.push(() => marker.removeEventListener('pointerenter', entered));
      }
      window.__limrSidebarMotion = new Promise(resolve => {
        const tick = () => {
          observe();
          // Keep the requested interval after the latest real pointer event,
          // not after Playwright arms the recorder across the WSL boundary.
          if (performance.now() - (lastTriggerAt ?? start) < (lastTriggerAt === undefined ? 5000 : duration)) requestAnimationFrame(tick);
          else { removers.forEach(remove => remove()); resolve({ samples, triggers, motionDuration }); }
        };
        tick();
      });
    }, { duration, first, last });
  }
  const result = () => frame.evaluate(() => window.__limrSidebarMotion);
  const groupValues = trace => trace.samples.map(sample => ({ time: sample.time, moving: sample.moving, ...sample.boxes.find(box => box.id === group) }));
  function assertLiveMotion(trace, name) {
    const values = groupValues(trace);
    expect(values.every(value => value.id === group), `${name}: cluster identity survives motion`).toBe(true);
    expect(values.filter(value => value.moving).length, `${name}: samples include the active RAF interval`).toBeGreaterThan(2);
    const positions = new Set(values.map(value => [value.top, value.height, value.contentY].map(number => number.toFixed(2)).join(',')));
    expect(positions.size, `${name}: natural geometry advances through multiple frames`).toBeGreaterThan(3);
    expect(trace.samples.at(-1).moving, `${name}: the RAF settles`).toBe(false);
    for (const sample of trace.samples) {
      expect(sample.boxes.length, `${name}: spacing checks have neighboring clusters`).toBeGreaterThan(1);
      expect(sample.groupGaps.every(gap => gap >= -.5), `${name}: clusters never overlap at t=${sample.time.toFixed(1)}ms`).toBe(true);
      expect(sample.cardGaps.every(gap => gap >= -.5), `${name}: cards never overlap at t=${sample.time.toFixed(1)}ms`).toBe(true);
    }
    return values;
  }

  await record();
  await page.mouse.move(lastPoint.x, lastPoint.y);
  await page.screenshot({ path: path.join(artifacts, 'sidebar-raf-reveal-live.png') });
  const reveal = await result();
  await writeFile(path.join(artifacts, 'sidebar-reveal-trace.json'), JSON.stringify({ group, occurrences, ...reveal }, null, 2));
  const revealed = assertLiveMotion(reveal, 'Dense sidebar reveal');
  expect(revealed.at(-1).contentY).toBeLessThan(revealed[0].contentY - 2);
  expect(revealed.at(-1).cards.find(card => card.id === last).inert, 'The previously folded target becomes interactive').toBe(false);
  await page.screenshot({ path: path.join(artifacts, 'sidebar-raf-reveal-settled.png') });

  await heading.hover();
  // Alignment intentionally waits 140ms after pointer leave before animating.
  await frame.evaluate(() => new Promise(resolve => setTimeout(resolve, 750)));
  await expect(rail).not.toHaveAttribute('data-moving');
  await record(1200);
  await page.mouse.move(lastPoint.x, lastPoint.y);
  await frame.evaluate(() => new Promise(resolve => {
    let remaining = 4;
    const tick = () => --remaining ? requestAnimationFrame(tick) : resolve();
    requestAnimationFrame(tick);
  }));
  await page.mouse.move(firstPoint.x, firstPoint.y);
  await page.screenshot({ path: path.join(artifacts, 'sidebar-raf-reversal-live.png') });
  const reversal = await result();
  await writeFile(path.join(artifacts, 'sidebar-reversal-trace.json'), JSON.stringify({ group, occurrences, ...reversal }, null, 2));
  const reversed = assertLiveMotion(reversal, 'Dense sidebar reversal');
  const forwardTrigger = reversal.triggers.find(trigger => trigger.id === last);
  const reverseTrigger = reversal.triggers.find(trigger => trigger.id === first);
  expect(forwardTrigger, 'A real pointer event starts the forward motion').toBeTruthy();
  expect(reverseTrigger, 'A real pointer event requests reversal').toBeTruthy();
  expect(reverseTrigger.time - forwardTrigger.time, 'The second interaction occurs before the 460ms motion ends').toBeLessThan(400);
  const lowest = Math.min(...reversed.map(value => value.contentY));
  expect(lowest, 'The outgoing motion has visibly advanced before reversal').toBeLessThan(reversed[0].contentY - 2);
  expect(reversed.at(-1).contentY, 'The actual offset reverses direction and returns toward the first card').toBeGreaterThan(lowest + 2);
  expect(reversed.at(-1).cards.find(card => card.id === first).inert).toBe(false);
  await page.screenshot({ path: path.join(artifacts, 'sidebar-raf-reversal-settled.png') });
  console.log('Animation checked: adaptive sidebar natural RAF reveal, reversal and neighbor spacing');
  return [{ check: 'Adaptive sidebar moves through natural RAF frames, reverses before completion, reveals folded cards and preserves neighboring gaps', group, occurrences, reveal, reversal }];
}
