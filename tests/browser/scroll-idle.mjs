import { expect } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { webviewPointerExit } from './input.mjs';

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

// A long continuous gesture can keep replacing the anchor and conceal an idle
// feedback loop. Exercise isolated native gestures, including the wrapped
// translator's-preface position reported in CMOS.limr.md.
export async function runScrollIdleAcceptance({ browser, page, frame, host, artifacts }) {
  const file = process.env.LIMR_TEST_LARGE_DOCUMENT;
  if (!file) throw new Error('LIMR_TEST_LARGE_DOCUMENT is required for the idle scrolling regression.');
  const source = await readFile(file, 'utf8');
  const evidence = [], errors = [];
  const include = name => !process.env.LIMR_TEST_IDLE_FILTER || new RegExp(process.env.LIMR_TEST_IDLE_FILTER).test(name);
  const idleMs = Number(process.env.LIMR_TEST_IDLE_MS ?? 4000);
  page.on('pageerror', error => errors.push(error.stack ?? error.message));
  page.on('console', message => {
    if (/Minified React error|Maximum update depth|LiMR plugin:/.test(message.text())) errors.push(message.text());
  });
  if (process.env.LIMR_TEST_WIDTH) await page.setViewportSize({ width: Number(process.env.LIMR_TEST_WIDTH), height: Number(process.env.LIMR_TEST_HEIGHT ?? 1020) });
  if (process.env.LIMR_TEST_DEVICE_SCALE) {
    const metrics = await page.context().newCDPSession(page);
    await metrics.send('Emulation.setDeviceMetricsOverride', {
      width: Number(process.env.LIMR_TEST_WIDTH ?? 1500), height: Number(process.env.LIMR_TEST_HEIGHT ?? 1020),
      deviceScaleFactor: Number(process.env.LIMR_TEST_DEVICE_SCALE), mobile: false,
    });
  }
  const passive = process.env.LIMR_TEST_IDLE_PASSIVE === '1';
  const rendering = { passive, gpuRequested: process.env.LIMR_TEST_GPU === '1',
    pageDevicePixelRatio: await page.evaluate(() => devicePixelRatio), frameDevicePixelRatio: await frame.evaluate(() => devicePixelRatio) };
  const system = await browser.newBrowserCDPSession();
  try {
    const { gpu } = await system.send('SystemInfo.getInfo');
    rendering.gpuFeatureStatus = gpu.featureStatus;
    rendering.gpuDevices = gpu.devices.map(({ vendorString, deviceString }) => ({ vendorString, deviceString }));
  } catch (error) { rendering.gpuInspectionError = String(error); }
  await system.detach();

  // Install before configuration/source replacement: keep the complete initial
  // seek and settling history, rather than beginning after the failure ends.
  await frame.evaluate(({ source, passive }) => {
    let journal, phase = 'setup', active = true, fixedAnchor, sourceOffset;
    let nextWindow = 0, frameId;
    const windows = new WeakMap(), instrumented = new WeakSet();
    const reset = () => { journal = { frames: [], commands: [], messages: [], wheels: [], phases: [] }; fixedAnchor = undefined; };
    reset();
    const rootNow = () => document.querySelector('.lv-scroll');
    const blocks = root => [...root.querySelectorAll('[data-window-slot]:not([data-window-parked]) > [data-source-start]')];
    const text = block => {
      const leaves = []; let joined = '';
      const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
      for (let node; (node = walker.nextNode());) {
        if (!node.textContent || node.parentElement.closest('.katex-mathml,[hidden]')
          || !node.parentElement.checkVisibility({ visibilityProperty: true, opacityProperty: true })) continue;
        leaves.push({ node, start: joined.length }); joined += node.textContent;
      }
      return { leaves, joined };
    };
    const glyph = (leaves, index) => {
      const leaf = leaves.findLast(value => value.start <= index);
      if (!leaf || index - leaf.start >= leaf.node.length) return null;
      const range = document.createRange();
      range.setStart(leaf.node, index - leaf.start); range.setEnd(leaf.node, index - leaf.start + 1);
      const rect = range.getBoundingClientRect();
      return rect.height && rect.width ? rect : null;
    };
    const locate = (root, anchor) => {
      if (!anchor) return null;
      const block = blocks(root).find(el => Number(el.dataset.sourceStart) === anchor.blockSource);
      if (!block) return null;
      const { leaves, joined } = text(block);
      // Re-find the same textual glyph after typography replaces text nodes.
      // Matching the surrounding text avoids treating a collapsed live Range
      // or an unrelated first glyph as movement of the retained reading edge.
      let index = joined.indexOf(anchor.needle);
      if (index < 0) return null;
      if (joined.indexOf(anchor.needle, index + 1) !== -1 && joined.slice(anchor.index, anchor.index + anchor.needle.length) === anchor.needle) index = anchor.index;
      const rect = glyph(leaves, index + anchor.within);
      return rect ? { top: rect.top - root.getBoundingClientRect().top, blockTop: block.getBoundingClientRect().top - root.getBoundingClientRect().top } : null;
    };
    const sourceAnchor = root => {
      if (sourceOffset === undefined) return null;
      const block = blocks(root).find(el => Number(el.dataset.sourceStart) <= sourceOffset && Number(el.dataset.sourceEnd) > sourceOffset);
      if (!block) return null;
      const needle = source.slice(sourceOffset, sourceOffset + 16);
      if (!/^[\p{L}\p{N}\s，。；、,.()（）]{5,16}$/u.test(needle)) return null;
      const { joined } = text(block), index = joined.indexOf(needle);
      if (index < 0 || joined.indexOf(needle, index + 1) !== -1) return null;
      return { blockSource: Number(block.dataset.sourceStart), needle, index, within: 0 };
    };
    const readingAnchor = root => {
      const edge = root.getBoundingClientRect().top + 18;
      for (const block of blocks(root)) {
        if (block.getBoundingClientRect().bottom <= edge) continue;
        const { leaves, joined } = text(block);
        for (const leaf of leaves) {
          if (!leaf.node.textContent.trim()) continue;
          const whole = document.createRange(); whole.selectNodeContents(leaf.node);
          if (whole.getBoundingClientRect().bottom <= edge) continue;
          let low = 0, high = leaf.node.length;
          while (low < high) {
            const mid = (low + high) >>> 1, rect = glyph(leaves, leaf.start + mid);
            if (!rect || rect.bottom <= edge) low = mid + 1;
            else high = mid;
          }
          if (low >= leaf.node.length) continue;
          const at = leaf.start + low, index = Math.max(0, at - 12);
          return { blockSource: Number(block.dataset.sourceStart), needle: joined.slice(index, at + 20), index, within: at - index };
        }
      }
      return null;
    };
    const attach = root => {
      if (instrumented.has(root)) return;
      instrumented.add(root);
      const scrollTo = root.scrollTo.bind(root);
      root.scrollTo = (...args) => {
        const before = root.scrollTop; scrollTo(...args);
        if (active) journal.commands.push({ time: performance.now(), phase, before, after: root.scrollTop, args,
          stack: new Error().stack?.split('\n').slice(2, 8).join('\n') });
      };
      root.addEventListener('wheel', event => {
        if (active) journal.wheels.push({ time: performance.now(), phase, delta: event.deltaY, top: root.scrollTop });
      }, { passive: true });
    };
    const sample = () => {
      const root = rootNow(); if (!active || !root) return;
      attach(root);
      const viewport = root.getBoundingClientRect(), win = root.querySelector('[data-limr-windowed]');
      if (win && !windows.has(win)) windows.set(win, ++nextWindow);
      const mounted = blocks(root).map(el => {
        const rect = el.getBoundingClientRect();
        return { source: Number(el.dataset.sourceStart), end: Number(el.dataset.sourceEnd), top: rect.top - viewport.top,
          height: rect.height, text: el.textContent.slice(0, 60) };
      });
      const visible = mounted.filter(item => item.top + item.height > 18 && item.top < root.clientHeight);
      const targetBlock = mounted.find(item => item.source <= sourceOffset && item.end > sourceOffset)
        ?? mounted.find(item => item.source >= sourceOffset && !source.slice(sourceOffset, item.source).trim());
      const targetAnchor = sourceAnchor(root), targetGlyph = locate(root, targetAnchor);
      journal.frames.push({ time: performance.now(), phase, top: root.scrollTop, height: root.scrollHeight, viewportHeight: root.clientHeight,
        window: windows.get(win), start: win?.dataset.windowStart, ready: root.closest('.lv-app')?.dataset.readerReady,
        translation: root.querySelector('[data-window-slot]')?.parentElement.style.translate,
        visible, target: { source: sourceOffset, block: targetBlock, glyphTop: targetGlyph?.top },
        fixed: fixedAnchor ? { anchor: fixedAnchor, position: locate(root, fixedAnchor) } : null,
        overlays: [...document.querySelectorAll('.lv-loading,.lv-load-error,.limr-document-loading,.limr-print-progress')]
          .filter(el => el.getBoundingClientRect().height > 0).map(el => ({ className: el.className, text: el.textContent.slice(0, 100) })) });
    };
    window.addEventListener('message', event => {
      const message = event.data;
      if (message?.type === 'reveal') sourceOffset = message.offset;
      if (active && ['state', 'configuration', 'reveal', 'scrollIntent'].includes(message?.type)) {
        journal.messages.push({ time: performance.now(), phase, type: message.type, offset: message.offset, generation: message.generation });
      }
    });
    // Sample after the product's ResizeObservers, in the same before-paint
    // rendering cycle. A RAF-following timer can see an unpainted image reflow.
    const probe = document.createElement('div');
    probe.setAttribute('aria-hidden', 'true'); probe.dataset.limrIgnore = 'true';
    Object.assign(probe.style, { position: 'fixed', top: '0', left: '0', width: '1px', height: '1px', opacity: '0',
      pointerEvents: 'none', contain: 'strict', overflow: 'hidden' });
    if (!passive) document.body.append(probe);
    let observer;
    const observePaint = () => {
      if (passive) return;
      observer?.disconnect();
      observer = new ResizeObserver(() => queueMicrotask(sample)); observer.observe(probe);
    };
    observePaint();
    let height = 1;
    const tick = () => { if (!active) return; height = height === 1 ? 2 : 1; probe.style.height = `${height}px`; frameId = requestAnimationFrame(tick); };
    if (!passive) frameId = requestAnimationFrame(tick);
    sample();
    window.__idleScroll = {
      sample,
      take() { const result = journal; reset(); phase = 'between-cases'; return result; },
      phase(name, owner) {
        // A seek/configuration can install a new reader observer. Register our
        // probe after it before evaluating the ensuing gesture/idle interval.
        observePaint();
        phase = name; fixedAnchor = /^(gesture|idle)-/.test(name)
          ? (owner === 'source' && sourceAnchor(rootNow())) || readingAnchor(rootNow()) : undefined;
        journal.phases.push({ time: performance.now(), name, anchor: fixedAnchor }); sample();
      },
      stop() { active = false; cancelAnimationFrame(frameId); observer?.disconnect(); probe.remove(); return journal; },
    };
  }, { source, passive });

  const settings = { syncScroll: true, typography: 'knuth-plass', theme: 'one-dark-pro', tocMode: 'wide', sidebarMode: 'hidden',
    'plugins.enabled': false, 'images.pathMode': 'folder', 'images.baseFolder': path.dirname(file),
    ...JSON.parse(process.env.LIMR_TEST_READER_SETTINGS ?? '{}') };
  const editorSettings = { wordWrap: 'on', smoothScrolling: false, 'stickyScroll.enabled': true,
    ...JSON.parse(process.env.LIMR_TEST_EDITOR_SETTINGS ?? '{}') };
  await host('configure', { values: settings });
  await host('configureEditor', { values: editorSettings });
  await host('layout', { sourceSize: .5 });
  await host('replaceSource', { source });
  await expect(frame.locator('.limr-reader h1').first()).toContainText(source.split('\n')[0].replace(/^#+\s*/, ''), { timeout: 90_000 });
  await expect(frame.locator('.lv-app')).toHaveAttribute('data-reader-ready', 'true', { timeout: 90_000 });
  await frame.evaluate(() => document.fonts.ready);
  await writeFile(path.join(artifacts, 'setup.json'), JSON.stringify({ settings, editorSettings, rendering, journal: await frame.evaluate(() => window.__idleScroll.take()) }, null, 2));
  const root = frame.locator('.lv-scroll');
  const editor = page.locator('.editor-group-container').first().locator('.monaco-editor').first();
  const compactHost = async () => {
    const state = await host('scrollSourceStatus');
    return { time: Date.now(), visibleRanges: state.visibleRanges, activeEditor: state.activeEditor, version: state.version, events: state.events.slice(-30) };
  };
  for (const [name, line, owner, syncScroll, character = 0, via] of [
    ['source-preface', 233, 'source', true],
    ['reader-preface', 233, 'reader', true],
    ['source-preface-wrapped', 236, 'source', true, 240],
    ['reader-preface-wrapped', 238, 'reader', true, 90],
    ['source-middle', 11630, 'source', true],
    ['reader-middle', 11630, 'reader', true],
    ['reader-independent-middle', 11630, 'reader', false],
    ['reader-return-preface', 236, 'reader', true, 240, 11630],
    ['source-return-preface', 238, 'source', true, 90, 11630],
  ]) {
    if (!include(name)) continue;
    const hostSamples = [];
    await frame.evaluate(() => window.__idleScroll.phase('seek'));
    await webviewPointerExit(page, frame);
    await host('configure', { values: { syncScroll: true } });
    await host('activateSource');
    if (via !== undefined) { await host('scrollSource', { line: via }); await delay(80); }
    await host('scrollSource', { line, character });
    hostSamples.push({ phase: 'seek-start', ...await compactHost() });
    await delay(Number(process.env.LIMR_TEST_IDLE_SEEK_MS ?? 1800));
    hostSamples.push({ phase: 'seek-end', ...await compactHost() });
    if (!syncScroll) await host('configure', { values: { syncScroll } });
    for (const [step, delta] of [[1, 120], [2, -80]]) {
      await frame.evaluate(({ step, owner }) => window.__idleScroll.phase(`gesture-${step}`, owner), { step, owner });
      if (owner === 'source') { await webviewPointerExit(page, frame); await editor.hover({ position: { x: 180, y: 240 } }); }
      else await root.hover({ position: { x: 240, y: 240 } });
      await page.mouse.wheel(0, delta);
      // Keep this settling interval in the trace as part of the gesture; it
      // only excludes the browser's native wheel delivery from idle assertions.
      await delay(250);
      await frame.evaluate(() => window.__idleScroll.sample());
      await frame.evaluate(({ step, owner }) => window.__idleScroll.phase(`idle-${step}`, owner), { step, owner });
      const started = Date.now();
      do {
        hostSamples.push({ phase: `idle-${step}`, ...await compactHost() });
        await delay(500);
      } while (Date.now() - started < idleMs);
      await frame.evaluate(() => window.__idleScroll.sample());
    }
    const journal = await frame.evaluate(() => window.__idleScroll.take());
    const idleResults = journal.phases.filter(item => item.name.startsWith('idle-')).map(item => {
      const frames = journal.frames.filter(value => value.phase === item.name && value.time >= item.time);
      const measured = frames.filter(value => value.fixed?.position);
      const tops = measured.map(value => value.fixed.position.top);
      const sources = frames.map(value => value.visible[0]?.source).filter(value => value !== undefined);
      return { phase: item.name, frames: frames.length, anchor: item.anchor,
        missingFrames: frames.length - measured.length,
        glyphExcursion: tops.length ? Math.max(...tops) - Math.min(...tops) : null,
        firstGlyphTop: tops[0], finalGlyphTop: tops.at(-1),
        firstVisibleSource: sources[0], finalVisibleSource: sources.at(-1),
        commands: journal.commands.filter(value => value.phase === item.name).length,
        sourceVisibleRanges: hostSamples.filter(value => value.phase === item.name).map(value => value.visibleRanges) };
    });
    const last = journal.frames.at(-1), target = last?.target;
    const sourceAligned = owner !== 'source' || (target?.glyphTop !== undefined
      ? target.glyphTop >= -80 && target.glyphTop < last.viewportHeight
      : target?.block && target.block.top < last.viewportHeight && target.block.top + target.block.height > 0);
    const gestureResults = journal.phases.filter(item => item.name.startsWith('gesture-')).map(item => {
      const frames = journal.frames.filter(value => value.phase === item.name && value.time >= item.time);
      const measured = frames.filter(value => value.fixed?.position);
      return { phase: item.name, anchor: item.anchor, missingFrames: frames.length - measured.length,
        firstGlyphTop: measured[0]?.fixed.position.top, finalGlyphTop: measured.at(-1)?.fixed.position.top,
        firstVisibleSource: frames[0]?.visible[0]?.source, finalVisibleSource: frames.at(-1)?.visible[0]?.source };
    });
    const result = { name, line, character, via, owner, syncScroll, rendering, characters: source.length, gestureResults, idleResults, sourceAligned,
      overlays: journal.frames.filter(value => value.overlays.length).length,
      states: journal.messages.filter(value => value.type === 'state' && /^(gesture|idle)-/.test(value.phase)).length,
      setupStates: journal.messages.filter(value => value.type === 'state' && !/^(gesture|idle)-/.test(value.phase)).length,
      windows: new Set(journal.frames.map(value => value.window).filter(Boolean)).size, errors: [...errors] };
    evidence.push(result);
    await writeFile(path.join(artifacts, `${name}.json`), JSON.stringify({ result, hostSamples, journal }, null, 2));
    await writeFile(path.join(artifacts, 'checks.json'), JSON.stringify(evidence, null, 2));
    console.log(JSON.stringify(result));
  }
  await frame.evaluate(() => window.__idleScroll.stop());
  expect((await host('snapshot')).source).toBe(source);
  expect(evidence.length).toBeGreaterThan(0);
  expect(errors).toEqual([]);
  if (!process.env.LIMR_TEST_OBSERVE_ONLY) for (const item of evidence) {
    expect(item.overlays, `${item.name}: no central loading panel while scrolling`).toBe(0);
    expect(item.states, `${item.name}: scrolling does not resend the document`).toBe(0);
    expect(item.windows, `${item.name}: the windowed reader stays mounted`).toBe(1);
    expect(item.sourceAligned, `${item.name}: editor's source target remains inside the reader viewport`).toBeTruthy();
    for (const idle of item.idleResults) {
      expect(idle.frames, `${item.name}/${idle.phase}: idle observation includes both ends`).toBeGreaterThan(passive ? 1 : 20);
      expect(idle.anchor, `${item.name}/${idle.phase}: capture a concrete text anchor`).toBeTruthy();
      expect(idle.missingFrames, `${item.name}/${idle.phase}: idle does not scroll away from the anchor`).toBe(0);
      expect(idle.glyphExcursion, `${item.name}/${idle.phase}: no self scrolling while input is idle`).toBeLessThanOrEqual(3);
    }
  }
  return evidence;
}
