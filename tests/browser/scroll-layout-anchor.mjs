import { expect } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const marker = 'READING_EDGE_ANCHOR';
const prose = 'A delayed image must not displace the words currently being read. 正文中的图片、公式和表格异步完成排版时，当前阅读文字应保持位置。 ';
const paragraph = index => `Paragraph ${index}. ${prose.repeat(8)}\n\n`;
const svg = height => `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="${height}"><rect width="320" height="${height}" fill="#557799"/></svg>`;
const source = '# Reading position inside a virtual block\n\n'
  + Array.from({ length: 90 }, (_, index) => paragraph(index)).join('')
  + '![Before the reading block](./layout-before-small.svg)\n\n'
  + '> ![Inside the reading block](./layout-inside-small.svg)\n>\n'
  + `> ${marker} ${prose.repeat(12)}\n>\n`
  + '> ![After the reading glyph](./layout-after-tall.svg)\n>\n'
  + Array.from({ length: 10 }, (_, index) => `> Quoted paragraph ${index}. ${prose.repeat(8)}\n>\n`).join('')
  + '\n' + Array.from({ length: 90 }, (_, index) => paragraph(index + 90)).join('');

/** Controlled, real image decode changes exercise asynchronous layout rather
 * than resizing the viewport. The marker stays inside one tall blockquote, so
 * checking that block's top would miss the intra-block regression entirely.
 *
 * Integrate in scripts/test-vscode.mjs as --scroll-layout-anchor, importing
 * runScrollLayoutAnchorAcceptance. LIMR_TEST_OBSERVE_ONLY=1 retains a complete
 * negative-control journal without stopping on the first failed assertion.
 * LIMR_TEST_LAYOUT_FILTER=same-height runs only the two unchanged-height cases.
 */
