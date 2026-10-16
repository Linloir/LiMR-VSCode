import { expect } from '@playwright/test';
import { createDocument, standard } from '@linloir/limr';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';

// Copied prose only: the user's docs/ai-guide.md and its real annotations are
// never opened or modified by this suite.
const guideParagraph = '激活 LiMR 阅读器标签页，在 **VS Code 原生编辑器工具栏的 AI 子菜单**中选择安装 Skill；也可以运行命令面板中的 **LiMR: Install AI Annotation Skill…**。选择目标工具和工作区后，扩展复制随包附带的 `limr-annotations` Skill：';
const guideSource = `# LiMR regression\n\n${guideParagraph}\n`;
const annotatedSource = `# LiMR regression

Before ::%%limr%%{<#r1}**selected words**::%%limr%%{>#r1} after, with a footnote[^f1].

## Another section

This section gives the table of contents a second target.

[^f1]: An actual Markdown footnote remains reachable above any selection toolbar.

:::limr-annotation{#h1 ranges="r1" type="highlight" color="#E5C07B"}
:::

:::limr-annotation{#n1 ranges="r1" type="margin-note"}
A note whose editor must not inherit a VS Code focus rectangle.
:::

:::limr-annotation{#q1 ranges="r1" type="question"}
A question on the same text.
:::
` + '\n' + Array.from({ length: 24 }, (_, index) => `Following paragraph ${index + 1} provides a scrollable viewport for popup placement.\n\n`).join('');
const multiRangeSource = `# LiMR regression

Primary ::%%limr%%{<#r1}**alpha range**::%%limr%%{>#r1} has three annotations.

Secondary ::%%limr%%{<#r2}**beta range**::%%limr%%{>#r2} shares two annotations.

Independent ::%%limr%%{<#r3}**untouched range**::%%limr%%{>#r3} stays unchanged.

:::limr-annotation{#h-shared ranges="r1 r2" type="highlight" color="#6B9BD2" style="underline" hidden="false"}
:::

:::limr-annotation{#n-shared ranges="r1 r2" type="margin-note" agent="codex" threadId="fixture-thread" custom="retain-me"}
One note belongs to two ranges.
:::

:::limr-annotation{#q-only ranges="r1" type="question"}
This question belongs only to the primary range.
:::

:::limr-annotation{#h-other ranges="r3" type="highlight" color="#81B29A"}
:::

:::limr-annotation{#n-other ranges="r3" type="margin-note"}
An independent note.
:::
`;
const reusedRangeSource = `# LiMR regression

First ::%%limr%%{<#reused}**alpha range**::%%limr%%{>#reused} shares the name.

Second ::%%limr%%{<#reused}**beta range**::%%limr%%{>#reused} must survive.

:::limr-annotation{#h-reused ranges="reused" type="highlight" color="#B39DDB"}
:::

:::limr-annotation{#n-reused ranges="reused" type="margin-note" custom="preserved"}
One named annotation has two separate occurrences.
:::
`;

const model = source => createDocument(source, { id: 'regression-model', extensions: standard() }).getSnapshot();
const anchorQuotes = (annotation, source) => annotation.anchors.map(anchor => source.slice(anchor.range.start, anchor.range.end).replaceAll('**', ''));

