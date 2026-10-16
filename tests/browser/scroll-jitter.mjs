import { expect } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { webviewPointerExit } from './input.mjs';

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const paragraph = 'A long source line wraps across the native editor while the reader retains its own typography. 中文段落在双栏阅读时具有不同的行高与宽度，滚动同步不能把自身产生的滚动误当作新的输入。 ';
const source = '# Complex reader scroll\n\n' + Array.from({ length: 18 }, (_, section) => `## Section ${section + 1}\n\n`
  + paragraph.repeat(10 + section % 3 * 8) + '\n\n'
  + `:::definition{title="Definition ${section + 1}"}\n${paragraph.repeat(3)}\n:::\n\n`
  + '<translations default="both">\n\n<origin>\n\n' + paragraph.repeat(2) + '\n\n</origin>\n\n<translation>\n\n' + '译文内容保留正常布局，避免同步路径引发突跳。'.repeat(12) + '\n\n</translation>\n\n</translations>\n\n'
  + '| Column | Content |\n| --- | --- |\n' + Array.from({ length: 12 }, (_, row) => `| ${row} | Table section ${section + 1}, row ${row} |\n`).join('') + '\n'
  + '```typescript\n' + Array.from({ length: 20 }, (_, line) => `const row${line} = ${line}; // section ${section + 1}`).join('\n') + '\n```\n\n'
  + '$$\n\\sum_{i=1}^{n} x_i^2 + \\frac{a}{b} = E\n$$\n\n'
  + `Range ::%%limr%%{<#r${section}}selected body::%%limr%%{>#r${section}} remains stable.\n\n`
  + `:::limr-annotation{#n${section} ranges="r${section}" type="margin-note"}\nNote ${section + 1}\n:::\n\n`).join('');

