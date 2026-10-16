import { expect } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const source = '# Continuous scroll acceptance\n\n' + Array.from({ length: 600 }, (_, index) =>
  `Paragraph ${String(index + 1).padStart(4, '0')}. Continuous wheel and trackpad input must update both panes while the gesture is still running. 中文阅读段落用于实际测量双向滚动，而不是只等待滚动结束。\n\n`).join('');

export async function runScrollSyncAcceptance({ page, frame, host, artifacts }) {
  const evidence = [], errors = [];
  page.on('pageerror', error => errors.push(String(error)));
  const save = async value => { evidence.push(value); await writeFile(path.join(artifacts, 'checks.json'), JSON.stringify(evidence, null, 2)); };
  await host('configure', { values: { syncScroll: false, tocMode: 'hidden', sidebarMode: 'hidden', typography: 'standard', 'plugins.enabled': false } });
  await host('replaceSource', { source });
  await host('layout', { sourceSize: .5 });
  await expect(frame.locator('.limr-reader h1')).toHaveText('Continuous scroll acceptance');
  await expect(frame.locator('.limr-reader-content > article > p')).toHaveCount(600);
  await frame.evaluate(() => document.fonts.ready);
  await frame.locator('.lv-scroll').evaluate(element => element.scrollTop = 0);
  await host('scrollSource', { line: 0 });
  await host('configure', { values: { syncScroll: true } });

  await frame.evaluate(() => {
    const root = document.querySelector('.lv-scroll');
    window.__scrollEvidence = { reveals: [], scrolls: [] };
    window.addEventListener('message', event => {
      if (event.data?.type === 'reveal') window.__scrollEvidence.reveals.push({ time: Date.now(), offset: event.data.offset });
    });
    root.addEventListener('scroll', () => window.__scrollEvidence.scrolls.push({ time: Date.now(), top: root.scrollTop }), { passive: true });
  });

  const started = await host('scrollSourceSeries', { start: 12, step: 3, count: 80, interval: 16 });
  await delay(350);
  const during = await host('scrollSourceStatus');
  const whileMoving = await frame.evaluate(() => ({ ...window.__scrollEvidence, top: document.querySelector('.lv-scroll').scrollTop }));
  expect(during.scroll.completed).toBeUndefined();
  expect(whileMoving.reveals.length).toBeGreaterThan(3);
  expect(whileMoving.top).toBeGreaterThan(300);
  expect(whileMoving.scrolls[0].time - started.started).toBeLessThan(250);
  await expect.poll(async () => (await host('scrollSourceStatus')).scroll.completed).toBeTruthy();
  await delay(120);
  const sourceFinished = await host('scrollSourceStatus');
  const sourceMetrics = await frame.evaluate(() => ({ ...window.__scrollEvidence, top: document.querySelector('.lv-scroll').scrollTop }));
  const finalSourceOffset = sourceFinished.events.at(-1).offset;
  expect(Math.abs(sourceMetrics.reveals.at(-1).offset - finalSourceOffset)).toBeLessThanOrEqual(1);
  const latencies = sourceMetrics.reveals.map(reveal => {
    const event = sourceFinished.events.find(event => event.offset === reveal.offset);
    return event ? reveal.time - event.time : undefined;
  }).filter(value => value !== undefined).sort((a, b) => a - b);
  expect(latencies.length).toBeGreaterThan(10);
  const p95 = latencies[Math.floor(latencies.length * .95)];
  expect(p95).toBeLessThan(150);
  await save({ check: 'Source to reader follows during a continuous 16 ms gesture and delivers the final line', duringSourceSteps: during.scroll.steps,
    duringReaderUpdates: whileMoving.reveals.length, duringReaderTop: whileMoving.top, firstVisibleFollowMs: whileMoving.scrolls[0].time - started.started,
    updates: sourceMetrics.reveals.length, hostToWebviewP95Ms: p95, finalSourceLine: sourceFinished.visibleRanges[0].start, finalReaderTop: sourceMetrics.top });

  // Start the opposite direction immediately; no 600 ms reveal cooldown.
  const readerStartLine = sourceFinished.visibleRanges[0].start;
  const readerStarted = await frame.evaluate(() => {
    const root = document.querySelector('.lv-scroll');
    const series = window.__readerSeries = { started: Date.now(), firstInput: undefined, completed: undefined, steps: 0, initialTop: root.scrollTop };
    const timer = setInterval(() => {
      series.firstInput ??= Date.now();
      root.scrollTop += 34;
      if (++series.steps >= 80) { clearInterval(timer); series.completed = Date.now(); }
    }, 16);
    return series.started;
  });
  await delay(320);
  const readerDuring = await host('scrollSourceStatus');
  const readerSeriesDuring = await frame.evaluate(() => ({ ...window.__readerSeries }));
  await writeFile(path.join(artifacts, 'scroll-trace.json'), JSON.stringify({ sourceFinished, sourceMetrics, readerDuring, readerSeriesDuring, reader: await frame.evaluate(() => ({ ...window.__scrollEvidence, top: document.querySelector('.lv-scroll').scrollTop })) }, null, 2));
  expect(readerSeriesDuring.completed).toBeUndefined();
  expect(readerDuring.visibleRanges[0].start).toBeGreaterThan(readerStartLine + 4);
  const readerSourceEvents = readerDuring.events.filter(event => event.time >= readerSeriesDuring.firstInput && event.line > readerStartLine);
  expect(readerSourceEvents.length).toBeGreaterThan(3);
  expect(readerSourceEvents[0].time - readerSeriesDuring.firstInput).toBeLessThan(200);
  await expect.poll(() => frame.evaluate(() => window.__readerSeries.completed)).toBeTruthy();
  await delay(100);
  const readerFinished = await host('scrollSourceStatus');
  const readerMetrics = await frame.evaluate(() => ({ ...window.__readerSeries, top: document.querySelector('.lv-scroll').scrollTop, reveals: window.__scrollEvidence.reveals.filter(item => item.time >= window.__readerSeries.started) }));
  expect(readerMetrics.top - readerMetrics.initialTop).toBe(80 * 34);
  expect(readerMetrics.reveals).toHaveLength(0);
  await delay(300);
  expect((await host('snapshot')).visibleRanges).toEqual(readerFinished.visibleRanges);
  expect(await frame.locator('.lv-scroll').evaluate(element => element.scrollTop)).toBe(readerMetrics.top);
  await save({ check: 'Reader to source follows while scrolling, takes over immediately, and settles without feedback or drift',
    sourceUpdatesDuringGesture: readerSourceEvents.length, firstSourceFollowMs: readerSourceEvents[0].time - readerSeriesDuring.firstInput,
    startSourceLine: readerStartLine, duringSourceLine: readerDuring.visibleRanges[0].start, finalSourceLine: readerFinished.visibleRanges[0].start,
    readerDistance: readerMetrics.top - readerMetrics.initialTop, returnedRevealMessages: readerMetrics.reveals.length });

  // Source must also take control immediately after a reader-driven reveal.
  await frame.locator('.lv-scroll').evaluate(element => element.scrollTop += 130);
  await delay(35);
  await host('scrollSource', { line: 120 });
  await expect.poll(async () => (await host('snapshot')).visibleRanges[0].start).toBeLessThan(121);
  const takeoverSource = await host('scrollSourceStatus');
  await expect.poll(() => frame.evaluate(() => window.__scrollEvidence.reveals.at(-1)?.offset)).toBe(takeoverSource.events.at(-1).offset);
  const takeover = await frame.locator('.lv-scroll').evaluate(element => element.scrollTop);
  expect(takeover).toBeLessThan(readerMetrics.top);
  await save({ check: 'Source can immediately reverse a reader-driven movement without a 300 ms global cooldown', readerTopAfterSourceTakeover: takeover });

  await host('configure', { values: { syncScroll: false } });
  await delay(60);
  const independentReader = await frame.locator('.lv-scroll').evaluate(element => element.scrollTop);
  await host('scrollSource', { line: 400 });
  await delay(120);
  expect(await frame.locator('.lv-scroll').evaluate(element => element.scrollTop)).toBe(independentReader);
  const independentSource = (await host('snapshot')).visibleRanges;
  await frame.locator('.lv-scroll').evaluate(element => element.scrollTop += 350);
  await delay(120);
  expect((await host('snapshot')).visibleRanges).toEqual(independentSource);
  await save({ check: 'Disabling associated scrolling leaves both panes independent' });

  await host('configureEditor', { values: { smoothScrolling: true, wordWrap: 'on' } });
  await host('configure', { values: { syncScroll: true } });
  await host('scrollSourceSeries', { start: 430, step: 2, count: 40, interval: 16 });
  await delay(240);
  const smoothDuring = await host('scrollSourceStatus');
  expect(smoothDuring.scroll.completed).toBeUndefined();
  const smoothReaderDuring = await frame.locator('.lv-scroll').evaluate(element => element.scrollTop);
  expect(smoothReaderDuring).toBeGreaterThan(independentReader + 1000);
  await expect.poll(async () => (await host('scrollSourceStatus')).scroll.completed).toBeTruthy();
  await delay(250);
  const smoothStart = await host('scrollSourceStatus');
  const smoothStarted = await frame.evaluate(() => {
    const root = document.querySelector('.lv-scroll');
    const series = window.__smoothSeries = { started: Date.now(), completed: undefined, steps: 0, top: root.scrollTop };
    const timer = setInterval(() => {
      root.scrollTop += 34;
      if (++series.steps >= 60) { clearInterval(timer); series.completed = Date.now(); }
    }, 16);
    return series.started;
  });
  await delay(300);
  expect((await host('snapshot')).visibleRanges[0].start).toBeGreaterThan(smoothStart.visibleRanges[0].start);
  await expect.poll(() => frame.evaluate(() => window.__smoothSeries.completed)).toBeTruthy();
  await delay(300);
  const smoothFinished = await host('scrollSourceStatus');
  const smoothMetrics = await frame.evaluate(() => ({ ...window.__smoothSeries, finalTop: document.querySelector('.lv-scroll').scrollTop,
    returnedReveals: window.__scrollEvidence.reveals.filter(item => item.time >= window.__smoothSeries.started) }));
  expect(smoothMetrics.finalTop - smoothMetrics.top).toBe(60 * 34);
  expect(smoothMetrics.returnedReveals).toHaveLength(0);
  await save({ check: 'Native editor smooth scrolling and wrapped source lines keep both directions live without feedback',
    sourceStepsDuringGesture: smoothDuring.scroll.steps, readerTopDuringSourceGesture: smoothReaderDuring,
    startSourceLine: smoothStart.visibleRanges[0].start, endSourceLine: smoothFinished.visibleRanges[0].start,
    sourceEventsDuringReaderGesture: smoothFinished.events.filter(event => event.time >= smoothStarted).length,
    readerDistance: smoothMetrics.finalTop - smoothMetrics.top, returnedRevealMessages: smoothMetrics.returnedReveals.length });

  const wheelStart = (await host('snapshot')).visibleRanges[0].start;
  await frame.locator('.lv-scroll').hover();
  let wheelDuring;
  for (let step = 0; step < 12; step++) {
    await page.mouse.wheel(0, 120); await delay(16);
    if (step === 5) wheelDuring = (await host('snapshot')).visibleRanges[0].start;
  }
  expect(wheelDuring).toBeGreaterThan(wheelStart);
  await save({ check: 'Real mouse wheel events synchronize before the wheel sequence ends', startSourceLine: wheelStart, duringSourceLine: wheelDuring });

  await delay(250);
  const finalReaderInput = Date.now();
  await frame.locator('.lv-scroll').evaluate(element => element.scrollTop += 280);
  await expect.poll(async () => (await host('scrollSourceStatus')).events.at(-1).time).toBeGreaterThan(finalReaderInput);
  const smallReverseAt = Date.now();
  await host('scrollSourceLines', { lines: -1 });
  await writeFile(path.join(artifacts, 'reverse-trace.json'), JSON.stringify({ finalReaderInput, smallReverseAt,
    host: await host('scrollSourceStatus'), reader: await frame.evaluate(() => window.__scrollEvidence) }, null, 2));
  await expect.poll(() => frame.evaluate(time => window.__scrollEvidence.reveals.filter(item => item.time >= time).length, smallReverseAt)).toBeGreaterThan(0);
  const smallReverse = await frame.evaluate(time => window.__scrollEvidence.reveals.find(item => item.time >= time), smallReverseAt);
  expect(smallReverse.time - smallReverseAt).toBeLessThan(180);
  await save({ check: 'One visual line of reverse source input takes control inside the same viewport with native smooth scrolling enabled', followMs: smallReverse.time - smallReverseAt });

  await host('scrollSource', { line: 0 });
  await expect.poll(() => frame.locator('.lv-scroll').evaluate(element => element.scrollTop)).toBe(0);
  await host('scrollSource', { line: 1198 });
  await expect.poll(() => frame.locator('.lv-scroll').evaluate(element => element.scrollTop >= element.scrollHeight - element.clientHeight - 1)).toBe(true);
  const endTop = await frame.locator('.lv-scroll').evaluate(element => element.scrollTop);
  await delay(250);
  expect(await frame.locator('.lv-scroll').evaluate(element => element.scrollTop)).toBe(endTop);
  await save({ check: 'Document start and clamped document end converge and remain stable', bottomScrollTop: endTop });

  expect(errors).toEqual([]);
  await page.screenshot({ path: path.join(artifacts, 'scroll-sync.png') });
  return evidence;
}