export async function runRegressionAcceptance({ page, frame, host, artifacts }) {
  const evidence = [], errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await host('configure', { values: { editingEnabled: true, sidebarMode: 'hidden', tocMode: 'hidden', syncScroll: false, theme: 'one-dark-pro', maxWidth: 820 } });
  await host('layout', { sourceSize: .48 });
  const toolbar = frame.getByRole('toolbar');
  const overlay = frame.locator('.limr-annotation-overlay');
  const heading = () => frame.getByRole('heading', { name: 'LiMR regression', exact: true });
  const screenshot = name => page.screenshot({ path: path.join(artifacts, `${name}.png`) });
  async function reset(source) {
    await host('replaceSource', { source });
    await expect(heading()).toBeVisible();
    await frame.locator('[data-testid="reader-scroll"]').evaluate(element => element.scrollTop = 0);
    await heading().click();
    await frame.evaluate(() => document.fonts.ready);
  }
  async function saveEvidence(item) {
    evidence.push(item);
    await writeFile(path.join(artifacts, 'regression-progress.json'), JSON.stringify(evidence, null, 2));
    console.log(`Regression checked: ${item.check}`);
  }
  async function selectText(container, text) {
    const result = await container.evaluate((element, text) => {
      const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT, { acceptNode: node => node.parentElement.closest('[data-limr-ignore],button') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT });
      const nodes = []; let node, plain = '';
      while (node = walker.nextNode()) { nodes.push({ node, start: plain.length, end: plain.length + node.length }); plain += node.data; }
      const start = plain.indexOf(text), end = start + text.length;
      if (start < 0) throw new Error(`Selection text not found: ${text}; rendered: ${plain}`);
      const first = nodes.find(item => item.end > start), last = nodes.find(item => item.end >= end);
      const range = document.createRange(); range.setStart(first.node, start - first.start); range.setEnd(last.node, end - last.start);
      const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range); document.dispatchEvent(new Event('selectionchange'));
      return { text: selection.toString(), bounds: range.getBoundingClientRect().toJSON() };
    }, text);
    expect(result.text).toBe(text);
    await expect(toolbar).toBeVisible();
    return result;
  }
  async function settles(locator) {
    await expect.poll(() => locator.evaluate(element => element.getAnimations({ subtree: true }).filter(animation => ['running', 'paused'].includes(animation.playState)).length)).toBe(0);
  }
  async function fillsParent(locator) {
    const metrics = await locator.evaluate(element => {
      const parent = element.parentElement, css = getComputedStyle(parent), child = getComputedStyle(element);
      return { width: element.getBoundingClientRect().width, available: parent.clientWidth - parseFloat(css.paddingLeft) - parseFloat(css.paddingRight) - parseFloat(child.marginLeft) - parseFloat(child.marginRight), parent: parent.className, scrollWidth: element.scrollWidth, clientWidth: element.clientWidth };
    });
    expect(Math.abs(metrics.width - metrics.available)).toBeLessThanOrEqual(2);
    expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.clientWidth + 1);
    return metrics;
  }
  async function noHostFocusFrame(locator, label) {
    await locator.focus();
    await expect(locator).toBeFocused();
    const style = await locator.evaluate(element => {
      const css = getComputedStyle(element);
      return { outlineStyle: css.outlineStyle, outlineWidth: css.outlineWidth, outlineColor: css.outlineColor, boxShadow: css.boxShadow, border: css.border, focusVisible: element.matches(':focus-visible') };
    });
    expect(style.outlineStyle === 'none' || parseFloat(style.outlineWidth) === 0, `${label}: no VS Code focus outline`).toBe(true);
    expect(style.boxShadow, `${label}: no focus shadow`).toBe('none');
    return { label, ...style };
  }

  // Paired boundaries can cross Markdown nodes without rewriting their syntax.
  const paragraph = frame.locator('.limr-reader-content > article > p').first();
  const crossingSelections = [];
  for (const example of [
    { kind: 'bold', source: guideSource, text: '阅读器标签页，在 VS Code 原生编辑器', selector: 'strong' },
    { kind: 'italic', source: '# LiMR regression\n\nBefore _italic phrase_ after.\n', text: 'Before italic ph', selector: 'em' },
    { kind: 'link', source: '# LiMR regression\n\nBefore [linked phrase](https://example.com) after.\n', text: 'Before linked ph', selector: 'a' },
  ]) {
    await reset(example.source);
    const textBefore = await paragraph.innerText();
    const formattedBefore = (await paragraph.locator(example.selector).allTextContents()).join('');
    const selected = await selectText(paragraph, example.text);
    await toolbar.getByRole('button', { name: '添加高亮', exact: true }).click();
    await expect.poll(async () => (await host('snapshot')).source).toContain('::%%limr%%{<#');
    await expect(toolbar.getByRole('alert')).toHaveCount(0);
    expect(model((await host('snapshot')).source).annotations.filter(annotation => annotation.type === 'highlight')).toHaveLength(1);
    await expect(paragraph).toHaveText(textBefore);
    expect((await paragraph.locator(example.selector).allTextContents()).join('')).toBe(formattedBefore);
    crossingSelections.push({ kind: example.kind, ...selected });
    await screenshot(`regression-partial-${example.kind}-accepted`);
    await host('undo');
    expect((await host('snapshot')).source).toBe(example.source);
  }
  await reset(guideSource);
  const originalText = await paragraph.innerText();
  const originalStrong = (await paragraph.locator('strong').allTextContents()).join('');
  await reset(guideSource);
  const legalSelection = await selectText(paragraph, '阅读器标签页');
  await toolbar.getByRole('button', { name: '添加高亮', exact: true }).click();
  await expect.poll(async () => (await host('snapshot')).source).toContain('type="highlight"');
  await expect(frame.getByRole('alert')).toHaveCount(0);
  await expect(paragraph).toHaveText(originalText);
  expect((await paragraph.locator('strong').allTextContents()).join('')).toBe(originalStrong);
  const highlightSource = (await host('snapshot')).source;
  const highlights = model(highlightSource).annotations.filter(annotation => annotation.type === 'highlight');
  expect(highlights).toHaveLength(1);
  const paint = await frame.locator('.limr-highlight-layer .limr-paint-rect').evaluateAll(elements => {
    const rects = elements.map(element => element.getBoundingClientRect()).filter(rect => rect.width > 0 && rect.height > 0);
    return { left: Math.min(...rects.map(rect => rect.left)), right: Math.max(...rects.map(rect => rect.right)), top: Math.min(...rects.map(rect => rect.top)), bottom: Math.max(...rects.map(rect => rect.bottom)) };
  });
  expect(highlights[0].anchors).toHaveLength(1);
  expect(Math.abs(paint.left - legalSelection.bounds.left)).toBeLessThan(4);
  expect(Math.abs(paint.right - legalSelection.bounds.right)).toBeLessThan(4);
  await screenshot('regression-legal-selection-highlight');
  await host('undo');
  expect((await host('snapshot')).source).toBe(guideSource);
  await saveEvidence({ check: 'Paired annotation boundaries cross bold, italic and links while preserving rendering; each highlight is one native Undo operation', crossingSelections, legalSelection, paint, source: highlightSource });

  // A crossing annotation must preserve the named note and its existing paint.
  await reset(annotatedSource);
  const selectedParagraph = frame.locator('.limr-reader-content > article > p').first();
  await selectText(selectedParagraph, 'Before selected wo');
  await toolbar.getByRole('button', { name: '添加高亮', exact: true }).click();
  await expect.poll(async () => model((await host('snapshot')).source).annotations.length).toBe(model(annotatedSource).annotations.length + 1);
  expect(model((await host('snapshot')).source).annotations.find(annotation => annotation.id === 'n1').data.body)
    .toBe('A note whose editor must not inherit a VS Code focus rectangle.');
  await host('undo');
  expect((await host('snapshot')).source).toBe(annotatedSource);

  // Appending definitions after an unclosed code block is still rejected.
  const unclosedSource = annotatedSource + '\n```js\nconst unfinished = true;\n';
  await reset(unclosedSource);
  await selectText(selectedParagraph, 'Before');
  const beforeErrorWidth = (await toolbar.locator('.limr-toolbar-surface').boundingBox()).width;
  await toolbar.getByRole('button', { name: '添加高亮', exact: true }).click();
  const alert = toolbar.getByRole('alert');
  await expect(alert).toBeVisible();
  expect((await host('snapshot')).source).toBe(unclosedSource);
  const errorWidth = await fillsParent(alert);
  expect(Math.abs((await toolbar.locator('.limr-toolbar-surface').boundingBox()).width - beforeErrorWidth)).toBeLessThan(2);
  await screenshot('regression-error-panel-width');
  await reset(annotatedSource);
  await heading().click();
  await selectText(selectedParagraph, 'Before');
  const beforeHintWidth = (await toolbar.locator('.limr-toolbar-surface').boundingBox()).width;
  await toolbar.getByRole('button', { name: '提问上下文', exact: true }).hover();
  const hint = toolbar.locator('.lv-context-hint');
  await expect(hint).toBeVisible(); await settles(toolbar);
  const hintWidth = await fillsParent(hint);
  expect(hintWidth.width).toBeGreaterThan(290);
  expect(Math.abs((await toolbar.locator('.limr-toolbar-surface').boundingBox()).width - beforeHintWidth)).toBeLessThan(2);
  await screenshot('regression-context-panel-width');
  await saveEvidence({ check: 'Crossing ranges preserve existing notes; a real serialization error and the AI context hint fill the toolbar without overflow', errorWidth, hintWidth });

  // New drafts own their provisional shared paint until Save confirms them.
  const draftLifecycle = [];
  for (const scenario of ['escape-empty', 'escape-draft', 'blur-empty']) {
    await reset(guideSource);
    await selectText(paragraph, '阅读器标签页');
    await toolbar.getByRole('button', { name: '添加旁注', exact: true }).click();
    const draftEditor = frame.getByRole('textbox', { name: '旁注内容', exact: true });
    await expect(draftEditor).toBeVisible();
    await expect(draftEditor).toBeEnabled();
    await expect(draftEditor).toBeFocused();
    await expect(toolbar).toHaveCount(0);
    if (scenario === 'escape-draft') await draftEditor.fill('This draft must be discarded.');
    if (scenario === 'blur-empty') await heading().click();
    else await draftEditor.press('Escape');
    await expect.poll(async () => model((await host('snapshot')).source).annotations.length).toBe(0);
    const after = (await host('snapshot')).source;
    expect(after).not.toContain('::%%limr%%');
    expect(after.trimEnd()).toBe(guideSource.trimEnd());
    draftLifecycle.push({ scenario, annotations: 0, boundaryMarkers: 0 });
  }
  await reset(annotatedSource);
  await selectedParagraph.locator('strong').click();
  await toolbar.getByRole('button', { name: '添加旁注', exact: true }).click();
  const sharedDraft = frame.getByRole('textbox', { name: '旁注内容', exact: true });
  await expect(sharedDraft).toBeEnabled();
  await sharedDraft.press('Escape');
  await expect.poll(async () => model((await host('snapshot')).source).annotations.map(item => item.id).sort().join(','))
    .toBe(model(annotatedSource).annotations.map(item => item.id).sort().join(','));
  expect((await host('snapshot')).source).toContain('::%%limr%%{<#r1}**selected words**::%%limr%%{>#r1}');
  draftLifecycle.push({ scenario: 'cancel-with-existing-highlight', retained: ['h1', 'n1', 'q1'] });
  await saveEvidence({ check: 'Escape and blank blur remove only the new annotation and provisional paint; existing shared highlights and notes survive cancellation', draftLifecycle });
  await reset(annotatedSource);

  // Native GFM footnote plus the editable source-annotation note are separate paths.
  await heading().click();
  await selectedParagraph.evaluate(element => {
    const scroll = document.querySelector('[data-testid="reader-scroll"]');
    scroll.scrollTop += element.getBoundingClientRect().top - scroll.getBoundingClientRect().top - 18;
  });
  await selectedParagraph.locator('strong').click();
  await expect(toolbar).toBeVisible();
  await frame.locator('.limr-reader-content').getByRole('button', { name: '脚注', exact: true }).click();
  await expect(overlay).toBeVisible(); await settles(overlay);
  await expect(overlay).toContainText('An actual Markdown footnote');
  const hitTests = await overlay.evaluate(element => {
    const rect = element.getBoundingClientRect();
    return [[.1, .1], [.5, .1], [.9, .1], [.5, .5], [.9, .9]].map(([x, y]) => {
      const hit = document.elementFromPoint(rect.left + rect.width * x, rect.top + rect.height * y);
      return { x, y, inOverlay: element.contains(hit), hit: hit?.tagName, className: hit?.className };
    });
  });
  expect(hitTests.every(hit => hit.inOverlay)).toBe(true);
  const focus = [await noHostFocusFrame(frame.locator('.limr-overlay-positioner'), 'overlay focus manager')];
  await screenshot('regression-highlight-then-footnote');
  await overlay.getByRole('button', { name: '关闭', exact: true }).click();
  await expect(overlay).toHaveCount(0);
  await frame.locator('.limr-reader-content').getByRole('button', { name: '旁注', exact: true }).click();
  await overlay.getByRole('button', { name: '编辑旁注', exact: true }).click();
  let editor = overlay.getByRole('textbox', { name: '旁注内容', exact: true });
  focus.push(await noHostFocusFrame(editor, 'overlay textarea'));
  await screenshot('regression-overlay-editor-focus');
  await editor.press('Escape');
  await overlay.getByRole('button', { name: '关闭', exact: true }).click();
  await host('configure', { values: { sidebarMode: 'always', tocMode: 'always' } });
  await host('layout', { sourceSize: .18 });
  const tocLink = frame.locator('.limr-reader-toc .limr-toc a').first();
  await expect(tocLink).toBeVisible();
  focus.push(await noHostFocusFrame(tocLink, 'TOC link'));
  focus.push(await noHostFocusFrame(frame.locator('.limr-reader-toc .limr-toc-scroll'), 'TOC scroll area'));
  const sidebar = frame.locator('.limr-sidebar-card[data-type="margin-note"]').first();
  await sidebar.getByRole('button', { name: '编辑旁注', exact: true }).click();
  editor = sidebar.getByRole('textbox', { name: '旁注内容', exact: true });
  focus.push(await noHostFocusFrame(editor, 'sidebar textarea'));
  await screenshot('regression-sidebar-editor-focus');
  await editor.press('Escape');
  expect((await host('snapshot')).source).toBe(annotatedSource);
  await reset(guideSource);
  await reset(annotatedSource);
  const markerActions = [];
  for (const [label, image] of [['旁注', 'note'], ['脚注', 'footnote']]) {
    await heading().click();
    await frame.locator('.limr-reader-content').getByRole('button', { name: label, exact: true }).click();
    const deleteAction = toolbar.locator('[data-action-id="delete-annotations"]');
    if (label === '旁注') {
      await expect(toolbar).toBeVisible();
      await expect(deleteAction.getByRole('button', { name: '删除', exact: true })).toBeVisible();
    } else {
      await expect(deleteAction).toHaveCount(0);
    }
    markerActions.push({ label, deleteVisible: label === '旁注', reason: label === '旁注' ? 'Editable source annotation' : 'Ordinary GFM footnote is read-only' });
    await screenshot(`regression-wide-${image}-marker-delete`);
  }
  await saveEvidence({ check: 'Clicking a highlight then a real footnote leaves the overlay above every hit-test point; TOC, overlay and sidebar editors have no host focus frame; wide editable note markers expose Delete while read-only GFM footnotes do not', hitTests, focus, markerActions });

  await host('configure', { values: { sidebarMode: 'hidden', tocMode: 'hidden' } });
  await host('layout', { sourceSize: .48 });
  async function deleteRange(source, reused = false, fromMarker = false) {
    await host('configure', { values: { sidebarMode: fromMarker ? 'always' : 'hidden' } });
    await host('layout', { sourceSize: fromMarker ? .18 : .48 });
    await reset(source);
    if (fromMarker) await frame.locator('.limr-reader-content > article > p').first().getByRole('button', { name: '旁注', exact: true }).click();
    else await frame.locator('.limr-reader-content strong').filter({ hasText: 'alpha range' }).click();
    const remove = toolbar.locator('[data-action-id="delete-annotations"]').getByRole('button', { name: '删除', exact: true });
    await expect(remove).toBeVisible();
    await remove.hover();
    const warning = toolbar.locator('.limr-toolbar-delete-warning');
    if (!reused) {
      await expect(warning).toHaveAttribute('aria-hidden', 'false');
      await expect(warning).toContainText('2');
      await settles(toolbar);
      await fillsParent(warning);
    }
    const before = await host('snapshot');
    await screenshot(reused ? 'regression-reused-range-before-delete' : 'regression-delete-all-hint');
    await remove.click();
    await expect.poll(async () => (await host('snapshot')).source).not.toBe(source);
    const after = await host('snapshot');
    expect(after.version).toBe(before.version + 1);
    const parsed = model(after.source);
    if (reused) {
      expect(parsed.annotations.map(annotation => annotation.id).sort()).toEqual(['h-reused', 'n-reused']);
      for (const annotation of parsed.annotations) expect(anchorQuotes(annotation, after.source)).toEqual(['beta range']);
      expect(parsed.annotations.find(annotation => annotation.id === 'n-reused').data.custom).toBe('preserved');
    } else {
      expect(parsed.annotations.map(annotation => annotation.id).sort()).toEqual(['h-other', 'h-shared', 'n-other', 'n-shared']);
      for (const id of ['h-shared', 'n-shared']) expect(anchorQuotes(parsed.annotations.find(annotation => annotation.id === id), after.source)).toEqual(['beta range']);
      for (const id of ['h-other', 'n-other']) expect(anchorQuotes(parsed.annotations.find(annotation => annotation.id === id), after.source)).toEqual(['untouched range']);
      const note = parsed.annotations.find(annotation => annotation.id === 'n-shared');
      expect(note.data).toMatchObject({ agent: 'codex', threadId: 'fixture-thread', custom: 'retain-me' });
      expect(parsed.annotations.find(annotation => annotation.id === 'h-shared').data).toMatchObject({ color: '#6B9BD2', style: 'underline', hidden: false });
      expect(parsed.annotationRanges.has('r1')).toBe(false);
    }
    await expect(frame.locator('.limr-reader-content strong').filter({ hasText: 'alpha range' })).toBeVisible();
    await screenshot(reused ? 'regression-reused-range-after-delete' : 'regression-delete-all-after');
    await host('undo'); expect((await host('snapshot')).source).toBe(source);
    await host('redo'); expect((await host('snapshot')).source).toBe(after.source);
    await host('undo'); expect((await host('snapshot')).source).toBe(source);
    return { reused, fromMarker, beforeVersion: before.version, afterVersion: after.version, afterSource: after.source, remaining: parsed.annotations.map(annotation => ({ id: annotation.id, anchors: anchorQuotes(annotation, after.source) })) };
  }
  const deletion = [await deleteRange(multiRangeSource, false, true), await deleteRange(reusedRangeSource, true)];
  await host('configure', { values: { editingEnabled: false } });
  await frame.locator('.limr-reader-content strong').filter({ hasText: 'alpha range' }).click();
  await expect(toolbar).toBeVisible();
  await expect(toolbar.locator('[data-action-id="delete-annotations"]')).toHaveCount(0);
  await saveEvidence({ check: 'Delete removes all annotations/highlight from only the clicked range, preserves other anchors and reused range occurrences, gates read-only writes and uses one native Undo transaction', deletion });

  // Center against the whole reader viewport, including the space occupied by
  // the TOC. A centered grid body cell alone can still shift the article right.
  const layoutSource = annotatedSource + '\n' + Array.from({ length: 35 }, (_, index) => `Reading paragraph ${index + 1} exercises scrolling and responsive reading width.\n\n`).join('');
  const measureLayout = () => frame.evaluate(() => {
    const scroll = document.querySelector('[data-testid="reader-scroll"]'), reader = document.querySelector('.lv-reader'), body = document.querySelector('.limr-reader-content'), sidebar = document.querySelector('.limr-sidebar'), tocRail = document.querySelector('.limr-reader-toc');
    const root = scroll.getBoundingClientRect(), rect = reader.getBoundingClientRect(), bodyRect = body.getBoundingClientRect(), css = getComputedStyle(scroll);
    const visible = element => !!element && getComputedStyle(element).visibility !== 'hidden' && element.getBoundingClientRect().width > 0 && element.getBoundingClientRect().height > 0;
    const toc = tocRail?.querySelector('.limr-toc'), mobile = reader.querySelector('.limr-reader-mobile-toc');
    const tocRect = visible(toc) ? toc.getBoundingClientRect() : null;
    return { viewport: innerWidth, scrollClient: scroll.clientWidth, scrollWidth: scroll.scrollWidth, scrollTop: scroll.scrollTop,
      readerWidth: rect.width, contentBoxWidth: scroll.clientWidth - parseFloat(css.paddingLeft) - parseFloat(css.paddingRight), centeredToc: reader.classList.contains('lv-centered-toc'), left: rect.left - root.left, right: root.left + scroll.clientWidth - rect.right,
      topPadding: parseFloat(css.paddingTop), bodyWidth: bodyRect.width, bodyLeft: bodyRect.left - root.left, bodyRight: bodyRect.right - root.left,
      bodyCenterError: bodyRect.left + bodyRect.width / 2 - (root.left + scroll.clientWidth / 2),
      sidebarWidth: visible(sidebar) ? sidebar.getBoundingClientRect().width : 0,
      headingTop: document.querySelector('h1').getBoundingClientRect().top - root.top,
      tocEnabled: reader.hasAttribute('data-toc'), tocRailDisplay: tocRail ? getComputedStyle(tocRail).display : null,
      desktopToc: !!tocRect, mobileToc: visible(mobile), tocLeft: tocRect ? tocRect.left - root.left : null,
      tocTop: tocRect ? tocRect.top - root.top : null,
      tocRight: tocRect ? tocRect.right - root.left : null, tocGap: tocRect ? bodyRect.left - tocRect.right : null,
    };
  });
  const layouts = [];
  for (const size of [
    { name: 'wide', width: 2560, height: 1100, sourceSize: .18 },
    { name: 'medium', width: 1920, height: 1080, sourceSize: .40 },
    { name: 'narrow', width: 1920, height: 1080, sourceSize: .72 },
  ]) {
    await page.setViewportSize({ width: size.width, height: size.height });
    await host('layout', { sourceSize: size.sourceSize });
    for (const showSidebar of [true, false]) for (const showToc of [true, false]) {
      const name = `${size.name}-sidebar-${showSidebar ? 'on' : 'off'}-toc-${showToc ? 'on' : 'off'}`;
      await host('configure', { values: { sidebarMode: showSidebar ? 'always' : 'hidden', tocMode: showToc ? 'always' : 'hidden', maxWidth: 820 } });
      await reset(layoutSource);
      // ResizeObserver controls Reader's responsive attributes. Wait for two
      // animation frames after the settings have reached the rendered tree.
      await frame.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      const measured = await measureLayout();
      layouts.push({ name, showSidebar, tocMode: showToc ? 'always' : 'hidden', ...measured });
      await writeFile(path.join(artifacts, 'layout-matrix.json'), JSON.stringify(layouts, null, 2));
      expect(measured.scrollWidth, `${name}: no horizontal overflow`).toBeLessThanOrEqual(measured.scrollClient + 1);
      expect(measured.bodyWidth, `${name}: configured reading width`).toBeLessThanOrEqual(821);
      expect(measured.topPadding, `${name}: original compact top gap restored`).toBe(measured.viewport <= 580 ? 12 : 18);
      expect(Math.abs(measured.left - measured.right), `${name}: symmetric outer gutters`).toBeLessThan(2);
      if (!showSidebar || size.name === 'narrow') expect(measured.sidebarWidth).toBe(0);
      if (showSidebar && size.name === 'wide') expect(measured.sidebarWidth).toBeGreaterThan(300);
      if (!measured.sidebarWidth) expect(Math.abs(measured.bodyCenterError), `${name}: body centered in entire viewport`).toBeLessThan(2);
      if (showToc) {
        expect(measured.desktopToc !== measured.mobileToc, `${name}: exactly one TOC presentation`).toBe(true);
        if (measured.desktopToc) {
          expect(measured.tocLeft, `${name}: TOC has a larger left inset`).toBeGreaterThanOrEqual(28);
          expect(Math.abs(measured.tocLeft - measured.left), `${name}: TOC stays at the left reader edge`).toBeLessThan(2);
          expect(measured.tocGap, `${name}: TOC does not cover text`).toBeGreaterThanOrEqual(16);
          await expect(frame.locator('.limr-reader-toc .limr-toc a').first()).toBeVisible();
        } else {
          const mobileToc = frame.locator('.limr-reader-mobile-toc');
          const toggle = mobileToc.locator('.limr-mobile-toc-toggle');
          if (await toggle.getAttribute('aria-expanded') !== 'true') await toggle.click();
          await expect(mobileToc.getByRole('link', { name: 'Another section', exact: true })).toBeVisible();
          await toggle.click();
        }
      } else expect(measured.desktopToc || measured.mobileToc).toBe(false);
      await screenshot(`regression-layout-${name}`);
      if (size.name === 'wide' && showToc) {
        await frame.locator('[data-testid="reader-scroll"]').evaluate(element => element.scrollTop = 180);
        const scrolled = await measureLayout();
        expect(measured.headingTop - scrolled.headingTop).toBeCloseTo(180, 0);
        if (!showSidebar) {
          await frame.locator('[data-testid="reader-scroll"]').evaluate(element => element.scrollTop = 320);
          const furtherScrolled = await measureLayout();
          expect(furtherScrolled.desktopToc).toBe(true);
          expect(Math.abs(furtherScrolled.tocTop - scrolled.tocTop), `${name}: TOC remains sticky while article scrolls`).toBeLessThan(2);
          expect(scrolled.headingTop - furtherScrolled.headingTop).toBeCloseTo(140, 0);
          expect(Math.abs(furtherScrolled.bodyCenterError)).toBeLessThan(2);
          layouts.at(-1).scrolling = { first: scrolled, second: furtherScrolled };
          await writeFile(path.join(artifacts, 'layout-matrix.json'), JSON.stringify(layouts, null, 2));
          await screenshot('regression-layout-wide-sidebar-off-toc-on-scrolled');
        }
      }
    }
  }
  const wideSidebar = layouts.find(item => item.name === 'wide-sidebar-on-toc-on');
  const wideSidebarNoToc = layouts.find(item => item.name === 'wide-sidebar-on-toc-off');
  expect(wideSidebarNoToc.sidebarWidth).toBeGreaterThan(wideSidebar.sidebarWidth);
  // A user font/measure setting can move a fixed-width reader across the TOC
  // boundary. Probe both sides in place instead of relying on window sizes alone.
  await page.setViewportSize({ width: 1920, height: 1080 });
  await host('layout', { sourceSize: .40 });
  await host('configure', { values: { sidebarMode: 'hidden', tocMode: 'always', maxWidth: 820 } });
  await reset(layoutSource);
  const medium = await measureLayout();
  const boundaryWidth = Math.floor(medium.contentBoxWidth - 448);
  expect(boundaryWidth).toBeGreaterThanOrEqual(400);
  const boundaries = [];
  for (const maxWidth of [400, boundaryWidth, boundaryWidth + 2, 1000, 1600]) {
    await host('configure', { values: { maxWidth } });
    await expect.poll(() => frame.evaluate(() => document.body.style.getPropertyValue('--lv-content-width'))).toBe(`${maxWidth}px`);
    await frame.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const measured = await measureLayout();
    const desktop = measured.contentBoxWidth >= maxWidth + 448;
    boundaries.push({ maxWidth, expectedDesktopToc: desktop, ...measured });
    await writeFile(path.join(artifacts, 'layout-toc-boundaries.json'), JSON.stringify(boundaries, null, 2));
    expect(measured.desktopToc, `maxWidth ${maxWidth}: TOC follows available side space`).toBe(desktop);
    expect(measured.mobileToc).toBe(!desktop);
    expect(Math.abs(measured.bodyCenterError)).toBeLessThan(2);
    expect(measured.bodyWidth).toBeLessThanOrEqual(maxWidth + 1);
    expect(measured.scrollWidth).toBeLessThanOrEqual(measured.scrollClient + 1);
    if (desktop) {
      expect(measured.tocLeft).toBeGreaterThanOrEqual(28);
      expect(Math.abs(measured.tocLeft - measured.left)).toBeLessThan(2);
      expect(measured.tocGap).toBeGreaterThanOrEqual(16);
    }
    if (maxWidth === 1600) expect(Math.abs(measured.bodyWidth - measured.contentBoxWidth), 'Oversized reading measure fills the available width').toBeLessThan(2);
    await screenshot(`regression-layout-maxwidth-${maxWidth}`);
  }
  await saveEvidence({ check: 'Wide/medium/narrow layouts cover every sidebar and TOC setting; without a sidebar the body is centered in the whole viewport, the left TOC adapts to maxWidth and side space, and compact top spacing is restored', layouts, boundaries });
  expect(errors).toEqual([]);
  return evidence;
}
