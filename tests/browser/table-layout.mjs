import { expect } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';

const remarks = 'A detailed discussion of language models, their architectures and practical applications. 中文内容应当保持完整可读。 '.repeat(3);
const definitions = '<citation id="four" title="Reference four" />\n\n<citation id="five" title="Reference five" />';
const headers = ['Ref.', 'Education', 'Industry', 'Agriculture', 'Healthcare', 'Transport', 'E-Commerce', 'Entertainment', 'Lifestyle', 'Gaming', 'Marketing', 'Finance', 'Big Data', 'AI', 'Cloud Computing', 'Edge Computing', '5G and Beyond', 'HCI', 'Remarks'];
const fixtures = [
  { name: 'Sparse', scroll: false, body: '| Item | A | Longer label | C | Extra | F | Notes |\n| --- | --- | --- | --- | --- | --- | --- |\n| Alpha | ✓ | ✓ | ✓ | ✓ | ✓ | X |' },
  { name: 'References', scroll: false, body: `| Reference | Remarks |\n| --- | --- |\n| <ref id="four">[4]</ref> <ref id="five">[5]</ref> | ${remarks} |\n| Our Survey Paper | E-Commerce methods and complete **selected words**. |\n\n${definitions}` },
  { name: 'Survey', scroll: true, body: `| ${headers.join(' | ')} |\n| ${headers.map(() => '---').join(' | ')} |\n| ${['<ref id="four">[4]</ref>', ...Array(17).fill('✓'), remarks].join(' | ')} |\n| ${['Our Survey Paper', ...Array(17).fill('✓'), remarks].join(' | ')} |\n\n${definitions}` },
];
// This is a real worker/windowed document. The fixture keeps the tested table
// at the beginning; no private runtime or forced width style is injected.
const padding = '\n\n' + Array.from({ length: 480 }, (_, index) => `Paragraph ${index}. ${'Ordinary source content remains available beyond the mounted viewport. '.repeat(3)}`).join('\n\n');

function geometry(host) {
  const table = host.querySelector('table'), cells = [...table.querySelectorAll('th,td')];
  let crossed = 0, inspected = 0;
  const markers = [], suffixes = [], completeWindows = [];
  for (const cell of cells) {
    const content = cell.querySelector('.limr-table-cell-content'), window = cell.querySelector('.limr-table-cell-window');
    const bounds = content.getBoundingClientRect(), visible = window.getBoundingClientRect(), suffix = cell.querySelector('.limr-table-cell-reveal');
    const suffixBox = suffix?.getBoundingClientRect();
    if (window.dataset.truncated !== 'true') completeWindows.push(getComputedStyle(window).overflowX);
    const walker = document.createTreeWalker(content, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const text = walker.currentNode;
      if (text.parentElement?.closest('[data-limr-ignore]')) continue;
      let offset = 0;
      for (const character of text.data) {
        const range = document.createRange(); range.setStart(text, offset); offset += character.length; range.setEnd(text, offset);
        const box = range.getBoundingClientRect();
        if (!character.trim() || box.bottom > visible.bottom + 1 || box.top < visible.top - 1) continue;
        inspected++;
        if (box.left < bounds.left - 1 || box.right > bounds.right + 1 || suffixBox && box.right > suffixBox.left + 1) crossed++;
      }
    }
    for (const marker of content.querySelectorAll('[data-limr-anchor]')) {
      const box = marker.getBoundingClientRect();
      markers.push({ inside: box.left >= visible.left - 1 && box.right <= visible.right + 1 && box.top >= visible.top - 1 && box.bottom <= visible.bottom + 1,
        inert: !!marker.closest('[inert]'), truncated: window.dataset.truncated === 'true' });
    }
    if (suffix) {
      const ellipsis = suffix.firstElementChild.getBoundingClientRect(), marker = suffix.querySelector('button').getBoundingClientRect();
      suffixes.push({ text: suffix.firstElementChild.textContent, distance: marker.left - ellipsis.right,
        vertical: Math.abs((marker.top + marker.bottom - ellipsis.top - ellipsis.bottom) / 2) });
    }
  }
  const short = cells.find(cell => cell.textContent.includes('Our Survey Paper'))?.querySelector('.limr-table-cell-content');
  const compound = [...table.querySelectorAll('th')].find(cell => cell.textContent.trim() === 'E-Commerce')?.querySelector('.limr-table-cell-content');
  return { available: host.clientWidth, table: table.getBoundingClientRect().width, overflow: host.scrollWidth - host.clientWidth,
    headers: [...table.tHead.rows[0].cells].map(cell => cell.querySelector('.limr-table-cell-window').getBoundingClientRect().height / parseFloat(getComputedStyle(cell.querySelector('.limr-table-cell-content')).lineHeight)),
    compoundLines: compound ? compound.clientHeight / parseFloat(getComputedStyle(compound).lineHeight) : null,
    shortLines: short ? short.clientHeight / parseFloat(getComputedStyle(short).lineHeight) : null,
    markers, suffixes, completeWindows, crossed, inspected, hostScriptWrappers: host.querySelectorAll('[class*="lv-script-"]').length };
}