export async function runScrollJitterAcceptance({ page, frame, host, artifacts }) {
  const evidence = [], cases = [];
  await host('configure', { values: { syncScroll: false, tocMode: 'hidden', sidebarMode: 'content', typography: 'standard', 'plugins.enabled': false } });
  await host('replaceSource', { source });
  await host('layout', { sourceSize: .5 });
  await expect(frame.locator('.limr-reader h1')).toHaveText('Complex reader scroll');
  await frame.evaluate(() => document.fonts.ready);
  await expect(frame.locator('.limr-definition')).toHaveCount(18);
  await expect(frame.locator('.limr-code-block')).toHaveCount(18);
  await expect(frame.locator('.limr-math-display')).toHaveCount(18);
  await frame.evaluate(() => {
    const root = document.querySelector('.lv-scroll');
    const journal = window.__jitter = { reveals: [], positions: [], commands: [], wheels: [], inputs: [], images: [] };
    window.addEventListener('message', event => {
      if (event.data?.type === 'reveal') journal.reveals.push({ time: Date.now(), offset: event.data.offset, top: root.scrollTop });
      if (event.data?.type === 'scrollIntent') journal.inputs.push({ time: Date.now(), host: event.data });
      if (event.data?.type === 'imageResolved') journal.images.push({ time: Date.now(), ...event.data });
    });
    for (const [target, name] of [[document.body, 'body'], [root, 'root'], [window, 'window']]) for (const event of ['pointerleave', 'mouseleave', 'pointerout', 'mouseout', 'blur']) target.addEventListener(event, () => journal.inputs.push({ time: Date.now(), event: `${name}:${event}` }));
    root.addEventListener('scroll', () => journal.positions.push({ time: Date.now(), top: root.scrollTop }), { passive: true });
    root.addEventListener('wheel', event => journal.wheels.push({ time: Date.now(), delta: event.deltaY, top: root.scrollTop }), { passive: true });
    const scrollTo = root.scrollTo.bind(root);
    root.scrollTo = (...args) => { const before = root.scrollTop; scrollTo(...args); journal.commands.push({ time: Date.now(), before, after: root.scrollTop, args }); };
  });
  const geometry = await frame.evaluate(() => [...document.querySelectorAll('.limr-reader-content > article > [data-source-start]')].map(element => ({
    tag: element.tagName, className: element.className, start: Number(element.dataset.sourceStart), end: Number(element.dataset.sourceEnd),
    top: element.getBoundingClientRect().top, height: element.getBoundingClientRect().height, display: getComputedStyle(element).display,
  })));
  await writeFile(path.join(artifacts, 'geometry.json'), JSON.stringify(geometry, null, 2));
  const leaveGuest = () => webviewPointerExit(page, frame);
  const sourceEditor = page.locator('.editor-group-container').first().locator('.monaco-editor').first();
  async function wheelCase(name, fraction, direction, smoothScrolling, options = {}) {
      await host('configure', { values: { syncScroll: false } });
      await frame.locator('.lv-scroll').evaluate((element, fraction) => element.scrollTop = (element.scrollHeight - element.clientHeight) * fraction, fraction);
      await delay(150);
      await host('configure', { values: { syncScroll: true } });
      const root = frame.locator('.lv-scroll'), box = await root.boundingBox();
      await root.hover({ position: { x: 8, y: Math.min(box.height / 2, 300) } });
      const start = await frame.evaluate(() => ({ time: Date.now(), top: document.querySelector('.lv-scroll').scrollTop }));
      for (let index = 0; index < (options.steps ?? 50); index++) {
        await page.mouse.wheel(0, direction * (options.delta ?? 50)); await delay(8);
        if (options.onStep) await options.onStep(index);
      }
      if (options.leaveImmediately) { await leaveGuest(); await sourceEditor.hover({ position: { x: 15, y: 220 } }); }
      await delay(400);
      const journal = await frame.evaluate(time => Object.fromEntries(Object.entries(window.__jitter).map(([key, values]) => [key, values.filter(value => value.time >= time)])), start.time);
      const hostState = await host('scrollSourceStatus');
      const backwards = journal.positions.filter((position, index) => index > 0 && (position.top - journal.positions[index - 1].top) * direction < -2);
      cases.push({ name, smoothScrolling, direction, start, journal, host: hostState, backwards });
      const sourceEvents = hostState.events.filter(event => event.time >= start.time);
      evidence.push({ name, smoothScrolling, readerEvents: journal.positions.length, sourceEvents: sourceEvents.length, returnedReveals: journal.reveals.length, unexpectedScrollCommands: journal.commands.length, reversals: backwards.length, start: start.top, end: journal.positions.at(-1)?.top });
      await writeFile(path.join(artifacts, 'jitter-trace.json'), JSON.stringify(cases, null, 2));
      await writeFile(path.join(artifacts, 'checks.json'), JSON.stringify(evidence, null, 2));
      expect(sourceEvents.length).toBeGreaterThan(0);
      return evidence.at(-1);
  }
  for (const smoothScrolling of [false, true]) {
    await host('configureEditor', { values: { smoothScrolling, wordWrap: 'on', 'stickyScroll.enabled': true } });
    for (const [name, fraction, direction] of (process.env.LIMR_TEST_JITTER_HANDOFF_ONLY ? [] : [['top-down', 0, 1], ['middle-down', .42, 1], ['middle-up', .65, -1], ['end-up', 1, -1]])) {
      await wheelCase(name, fraction, direction, smoothScrolling);
      if (name === 'top-down') await expect.poll(() => frame.locator('.katex').count()).toBeGreaterThan(0);
    }
  }
  await wheelCase('pointer-leaves-without-source-input', .5, 1, true, { steps: 8, leaveImmediately: true });
  const handoffs = [];
  for (const direction of [1, -1]) {
    const root = frame.locator('.lv-scroll'), box = await root.boundingBox();
    await root.hover({ position: { x: 8, y: Math.min(box.height / 2, 300) } });
    const before = await host('scrollSourceStatus');
    await page.mouse.wheel(0, 120);
    await delay(35);
    await leaveGuest(); await sourceEditor.hover({ position: { x: 15, y: 220 } });
    const hover = await frame.evaluate(() => ({ focused: document.hasFocus(), root: document.querySelector('.lv-scroll').matches(':hover'), body: document.body.matches(':hover'), html: document.documentElement.matches(':hover'), hovered: [...document.querySelectorAll(':hover')].map(el => el.className).slice(-8) }));
    const start = Date.now();
    for (let step = 0; step < 8; step++) { await page.mouse.wheel(0, direction * 40); await delay(16); }
    await delay(200);
    const reveals = await frame.evaluate(time => window.__jitter.reveals.filter(item => item.time >= time), start);
    handoffs.push({ direction, hover, firstFollowMs: reveals[0]?.time - start, updates: reveals.length, before, after: await host('scrollSourceStatus'), journal: await frame.evaluate(time => Object.fromEntries(Object.entries(window.__jitter).map(([key, values]) => [key, values.filter(value => value.time >= time)])), start - 100) });
  }
  await writeFile(path.join(artifacts, 'handoff.json'), JSON.stringify(handoffs, null, 2));
  expect(handoffs.every(item => item.updates > 0 && item.firstFollowMs < 200)).toBe(true);

  // The actual paper retains its original attribution. The optional directory
  // exercises its real images without making a sibling checkout mandatory.
  const paper = await readFile(new URL('../fixtures/feature-visualization.md', import.meta.url), 'utf8');
  await host('configure', { values: { syncScroll: false, 'images.pathMode': 'auto', 'images.searchPaths': [] } });
  await frame.locator('.lv-scroll').evaluate(element => element.scrollTop = 0);
  await delay(100);
  await host('replaceSource', { source: paper });
  await expect(frame.locator('.limr-reader h1')).toContainText('Feature Visualization');
  await delay(500);
  await writeFile(path.join(artifacts, 'paper-dom.html'), await frame.content());
  await writeFile(path.join(artifacts, 'paper-geometry.json'), JSON.stringify(await frame.evaluate(() => [...document.querySelectorAll('.lv-scroll *')].map(el => ({ tag: el.tagName, className: el.className, style: el.getAttribute('style'), start: el.dataset.sourceStart, end: el.dataset.sourceEnd, top: el.getBoundingClientRect().top, height: el.getBoundingClientRect().height })).filter(el => el.height > 500 || el.start)), null, 2));
  await wheelCase('paper-missing-images-down', 0, 1, true, { steps: 65, delta: 120 });
  await wheelCase('paper-missing-images-up', 1, -1, true, { steps: 65, delta: 120 });
  const missing = await frame.locator('.limr-reader-content img').evaluateAll(images => images.map(image => ({ alt: image.alt, loaded: image.naturalWidth, error: image.dataset.lvImageError })));
  expect(missing.length).toBeGreaterThanOrEqual(4);
  expect(missing.every(image => !image.loaded && image.error === 'missing')).toBe(true);
  const tinyPng = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';
  const files = {};
  for (const name of ['feature-neuron.png', 'feature-channel.png', 'feature-optimized.png', 'feature-diversity.png']) {
    files[`public/papers/${name}`] = process.env.LIMR_TEST_PAPER_IMAGES ? (await readFile(path.join(process.env.LIMR_TEST_PAPER_IMAGES, name))).toString('base64') : tinyPng;
  }
  await host('writeFiles', { files, encoding: 'base64' });
  await host('configure', { values: { 'images.searchPaths': ['public'] } });
  await wheelCase('paper-loaded-images-down', 0, 1, true, { steps: 65, delta: 120 });
  await wheelCase('paper-loaded-images-up', 1, -1, true, { steps: 65, delta: 120 });
  const loaded = await frame.locator('.limr-reader-content img').evaluateAll(images => images.map(image => ({ alt: image.alt, width: image.naturalWidth, height: image.naturalHeight })));
  expect(loaded.length).toBeGreaterThanOrEqual(4);
  expect(loaded.every(image => image.width > 0)).toBe(true);
  await host('configure', { values: { syncScroll: false, 'images.searchPaths': [] } });
  await page.setViewportSize({ width: 1920, height: 600 });
  await delay(150);
  await frame.locator('.lv-scroll').evaluate(element => element.scrollTop = element.scrollHeight);
  await delay(150);
  await host('configure', { values: { syncScroll: true } });
  await frame.locator('.lv-scroll').hover({ position: { x: 8, y: 200 } });
  await page.mouse.wheel(0, 1); await delay(100);
  const layoutBefore = await frame.evaluate(() => {
    const root = document.querySelector('.lv-scroll'), top = root.getBoundingClientRect().top + 18;
    const anchor = [...document.querySelectorAll('.limr-reader-content > article > [data-source-start]')].find(element => element.getBoundingClientRect().bottom > top);
    window.__layoutAnchor = anchor;
    return { time: Date.now(), root: root.scrollTop, anchorTop: anchor.getBoundingClientRect().top, anchorText: anchor.textContent.slice(0, 100) };
  });
  await host('configure', { values: { 'images.searchPaths': ['public'] } });
  try {
    await expect.poll(() => frame.locator('.limr-reader-content img').evaluateAll(images => images.every(image => image.complete && image.naturalWidth > 0))).toBe(true);
  } finally {
    await writeFile(path.join(artifacts, 'layout-images.json'), JSON.stringify(await frame.evaluate(() => ({
      images: [...document.querySelectorAll('.limr-reader-content img')].map(image => ({
        alt: image.alt, source: image.getAttribute('src'), currentSrc: image.currentSrc, complete: image.complete,
        width: image.naturalWidth, height: image.naturalHeight, loading: image.loading, error: image.dataset.lvImageError,
        top: image.getBoundingClientRect().top, elementHeight: image.getBoundingClientRect().height,
      })), replies: window.__jitter.images,
    })), null, 2));
  }
  await delay(250);
  const layoutAfter = await frame.evaluate(time => ({ root: document.querySelector('.lv-scroll').scrollTop,
    anchorTop: window.__layoutAnchor.getBoundingClientRect().top,
    reveals: window.__jitter.reveals.filter(item => item.time >= time), commands: window.__jitter.commands.filter(item => item.time >= time),
  }), layoutBefore.time);
  await writeFile(path.join(artifacts, 'layout-shift.json'), JSON.stringify({ before: layoutBefore, after: layoutAfter }, null, 2));
  expect(layoutAfter.reveals).toHaveLength(0);
  expect(layoutAfter.commands).toHaveLength(0);
  expect(Math.abs(layoutAfter.anchorTop - layoutBefore.anchorTop)).toBeLessThan(2);
  await writeFile(path.join(artifacts, 'paper-images.json'), JSON.stringify({ realImages: !!process.env.LIMR_TEST_PAPER_IMAGES, missing, loaded, handoffs }, null, 2));
  expect(evidence.every(item => item.returnedReveals === 0 && item.reversals === 0)).toBe(true);
  expect((await host('snapshot')).source).toBe(paper);
  return evidence;
}
