import { expect } from '@playwright/test';
import path from 'node:path';
import { writeFile } from 'node:fs/promises';
import { runSidebarMotionAcceptance } from './sidebar-motion.mjs';
import { runBlockMotion } from './block-motion.mjs';

const fixture = `# LiMR motion

Read ::%%limr%%{<#r1}**selected words**::%%limr%%{>#r1} today.

This paragraph leaves room to inspect the reader while annotations move.

- [ ] Animated task

:::limr-annotation{#h1 ranges="r1" type="highlight" color="#E5C07B"}
:::

:::limr-annotation{#n1 ranges="r1" type="margin-note"}
A **note with several paragraphs** makes expansion measurable.

Second paragraph explains the selected passage in more detail.

Third paragraph preserves enough content for a sidebar collapse.

Fourth paragraph shows that text keeps its natural size during a card morph.

Fifth paragraph checks that opening and closing settle into a stable layout.
:::
`;

export async function runAnimationAcceptance({ page, frame, host, artifacts }) {
  const evidence = [];
  const originalReducedMotion = await frame.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches);
  const originalBodyClasses = await frame.locator('body').getAttribute('class');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await expect.poll(() => frame.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches)).toBe(false);
  await host('configure', { values: { editingEnabled: true, sidebarMode: 'hidden', syncScroll: false, theme: 'playground-dark' } });
  await host('replaceSource', { source: fixture });
  await expect(frame.getByRole('heading', { name: 'LiMR motion', exact: true })).toBeVisible();
  await frame.evaluate(() => document.fonts.ready);
  evidence.push({ check: 'Record the real Windows motion preference and explicitly verify the normal animation path', originalReducedMotion, originalBodyClasses });

  async function capture(locator, name, { requireMotion = true } = {}) {
    await expect(locator).toBeVisible();
    const { natural, timing } = await locator.evaluate(async element => {
      const samples = [];
      const animations = element.getAnimations({ subtree: true });
      for (let count = 0; count < 4; count++) {
        const css = getComputedStyle(element);
        samples.push({ now: performance.now(), opacity: css.opacity, transform: css.transform, background: css.backgroundColor, backgroundSize: css.backgroundSize, rect: element.getBoundingClientRect().toJSON(), intent: element.getAttribute('data-state'), motion: element.getAttribute('data-motion'), hovered: element.matches(':hover'), animations: animations.map(animation => ({ state: animation.playState, currentTime: animation.currentTime })) });
        await new Promise(requestAnimationFrame);
      }
      for (const animation of animations) animation.pause();
      const end = Math.max(1, ...animations.map(animation => Number(animation.effect.getComputedTiming().endTime)));
      window.__limrMotionSample = { element, animations, end };
      return { natural: samples, timing: animations.map(animation => ({
        name: animation instanceof CSSAnimation ? animation.animationName : animation instanceof CSSTransition ? animation.transitionProperty : 'Web Animation',
        target: animation.effect.target.className,
        timing: animation.effect.getTiming(), frames: animation.effect.getKeyframes(),
      })) };
    });
    const advancing = natural.slice(1).some((sample, index) => sample.animations.some((animation, position) => animation.state === 'running' && typeof animation.currentTime === 'number' && animation.currentTime > (natural[index].animations[position]?.currentTime ?? Infinity)));
    if (requireMotion) expect(advancing, `${name} naturally advances before deterministic sampling`).toBe(true);
    if (requireMotion) expect(timing.length, `${name} has actual running or retained animations`).toBeGreaterThan(0);
    const samples = [];
    for (const [label, fraction] of [['start', 0], ['middle', .35], ['end', 1]]) {
      const sample = await frame.evaluate(async fraction => {
        const { element, animations, end } = window.__limrMotionSample;
        for (const animation of animations) animation.currentTime = end * fraction;
        await new Promise(requestAnimationFrame);
        const shell = element.querySelector('.limr-overlay-surface') ?? element;
        const body = element.querySelector('.limr-overlay-card,.limr-collapse-inner') ?? element;
        const css = getComputedStyle(element), bodyCss = getComputedStyle(body);
        return { rect: element.getBoundingClientRect().toJSON(), shell: shell.getBoundingClientRect().toJSON(), opacity: Number(css.opacity), transform: css.transform, clipPath: css.clipPath, background: css.backgroundColor, backgroundSize: css.backgroundSize, bodyFontSize: bodyCss.fontSize, bodyTransform: bodyCss.transform, state: element.getAttribute('data-state'), connected: element.isConnected };
      }, fraction);
      samples.push({ label, ...sample });
      await page.screenshot({ path: path.join(artifacts, `${name}-${label}.png`) });
    }
    await frame.evaluate(() => { for (const animation of window.__limrMotionSample.animations) animation.finish(); });
    const naturalFrameChanges = new Set(natural.map(({ opacity, transform, background, backgroundSize, rect, animations }) => JSON.stringify({ opacity, transform, background, backgroundSize, rect, times: animations.map(animation => animation.currentTime) }))).size;
    const result = { check: name, natural, naturalFrameChanges, advancing, timing, samples };
    await writeFile(path.join(artifacts, `${name}.json`), JSON.stringify(result, null, 2));
    evidence.push(result);
    console.log(`Animation checked: ${name}`);
    return result;
  }
  async function settle(locator) {
    await expect.poll(() => locator.evaluate(element => element.getAnimations({ subtree: true }).filter(animation => animation.playState === 'running' || animation.playState === 'paused').length)).toBe(0);
  }
  const select = async () => {
    await frame.locator('.limr-reader-content strong').first().evaluate(element => {
      const range = document.createRange(); range.selectNodeContents(element);
      getSelection().removeAllRanges(); getSelection().addRange(range); document.dispatchEvent(new Event('selectionchange'));
    });
    await expect(frame.getByRole('toolbar')).toBeVisible();
  };

  await select();
  const toolbar = frame.getByRole('toolbar');
  const entry = await capture(toolbar.locator('.limr-toolbar-surface'), 'toolbar-entry');
  const floats = entry.timing.filter(item => item.name === 'limr-tool-float' && String(item.target).includes('limr-toolbar-item'));
  expect(floats.length).toBeGreaterThan(3);
  for (let index = 1; index < floats.length; index++) expect(Number(floats[index].timing.delay)).toBeGreaterThan(Number(floats[index - 1].timing.delay));
  expect(entry.samples[0].opacity).toBe(0);
  expect(entry.samples[1].opacity).toBeGreaterThan(0);
  expect(entry.samples[2].opacity).toBe(1);
  const actionsBefore = await toolbar.locator('.limr-toolbar-actions').boundingBox();
  await toolbar.getByRole('button', { name: '提问上下文', exact: true }).hover();
  const panel = await capture(toolbar.locator('.limr-toolbar-panel'), 'toolbar-context-hover');
  expect(panel.samples[0].opacity).toBe(0); expect(panel.samples[2].opacity).toBe(1);
  const actionsAfter = await toolbar.locator('.limr-toolbar-actions').boundingBox();
  expect(actionsAfter.y).toBeCloseTo(actionsBefore.y, 0);
  await toolbar.getByRole('button', { name: '复制', exact: true }).hover();
  await expect(toolbar.locator('.limr-toolbar-panel')).toHaveCount(0);
  await toolbar.getByRole('button', { name: '复制', exact: true }).click();
  await expect(toolbar.getByRole('button', { name: '已复制', exact: true })).toBeVisible();
  const copiedFaces = toolbar.getByRole('button', { name: '已复制', exact: true }).locator('.limr-tool-faces');
  const copied = await capture(copiedFaces, 'toolbar-copy-feedback');
  expect(copied.timing.some(item => item.name === 'width')).toBe(true);
  expect(copied.samples[2].rect.width).toBeGreaterThan(copied.samples[0].rect.width);
  await expect(toolbar.getByRole('button', { name: '复制', exact: true })).toBeVisible({ timeout: 4000 });
  await frame.getByRole('heading', { name: 'LiMR motion', exact: true }).click();
  await expect(toolbar).toHaveCount(0);

  const text = frame.locator('.limr-reader-content strong').first();
  const paint = frame.locator('.limr-paint-background').first();
  const highlightBefore = await paint.evaluate(element => getComputedStyle(element).backgroundColor);
  await text.hover();
  await expect(paint).toHaveAttribute('data-hovered');
  const highlight = await capture(paint, 'highlight-hover');
  expect(highlight.samples[2].background).not.toBe(highlightBefore);
  await frame.getByRole('heading', { name: 'LiMR motion', exact: true }).hover();
  await expect(paint).not.toHaveAttribute('data-hovered');
  await expect(frame.locator('.limr-annotation-overlay')).toHaveCount(0);

  const marker = frame.locator('.limr-reader-content').getByRole('button', { name: '旁注', exact: true });
  await marker.hover();
  const overlay = frame.locator('.limr-annotation-overlay');
  const opened = await capture(overlay, 'overlay-preview-open');
  expect(opened.samples[0].opacity).toBe(0); expect(opened.samples[2].opacity).toBe(1);
  const preview = opened.samples[2].shell;
  await marker.click();
  await expect(overlay).toHaveClass(/limr-annotation-expanded/);
  const expanded = await capture(overlay, 'overlay-expand');
  expect(expanded.samples[0].shell.width).toBeCloseTo(preview.width, 0);
  expect(expanded.samples[2].shell.width).toBeGreaterThan(preview.width);
  expect(new Set(expanded.samples.map(sample => sample.bodyFontSize)).size).toBe(1);
  await settle(overlay);
  const edit = overlay.getByRole('button', { name: '编辑旁注', exact: true });
  await edit.hover();
  const underline = await capture(edit.locator('.limr-underline'), 'annotation-edit-underline');
  expect(underline.samples[0].backgroundSize).toBe('0% 1px');
  expect(underline.samples[2].backgroundSize).toBe('100% 1px');
  await edit.click();
  const editor = overlay.getByRole('textbox', { name: '旁注内容', exact: true });
  await expect(editor).toBeFocused();
  await editor.fill('A new draft keeps **Markdown** and a stable edit surface.');
  await editor.press('Control+Enter');
  await expect(editor).toHaveCount(0);
  await expect(overlay).toHaveCSS('opacity', '1');
  await overlay.getByRole('button', { name: '收起', exact: true }).click();
  const collapsed = await capture(overlay, 'overlay-collapse');
  expect(collapsed.samples[2].shell.width).toBeLessThan(collapsed.samples[0].shell.width);
  await overlay.getByRole('button', { name: '展开', exact: true }).click();
  await settle(overlay);
  await overlay.getByRole('button', { name: '关闭', exact: true }).evaluate(element => element.click());
  const closed = await capture(overlay, 'overlay-close');
  expect(closed.samples[0].opacity).toBeGreaterThan(.9); expect(closed.samples[2].opacity).toBe(0);
  await expect(overlay).toHaveCount(0);

  // A document save and a native editor tab cycle must retain a live animation context.
  await host('save');
  await host('tabCycle');
  await marker.hover();
  const reopened = await capture(overlay, 'overlay-after-save-tab-cycle');
  expect(reopened.samples[2].opacity).toBe(1);
  const reversalHeading = await frame.getByRole('heading', { name: 'LiMR motion', exact: true }).boundingBox();
  const reversalMarker = await marker.boundingBox();
  await frame.evaluate(() => {
    const samples = [], started = performance.now();
    window.__limrOverlayReversal = new Promise(resolve => {
      const tick = () => {
        const element = document.querySelector('.limr-annotation-overlay');
        samples.push({ time: performance.now() - started, state: element?.getAttribute('data-state'), motion: element?.getAttribute('data-motion'), opacity: element ? Number(getComputedStyle(element).opacity) : 0 });
        if (performance.now() - started < 1400) requestAnimationFrame(tick);
        else resolve(samples);
      }; tick();
    });
  });
  await page.mouse.move(reversalHeading.x + reversalHeading.width / 2, reversalHeading.y + reversalHeading.height / 2);
  await expect(overlay).toHaveAttribute('data-motion', 'closing');
  await page.mouse.move(reversalMarker.x + reversalMarker.width / 2, reversalMarker.y + reversalMarker.height / 2);
  const reversal = await frame.evaluate(() => window.__limrOverlayReversal);
  await writeFile(path.join(artifacts, 'overlay-exit-reversal.json'), JSON.stringify(reversal, null, 2));
  const exitIndex = reversal.findIndex(sample => sample.motion === 'closing');
  const returnIndex = reversal.findIndex((sample, index) => index > exitIndex && sample.motion === 'opening');
  expect(exitIndex).toBeGreaterThanOrEqual(0);
  expect(returnIndex).toBeGreaterThan(exitIndex);
  expect(reversal.slice(exitIndex, returnIndex).some(sample => sample.opacity < .95)).toBe(true);
  expect(reversal.at(-1).opacity).toBe(1);
  expect(reversal.slice(exitIndex).every(sample => sample.state)).toBe(true);
  await page.screenshot({ path: path.join(artifacts, 'overlay-exit-reversal-end.png') });
  evidence.push({ check: 'overlay-exit-reversal', natural: true, samples: reversal });
  console.log('Animation checked: overlay-exit-reversal');
  await frame.getByRole('heading', { name: 'LiMR motion', exact: true }).hover();
  await expect(overlay).toHaveCount(0);

  // Modern appearance uses another style branch from the default classic Playground.
  await host('configure', { values: { theme: 'one-dark-pro' } });
  await expect(frame.locator('body')).toHaveAttribute('data-reader-theme', 'one-dark-pro');
  await select();
  await capture(toolbar.locator('.limr-toolbar-surface'), 'onedark-toolbar-entry');
  await frame.getByRole('heading', { name: 'LiMR motion', exact: true }).click();
  await text.hover();
  await capture(paint, 'onedark-highlight-hover');
  await frame.getByRole('heading', { name: 'LiMR motion', exact: true }).hover();
  await expect(overlay).toHaveCount(0);
  await marker.hover();
  await capture(overlay, 'onedark-overlay-preview');
  await marker.click();
  await capture(overlay, 'onedark-overlay-expand');
  await overlay.getByRole('button', { name: '关闭', exact: true }).click();
  await expect(overlay).toHaveCount(0);
  await host('configure', { values: { theme: 'playground-dark' } });

  await host('replaceSource', { source: fixture });
  await host('configure', { values: { sidebarMode: 'always' } });
  await host('layout', { sourceSize: .18 });
  const sidebar = frame.locator('.limr-sidebar-card[data-type="margin-note"]').first();
  await expect(sidebar).toBeVisible();
  const sidebarBefore = await sidebar.boundingBox();
  await sidebar.locator('.limr-sidebar-card-heading').click();
  await expect(sidebar).toHaveAttribute('data-expanded');
  const sidebarOpen = await capture(sidebar, 'sidebar-expand');
  expect(sidebarOpen.timing.some(item => item.name === 'grid-template-rows')).toBe(true);
  expect(sidebarOpen.samples[2].rect.height).toBeGreaterThan(sidebarBefore.height);
  await sidebar.locator('.limr-sidebar-card-heading').click();
  const sidebarClosed = await capture(sidebar, 'sidebar-collapse');
  expect(sidebarClosed.samples[2].rect.height).toBeLessThan(sidebarClosed.samples[0].rect.height);
  await settle(sidebar);
  await expect(sidebar).not.toHaveAttribute('data-expanded');

  await host('configure', { values: { sidebarMode: 'hidden' } });
  await host('layout', { sourceSize: .5 });
  const checkbox = frame.getByRole('checkbox');
  await checkbox.evaluate(element => { window.__limrTaskNode = element; });
  await checkbox.click();
  const taskMotion = await capture(frame.locator('.limr-task-item .limr-diamond-fill'), 'task-checkbox-toggle');
  expect(taskMotion.samples[0].transform).not.toBe(taskMotion.samples[2].transform);
  await expect(checkbox).toBeChecked();
  expect(await checkbox.evaluate(element => element === window.__limrTaskNode)).toBe(true);
  expect((await host('snapshot')).source).toContain('- [x] Animated task');

  const resources = '# Motion resources\n\n```typescript\nconst animated = true;\n```\n\n```mermaid\nflowchart LR\n  A[Read] --> B[Annotate]\n```\n';
  await host('replaceSource', { source: resources });
  const codeCopy = frame.locator('.limr-code-header .limr-copy-button').first();
  await codeCopy.click();
  await expect(codeCopy).toHaveAttribute('data-status', 'copied');
  const codeMotion = await capture(codeCopy.locator('.limr-copy-glyph'), 'code-copy-feedback');
  expect(codeMotion.timing.some(item => item.name === 'stroke-dashoffset')).toBe(true);
  const diagram = frame.locator('[data-mermaid-state="ready"]');
  await expect(diagram).toBeVisible({ timeout: 15000 });
  await diagram.hover();
  await capture(diagram.locator('.limr-block-tools'), 'mermaid-tools-hover');
  await diagram.getByRole('button', { name: '放大', exact: true }).click();
  const zoom = await capture(diagram.locator('.limr-mermaid-canvas'), 'mermaid-zoom');
  expect(zoom.samples[2].rect.width).toBeGreaterThan(zoom.samples[0].rect.width);

  const longSource = '# Scroll start\n\n' + Array.from({ length: 42 }, (_, index) => `Paragraph ${index + 1} keeps enough reading distance to inspect smooth scrolling with source synchronization enabled.\n\n`).join('') + '## Scroll target\n\n' + 'After the target.\n\n'.repeat(30);
  await host('configure', { values: { tocMode: 'always', syncScroll: true } });
  await host('layout', { sourceSize: .64 });
  await host('replaceSource', { source: longSource });
  const mobileToc = frame.locator('.limr-reader-mobile-toc');
  await expect(mobileToc).toBeVisible();
  await mobileToc.locator('.limr-mobile-toc-toggle').click();
  const tocOpen = await capture(mobileToc, 'mobile-toc-expand');
  expect(tocOpen.samples[2].rect.height).toBeGreaterThan(tocOpen.samples[0].rect.height);
  const scrollMotion = await frame.evaluate(async () => {
    const root = document.querySelector('[data-testid="reader-scroll"]');
    const heading = [...document.querySelectorAll('h2')].find(element => element.textContent === 'Scroll target');
    const expected = Math.min(root.scrollHeight - root.clientHeight, heading.getBoundingClientRect().top - root.getBoundingClientRect().top + root.scrollTop - 24);
    const link = [...document.querySelectorAll('.limr-reader-mobile-toc a')].find(element => element.textContent === 'Scroll target');
    const samples = [];
    link.click();
    const started = performance.now();
    while (performance.now() - started < 1000) {
      samples.push({ time: performance.now() - started, top: root.scrollTop, headingTop: heading.getBoundingClientRect().top - root.getBoundingClientRect().top });
      await new Promise(requestAnimationFrame);
    }
    return { expected, samples, activeElement: document.activeElement?.tagName };
  });
  const scrollPositions = [...new Set(scrollMotion.samples.map(sample => sample.top))];
  expect(scrollPositions.length).toBeGreaterThan(5);
  expect(scrollMotion.samples.at(-1).top).toBeCloseTo(scrollMotion.expected, 0);
  for (let index = 1; index < scrollMotion.samples.length; index++) expect(scrollMotion.samples[index].top).toBeGreaterThanOrEqual(scrollMotion.samples[index - 1].top - 1);
  const targetSourceLine = longSource.split('\n').findIndex(line => line === '## Scroll target');
  let synchronizedSource;
  await expect.poll(async () => {
    synchronizedSource = await host('snapshot');
    return synchronizedSource.visibleRanges.some(range => range.start <= targetSourceLine && range.end >= targetSourceLine);
  }).toBe(true);
  expect(synchronizedSource.activeCustom).toBe('limr.reader');
  await page.screenshot({ path: path.join(artifacts, 'toc-synchronized-scroll-end.png') });
  evidence.push({ check: 'toc-scroll-with-source-sync', ...scrollMotion, sourceVisibleRanges: synchronizedSource.visibleRanges, activeCustom: synchronizedSource.activeCustom });
  console.log('Animation checked: toc-scroll-with-source-sync');

  await host('configure', { values: { tocMode: 'hidden', syncScroll: false } });
  evidence.push(...await runSidebarMotionAcceptance({ page, frame, host, artifacts }));
  evidence.push(...await runBlockMotion({ page, frame, host, artifacts }));
  await host('replaceSource', { source: fixture });
  await frame.locator('[data-testid="reader-scroll"]').evaluate(element => element.scrollTop = 0);

  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect.poll(() => frame.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches)).toBe(true);
  await host('configure', { values: { sidebarMode: 'hidden' } });
  await host('layout', { sourceSize: .5 });
  await marker.click();
  await expect(overlay).toBeVisible();
  await expect(overlay).toHaveCSS('opacity', '1');
  await expect(overlay).not.toHaveAttribute('data-motion');
  await overlay.getByRole('button', { name: '关闭', exact: true }).click();
  await expect(overlay).toHaveCount(0);
  await select();
  await expect(toolbar.locator('.limr-toolbar-surface')).toHaveCSS('opacity', '1');
  expect(await toolbar.locator('.limr-toolbar-surface').evaluate(element => element.getAnimations({ subtree: true }).every(animation => Number(animation.effect.getTiming().duration) < 1))).toBe(true);
  await frame.getByRole('heading', { name: 'LiMR motion', exact: true }).click();
  await expect(toolbar).toHaveCount(0);
  evidence.push({ check: 'Reduced-motion mode settles fully opaque and closes overlays/toolbars without a partial transition' });
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  return evidence;
}