// Read actual rendered graphemes, including the host's script wrappers. A
// nonempty visible line and its complete glyph count are separate assertions.
function headerGeometry(cell) {
  const content = cell.querySelector('.limr-table-cell-content'), window = cell.querySelector('.limr-table-cell-window');
  const bounds = content.getBoundingClientRect(), visible = window.getBoundingClientRect(), lines = new Map();
  const walker = document.createTreeWalker(content, NodeFilter.SHOW_TEXT), segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
  let crossed = 0;
  while (walker.nextNode()) {
    const text = walker.currentNode;
    if (text.parentElement?.closest('[data-limr-ignore]')) continue;
    for (const { index, segment } of segmenter.segment(text.data)) {
      const range = document.createRange(); range.setStart(text, index); range.setEnd(text, index + segment.length);
      const box = range.getBoundingClientRect();
      if (!box.width || !box.height || box.bottom > visible.bottom + 1 || box.top < visible.top - 1) continue;
      if (box.left < bounds.left - 1 || box.right > bounds.right + 1) crossed++;
      else { const line = Math.round(box.top * 2) / 2; lines.set(line, (lines.get(line) ?? 0) + 1); }
    }
  }
  return { text: content.textContent, truncated: window.dataset.truncated === 'true', trackWidth: cell.getBoundingClientRect().width,
    contentWidth: bounds.width, contentScrollWidth: content.scrollWidth, windowWidth: visible.width, visibleGlyphs: [...lines.values()], crossed,
    markers: cell.querySelectorAll('.limr-table-cell-reveal').length, scriptWrappers: content.querySelectorAll('[class*="lv-script-"]').length };
}

// Construct one boundary from the actual host font and suffix, before checking
// it. There is no retry-until-pass or injected layout style. This deterministic
// counterfactual must fit three full-width lines but require four with a suffix.
function threeLineBoundary(cell) {
  const content = cell.querySelector('.limr-table-cell-content'), window = cell.querySelector('.limr-table-cell-window');
  const textStyle = getComputedStyle(content.querySelector('.lv-script-latin') ?? content), suffixStyle = getComputedStyle(content);
  const marker = cell.closest('.limr-table-layout').querySelector('.limr-table-marker-measure button');
  if (!marker) throw new Error('The v2 actual InlineMarker measurement probe is absent');
  const markerStyle = getComputedStyle(marker), canvas = document.createElement('canvas').getContext('2d');
  const font = css => css.font || `${css.fontStyle} ${css.fontWeight} ${css.fontSize} ${css.fontFamily}`;
  canvas.font = font(textStyle); const textFont = canvas.font, spacing = parseFloat(textStyle.letterSpacing) || 0;
  const advance = count => canvas.measureText('W'.repeat(count)).width + count * spacing;
  const width = window.getBoundingClientRect().width;
  canvas.font = font(suffixStyle);
  const ellipsis = canvas.measureText('…').width + (parseFloat(suffixStyle.letterSpacing) || 0);
  const markerWidth = marker.getBoundingClientRect().width + (parseFloat(markerStyle.marginLeft) || 0) + (parseFloat(markerStyle.marginRight) || 0);
  const suffix = ellipsis + markerWidth;
  canvas.font = textFont;
  const capacity = available => { let count = 0; while (count < 256 && advance(count + 1) <= available - .05) count++; return count; };
  const fullCapacity = capacity(width), suffixCapacity = capacity(width - suffix), count = fullCapacity * 3;
  return { textFont, spacing, width, ellipsis, markerWidth, suffix, fullCapacity, suffixCapacity, count,
    fullLineAdvance: advance(fullCapacity), nextGlyphAdvance: advance(fullCapacity + 1), counterfactualLines: Math.ceil(count / Math.max(1, suffixCapacity)) };
}

