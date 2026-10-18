import { expect } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const source = 'sdf\n\n# Title after ordinary text\n\n' + Array.from({ length: 8000 }, (_, i) =>
  `Paragraph ${i}. ${'Long document text with a stable source location. '.repeat(5)}\n\n`).join('');

export async function runScrollRefreshAcceptance({ page, frame, host, artifacts }) {
  const evidence = [], errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const save = async value => { evidence.push(value); await writeFile(path.join(artifacts, 'checks.json'), JSON.stringify(evidence, null, 2)); console.log(value.check); };
  const root = frame.locator('.lv-scroll'), app = frame.locator('.lv-app');
  const ready = () => expect(app).toHaveAttribute('data-reader-ready', 'true', { timeout: 60_000 });
  const position = () => root.evaluate(root => {
    const edge = root.getBoundingClientRect().top + 18;
    const blocks = [...root.querySelectorAll('[data-source-start]')].filter(block => !block.closest('[inert],[data-window-parked]'));
    const block = blocks.find(block => { const rect = block.getBoundingClientRect(); return rect.height > 0 && rect.bottom > edge; });
    return { top: root.scrollTop, start: Number(block?.dataset.sourceStart), text: block?.textContent.slice(0, 80), textTop: block?.getBoundingClientRect().top - root.getBoundingClientRect().top };
  });
  await frame.evaluate(() => {
    const NativeWorker = Worker;
    window.__refreshWorker = { loads: 0, holdNext: false, release: null };
    window.Worker = class extends NativeWorker {
      postMessage(message, ...rest) {
        const audit = window.__refreshWorker;
        if (message.type === 'load') {
          audit.loads++;
          if (audit.holdNext) { audit.holdNext = false; audit.release = () => { audit.release = null; super.postMessage(message, ...rest); }; return; }
        }
        super.postMessage(message, ...rest);
      }
    };
  });
  await host('configure', { values: { syncScroll: false, tocMode: 'hidden', sidebarMode: 'hidden', 'plugins.enabled': false } });
  await host('configureEditor', { values: { smoothScrolling: false, wordWrap: 'off' } });
  for (const large of [false, true]) {
    const loadsBefore = await frame.evaluate(() => window.__refreshWorker.loads);
    await host('replaceSource', { source: large ? source : source.slice(0, 8000) });
    if (large) await expect.poll(() => frame.evaluate(() => window.__refreshWorker.loads)).toBe(loadsBefore + 1);
    await expect(frame.getByRole('heading', { name: 'Title after ordinary text', exact: true })).toBeVisible();
    await ready();
    await frame.evaluate(() => document.fonts.ready);
    for (const syncScroll of [false, true]) {
      await host('configure', { values: { syncScroll } });
      if (syncScroll) { await host('scrollSource', { line: 40 }); await pause(150); await host('scrollSource', { line: 0 }); }
      else await root.evaluate(root => { root.scrollTop = 400; root.scrollTop = 0; });
      const samples = await root.evaluate(root => new Promise(resolve => {
        const samples = []; const next = () => { samples.push(root.scrollTop); if (samples.length < 100) requestAnimationFrame(next); else resolve(samples); }; requestAnimationFrame(next);
      }));
      const tail = samples.slice(20);
      await save({ check: 'Leading text before title stays at the top', large, syncScroll, min: Math.min(...tail), max: Math.max(...tail), samples });
    }
  }
  for (const loadingMode of ['progressive', 'blocking']) {
    await host('configure', { values: { syncScroll: true, loadingMode } });
    await host('activateSource'); await host('scrollSource', { line: 40 }); await pause(100); await host('scrollSource', { line: 7004 });
    await expect.poll(async () => (await position()).start, { timeout: 15_000 }).toBeGreaterThan(source.length * .35);
    await pause(350); const before = await position();
    const loadsBefore = await frame.evaluate(() => window.__refreshWorker.loads);
    await root.evaluate((root, start) => {
      window.__refreshFrames = []; window.__watchRefresh = true;
      const sample = () => { if (!window.__watchRefresh) return; window.__refreshFrames.push({ top: root.scrollTop, height: root.scrollHeight, textTop: root.querySelector(`[data-source-start="${start}"]`)?.getBoundingClientRect().top - root.getBoundingClientRect().top }); requestAnimationFrame(sample); }; sample();
    }, before.start);
    const start = source.indexOf('Paragraph 3510.');
    const change = await host('editSource', { start, text: `Edited ${loadingMode}. ` });
    await expect.poll(() => frame.evaluate(() => window.__refreshWorker.loads)).toBe(loadsBefore + 1);
    await ready(); await pause(500);
    const after = await position();
    const frames = await frame.evaluate(() => { window.__watchRefresh = false; return window.__refreshFrames; });
    expect(frames.length).toBeGreaterThan(5);
    await writeFile(path.join(artifacts, `frames-${loadingMode}.json`), JSON.stringify({ before, after, frames }, null, 2));
    expect(Math.max(...frames.map(sample => Math.abs(sample.textTop - before.textTop)))).toBeLessThanOrEqual(2);
    expect(Math.min(...frames.map(sample => sample.height))).toBeGreaterThan(before.top);
    expect(await frame.evaluate(() => window.__refreshWorker.loads)).toBe(loadsBefore + 1);
    await save({ check: 'Source edit restores the aligned middle without another scroll', loadingMode, before, after, minTopDuringRefresh: Math.min(...frames.map(sample => sample.top)), frames: frames.length,
      sourceLine: change.visibleRanges[0]?.start });
  }
  const burstBefore = await position(), beforeLoads = await frame.evaluate(() => window.__refreshWorker.loads);
  await host('editBurst', { start: source.indexOf('Paragraph 3510.'), text: 'x', count: 12, interval: 20 });
  await expect.poll(() => frame.evaluate(() => window.__refreshWorker.loads)).toBe(beforeLoads + 1);
  await ready();
  expect(await frame.evaluate(() => window.__refreshWorker.loads)).toBe(beforeLoads + 1);
  const burstAfter = await position();
  expect(burstAfter.start).toBe(burstBefore.start);
  expect(Math.abs(burstAfter.textTop - burstBefore.textTop)).toBeLessThanOrEqual(2);
  await save({ check: 'Twelve rapid large-document edits cause one worker load and keep the reading viewport', before: burstBefore, after: burstAfter, workerLoads: 1 });
  // Keep one real worker request pending so the user can change the source
  // viewport during parsing, regardless of how fast this machine parses.
  await host('configure', { values: { loadingMode: 'progressive' } }); await ready();
  await frame.evaluate(() => { window.__refreshWorker.holdNext = true; });
  await host('editSource', { start: source.indexOf('Paragraph 3510.'), text: 'Another edit. ' });
  await expect(app).toHaveAttribute('data-reader-ready', 'false');
  await expect.poll(() => frame.evaluate(() => !!window.__refreshWorker.release)).toBe(true);
  await host('scrollSource', { line: 9004 }); await pause(120);
  const settled = await host('snapshot'), line = settled.visibleRanges[0].start;
  const expected = settled.source.split('\n').slice(0, line).reduce((offset, text) => offset + text.length + 1, 0);
  await frame.evaluate(() => window.__refreshWorker.release()); await ready(); await pause(500);
  const after = await position();
  await save({ check: 'Scrolling the source during loading restores the latest viewport', sourceLine: line, expected, after });
  await page.screenshot({ path: path.join(artifacts, 'refresh-middle.png') });
  if (!process.env.LIMR_TEST_OBSERVE_ONLY) {
    for (const result of evidence) {
      if (result.samples) { expect(result.max - result.min).toBeLessThanOrEqual(1); expect(result.max).toBeLessThanOrEqual(1); }
      else { expect(result.after.top).toBeGreaterThan(1000); expect(Math.abs(result.after.start - (result.expected ?? result.before.start))).toBeLessThan(600); }
    }
    expect(errors).toEqual([]);
  }
  return evidence;
}
