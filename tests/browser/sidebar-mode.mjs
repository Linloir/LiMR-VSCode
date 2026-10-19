import { expect } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';

const plain = '# Sidebar modes\n\nThe article stays centered when there is no annotation content.\n\n## Reading\n\nA second paragraph keeps the table of contents meaningful.\n';
const ranged = '# Sidebar modes\n\nThe ::%%limr%%{<#first}first range::%%limr%%{>#first} and ::%%limr%%{<#second}second range::%%limr%%{>#second} can share a note.\n\n## Reading\n\nA second paragraph keeps the table of contents meaningful.\n';
const note = (type = 'margin-note', body = 'A shared sidebar note.', ranges = 'first second') => `${ranged}\n:::limr-annotation{#test-note ranges="${ranges}" type="${type}"}\n${body}\n:::\n`;

export async function runSidebarModeAcceptance({ page, frame, host, artifacts }) {
  const evidence = [], errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await host('configure', { values: { tocMode: 'wide', maxWidth: 760, editingEnabled: false, syncScroll: false, 'plugins.enabled': false } });
  await host('layout', { sourceSize: .15 });
  expect(await host('readConfiguration', { keys: ['sidebarMode'] })).toEqual({ sidebarMode: 'content' });
  const rail = () => frame.locator('.limr-reader > .limr-sidebar');
  const article = () => frame.locator('.limr-reader-content > .limr-prose');
  const geometry = () => article().evaluate(element => {
    const body = element.getBoundingClientRect();
    const scroll = document.querySelector('.lv-scroll'), viewport = scroll.getBoundingClientRect();
    const style = getComputedStyle(scroll);
    const left = viewport.left + scroll.clientLeft + parseFloat(style.paddingLeft);
    const width = scroll.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
    const toc = document.querySelector('.limr-reader-toc'), rail = toc?.getBoundingClientRect();
    const remainingLeft = rail?.width ? rail.right + 24 : left;
    return { centerDelta: body.left + body.width / 2 - (left + width / 2), remainingCenterDelta: body.left + body.width / 2 - (remainingLeft + left + width) / 2, bodyWidth: body.width, availableWidth: width,
      sidebar: !!document.querySelector('.limr-reader[data-sidebar]'), markers: document.querySelectorAll('.limr-reader-content [data-limr-anchor]').length };
  });
  const save = async (check, name) => {
    const layout = await geometry();
    evidence.push({ check, layout });
    await writeFile(path.join(artifacts, 'sidebar-mode-progress.json'), JSON.stringify(evidence, null, 2));
    await page.screenshot({ path: path.join(artifacts, `sidebar-mode-${name}.png`) });
    console.log(`Sidebar checked: ${check}`);
  };
  const replace = async source => {
    await host('replaceSource', { source });
    await expect(frame.getByRole('heading', { name: 'Sidebar modes', exact: true })).toBeVisible();
    await frame.locator('.lv-scroll').evaluate(element => element.scrollTop = 0);
  };
  const centered = async () => {
    await expect(rail()).toHaveCount(0);
    await expect.poll(async () => Math.abs((await geometry()).centerDelta)).toBeLessThan(1);
  };
  const sidebar = async count => {
    await expect(rail()).toBeVisible();
    await expect(rail().locator('.limr-sidebar-card')).toHaveCount(count);
    await expect.poll(async () => (await geometry()).centerDelta).toBeLessThan(-100);
  };

  await replace(plain);
  await centered();
  await expect(frame.locator('.limr-reader-toc .limr-toc')).toBeVisible();
  await save('Default content mode leaves empty documents centered with a real wide TOC', 'empty-centered');
  await host('configure', { values: { contentAlignment: 'remaining' } });
  await expect(frame.locator('.limr-reader-toc .limr-toc')).toBeVisible();
  await expect.poll(async () => Math.abs((await geometry()).remainingCenterDelta)).toBeLessThan(1);
  expect((await geometry()).centerDelta).toBeGreaterThan(100);
  await save('Remaining-space alignment centers prose to the right of the TOC', 'remaining-centered');
  await host('configure', { values: { contentAlignment: 'window' } });
  await centered();

  await host('configure', { values: { editingEnabled: true } });
  await expect(frame.locator('.lv-app')).toHaveAttribute('data-editing', 'true');
  // Synthetic selection does not grant the webview the input focus that a
  // user's drag does. Enter the paragraph before exercising toolbar autofocus.
  await article().locator('p').first().click();
  await article().locator('p').first().evaluate(element => {
    const range = document.createRange(), selection = getSelection();
    range.selectNodeContents(element);
    selection.removeAllRanges(); selection.addRange(range);
    document.dispatchEvent(new Event('selectionchange'));
  });
  await frame.getByRole('toolbar').getByRole('button', { name: '添加旁注', exact: true }).click();
  await sidebar(1);
  const draft = rail().getByRole('textbox', { name: '旁注内容', exact: true });
  await expect(draft).toBeEnabled();
  try { await expect(draft).toBeFocused(); }
  catch (error) {
    await writeFile(path.join(artifacts, 'draft-focus.json'), JSON.stringify(await draft.evaluate(element => {
      const describe = node => node && ({ tag: node.tagName, class: node.className, disabled: node.disabled, inert: node.inert, active: node.getAttribute('data-active'), editing: node.getAttribute('data-editing') });
      const ancestors = []; for (let node = element; node; node = node.parentElement) ancestors.push(describe(node));
      return { focused: document.hasFocus(), active: describe(document.activeElement), ancestors, app: describe(document.querySelector('.lv-app')) };
    }), null, 2));
    throw error;
  }
  await draft.fill('A draft follows the automatic sidebar transition.');
  await draft.press('Escape');
  await centered();
  await expect.poll(async () => (await host('snapshot')).source.trim()).toBe(plain.trim());
  await save('Creating a note opens the rail with editor focus intact; cancelling removes it and recenters the article', 'draft-cancelled');
  await host('configure', { values: { editingEnabled: false } });

  await replace(note('highlight', '', 'first'));
  await centered();
  expect((await geometry()).markers).toBe(0);
  await save('Highlight-only documents reserve no sidebar space', 'highlight-centered');

  await replace(note('margin-note', '', 'first'));
  await sidebar(1);
  await save('An empty annotation still supplies an editable sidebar card', 'empty-note');

  await replace(note());
  await sidebar(2);
  await expect(rail()).toContainText('A shared sidebar note.');
  const sidebarGeometry = await geometry();
  await host('configure', { values: { contentAlignment: 'remaining' } });
  await sidebar(2);
  expect(Math.abs((await geometry()).centerDelta - sidebarGeometry.centerDelta)).toBeLessThan(1);
  await host('configure', { values: { contentAlignment: 'window' } });
  await save('Adding a note with two anchors creates both actual sidebar cards', 'multi-anchor');

  await replace(plain);
  await centered();
  await save('Removing the last annotation releases the rail and recenters the article', 'removed');

  await replace(`${plain}\nFootnote reference[^test].\n\n[^test]: Footnote sidebar content.\n`);
  await sidebar(1);
  await expect(rail()).toContainText('Footnote sidebar content.');
  await save('Footnote occurrences also enable the sidebar', 'footnote');

  await host('writeFiles', { files: {
    '.limr/plugins/manifest.json': JSON.stringify({ plugins: [{ id: 'sidebar-test', module: 'sidebar-test.mjs' }] }),
    '.limr/plugins/sidebar-test.mjs': 'export default ({ React }) => ({ name: "sidebar-test", annotationTypes: [{ type: "sidebar-test", label: "Plugin note", Content: () => React.createElement("p", null, "Plugin sidebar content") }] });\n',
  } });
  await replace(note('sidebar-test', '', 'first'));
  await centered();
  await host('configure', { values: { 'plugins.enabled': true } });
  await sidebar(1);
  await expect(frame.locator('.limr-reader-content').getByRole('button', { name: 'Plugin note', exact: true })).toBeVisible();
  await save('Enabling a custom annotation plugin makes its supported occurrence occupy the sidebar', 'plugin-enabled');
  await host('configure', { values: { 'plugins.enabled': false } });
  await centered();
  await save('Disabling the plugin removes unsupported content and releases its sidebar space', 'plugin-disabled');

  await replace(plain);
  await host('configure', { values: { sidebarMode: 'always' } });
  await sidebar(0);
  await save('Always mode reserves an empty sidebar when width permits', 'always');

  await replace(note());
  await host('configure', { values: { sidebarMode: 'hidden' } });
  await centered();
  const marker = frame.locator('.limr-reader-content [data-limr-anchor]').first();
  await marker.click();
  await expect(frame.locator('.limr-overlay-positioner')).toBeVisible();
  await expect(frame.locator('.limr-overlay-positioner')).toContainText('A shared sidebar note.');
  await save('Hidden mode centers annotated prose and keeps note reading available through the real overlay', 'hidden-overlay');
  await page.keyboard.press('Escape');

  await host('configure', { values: { sidebarMode: 'content' } });
  await sidebar(2);

  const denseRanges = Array.from({ length: 8 }, (_, index) => `::%%limr%%{<#dense-${index}}${index + 1}::%%limr%%{>#dense-${index}}`).join(' ');
  const denseNotes = Array.from({ length: 8 }, (_, index) => `:::limr-annotation{#dense-note-${index} ranges="dense-${index}" type="margin-note"}\nDense note ${index + 1} has enough preview text to form a meaningful group of cards.\n:::`).join('\n\n');
  await replace(`# Sidebar modes\n\nNearby notes: ${denseRanges}.\n\n${Array.from({ length: 12 }, (_, index) => `Reading paragraph ${index + 1} gives the rail enough height for its card groups.`).join('\n\n')}\n\n${denseNotes}\n`);
  await sidebar(8);
  await expect(rail()).toHaveAttribute('data-collapse-overflow', 'true');
  await expect.poll(() => rail().locator('.limr-sidebar-cluster[data-collapsible]').count()).toBeGreaterThan(0);
  await expect.poll(() => rail().locator('.limr-sidebar-card[inert]').count()).toBeGreaterThan(0);
  await save('Automatic collapsing folds crowded sidebar card groups by default', 'auto-collapse');
  await host('configure', { values: { sidebarAutoCollapse: false } });
  await sidebar(8);
  await expect(rail()).not.toHaveAttribute('data-collapse-overflow');
  await expect(rail().locator('.limr-sidebar-card[inert]')).toHaveCount(0);
  const cards = await rail().locator('.limr-sidebar-card').evaluateAll(elements => elements.map(element => {
    const rect = element.getBoundingClientRect();
    return { top: rect.top, bottom: rect.bottom, height: rect.height };
  }));
  for (let index = 0; index < cards.length; index++) {
    expect(cards[index].height).toBeGreaterThan(0);
    if (index) expect(cards[index].top).toBeGreaterThanOrEqual(cards[index - 1].bottom - .5);
  }
  await save('Turning automatic collapsing off lays out each card separately, without folding or overlap', 'all-items');
  await host('configure', { values: { sidebarAutoCollapse: true } });
  await expect(rail()).toHaveAttribute('data-collapse-overflow', 'true');
  await expect.poll(() => rail().locator('.limr-sidebar-card[inert]').count()).toBeGreaterThan(0);
  await save('Re-enabling automatic collapsing restores crowded card groups', 'auto-collapse-restored');

  await host('layout', { sourceSize: .65 });
  await centered();
  await expect(frame.locator('.limr-reader-mobile-toc')).toHaveCount(0);
  await save('Content mode still uses narrow-screen overlays and wide-only TOC stays absent', 'narrow');
  await host('configure', { values: { contentAlignment: 'remaining' } });
  await centered();
  await expect(frame.locator('.limr-reader-mobile-toc')).toHaveCount(0);
  await host('configure', { values: { tocMode: 'always' } });
  await centered();
  await expect(frame.locator('.limr-reader-mobile-toc')).toBeVisible();
  await save('Remaining-space alignment also uses centered prose and compact contents on narrow screens', 'remaining-narrow');
  expect(errors).toEqual([]);
  return evidence;
}