export async function runScrollLayoutAnchorAcceptance({ page, frame, host, artifacts }) {
  const evidence = [], errors = [];
  const include = name => !process.env.LIMR_TEST_LAYOUT_FILTER || new RegExp(process.env.LIMR_TEST_LAYOUT_FILTER).test(name);
  page.on('pageerror', error => errors.push(error.stack ?? error.message));
  page.on('console', message => {
    if (/Minified React error|Maximum update depth|LiMR plugin:/.test(message.text())) errors.push(message.text());
  });
  if (process.env.LIMR_TEST_WIDTH) await page.setViewportSize({
    width: Number(process.env.LIMR_TEST_WIDTH), height: Number(process.env.LIMR_TEST_HEIGHT ?? 1080),
  });
  await host('writeFiles', { files: {
    'layout-before-small.svg': svg(48), 'layout-before-tall.svg': svg(208),
    'layout-inside-small.svg': svg(48), 'layout-inside-tall.svg': svg(208),
    'layout-after-tall.svg': svg(208),
  } });
  await host('configure', { values: {
    syncScroll: false, tocMode: 'hidden', sidebarMode: 'hidden', typography: 'knuth-plass', 'plugins.enabled': false,
    ...JSON.parse(process.env.LIMR_TEST_READER_SETTINGS ?? '{}'),
  } });
  await host('configureEditor', { values: { wordWrap: 'off', smoothScrolling: false } });
  await host('layout', { sourceSize: .5 });
  await host('replaceSource', { source });
  await expect(frame.locator('.lv-app')).toHaveAttribute('data-reader-ready', 'true', { timeout: 90_000 });
  await expect(frame.locator('[data-limr-windowed]')).toHaveCount(1);
  const line = source.slice(0, source.indexOf(marker)).split('\n').length - 1;
  await host('configure', { values: { syncScroll: true } });
  await host('activateSource');
  await host('scrollSource', { line });
  await expect(frame.locator('blockquote').filter({ hasText: marker })).toHaveCount(1, { timeout: 30_000 });
  await host('configure', { values: { syncScroll: false } });
  await frame.evaluate(() => document.fonts.ready);
  await frame.evaluate(async () => {
    for (const image of document.querySelectorAll('img[alt="Before the reading block"], img[alt="Inside the reading block"], img[alt="After the reading glyph"]')) {
      image.loading = 'eager'; await image.decode();
    }
  });
  await delay(500);

  await frame.evaluate(({ marker }) => {
    const root = document.querySelector('.lv-scroll');
    let active = false, frameId = 0, generation = 0, probe, paintObserver, journal, range, quote, windowElement;
    const findRange = () => {
      if (range?.startContainer.isConnected && range.getBoundingClientRect().height
        && !range.startContainer.parentElement.closest('[inert],[data-window-parked],[hidden]')) return range;
      quote = [...root.querySelectorAll('blockquote')].find(element => element.textContent.includes(marker) && !element.closest('[inert],[data-window-parked]'));
      if (!quote) return null;
      const walker = document.createTreeWalker(quote, NodeFilter.SHOW_TEXT);
      while (walker.nextNode()) {
        const index = walker.currentNode.data.indexOf(marker);
        if (index < 0) continue;
        const candidate = document.createRange(); candidate.setStart(walker.currentNode, index); candidate.setEnd(walker.currentNode, index + 1);
        if (!candidate.getBoundingClientRect().height || walker.currentNode.parentElement.closest('[hidden],[inert]')) continue;
        range = candidate; return range;
      }
      return null;
    };
    const visibleLoading = () => [...document.querySelectorAll(
      '[role="status"],[role="progressbar"],[role="dialog"],.lv-loading,.lv-load-progress,.limr-print-progress,.limr-block-loading,.limr-mermaid-loading,.limr-loading'
    )].flatMap(element => {
      const style = getComputedStyle(element), rect = element.getBoundingClientRect();
      if (!rect.width || !rect.height || style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0
        || element.closest('[hidden],[aria-hidden="true"],.limr-sr-only')) return [];
      const label = `${element.getAttribute('aria-label') ?? ''} ${element.textContent ?? ''}`.trim();
      if (element.getAttribute('role') !== 'dialog' && !element.matches('.lv-loading,.lv-load-progress,.limr-print-progress,.limr-block-loading,.limr-mermaid-loading,.limr-loading,[role="progressbar"]')
        && !/load|加载|准备|processing|处理中/i.test(label)) return [];
      return [{ role: element.getAttribute('role'), className: element.className, label: label.slice(0, 240), width: rect.width, height: rect.height }];
    });
    const sample = () => {
      if (!active) return;
      const anchor = findRange(), rect = anchor?.getBoundingClientRect(), viewport = root.getBoundingClientRect();
      journal.frames.push({ time: performance.now(), top: root.scrollTop, glyphTop: rect?.height ? rect.top - viewport.top : null,
        blockTop: quote?.isConnected ? quote.getBoundingClientRect().top - viewport.top : null,
        blockHeight: quote?.isConnected ? quote.getBoundingClientRect().height : null,
        translation: root.querySelector('[data-window-slot]')?.parentElement.style.translate,
        wheelTotal: journal.wheels.reduce((sum, wheel) => sum + wheel.delta, 0),
        sameWindow: windowElement === root.querySelector('[data-limr-windowed]'),
        ready: root.closest('.lv-app')?.dataset.readerReady, loading: visibleLoading(),
      });
    };
    root.addEventListener('wheel', event => {
      if (active) journal.wheels.push({ time: performance.now(), delta: event.deltaY, deltaMode: event.deltaMode });
    }, { passive: true });
    window.addEventListener('message', event => {
      if (active && ['state', 'reveal', 'configuration'].includes(event.data?.type)) journal.messages.push({ time: performance.now(), type: event.data.type });
    });
    window.__layoutAnchor = {
      prepareSameHeight() {
        findRange();
        const before = root.querySelector('img[alt="Inside the reading block"]');
        const after = root.querySelector('img[alt="After the reading glyph"]');
        if (!before || !after || !quote?.contains(before) || !quote.contains(after)) throw new Error('Both decoded image surfaces must belong to the reading block.');
        // Explicit media dimensions model an asynchronous renderer receiving
        // new media metadata. Fix width so only the intended vertical layout
        // changes; the viewport and block container remain unconstrained.
        Object.assign(before.style, { width: '320px', height: '48px' });
        Object.assign(after.style, { width: '320px', height: '208px' });
      },
      align() {
        const anchor = findRange();
        if (!anchor) throw new Error('The reading glyph is not mounted.');
        root.scrollTop += anchor.getBoundingClientRect().top - root.getBoundingClientRect().top - 18;
      },
      start() {
        journal = { frames: [], wheels: [], changes: [], messages: [] };
        windowElement = root.querySelector('[data-limr-windowed]'); active = true;
        const currentGeneration = ++generation;
        // A timer following RAF is not an after-paint signal: an image may
        // decode before that timer and invalidate layout, while its product
        // ResizeObserver is not delivered until the next rendering step.
        // Observe an independent fixed surface after the product observers.
        // Its delivery samples this render cycle after their before-paint
        // compensation, without changing document/viewport geometry.
        probe = document.createElement('div');
        probe.setAttribute('aria-hidden', 'true'); probe.dataset.limrIgnore = 'true';
        Object.assign(probe.style, { position: 'fixed', left: '0', top: '0', width: '1px', height: '1px',
          opacity: '0', pointerEvents: 'none', contain: 'strict', overflow: 'hidden' });
        document.body.append(probe);
        paintObserver = new ResizeObserver(() => queueMicrotask(() => {
          if (active && currentGeneration === generation) sample();
        }));
        paintObserver.observe(probe);
        let height = 1;
        const tick = () => {
          if (!active || currentGeneration !== generation) return;
          height = height === 1 ? 2 : 1; probe.style.height = `${height}px`;
          frameId = requestAnimationFrame(tick);
        };
        frameId = requestAnimationFrame(tick);
      },
      async resize(kind, tall) {
        const image = root.querySelector(`img[alt="${kind === 'inside' ? 'Inside' : 'Before'} the reading block"]`);
        if (!image) throw new Error(`${kind} image is no longer mounted.`);
        const anchor = findRange();
        const imageBlock = image.closest('[data-window-slot]'), textBlock = anchor?.startContainer.parentElement.closest('[data-window-slot]');
        if ((kind === 'inside') !== (imageBlock === textBlock)) throw new Error('The fixture does not exercise the intended block relationship.');
        const before = image.getBoundingClientRect().height;
        // A changed decoded image aspect ratio is the same layout trigger as
        // delayed image/media content; no root/viewport dimension is modified.
        const url = new URL(image.currentSrc || image.src);
        url.pathname = url.pathname.replace(/layout-(inside|before)-(small|tall)\.svg$/, `layout-${kind}-${tall ? 'tall' : 'small'}.svg`);
        if (url.href === image.src) throw new Error('Image stimulus did not change its source.');
        image.src = url.href;
        await image.decode();
        const after = image.getBoundingClientRect().height;
        journal.changes.push({ time: performance.now(), kind, tall, before, after, naturalHeight: image.naturalHeight });
      },
      async reflow(tall) {
        await new Promise(resolve => requestAnimationFrame(() => {
          const beforeImage = root.querySelector('img[alt="Inside the reading block"]');
          const afterImage = root.querySelector('img[alt="After the reading glyph"]');
          const anchor = findRange();
          const blockBefore = quote.getBoundingClientRect().height;
          const glyphBefore = anchor.getBoundingClientRect().top;
          const before = beforeImage.getBoundingClientRect().height;
          const lowerBefore = afterImage.getBoundingClientRect().height;
          // Commit both asynchronous media size changes in one render step.
          // Total block height is unchanged, so observing only the block's
          // ResizeObserver cannot detect the moved reading glyph.
          beforeImage.style.height = tall ? '208px' : '48px';
          afterImage.style.height = tall ? '48px' : '208px';
          const after = beforeImage.getBoundingClientRect().height;
          const lowerAfter = afterImage.getBoundingClientRect().height;
          journal.changes.push({ time: performance.now(), kind: 'same-height', tall, before, after, lowerBefore, lowerAfter,
            blockBefore, blockAfter: quote.getBoundingClientRect().height,
            rawGlyphMovement: anchor.getBoundingClientRect().top - glyphBefore });
          resolve();
        }));
      },
      stop() {
        active = false; generation++; cancelAnimationFrame(frameId);
        paintObserver?.disconnect(); paintObserver = undefined;
        probe?.remove(); probe = undefined;
        return journal;
      },
    };
  }, { marker });

  const root = frame.locator('.lv-scroll');
  for (const kind of ['inside', 'before', 'same-height']) for (const wheel of [false, true]) {
    const name = `${kind}-${wheel ? 'wheel' : 'stationary'}`;
    if (!include(name)) continue;
    if (kind === 'same-height') { await frame.evaluate(() => window.__layoutAnchor.prepareSameHeight()); await delay(250); }
    // A real gesture retires the source seek before direct test positioning.
    await root.click({ position: { x: 8, y: 160 } });
    await frame.evaluate(() => window.__layoutAnchor.align()); await delay(250);
    await frame.evaluate(() => window.__layoutAnchor.align()); await delay(250);
    await root.hover({ position: { x: 8, y: 240 } });
    await frame.evaluate(() => window.__layoutAnchor.start());
    await delay(80);
    for (let step = 0; step < 24; step++) {
      if (step === 5 || step === 15) await frame.evaluate(({ kind, tall }) => kind === 'same-height'
        ? window.__layoutAnchor.reflow(tall) : window.__layoutAnchor.resize(kind, tall), { kind, tall: step === 5 });
      if (wheel) await page.mouse.wheel(0, 4);
      await delay(32);
    }
    await delay(400);
    const journal = await frame.evaluate(() => window.__layoutAnchor.stop());
    const first = journal.frames[0], last = journal.frames.at(-1);
    const missing = journal.frames.filter(sample => sample.glyphTop === null);
    const residuals = journal.frames.filter(sample => sample.glyphTop !== null)
      .map(sample => sample.glyphTop - first.glyphTop + sample.wheelTotal);
    const result = { name, frames: journal.frames.length, first, last, missingAnchors: missing.length,
      maxReadingDisplacement: Math.max(...residuals.map(Math.abs)),
      finalReadingDisplacement: last.glyphTop === null ? null : last.glyphTop - first.glyphTop + last.wheelTotal,
      loadingFrames: journal.frames.filter(sample => sample.loading.length || sample.ready !== 'true').length,
      replacedWindowFrames: journal.frames.filter(sample => !sample.sameWindow).length,
      sourceDeliveries: journal.messages.filter(message => message.type === 'state').length,
      blockHeightVariation: Math.max(...journal.frames.map(sample => sample.blockHeight)) - Math.min(...journal.frames.map(sample => sample.blockHeight)),
      changes: journal.changes, errors: [...errors] };
    evidence.push(result);
    await writeFile(path.join(artifacts, `${name}.json`), JSON.stringify({ result, journal }, null, 2));
    await writeFile(path.join(artifacts, 'checks.json'), JSON.stringify(evidence, null, 2));
    console.log(JSON.stringify(result));
  }
  expect((await host('snapshot')).source).toBe(source);
  expect(evidence.length, 'the layout filter must select at least one regression').toBeGreaterThan(0);
  if (!process.env.LIMR_TEST_OBSERVE_ONLY) {
    expect(errors).toEqual([]);
    for (const result of evidence) {
      expect(result.frames, `${result.name}: sample actual rendered frames`).toBeGreaterThan(10);
      if (result.name.startsWith('same-height')) {
        expect(result.changes.map(change => change.after)).toEqual([208, 48]);
        expect(result.changes.map(change => change.lowerAfter)).toEqual([48, 208]);
        for (const change of result.changes) {
          expect(Math.abs(change.blockAfter - change.blockBefore), 'the asynchronous layout change must preserve total block height').toBeLessThan(1);
          expect(Math.abs(change.rawGlyphMovement), 'the unchanged-height stimulus must really move the reading glyph before compensation').toBeGreaterThan(100);
        }
        expect(result.blockHeightVariation, 'total block height stays unchanged throughout the rendered frames').toBeLessThan(1);
      } else expect(result.changes.map(change => change.naturalHeight)).toEqual([208, 48]);
      expect(result.changes[0].after - result.changes[0].before, 'the decoded image must really enlarge').toBeGreaterThan(100);
      expect(result.changes[1].before - result.changes[1].after, 'the decoded image must really shrink').toBeGreaterThan(100);
      expect(result.missingAnchors, `${result.name}: never silently ignore a missing glyph`).toBe(0);
      expect(result.loadingFrames, `${result.name}: layout changes must not show any loading surface`).toBe(0);
      expect(result.replacedWindowFrames, `${result.name}: preserve the virtual reader instance`).toBe(0);
      expect(result.sourceDeliveries, `${result.name}: no source reload`).toBe(0);
      // A wheel event can be sampled one compositor frame before its native
      // scroll. Allow two 4px wheel increments, never the 160px layout change.
      expect(result.maxReadingDisplacement, `${result.name}: preserve the reading glyph through asynchronous layout`).toBeLessThanOrEqual(result.name.endsWith('wheel') ? 10 : 2);
      expect(Math.abs(result.finalReadingDisplacement), `${result.name}: preserve the final glyph position`).toBeLessThanOrEqual(2);
      if (result.name.endsWith('wheel')) expect(result.last.wheelTotal).toBe(96);
    }
  }
  return evidence;
}
