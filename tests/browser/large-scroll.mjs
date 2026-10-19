import { expect } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { webviewPointerExit } from './input.mjs';

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const paragraph = 'Long-document scrolling preserves the visible paragraph while newly mounted blocks replace their estimates. 双栏阅读连续滚动时，正文不应跳回前面的段落。';
const generated = '# Large scrolling\n\n' + Array.from({ length: 500 }, (_, i) => `## Section ${i + 1}\n\n${paragraph.repeat(8)}\n\n$$\n\\frac{a+b}{c} = \\sum_{i=1}^{n} x_i\n$$\n\n<figure src="./scroll-image.svg" alt="Figure ${i + 1}">\n\n<figcaption>\n\nCaption ${i + 1}. The closing tags must not return to the top of this figure.\n\n</figcaption>\n\n</figure>\n\n${paragraph.repeat(3)}\n\n`).join('');

export async function runLargeScrollAcceptance({ page, frame, host, artifacts }) {
  const external = process.env.LIMR_TEST_LARGE_DOCUMENT;
  const source = external ? await readFile(external, 'utf8') : generated;
  const evidence = [], errors = [];
  const readerSettings = JSON.parse(process.env.LIMR_TEST_READER_SETTINGS ?? '{}');
  const include = name => !process.env.LIMR_TEST_SCROLL_FILTER || new RegExp(process.env.LIMR_TEST_SCROLL_FILTER).test(name);
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => {
    if (/Minified React error|Maximum update depth|LiMR plugin:/.test(message.text())) {
      errors.push(message.text());
      void writeFile(path.join(artifacts, 'react-errors.json'), JSON.stringify(errors, null, 2));
    }
  });
  if (process.env.LIMR_TEST_WIDTH) await page.setViewportSize({ width: Number(process.env.LIMR_TEST_WIDTH), height: Number(process.env.LIMR_TEST_HEIGHT ?? 1080) });
  if (!external) await host('writeFiles', { files: { 'scroll-image.svg': '<svg xmlns="http://www.w3.org/2000/svg" width="480" height="180"><rect width="480" height="180" fill="#607456"/></svg>' } });
  await host('configure', { values: { syncScroll: false, tocMode: 'hidden', sidebarMode: 'content', typography: 'standard', 'plugins.enabled': false,
    ...(external ? { 'images.pathMode': 'folder', 'images.baseFolder': path.dirname(external) } : {}), ...readerSettings } });
  await host('configureEditor', { values: { wordWrap: 'on', smoothScrolling: true, 'stickyScroll.enabled': true,
    ...JSON.parse(process.env.LIMR_TEST_EDITOR_SETTINGS ?? '{}') } });
  await host('layout', { sourceSize: .5 });
  await host('replaceSource', { source });
  await expect(frame.locator('.limr-reader h1').first()).toContainText(source.split('\n')[0].replace(/^#+\s*/, ''), { timeout: 90_000 });
  await expect(frame.locator('.lv-app')).toHaveAttribute('data-reader-ready', 'true', { timeout: 90_000 });
  await expect(frame.locator('[data-limr-windowed]')).toHaveCount(1);
  await frame.evaluate(() => document.fonts.ready);
  await frame.evaluate(({ source }) => {
    const root = document.querySelector('.lv-scroll');
    const windows = new WeakMap(); let nextWindow = 0;
    let journal, active = false, textAnchor, sourceOffset, sourceAnchor;
    const sourceGlyph = offset => {
      if (offset === undefined) return null;
      const blocks = [...root.querySelectorAll('[data-window-slot]:not([data-window-parked]) > [data-source-start]')];
      const block = blocks.find(el => Number(el.dataset.sourceStart) <= offset && Number(el.dataset.sourceEnd) > offset);
      if (!block) return null;
      const snippet = source.slice(offset, offset + 8);
      // Source scrolling explicitly owns this target. If it is plain prose,
      // locate its actual glyph across the typography engine's split spans.
      // A different formula on that line can wrap without moving this target.
      if (!/^[\p{L}\p{N}\s，。；、,.()（）]{5,8}$/u.test(snippet)) return null;
      const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT), leaves = [];
      let joined = '';
      for (let node; (node = walker.nextNode());) {
        if (node.parentElement.closest('.katex-mathml,[hidden]') || !node.parentElement.checkVisibility({ visibilityProperty: true, opacityProperty: true })) continue;
        leaves.push({ node, start: joined.length }); joined += node.textContent;
      }
      const index = joined.indexOf(snippet);
      if (index < 0 || joined.indexOf(snippet, index + 1) !== -1) return null;
      const leaf = leaves.findLast(leaf => leaf.start <= index);
      const range = document.createRange(); range.setStart(leaf.node, index - leaf.start); range.setEnd(leaf.node, index - leaf.start + 1);
      const rect = range.getBoundingClientRect();
      return rect.height && rect.width ? rect.top - root.getBoundingClientRect().top : null;
    };
    window.__largeScrollStart = () => { journal = { frames: [], commands: [], messages: [], wheels: [] }; active = true; };
    window.__largeScrollStop = () => { active = false; return journal; };
    const scrollTo = root.scrollTo.bind(root);
    root.scrollTo = (...args) => {
      const before = root.scrollTop; scrollTo(...args);
      if (active) journal.commands.push({ time: performance.now(), before, after: root.scrollTop, args, stack: new Error().stack?.split('\n').slice(2, 6).join('\n') });
    };
    window.addEventListener('message', event => {
      const m = event.data;
      if (m?.type === 'reveal') sourceOffset = m.offset;
      if (active && ['state', 'configuration', 'reveal', 'scrollIntent'].includes(m?.type)) journal.messages.push({ time: performance.now(), type: m.type, offset: m.offset, generation: m.generation, version: m.state?.document?.version });
    });
    root.addEventListener('wheel', e => { if (active) journal.wheels.push({ time: performance.now(), delta: e.deltaY, top: root.scrollTop }); }, { passive: true });
    const sample = () => {
      if (active) {
        const bounds = root.getBoundingClientRect(), win = root.querySelector('[data-limr-windowed]');
        const previousSourceTop = sourceAnchor && sourceGlyph(sourceAnchor.source);
        const previousSource = previousSourceTop === null || previousSourceTop === undefined ? null : { source: sourceAnchor.source, top: previousSourceTop, previousTop: sourceAnchor.top };
        const currentSourceTop = sourceGlyph(sourceOffset);
        sourceAnchor = currentSourceTop === null ? null : { source: sourceOffset, top: currentSourceTop };
        if (win && !windows.has(win)) windows.set(win, ++nextWindow);
        const blocks = [...root.querySelectorAll('[data-window-slot]:not([data-window-parked]) > [data-source-start]')].map(el => {
          const rect = el.getBoundingClientRect(); return { source: Number(el.dataset.sourceStart), top: rect.top - bounds.top, height: rect.height };
        });
        // Retain the whole mounted window: losing an old visible anchor must
        // not silently turn a discontinuity into zero movement.
        const previousRect = textAnchor?.range.getBoundingClientRect();
        // React can replace a text node while a live Range remains connected
        // but collapses onto its parent. That empty rectangle is not a glyph
        // jumping to y=0; use the still-mounted source block for that frame.
        const previousText = previousRect?.height && previousRect.width && textAnchor.range.startContainer.nodeType === Node.TEXT_NODE
          && textAnchor.range.startContainer.isConnected && textAnchor.range.startContainer.textContent === textAnchor.text
          ? { top: previousRect.top - bounds.top, previousTop: textAnchor.top, text: textAnchor.text.slice(0, 100), parent: textAnchor.parent } : null;
        const firstBlock = [...root.querySelectorAll('[data-window-slot]:not([data-window-parked]) > [data-source-start]')].find(el => el.getBoundingClientRect().bottom > bounds.top + 18);
        textAnchor = null;
        if (firstBlock) {
          const walker = document.createTreeWalker(firstBlock, NodeFilter.SHOW_TEXT);
          for (let text; (text = walker.nextNode());) {
            if (!text.textContent.trim()) continue;
            if (text.parentElement.closest('.katex-mathml,[hidden]') || !text.parentElement.checkVisibility({ visibilityProperty: true, opacityProperty: true })) continue;
            const range = document.createRange(); range.selectNodeContents(text);
            if (range.getBoundingClientRect().bottom <= bounds.top + 18) continue;
            let low = 0, high = text.length;
            while (low < high) {
              const mid = (low + high) >>> 1;
              range.setStart(text, mid); range.setEnd(text, mid + 1);
              if (range.getBoundingClientRect().bottom <= bounds.top + 18) low = mid + 1;
              else high = mid;
            }
            if (low >= text.length) continue;
            range.setStart(text, low); range.setEnd(text, low + 1);
            const rect = range.getBoundingClientRect();
            if (!rect.height) continue;
            textAnchor = { range, top: rect.top - bounds.top, text: text.textContent, parent: text.parentElement.outerHTML.slice(0, 350) }; break;
          }
        }
        const overlays = [...document.querySelectorAll('.lv-loading,.lv-load-error,.limr-document-loading,.limr-print-progress')].filter(el => el.getBoundingClientRect().height > 0).map(el => ({ className: el.className, text: el.textContent.slice(0, 160) }));
        journal.frames.push({ time: performance.now(), top: root.scrollTop, height: root.scrollHeight, start: win?.dataset.windowStart, window: windows.get(win),
          ready: root.closest('.lv-app')?.dataset.readerReady, loading: !!root.querySelector('.lv-load-progress'),
          contentTranslation: win?.querySelector('[data-window-slot]')?.parentElement.style.translate,
          translation: root.querySelector('.limr-prose') && getComputedStyle(root.querySelector('.limr-prose')).translate, blocks, previousText, previousSource, overlays });
      }
      requestAnimationFrame(() => setTimeout(sample, 0));
    };
    requestAnimationFrame(() => setTimeout(sample, 0));
  }, { source });
  const root = frame.locator('.lv-scroll');
  const editor = page.locator('.editor-group-container').first().locator('.monaco-editor').first();
  const finish = async (name, direction = 1) => {
    await delay(450);
    const journal = await frame.evaluate(() => window.__largeScrollStop());
    const reversals = [];
    for (let i = 1; i < journal.frames.length; i++) {
      const current = journal.frames[i], previous = journal.frames[i - 1];
      // Track the reading edge, not every block below an expanding image.
      // Sample after the rendering step so before-paint compensation is not
      // mistaken for a visible frame. Native scrollTop may legitimately change
      // when measured heights replace estimates above the reading position.
      const anchor = previous.blocks.find(b => b.top + b.height > 18);
      const next = anchor && current.blocks.find(b => b.source === anchor.source);
      const glyph = name.startsWith('source-') && current.previousSource ? current.previousSource : current.previousText;
      const movement = glyph ? glyph.top - glyph.previousTop : next ? next.top - anchor.top : 0;
      if (movement * direction > 3) reversals.push({ frame: i, movement, before: previous.top, after: current.top });
      if (anchor && !next && current.blocks.length && (current.blocks.find(b => b.top + b.height > 18)?.source - anchor.source) * direction < 0) reversals.push({ frame: i, missingAnchor: anchor.source, before: previous.top, after: current.top });
    }
    const result = { name, direction, characters: source.length, frames: journal.frames.length, commands: journal.commands.length, windowInstances: new Set(journal.frames.map(f => f.window)).size,
      reveals: journal.messages.filter(m => m.type === 'reveal').length, states: journal.messages.filter(m => m.type === 'state').length,
      loadingFrames: journal.frames.filter(f => f.loading || f.ready !== 'true' || f.overlays.length).length,
      minimum: Math.min(...journal.frames.map(f => f.top)), maximum: Math.max(...journal.frames.map(f => f.top)), reversals };
    evidence.push(result);
    await writeFile(path.join(artifacts, `${name}.json`), JSON.stringify({ result, journal }, null, 2));
    await writeFile(path.join(artifacts, 'checks.json'), JSON.stringify(evidence, null, 2));
    console.log(JSON.stringify(result));
  };
  for (const syncScroll of process.env.LIMR_TEST_SCROLL_SOURCE_ONLY || process.env.LIMR_TEST_SCROLL_HANDOFF_ONLY ? [] : [false, true]) for (const [fraction, direction] of [[0, 1], [.45, 1], [.65, -1]]) {
    const name = `reader-${syncScroll ? 'sync' : 'independent'}-${fraction}`;
    if (!include(name)) continue;
    await host('configure', { values: { syncScroll: false } });
    await root.evaluate((el, fraction) => { el.scrollTop = (el.scrollHeight - el.clientHeight) * fraction; }, fraction);
    if (process.env.LIMR_TEST_SCROLL_READER_START_TOP) await root.evaluate((el, top) => { el.scrollTop = top; }, Number(process.env.LIMR_TEST_SCROLL_READER_START_TOP));
    await delay(500);
    await host('configure', { values: { syncScroll } });
    await root.hover({ position: { x: 240, y: 240 } });
    await frame.evaluate(() => window.__largeScrollStart());
    for (let i = 0; i < Number(process.env.LIMR_TEST_SCROLL_WHEELS ?? 80); i++) { await page.mouse.wheel(0, direction * Number(process.env.LIMR_TEST_SCROLL_DELTA ?? 100)); await delay(Number(process.env.LIMR_TEST_SCROLL_DELAY ?? 16)); }
    await finish(name, direction);
  }
  await webviewPointerExit(page, frame);
  await host('configure', { values: { syncScroll: true } });
  await host('activateSource');
  const middle = Math.floor(source.split('\n').length * .45);
  for (const [line, direction] of process.env.LIMR_TEST_SCROLL_HANDOFF_ONLY ? [] : [[Number(process.env.LIMR_TEST_SCROLL_SOURCE_START ?? 300), 1], [middle, 1], [middle, -1]]) {
    if (!include(`source-${line}-${direction}`)) continue;
    await host('scrollSource', { line });
    await delay(800);
    await editor.hover({ position: { x: 180, y: 240 } });
    await frame.evaluate(() => window.__largeScrollStart());
    for (let i = 0; i < 80; i++) { await page.mouse.wheel(0, direction * 100); await delay(16); }
    await finish(`source-${line}-${direction}`, direction);
  }
  if (!process.env.LIMR_TEST_SCROLL_SOURCE_ONLY) for (const x of [8, 240]) {
    if (!include(`handoff-${x}`)) continue;
    await webviewPointerExit(page, frame);
    await host('activateSource');
    const box = await root.boundingBox();
    await frame.evaluate(() => window.__largeScrollStart());
    await host('scrollSource', { line: Math.floor(source.split('\n').length * (x === 8 ? .65 : .75)) });
    await page.mouse.move(box.x + x, box.y + 240);
    for (let i = 0; i < 40; i++) { await page.mouse.wheel(0, 40); await delay(16); }
    await finish(`handoff-${x}`);
  }
  expect((await host('snapshot')).source).toBe(source);
  expect(evidence.length).toBeGreaterThan(0);
  expect(errors).toEqual([]);
  for (const item of evidence) {
    expect(item.loadingFrames, `${item.name}: no document reload`).toBe(0);
    expect(item.states, `${item.name}: no repeated source delivery`).toBe(0);
    expect(item.windowInstances, `${item.name}: preserve the reader DOM`).toBe(1);
    expect(item.reversals, `${item.name}: visible reading anchor must follow the gesture`).toEqual([]);
    expect(item.maximum - item.minimum, `${item.name}: continues moving during the gesture`).toBeGreaterThan(300);
    if (item.name.startsWith('source-')) {
      expect(item.reveals).toBeGreaterThan(5);
      if (item.name !== 'source-0-1') expect(item.minimum, 'source synchronization never resets to the book start').toBeGreaterThan(1000);
    }
  }
  return evidence;
}
