import { expect } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';

export async function runLoadLimitsAcceptance({ page, frame, host, artifacts }) {
  const evidence = [];
  const save = async value => { evidence.push(value); console.log(value.check); await writeFile(path.join(artifacts, 'checks.json'), JSON.stringify(evidence, null, 2)); };
  await host('configure', { values: { language: 'en', syncScroll: false, tocMode: 'hidden' } });
  // Keep a real native worker alive but withhold its input to model an
  // unresponsive parser. The production 60-second deadline is not shortened.
  await frame.evaluate(() => {
    const Native = Worker;
    window.__limits = { requests: [], transfers: [], stopped: 0 };
    addEventListener('message', ({ data }) => {
      if (data?.type === 'state') window.__limits.transfers.push({ bytes: data.sourceBytes?.byteLength ?? 0,
        envelopeChars: data.state.document.source.length, error: data.state.loadError });
    });
    window.Worker = class extends Native {
      postMessage(message, ...args) {
        if (message.type === 'load') { window.__limits.requests.push(message.input.length); return; }
        super.postMessage(message, ...args);
      }
      terminate() { window.__limits.stopped++; super.terminate(); }
    };
  });
  const limit = 75 * 1024 * 1024;
  const exact = await host('replaceGeneratedSource', { bytes: limit });
  expect(exact.bytes).toBe(limit);
  await expect(frame.getByRole('progressbar')).toBeVisible({ timeout: 20_000 });
  await expect.poll(() => frame.evaluate(() => window.__limits.requests.length)).toBe(1);
  const transfer = await frame.evaluate(() => window.__limits.transfers.at(-1));
  expect(transfer).toEqual({ bytes: limit, envelopeChars: 0, error: undefined });
  const above = await host('replaceGeneratedSource', { bytes: limit + 1 });
  expect(above.bytes).toBe(limit + 1);
  await expect(frame.getByRole('alert')).toContainText('75 MiB');
  await expect(frame.locator('.limr-reader')).toHaveCount(0);
  await expect(frame.getByRole('progressbar')).toHaveCount(0);
  const rejected = await frame.evaluate(() => window.__limits);
  expect(rejected.requests).toHaveLength(1); expect(rejected.stopped).toBe(1);
  expect(rejected.transfers.at(-1)).toEqual({ bytes: 0, envelopeChars: 0, error: 'too-large' });
  await save({ check: 'Exactly 75 MiB transfers as binary; one extra UTF-8 byte is rejected before transfer/parsing and terminates the old worker', exact, above, transfer });

  await host('replaceSource', { source: '# Reset\n\nSmall buffer.' });
  await expect(frame.getByRole('heading', { name: 'Reset' })).toBeVisible();
  const previousWorkers = new Set(page.workers());
  const started = Date.now();
  await host('replaceGeneratedSource', { bytes: 256 * 1024 });
  await expect(frame.getByRole('progressbar')).toBeVisible();
  await expect.poll(() => page.workers().filter(worker => !previousWorkers.has(worker)).length).toBeGreaterThan(0);
  const pendingWorkers = page.workers().filter(worker => !previousWorkers.has(worker));
  let recovered;
  await expect.poll(async () => {
    for (const candidate of page.frames()) {
      if (await candidate.getByRole('alert').filter({ hasText: '60 seconds' }).count().catch(() => 0)) { recovered = candidate; return true; }
    }
    return false;
  }, { timeout: 75_000, intervals: [250] }).toBe(true);
  const elapsed = Date.now() - started;
  expect(elapsed).toBeGreaterThanOrEqual(59_000); expect(elapsed).toBeLessThan(70_000);
  await expect.poll(() => pendingWorkers.every(worker => !page.workers().includes(worker))).toBe(true);
  await expect(page.locator('.statusbar-item').filter({ hasText: 'LiMR · Loading failed' })).toBeVisible();
  await expect(recovered.getByRole('progressbar')).toHaveCount(0);
  await page.screenshot({ path: path.join(artifacts, 'timeout.png') });
  // The new guest has the native Worker; retry must create a fresh request.
  await recovered.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(recovered.locator('.lv-app')).toHaveAttribute('data-reader-ready', 'true', { timeout: 60_000 });
  await expect(recovered.getByRole('alert')).toHaveCount(0);
  await save({ check: 'Real 60-second host deadline destroys the stalled guest and its worker; visible retry succeeds in a fresh guest', elapsedMs: elapsed, workersObserved: pendingWorkers.length });
  await recovered.evaluate(() => {
    const Native = Worker;
    window.Worker = class extends Native { postMessage(message, ...rest) { if (message.type !== 'load') super.postMessage(message, ...rest); } };
  });
  const existingWorkers = new Set(page.workers()), hiddenStarted = Date.now();
  await host('replaceGeneratedSource', { bytes: 257 * 1024 });
  await expect(recovered.getByRole('progressbar')).toBeVisible();
  await expect.poll(() => page.workers().filter(worker => !existingWorkers.has(worker)).length).toBeGreaterThan(0);
  const hiddenWorkers = page.workers().filter(worker => !existingWorkers.has(worker));
  await host('openUntitledSource', { source: 'Keep the reader hidden during an external source edit.' });
  await host('replaceSource', { source: '# Latest hidden revision\n\nA new revision must survive the old job timing out.' });
  await expect.poll(() => hiddenWorkers.every(worker => !page.workers().includes(worker)), { timeout: 75_000, intervals: [250] }).toBe(true);
  const hiddenElapsed = Date.now() - hiddenStarted;
  expect(hiddenElapsed).toBeGreaterThanOrEqual(59_000); expect(hiddenElapsed).toBeLessThan(70_000);
  await host('openReader');
  let latest;
  await expect.poll(async () => {
    for (const candidate of page.frames()) if (await candidate.getByRole('heading', { name: 'Latest hidden revision' }).count().catch(() => 0)) { latest = candidate; return true; }
    return false;
  }).toBe(true);
  await expect(latest.getByRole('alert')).toHaveCount(0);
  await expect(latest.locator('.lv-app')).toHaveAttribute('data-reader-ready', 'true');
  await save({ check: 'An unsent hidden edit cannot bypass the old worker deadline; revealing the reader loads the latest revision without a stale timeout error', elapsedMs: hiddenElapsed });
  await host('replaceSource', { source: '# Limit checks complete\n\nReady.' });
  return evidence;
}
