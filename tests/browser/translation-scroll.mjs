import { expect } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { webviewPointerExit } from './input.mjs';

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const text = 'Each translation is one scroll unit even when its visible language order differs from the Markdown source. ';
const paragraphs = (language, block) => Array.from({ length: 6 }, (_, index) => `${language} ${block}.${index + 1}: ${index === 1 && language === 'Original' ? '::%%limr%%{<#abc123}Annotated words::%%limr%%{>#abc123} ' : ''}${text.repeat(4)}`).join('\n\n');
const pair = (id, reversed) => {
  const origin = `<origin>\n\n${paragraphs('Original', id)}\n\n</origin>`;
  const translation = `<translation>\n\n${paragraphs('译文', id)}\n\n</translation>`;
  return `<translations id="${id}" default="both">\n\n${reversed ? `${translation}\n\n${origin}` : `${origin}\n\n${translation}`}\n\n</translations>`;
};
const body = '# Translation scroll order\n\n' + pair('reversed', true) + '\n\n' + pair('normal', false);
const source = body + '\n\n## After translations\n\n' + Array.from({ length: 16 }, (_, index) => `Tail ${index + 1}. ${text}`).join('\n\n') + '\n\n:::limr-annotation{#def456 ranges="abc123" type="highlight" color="#E5C07B"}\n:::\n';