export async function runTableLayoutAcceptance({ page, frame, host, artifacts }) {
  const evidence = [], errors = [], workers = [];
  const sections = (process.env.LIMR_TEST_TABLE_SECTIONS ?? 'layout,images,translation').split(',');
  expect(sections.length > 0 && sections.every(value => ['layout', 'images', 'translation'].includes(value))).toBe(true);
  page.on('pageerror', error => errors.push(error.message)); page.on('worker', worker => workers.push(worker.url()));
  const save = async check => { evidence.push(check); await writeFile(path.join(artifacts, 'checks.json'), JSON.stringify(evidence, null, 2)); };
  for (const command of ['workbench.action.closeSidebar', 'workbench.action.closeAuxiliaryBar', 'workbench.action.closePanel']) await host('command', { command, args: [] });
  await page.setViewportSize({ width: 2200, height: 1100 }); await host('layout', { sourceSize: .1 });
  await host('configure', { values: { language: 'en', theme: 'playground-dark', typography: 'standard', editingEnabled: false, loadingMode: 'blocking', tocMode: 'hidden', sidebarMode: 'hidden', syncScroll: false, 'plugins.enabled': false } });
  let source;
  if (sections.includes('layout')) {
  for (const fixture of fixtures) {
    source = `# ${fixture.name}\n\n${fixture.body}${padding}`;
    await host('replaceSource', { source });
    await expect(frame.getByRole('heading', { name: fixture.name, exact: true })).toBeVisible();
    await expect(frame.locator('.lv-app')).toHaveAttribute('data-reader-ready', 'true');
    await expect(frame.locator('[data-limr-windowed]')).toHaveCount(1);
    const table = frame.locator('.limr-table-layout').first();
    await expect(table).toHaveAttribute('data-table-ready', 'true'); await frame.evaluate(() => document.fonts.ready);
    for (const width of [500, 760, 1100]) {
      await host('configure', { values: { maxWidth: width } });
      await expect.poll(() => table.evaluate(node => node.clientWidth)).toBe(width);
      await expect.poll(() => table.evaluate(node => node.querySelector('table').getBoundingClientRect().width - node.clientWidth)).toBeGreaterThanOrEqual(-1);
      const measured = await table.evaluate(geometry);
      expect(measured.hostScriptWrappers).toBeGreaterThan(0);
      expect(measured.inspected).toBeGreaterThan(10); expect(measured.crossed).toBe(0);
      expect(measured.completeWindows.every(value => value === 'visible')).toBe(true);
      expect(Math.max(...measured.headers)).toBeLessThanOrEqual(3.05);
      if (!fixture.scroll) expect(measured.overflow).toBeLessThanOrEqual(1);
      else { expect(measured.overflow).toBeGreaterThan(1); expect(measured.compoundLines).toBeLessThan(1.1); }
      if (measured.shortLines !== null) expect(measured.shortLines).toBeLessThan(2.1);
      for (const marker of measured.markers) expect(marker).toEqual({ inside: true, inert: false, truncated: false });
      if (fixture.name === 'References') expect(measured.markers).toHaveLength(2);
      for (const suffix of measured.suffixes) { expect(suffix.text).toBe('…'); expect(suffix.distance).toBeGreaterThanOrEqual(-1); expect(suffix.distance).toBeLessThan(16); expect(suffix.vertical).toBeLessThan(20); }
      await page.screenshot({ path: path.join(artifacts, `table-${fixture.name.toLowerCase()}-${width}.png`) });
      await save({ check: 'Actual host table/content width and glyph/marker geometry', name: fixture.name, width, measured });
    }
    expect((await host('snapshot')).source).toBe(source);
  }
  // One additional document exercises both v2 regressions through actual
  // worker parsing, host script spans and the default host font. Keep this out
  // of the old 3 x 3 matrix and preserve its original assertions.
  const boundaryHeaders = ['W'.repeat(25), 'W'.repeat(80), 'E-Commerce', ...Array.from({ length: 16 }, (_, index) => `F${index}`)];
  const boundarySource = count => `# Header boundaries\n\n| ${boundaryHeaders.join(' | ')} |\n| ${boundaryHeaders.map(() => '---').join(' | ')} |\n| ${boundaryHeaders.map(() => '✓').join(' | ')} |\n\n| ${'W'.repeat(count)} |\n| --- |\n| ✓ |${padding}`;
  await host('configure', { values: { maxWidth: 500, sidebarMode: 'hidden' } });
  source = boundarySource(1); await host('replaceSource', { source });
  await expect(frame.getByRole('heading', { name: 'Header boundaries', exact: true })).toBeVisible();
  await expect(frame.locator('.lv-app')).toHaveAttribute('data-reader-ready', 'true');
  await expect(frame.locator('[data-limr-windowed]')).toHaveCount(1);
  const boundaryTables = frame.locator('.limr-table-layout'); await expect(boundaryTables).toHaveCount(2);
  await expect(boundaryTables.nth(1)).toHaveAttribute('data-table-ready', 'true'); await frame.evaluate(() => document.fonts.ready);
  await expect.poll(() => boundaryTables.nth(1).evaluate(node => node.clientWidth)).toBe(500);
  const construction = await boundaryTables.nth(1).locator('th').evaluate(threeLineBoundary);
  await save({ check: 'Actual host three-line boundary construction before validation', construction });
  expect(construction.fullCapacity).toBeGreaterThan(1); expect(construction.fullCapacity).toBeLessThan(256);
  expect(construction.suffixCapacity).toBeGreaterThan(0); expect(construction.suffixCapacity).toBeLessThan(construction.fullCapacity);
  expect(construction.counterfactualLines).toBeGreaterThan(3);
  source = boundarySource(construction.count); await host('replaceSource', { source });
  await expect(boundaryTables.nth(1).locator('th .limr-table-cell-content')).toHaveText('W'.repeat(construction.count));
  await expect(frame.locator('.lv-app')).toHaveAttribute('data-reader-ready', 'true');
  for (const [step, width] of [500, 760, 500].entries()) {
    await host('configure', { values: { maxWidth: width } });
    await expect.poll(() => boundaryTables.first().evaluate(node => node.clientWidth)).toBe(width);
    const stability = await boundaryTables.first().evaluate(async node => {
      const states = [];
      for (let index = 0; index < 8; index++) { await new Promise(requestAnimationFrame); states.push([...node.querySelectorAll('th .limr-table-cell-window')].slice(0, 2).map(cell => cell.dataset.truncated === 'true')); }
      return states;
    });
    // Let the real ResizeObserver/layout commits finish before final geometry.
    const medium = await boundaryTables.first().locator('th').nth(0).evaluate(headerGeometry);
    const long = await boundaryTables.first().locator('th').nth(1).evaluate(headerGeometry);
    const measured = await boundaryTables.first().evaluate(geometry);
    await page.screenshot({ path: path.join(artifacts, `table-header-boundaries-${step + 1}-${width}.png`) });
    await save({ check: 'Actual host v2 readable long-token headers and stable suffix geometry', step, width, medium, long, measured, stability });
    expect(medium.scriptWrappers).toBeGreaterThan(0); expect(long.scriptWrappers).toBeGreaterThan(0);
    expect(medium.truncated).toBe(false); expect(medium.markers).toBe(0); expect(medium.crossed).toBe(0);
    expect(medium.visibleGlyphs.length).toBeGreaterThan(0); expect(medium.visibleGlyphs.length).toBeLessThanOrEqual(3);
    expect(medium.visibleGlyphs.at(-1)).toBeGreaterThanOrEqual(2);
    expect(medium.visibleGlyphs.reduce((sum, count) => sum + count, 0)).toBe(25);
    expect(long.truncated).toBe(true); expect(long.markers).toBe(1); expect(long.crossed).toBe(0);
    expect(long.visibleGlyphs.length).toBeGreaterThan(0); expect(long.visibleGlyphs.length).toBeLessThanOrEqual(3);
    expect(long.visibleGlyphs[0]).toBeGreaterThanOrEqual(6);
    expect(measured.crossed).toBe(0); expect(measured.suffixes.length).toBeGreaterThan(0);
    for (const suffix of measured.suffixes) { expect(suffix.text).toBe('…'); expect(suffix.distance).toBeGreaterThanOrEqual(-1); expect(suffix.distance).toBeLessThan(16); expect(suffix.vertical).toBeLessThan(20); }
    expect(stability.every(state => state[0] === false && state[1] === true)).toBe(true);
  }
  const complete = await boundaryTables.nth(1).locator('th').evaluate(headerGeometry);
  await save({ check: 'Actual host three full-width lines remain complete without a self-sustaining suffix', construction, complete });
  expect(complete.truncated).toBe(false); expect(complete.markers).toBe(0); expect(complete.crossed).toBe(0);
  expect(complete.visibleGlyphs).toHaveLength(3); expect(complete.visibleGlyphs.at(-1)).toBeGreaterThanOrEqual(2);
  expect(complete.visibleGlyphs.reduce((sum, count) => sum + count, 0)).toBe(construction.count);
  expect((await host('snapshot')).source).toBe(source);

  const huge = 'ExtraordinaryHeader'.repeat(25);
  source = `# Overflow\n\n| **${huge}** | Value |\n| --- | --- |\n| short | 1 |${padding}`;
  await host('configure', { values: { maxWidth: 760, sidebarMode: 'always', sidebarAutoCollapse: true } });
  await host('replaceSource', { source });
  await expect(frame.getByRole('heading', { name: 'Overflow', exact: true })).toBeVisible();
  await expect(frame.locator('.lv-app')).toHaveAttribute('data-reader-ready', 'true');
  const table = frame.locator('.limr-table-layout').first(), marker = table.getByRole('button', { name: 'Full cell content', exact: true }).first();
  await expect(table).toHaveAttribute('data-table-ready', 'true');
  await expect(marker).toBeVisible();
  // The existing plan can remain ready while ResizeObserver updates its width.
  await expect.poll(() => table.evaluate(node => node.clientWidth)).toBe(760);
  await expect.poll(() => table.evaluate(node => node.querySelector('table').getBoundingClientRect().width - node.clientWidth)).toBeGreaterThanOrEqual(-1);
  const overflowGeometry = await table.evaluate(geometry);
  expect(overflowGeometry.table - overflowGeometry.available).toBeGreaterThanOrEqual(-1);
  // This header must truncate: make the suffix geometry check non-vacuous
  // without requiring the ordinary short-content fixtures above to truncate.
  expect(overflowGeometry.suffixes.length).toBeGreaterThan(0);
  for (const suffix of overflowGeometry.suffixes) {
    expect(suffix.text).toBe('…');
    expect(suffix.distance).toBeGreaterThanOrEqual(-1); expect(suffix.distance).toBeLessThan(16);
    expect(suffix.vertical).toBeLessThan(20);
  }
  await marker.click();
  const card = frame.locator('.limr-sidebar-card[data-type="table-cell-overflow"]');
  await expect(card).toHaveAttribute('data-expanded', 'true');
  await expect(card.locator('.limr-table-full-content strong')).toHaveText(huge);
  await expect(frame.locator('.limr-annotation-overlay')).toHaveCount(0);
  await expect(card.locator('.lv-note-content,.lv-note-preview')).toHaveCount(0);
  await page.screenshot({ path: path.join(artifacts, 'table-native-sidebar.png') });
  await page.setViewportSize({ width: 1000, height: 1000 });
  const overlay = frame.locator('.limr-annotation-overlay[data-type="table-cell-overflow"]');
  await expect(overlay).toBeVisible(); await expect(overlay.locator('.limr-table-full-content strong')).toHaveText(huge);
  await overlay.getByRole('button', { name: 'Expand in table', exact: true }).click();
  await expect(table.locator('th').first()).toHaveAttribute('data-cell-expanded', 'true');
  expect((await host('snapshot')).source).toBe(source);
  await page.screenshot({ path: path.join(artifacts, 'table-native-overlay-expanded.png') });
  await save({ check: 'Core view-only overflow annotation uses native host sidebar/overlay and preserves Markdown', workers, overflowGeometry });
  }

  if (sections.includes('images')) {
    await host('writeFiles', { files: { 'images/table-preview.svg': '<svg xmlns="http://www.w3.org/2000/svg" width="2400" height="1400"><rect width="2400" height="1400" fill="#365d80"/><circle cx="1200" cy="700" r="460" fill="#fbf3da"/></svg>', 'table-target.md': '# Image link destination\n' } });
    source = `# Table images\n\n| [![Table landscape](./images/table-preview.svg)](./table-target.md) ${'ExtraordinaryHeader'.repeat(25)} | Value |\n| --- | --- |\n| Compact | ✓ |\n| Short | ✓ |${padding}`;
    await frame.evaluate(() => {
      window.__tableImageReplies = [];
      window.__tableImageEvents = [];
      window.addEventListener('message', event => { if (event.data?.type === 'imageResolved') window.__tableImageReplies.push({ src: event.data.src, uri: event.data.uri, reason: event.data.reason }); });
      const describe = node => node instanceof Element ? `${node.tagName}.${node.className}` : node?.parentElement ? `text:${node.parentElement.tagName}.${node.parentElement.className}` : null;
      for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click', 'selectionchange']) for (const capture of [true, false]) document.addEventListener(type, event => {
        const selection = document.getSelection();
        window.__tableImageEvents.push({ type, capture, at: performance.now(), target: describe(event.target), active: describe(document.activeElement), prevented: event.defaultPrevented,
          x: event.clientX, y: event.clientY, collapsed: selection?.isCollapsed, text: selection?.toString().slice(0, 120), anchor: describe(selection?.anchorNode), focus: describe(selection?.focusNode) });
        if (window.__tableImageEvents.length > 100) window.__tableImageEvents.shift();
      }, capture);
    });
    await host('configure', { values: { maxWidth: 760, typography: 'standard', sidebarMode: 'hidden' } });
    await host('replaceSource', { source });
    await expect(frame.getByRole('heading', { name: 'Table images', exact: true })).toBeVisible();
    await expect(frame.locator('.lv-app')).toHaveAttribute('data-reader-ready', 'true');
    await expect(frame.locator('[data-limr-windowed]')).toHaveCount(1);
    const table = frame.locator('.limr-table-layout').first(), original = table.getByAltText('Table landscape', { exact: true });
    await expect(table).toHaveAttribute('data-table-ready', 'true');
    await expect(original).toHaveJSProperty('naturalWidth', 2400);
    const resolved = await original.evaluate(image => image.currentSrc);
    expect(resolved).toContain('vscode-resource.vscode-cdn.net');
    for (const mode of ['overlay', 'sidebar']) {
      await page.setViewportSize({ width: mode === 'overlay' ? 1000 : 2200, height: 1100 });
      await host('configure', { values: { sidebarMode: mode === 'overlay' ? 'hidden' : 'always', sidebarAutoCollapse: true } });
      await expect(original).toHaveJSProperty('naturalWidth', 2400);
      const replies = await frame.evaluate(() => window.__tableImageReplies.length);
      await table.getByRole('button', { name: 'Full cell content', exact: true }).first().click();
      const card = frame.locator(mode === 'overlay' ? '.limr-annotation-overlay[data-type="table-cell-overflow"]' : '.limr-sidebar-card[data-type="table-cell-overflow"]');
      const clone = card.locator('.limr-table-full-content').getByAltText('Table landscape', { exact: true });
      await expect(clone).toHaveJSProperty('naturalWidth', 2400);
      await expect(clone).toHaveAttribute('role', 'button');
      expect(await clone.evaluate(image => ({ src: image.currentSrc, error: image.dataset.lvImageError ?? null }))).toEqual({ src: resolved, error: null });
      const beforeClick = await clone.evaluate(image => ({ html: image.outerHTML, rect: image.getBoundingClientRect().toJSON(), selection: document.getSelection()?.toString(), collapsed: document.getSelection()?.isCollapsed }));
      const dialog = frame.locator('.limr-image-preview');
      try { await clone.click(); await expect(dialog).toBeVisible(); }
      catch (error) {
        await save({ check: 'Image activation failure diagnostic', mode, beforeClick, events: await frame.evaluate(() => window.__tableImageEvents), host: await host('snapshot') });
        throw error;
      }
      await expect(dialog.getByAltText('Table landscape')).toHaveAttribute('src', resolved);
      await expect(dialog.getByAltText('Table landscape')).toHaveJSProperty('naturalWidth', 2400);
      await dialog.getByRole('button', { name: 'Actual size', exact: true }).click();
      await expect(dialog.locator('.limr-image-preview-stage')).toHaveAttribute('data-original', 'true');
      await expect(card).toBeVisible();
      await page.screenshot({ path: path.join(artifacts, `table-image-${mode}.png`) });
      await dialog.getByRole('button', { name: 'Close image preview' }).click();
      await expect(dialog).toHaveCount(0); await expect(clone).toBeFocused(); await expect(card).toBeVisible();
      expect(await frame.evaluate(() => window.__tableImageReplies.length)).toBe(replies);
      expect((await host('snapshot')).source).toBe(source);
      await save({ check: 'Resolved local clone image shares core preview and owned card dismissal without another host resolution', mode, resolved, replies });
      await page.keyboard.press('Escape');
    }
  }

  // A short host-only sentinel for the separate list-item requirement. The core
  // suite already covers six list forms; here the lv-script wrapper is the risk.
  if (sections.includes('translation')) {
  source = '# List translations\n\n<translations>\n\n<origin>\n\n- First item\n- Final item with **selected words**.\n\n</origin>\n\n<translation>\n\n- 第一项\n- 最后一项含有**可选择文字**。\n\n</translation>\n\n</translations>' + padding;
  await host('configure', { values: { maxWidth: 760, sidebarMode: 'hidden' } }); await host('replaceSource', { source });
  await expect(frame.getByRole('heading', { name: 'List translations', exact: true })).toBeVisible();
  await expect(frame.locator('.lv-app')).toHaveAttribute('data-reader-ready', 'true');
  const block = frame.locator('.limr-translations').first(), toggle = block.locator('[data-translation-switch]');
  for (const typography of ['standard', 'knuth-plass']) {
    await host('configure', { values: { typography } });
    for (let index = 0; index < 3; index++) {
      const before = await block.getAttribute('data-mode'); await toggle.click();
      await expect(block).not.toHaveAttribute('data-mode', before);
      const inline = await toggle.evaluate(button => {
        const item = button.closest('li'), box = button.getBoundingClientRect();
        const spans = item ? [...item.querySelectorAll('[data-limr-text]')].filter(span => !span.closest('[data-limr-ignore]')) : [];
        const last = spans.at(-1), range = document.createRange();
        if (!last?.lastChild) return { item: !!item, sameLine: false };
        range.selectNodeContents(last); const rect = [...range.getClientRects()].at(-1);
        return { item: true, sameLine: !!rect && box.top < rect.bottom && box.bottom > rect.top };
      });
      expect(inline).toEqual({ item: true, sameLine: true });
    }
    await save({ check: 'Host translation marker stays in the final list item line', typography });
  }
  }
  expect((await host('snapshot')).source).toBe(source); expect(workers.length).toBeGreaterThan(0); expect(errors).toEqual([]);
  return evidence;
}
