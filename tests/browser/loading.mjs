import { expect } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';

export async function runLoadingAcceptance({ page, frame, host, artifacts }) {
  const evidence = [];
  const save = async value => { evidence.push(value); await writeFile(path.join(artifacts, 'checks.json'), JSON.stringify(evidence, null, 2)); console.log(value.check); };
  const app = frame.locator('.lv-app'), progress = frame.getByRole('progressbar');
  const status = page.locator('.statusbar-item').filter({ hasText: /LiMR · (Reading|Parsing|Indexing|Loading)/ });
  const titleActions = page.locator('.editor-group-container.active .title .actions-container');
  expect((await host('readConfiguration', { keys: ['loadingMode'] })).loadingMode).toBe('progressive');
  await host('configure', { values: { language: 'en', editingEnabled: false, 'skills.promptOnStartup': false, syncScroll: false, tocMode: 'hidden' } });
  await expect(titleActions.locator('.codicon-lock')).toBeVisible();
  await host('command', { command: 'limr.toggleEditing' });
  await expect(titleActions.locator('.codicon-edit')).toBeVisible();
  await host('command', { command: 'limr.toggleEditing' });
  await expect(titleActions.locator('.codicon-lock')).toBeVisible();
  await save({ check: 'Progressive is the default; the native editor toolbar switches between lock and edit icons' });

  // Observe the real worker without retaining its source or AST. A one-shot
  // failure below exercises the actual host error/retry route separately.
  await frame.evaluate(() => {
    const NativeWorker = Worker;
    window.__loadingAudit = { workers: [], samples: [], failNext: false, holdNext: false };
    window.Worker = class extends NativeWorker {
      constructor(...args) {
        super(...args);
        this.audit = { loads: [], snapshots: [], terminated: false }; window.__loadingAudit.workers.push(this.audit);
        this.addEventListener('message', ({ data }) => {
          if (data.type === 'snapshot') this.audit.snapshots.push({ complete: data.complete, chars: data.snapshot.source.length });
        });
      }
      postMessage(message, ...rest) {
        if (message.type === 'load') {
          this.audit.loads.push({ mode: message.mode, chars: message.input.length });
          if (window.__loadingAudit.holdNext) { window.__loadingAudit.holdNext = false; return; }
          if (window.__loadingAudit.failNext) {
            window.__loadingAudit.failNext = false;
            queueMicrotask(() => this.dispatchEvent(new ErrorEvent('error', { message: 'Acceptance worker failure' })));
            return;
          }
        }
        super.postMessage(message, ...rest);
      }
      terminate() { this.audit.terminated = true; super.terminate(); }
    };
    const observe = () => {
      const bar = document.querySelector('.lv-load-progress'), app = document.querySelector('.lv-app');
      const sample = { progress: bar ? Number(bar.getAttribute('aria-valuenow')) : null,
        ready: app?.dataset.readerReady, heading: document.querySelector('.lv-reader h1')?.textContent };
      const samples = window.__loadingAudit.samples;
      if (JSON.stringify(samples.at(-1)) !== JSON.stringify(sample)) samples.push(sample);
    };
    new MutationObserver(observe).observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['aria-valuenow', 'data-reader-ready'] });
  });
  const text = '# Progressive document\n\n- [ ] A large document task\n\n' + '中文与 English text. '.repeat(20) + '\n\n'
    + Array.from({ length: 8000 }, (_, i) => `Paragraph ${i}. ${'The complete source keeps annotations, images and reading positions. '.repeat(4)}\n\n`).join('');
  await host('replaceSource', { source: text });
  await expect(progress).toBeVisible({ timeout: 15_000 });
  await expect(status).toBeVisible();
  expect(await progress.evaluate(element => element.getBoundingClientRect().top)).toBe(0);
  await expect(progress.locator('span')).toHaveCSS('background-color', 'rgb(0, 120, 212)');
  await expect(frame.getByRole('heading', { name: 'Progressive document' })).toBeVisible({ timeout: 30_000 });
  await page.screenshot({ path: path.join(artifacts, 'progressive.png') });
  await expect(app).toHaveAttribute('data-reader-ready', 'true', { timeout: 60_000 });
  await expect(progress).toHaveCount(0); await expect(status).toHaveCount(0);
  await expect(frame.locator('.limr-document-loading')).toHaveCount(0);
  const first = await frame.evaluate(() => structuredClone(window.__loadingAudit));
  expect(first.workers).toHaveLength(1); expect(first.workers[0].terminated).toBe(true);
  expect(first.workers[0].snapshots.some(snapshot => !snapshot.complete && snapshot.chars < text.length)).toBe(true);
  expect(first.samples.some(sample => sample.ready === 'false' && sample.heading === 'Progressive document')).toBe(true);
  const percents = first.samples.map(sample => sample.progress).filter(value => value !== null);
  expect(percents.length).toBeGreaterThan(2); expect(percents.every((value, i) => i === 0 || value >= percents[i - 1])).toBe(true);
  await save({ check: 'Real worker preview appears before completion; top blue bar and native status progress disappear together; worker terminates', chars: text.length, workers: first.workers, percents });
  await host('configure', { values: { editingEnabled: true } });
  await frame.getByRole('checkbox').click();
  await expect.poll(async () => (await host('snapshot')).source.includes('- [x] A large document task')).toBe(true);
  await expect(app).toHaveAttribute('data-reader-ready', 'true');
  await frame.getByRole('checkbox').click();
  await expect.poll(async () => (await host('snapshot')).source).toBe(text);
  await host('configure', { values: { editingEnabled: false } });
  await host('replaceSource', { source: text });
  await expect(app).toHaveAttribute('data-reader-ready', 'true');
  await expect(progress).toHaveCount(0); await expect(status).toHaveCount(0);
  expect(await frame.evaluate(() => window.__loadingAudit.workers.length)).toBe(1);

  // A completed reader keeps its engine for presentation-only updates.
  await host('configure', { values: { bodyFontSize: 17 } });
  await host('configure', { values: { theme: 'one-dark-pro', language: 'zh-CN' } });
  await expect(frame.locator('body')).toHaveAttribute('data-reader-theme', 'one-dark-pro');
  await host('configure', { values: { theme: 'playground', language: 'en' } });
  await expect(frame.locator('html')).toHaveAttribute('lang', 'en');
  expect(await frame.evaluate(() => window.__loadingAudit.workers.length)).toBe(1);
  await host('replaceSource', { source: '# Small reset\n\nReady.' });
  await expect(app).toHaveAttribute('data-reader-ready', 'true');
  await host('configure', { values: { loadingMode: 'blocking' } });
  await frame.evaluate(() => { window.__loadingAudit.samples = []; });
  await host('replaceSource', { source: text.replace('Progressive document', 'Blocking document') });
  await expect(progress).toBeVisible(); await expect(status).toBeVisible();
  await expect(frame.getByRole('heading', { name: 'Blocking document' })).toHaveCount(0);
  await expect(app).toHaveAttribute('data-reader-ready', 'true', { timeout: 60_000 });
  await expect(frame.getByRole('heading', { name: 'Blocking document' })).toBeVisible();
  const blocking = await frame.evaluate(() => structuredClone(window.__loadingAudit));
  expect(blocking.workers.at(-1).loads[0].mode).toBe('blocking');
  expect(blocking.workers.at(-1).snapshots.some(snapshot => !snapshot.complete)).toBe(false);
  await save({ check: 'Blocking mode keeps content hidden until ready, while presentation-only settings do not start another worker' });

  // Hold one request to keep a fast parser from finishing while the native
  // status item waits for a stable click target. The worker itself is real.
  await frame.evaluate(() => { window.__loadingAudit.holdNext = true; });
  await host('replaceSource', { source: text.replace('Progressive document', 'Cancel document') });
  await expect(status).toBeVisible(); await status.click();
  await expect(frame.locator('.lv-load-error')).toContainText('Loading cancelled');
  await expect(progress).toHaveCount(0);
  expect(await frame.evaluate(() => window.__loadingAudit.workers.at(-1).terminated)).toBe(true);
  await status.click();
  await expect(app).toHaveAttribute('data-reader-ready', 'true', { timeout: 60_000 });
  await expect(status).toHaveCount(0);
  await frame.evaluate(() => { window.__loadingAudit.failNext = true; });
  await host('replaceSource', { source: text.replace('Progressive document', 'Retry document') });
  await expect(frame.locator('.lv-load-error')).toContainText('Acceptance worker failure');
  await expect(status).toContainText('Loading failed');
  await frame.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(app).toHaveAttribute('data-reader-ready', 'true', { timeout: 60_000 });
  await expect(progress).toHaveCount(0); await expect(status).toHaveCount(0);
  await save({ check: 'Native status cancellation, native retry and visible worker-error retry terminate abandoned workers and recover' });

  await host('replaceSource', { source: text.replace('Progressive document', 'Superseded document') });
  await expect(progress).toBeVisible();
  await host('replaceSource', { source: '# Latest document\n\nOnly the latest revision is visible.' });
  await expect(frame.getByRole('heading', { name: 'Latest document' })).toBeVisible();
  await expect(progress).toHaveCount(0); await expect(status).toHaveCount(0);
  expect(await frame.evaluate(() => window.__loadingAudit.workers.every(worker => worker.terminated))).toBe(true);
  await save({ check: 'Replacing a loading document with a small revision drops old progress and terminates the obsolete worker' });

  const beforeHidden = await frame.evaluate(() => window.__loadingAudit.workers.length);
  await host('openUntitledSource', { source: 'Another editor in the reader group.' });
  await host('replaceSource', { source: text.replace('Progressive document', 'Deferred hidden document') });
  await host('replaceSource', { source: text.replace('Progressive document', 'Latest hidden document') });
  expect(await frame.evaluate(() => window.__loadingAudit.workers.length)).toBe(beforeHidden);
  await expect(status).toHaveCount(0);
  await host('openReader');
  await expect(frame.getByRole('heading', { name: 'Latest hidden document' })).toBeVisible({ timeout: 60_000 });
  await expect(app).toHaveAttribute('data-reader-ready', 'true', { timeout: 60_000 });
  expect(await frame.evaluate(() => window.__loadingAudit.workers.length)).toBe(beforeHidden + 1);
  await save({ check: 'Hidden retained readers defer repeated source changes and parse only the latest revision when revealed' });
  return evidence;
}