export async function runTranslationScrollAcceptance({ page, frame, host, artifacts }) {
  const evidence = [], traces = [];
  await host('configure', { values: { syncScroll: false, tocMode: 'hidden', sidebarMode: 'hidden', translationMode: 'bilingual', 'plugins.enabled': false } });
  await host('configureEditor', { values: { smoothScrolling: false, wordWrap: 'on', 'stickyScroll.enabled': true } });
  await host('replaceSource', { source });
  await host('layout', { sourceSize: .5 });
  await expect(frame.locator('.limr-reader h1')).toHaveText('Translation scroll order');
  await expect(frame.locator('.limr-translations')).toHaveCount(2);
  await frame.evaluate(() => document.fonts.ready);
  await frame.evaluate(() => {
    const root = document.querySelector('.lv-scroll');
    const log = window.__translationScroll = { positions: [], reveals: [], commands: [] };
    root.addEventListener('scroll', () => log.positions.push({ time: Date.now(), top: root.scrollTop }), { passive: true });
    window.addEventListener('message', event => { if (event.data?.type === 'reveal') log.reveals.push({ time: Date.now(), offset: event.data.offset }); });
    const scrollTo = root.scrollTo.bind(root);
    root.scrollTo = (...args) => { log.commands.push({ time: Date.now(), args }); return scrollTo(...args); };
  });
  const mapping = await frame.evaluate(() => {
    const article = document.querySelector('.limr-reader-content > article');
    const blocks = [...article.children].filter(element => element.hasAttribute('data-source-start'));
    return [...document.querySelectorAll('.limr-translations')].map(element => {
      const outer = blocks.find(block => block.contains(element));
      const descendants = [...element.querySelectorAll('[data-source-start]')].filter(child => child.getBoundingClientRect().height > 0)
        .map(child => ({ start: Number(child.dataset.sourceStart), text: child.textContent.slice(0, 70) }));
      return { start: Number(outer.dataset.sourceStart), end: Number(outer.dataset.sourceEnd), directArticleChild: outer.parentElement === article,
        topLevelEntryCount: blocks.filter(block => block.contains(element) || element.contains(block)).length,
        nestedSourceOrderReverses: descendants.some((item, index) => index > 0 && item.start < descendants[index - 1].start), descendants };
    });
  });
  await writeFile(path.join(artifacts, 'translation-dom-map.json'), JSON.stringify(mapping, null, 2));
  expect(mapping.every(block => block.directArticleChild && block.topLevelEntryCount === 1 && block.end > block.start)).toBe(true);
  expect(mapping.some(block => block.nestedSourceOrderReverses)).toBe(true);
  expect(mapping[0].end).toBeLessThanOrEqual(mapping[1].start);
  const logSince = time => frame.evaluate(time => Object.fromEntries(Object.entries(window.__translationScroll).map(([key, values]) => [key, values.filter(item => item.time >= time)])), time);
  const root = frame.locator('.lv-scroll');
  const sourceEditor = page.locator('.editor-group-container').first().locator('.monaco-editor').first();
  for (const [mode, domMode] of [['bilingual', 'both'], ['original', 'origin'], ['translated', 'translation']]) {
    await host('configure', { values: { syncScroll: false, translationMode: mode } });
    await expect.poll(() => frame.locator('.limr-translations').evaluateAll(nodes => nodes.map(node => node.dataset.mode))).toEqual([domMode, domMode]);
    await webviewPointerExit(page, frame); await sourceEditor.hover({ position: { x: 15, y: 220 } });
    await root.evaluate(element => element.scrollTop = 0);
    await host('scrollSource', { line: 0 }); await delay(100);
    await host('configure', { values: { syncScroll: true } });
    const series = await host('scrollSourceSeries', { start: 2, step: 1, count: body.split('\n').length, interval: 24 });
    await expect.poll(async () => (await host('scrollSourceStatus')).scroll.completed).toBeTruthy();
    await delay(120);
    const hostState = await host('scrollSourceStatus'), log = await logSince(series.started);
    const reversals = log.positions.filter((item, index) => index > 0 && item.top < log.positions[index - 1].top - 2);
    traces.push({ mode, direction: 'source-to-reader', host: hostState, log, reversals });
    await writeFile(path.join(artifacts, 'translation-trace.json'), JSON.stringify(traces, null, 2));
    expect(log.reveals.length).toBeGreaterThan(15);
    expect(log.positions.length).toBeGreaterThan(10);
    expect(reversals).toHaveLength(0);
    expect(log.positions.at(-1).top - log.positions[0].top).toBeGreaterThan(500);
    evidence.push({ mode, direction: 'source-to-reader', updates: log.positions.length, reversals: reversals.length,
      firstFollowMs: log.positions[0].time - series.started, finalTop: log.positions.at(-1).top });
    for (const direction of [1, -1]) {
      await host('configure', { values: { syncScroll: false } });
      await root.evaluate((element, direction) => element.scrollTop = direction > 0 ? 0 : element.scrollHeight, direction);
      await host('scrollSource', { line: direction > 0 ? 0 : source.split('\n').length - 1 }); await delay(100);
      await host('configure', { values: { syncScroll: true } });
      await root.hover({ position: { x: 8, y: 220 } });
      const start = Date.now();
      for (let index = 0; index < 50; index++) { await page.mouse.wheel(0, direction * 120); await delay(8); }
      await delay(160);
      const hostState = await host('scrollSourceStatus'), log = await logSince(start);
      const events = hostState.events.filter(event => event.time >= start);
      const reversals = events.filter((event, index) => index > 0 && (event.offset - events[index - 1].offset) * direction < 0);
      traces.push({ mode, direction: `reader-${direction}`, events, log, reversals });
      await writeFile(path.join(artifacts, 'translation-trace.json'), JSON.stringify(traces, null, 2));
      expect(events.length).toBeGreaterThan(10);
      expect(reversals).toHaveLength(0);
      expect(log.reveals).toHaveLength(0);
      expect(log.commands).toHaveLength(0);
      evidence.push({ mode, direction: `reader-${direction}`, sourceUpdates: events.length, reversals: reversals.length, feedback: log.reveals.length });
    }
    await writeFile(path.join(artifacts, 'translation-trace.json'), JSON.stringify(traces, null, 2));
  }
  // Opening annotation paint/actions inside a translation must not turn those
  // nested source spans into separate scrolling anchors.
  await host('configure', { values: { syncScroll: false, translationMode: 'bilingual' } });
  const highlight = frame.locator('.limr-translations .limr-highlight').first();
  await expect(highlight).toBeAttached();
  await highlight.scrollIntoViewIfNeeded(); await delay(100);
  await host('configure', { values: { syncScroll: true } });
  const before = await root.evaluate(element => ({ time: Date.now(), top: element.scrollTop }));
  await highlight.hover(); await highlight.click(); await delay(150);
  const annotation = await logSince(before.time);
  expect(annotation.reveals).toHaveLength(0); expect(annotation.commands).toHaveLength(0);
  expect(Math.abs(await root.evaluate(element => element.scrollTop) - before.top)).toBeLessThan(2);
  await page.keyboard.press('Escape');
  const toggle = frame.locator('[data-translation-switch]').first();
  await toggle.scrollIntoViewIfNeeded(); await delay(100);
  const uiStart = Date.now();
  for (const expected of ['origin', 'translation', 'both']) {
    await toggle.click();
    await expect(frame.locator('.limr-translations').first()).toHaveAttribute('data-mode', expected);
  }
  const ui = await logSince(uiStart);
  expect(ui.reveals).toHaveLength(0); expect(ui.commands).toHaveLength(0);
  const boundaryEvidence = [];
  const hintText = '翻译块不支持选区跨过原文或译文的段落边界。';
  for (const width of [1920, 1280]) {
    await page.setViewportSize({ width, height: 1080 });
    for (const [blockIndex, from, to] of [[0, 'translation', 'origin'], [1, 'origin', 'translation']]) {
      await host('configure', { values: { syncScroll: false } });
      const block = frame.locator('.limr-translations').nth(blockIndex);
      await expect(block).toHaveAttribute('data-mode', 'both');
      await expect(block).toHaveAttribute('data-limr-selection-boundary', hintText);
      await block.evaluate(element => {
        getSelection()?.removeAllRanges(); document.activeElement?.blur();
        const root = document.querySelector('.lv-scroll');
        const origin = element.querySelector('[data-language="origin"] p');
        root.scrollTop += origin.getBoundingClientRect().top - root.getBoundingClientRect().top - root.clientHeight / 2;
        document.dispatchEvent(new Event('selectionchange'));
      });
      await delay(120);
      await host('configure', { values: { syncScroll: true } });
      const before = await root.evaluate(element => ({ time: Date.now(), top: element.scrollTop }));
      const bodyBox = await frame.locator('body').boundingBox();
      const points = await block.evaluate(element => {
        const point = language => {
          const region = element.querySelector(`[data-language="${language}"]`);
          const paragraphs = region.querySelectorAll('p');
          const paragraph = language === 'translation' ? paragraphs[paragraphs.length - 1] : paragraphs[0];
          const walker = document.createTreeWalker(paragraph, NodeFilter.SHOW_TEXT, {
            acceptNode: node => !node.data.trim() || node.parentElement.closest('[data-limr-ignore],button') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT,
          });
          const nodes = []; let node; while (node = walker.nextNode()) nodes.push(node);
          node = language === 'translation' ? nodes.at(-1) : nodes[0];
          const offset = language === 'translation' ? Math.max(0, node.length - 20) : Math.min(5, node.length - 1);
          const range = document.createRange(); range.setStart(node, offset); range.setEnd(node, offset + 1);
          const rect = range.getBoundingClientRect();
          return { x: rect.left + rect.width / 3, y: rect.top + rect.height / 2 };
        };
        return { origin: point('origin'), translation: point('translation') };
      });
      const start = points[from], end = points[to];
      await page.mouse.move(bodyBox.x + start.x, bodyBox.y + start.y); await page.mouse.down();
      await page.mouse.move(bodyBox.x + end.x, bodyBox.y + end.y, { steps: 12 }); await page.mouse.up();
      const toolbar = frame.getByRole('toolbar');
      const hint = toolbar.locator('.limr-toolbar-selection-hint');
      await expect(hint).toHaveText(hintText); await expect(hint).toBeVisible(); await delay(160);
      const selected = await frame.evaluate(() => {
        const selection = getSelection();
        const language = node => (node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement)?.closest('[data-language]')?.dataset.language;
        const toolbar = document.querySelector('[role="toolbar"]'), hint = toolbar.querySelector('.limr-toolbar-selection-hint');
        return { anchor: language(selection.anchorNode), focus: language(selection.focusNode), text: selection.toString(),
          toolbar: toolbar.getBoundingClientRect().toJSON(), hint: hint.getBoundingClientRect().toJSON(),
          clientWidth: hint.clientWidth, scrollWidth: hint.scrollWidth, viewport: { width: innerWidth, height: innerHeight } };
      });
      expect(selected.anchor).toBe(from); expect(selected.focus).toBe(from); expect(selected.text.length).toBeGreaterThan(0);
      expect(selected.toolbar.left).toBeGreaterThanOrEqual(-1); expect(selected.toolbar.right).toBeLessThanOrEqual(selected.viewport.width + 1);
      expect(selected.toolbar.top).toBeGreaterThanOrEqual(-1); expect(selected.toolbar.bottom).toBeLessThanOrEqual(selected.viewport.height + 1);
      expect(selected.hint.left).toBeGreaterThanOrEqual(selected.toolbar.left); expect(selected.hint.right).toBeLessThanOrEqual(selected.toolbar.right);
      expect(selected.hint.bottom).toBeLessThanOrEqual(selected.toolbar.bottom); expect(selected.scrollWidth).toBeLessThanOrEqual(selected.clientWidth + 1);
      expect(Math.abs(await root.evaluate(element => element.scrollTop) - before.top)).toBeLessThan(2);
      const events = await logSince(before.time); expect(events.reveals).toHaveLength(0); expect(events.commands).toHaveLength(0);
      boundaryEvidence.push({ width, blockIndex, from, to, selected, scrollBefore: before.top, events });
      await writeFile(path.join(artifacts, 'translation-selection-boundaries.json'), JSON.stringify(boundaryEvidence, null, 2));
      // A new legal selection in one language clears the transient warning.
      await block.evaluate((element, language) => {
        const paragraph = element.querySelector(`[data-language="${language}"] p`);
        const walker = document.createTreeWalker(paragraph, NodeFilter.SHOW_TEXT); let node;
        while ((node = walker.nextNode()) && (!node.data.trim() || node.parentElement.closest('button,[data-limr-ignore]'))) {}
        getSelection().setBaseAndExtent(node, 0, node, Math.min(node.length, 5));
        document.dispatchEvent(new Event('selectionchange'));
      }, from);
      await expect(toolbar).toBeVisible(); await expect(hint).toHaveCount(0);
      await frame.evaluate(() => { getSelection()?.removeAllRanges(); document.dispatchEvent(new Event('selectionchange')); });
    }
  }
  evidence.push({ check: 'LiMR 1.2.3 clamps actual cross-language mouse drags, shows the Chinese hint within wide/narrow toolbars, and preserves scrolling', cases: boundaryEvidence });
  expect((await host('snapshot')).source).toBe(source);
  evidence.push({ check: 'Annotation hover/click and paragraph display switches keep the same whole-block source span without feedback or Markdown edits', annotation, ui });
  await writeFile(path.join(artifacts, 'translation-trace.json'), JSON.stringify(traces, null, 2));
  return evidence;
}
