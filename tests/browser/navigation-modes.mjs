import { expect } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';

export async function runNavigationModesAcceptance({ page, host, artifacts }) {
  const evidence = [];
  const record = async check => { evidence.push({ check }); console.log(check); await writeFile(path.join(artifacts, 'checks.json'), JSON.stringify(evidence, null, 2)); };
  const tabs = async () => (await host('snapshot')).groups;
  const active = (groups, column) => groups.find(group => group.viewColumn === column)?.tabs.find(tab => tab.active);
  const current = async (column, name, custom) => {
    await expect.poll(async () => { const tab = active(await tabs(), column); return tab ? [tab.label, tab.custom] : null; }, { timeout: 15000 }).toEqual([name, custom]);
  };
  const settledCurrent = async (column, name, custom) => {
    await current(column, name, custom);
    // Auto-open is debounced. Check again after its queued native tab events.
    await new Promise(resolve => setTimeout(resolve, 300));
    await current(column, name, custom);
  };
  const permanentPair = async (name, source = 1, reader = 2) => {
    await settledCurrent(source, name);
    await settledCurrent(reader, name, 'limr.reader');
    const groups = await tabs();
    expect(active(groups, source).preview).toBe(false);
    expect(active(groups, reader).preview).toBe(false);
    expect(groups.find(group => group.viewColumn === reader).tabs.filter(tab => tab.label === name && !tab.custom)).toHaveLength(0);
  };
  const reader = async title => {
    let frame;
    await expect.poll(async () => {
      for (const candidate of page.frames()) if (await candidate.getByRole('heading', { name: title, exact: true }).isVisible().catch(() => false)) { frame = candidate; return true; }
      return false;
    }, { timeout: 20000 }).toBe(true);
    return frame;
  };
  const sideKey = async (title, direction = 'back') => {
    const frame = await reader(title);
    await frame.locator('body').evaluate((body, button) => {
      for (const type of ['mousedown', 'mouseup', 'auxclick']) body.dispatchEvent(new MouseEvent(type, { button, bubbles: true, cancelable: true }));
    }, direction === 'back' ? 3 : 4);
  };
  const reset = async (mode, paired = false, other = false) => {
    await host('configure', { values: { markdownOpenMode: 'none', markdownLinkMode: mode, singleReader: false, syncScroll: false, tocMode: 'hidden', sidebarMode: 'hidden' } });
    await host('command', { command: 'workbench.action.closeAllEditors', args: [] });
    await host('command', { command: 'workbench.action.joinAllGroups', args: [] });
    if (paired || other) await host('openRelativeSource', { relative: paired ? 'a.md' : 'c.md', viewColumn: 1 });
    await host('openRelativeReader', { relative: 'a.md', viewColumn: paired || other ? 2 : 1 });
    return reader('Page A');
  };
  await host('writeFiles', { files: {
    'a.md': '# Page A\n\n[Go B](b.md)\n',
    'b.md': '# Page B\n\n[Go C](c.md#destination)\n',
    'c.md': '# Page C\n\n' + 'Text.\n\n'.repeat(80) + '## Destination\n',
  } });
  let frame = await reset('smart', true);
  await frame.getByRole('link', { name: 'Go B' }).click();
  await current(1, 'b.md'); await current(2, 'b.md', 'limr.reader');
  await sideKey('Page B'); await current(1, 'a.md'); await current(2, 'a.md', 'limr.reader');
  await sideKey('Page A', 'forward'); await current(1, 'b.md'); await current(2, 'b.md', 'limr.reader');
  frame = await reader('Page B'); await frame.getByRole('link', { name: 'Go C' }).click();
  await current(1, 'c.md'); await current(2, 'c.md', 'limr.reader');
  await expect((await reader('Page C')).getByRole('heading', { name: 'Destination', exact: true })).toBeInViewport();
  await sideKey('Page C'); await current(1, 'b.md'); await current(2, 'b.md', 'limr.reader');
  await record('Smart paired navigation, heading fragments, multi-step history and mouse back/forward restore both columns');

  for (const mode of ['smart', 'currentReader']) {
    frame = await reset(mode, false, true); await frame.getByRole('link', { name: 'Go B' }).click();
    await current(1, 'c.md'); await current(2, 'b.md', 'limr.reader');
    const keyboardFrame = await reader('Page B');
    await keyboardFrame.getByRole('heading', { name: 'Page B', exact: true }).click();
    await keyboardFrame.locator('body').press('Alt+ArrowLeft');
    await current(1, 'c.md'); await current(2, 'a.md', 'limr.reader');
  }
  await record('Smart unpaired layouts and current-reader mode leave unrelated editors in place; Alt+Left works');

  frame = await reset('besideEditor'); await frame.getByRole('link', { name: 'Go B' }).click();
  await current(1, 'a.md', 'limr.reader'); await current(2, 'b.md');
  frame = await reset('besideReader'); await frame.getByRole('link', { name: 'Go B' }).click();
  await current(1, 'a.md', 'limr.reader'); await current(2, 'b.md', 'limr.reader');
  await record('Editor-beside and reader-beside modes open the requested editor type');

  frame = await reset('besideReader'); await host('configure', { values: { singleReader: true } });
  await frame.getByRole('link', { name: 'Go B' }).click();
  await current(1, 'b.md', 'limr.reader');
  expect((await tabs()).flatMap(group => group.tabs).filter(tab => tab.custom === 'limr.reader')).toHaveLength(1);
  await sideKey('Page B'); await current(1, 'a.md', 'limr.reader');
  await record('Single-reader mode overrides reader-beside and retains usable history');

  frame = await reset('editorAndReader', false, true); await frame.getByRole('link', { name: 'Go B' }).click();
  await current(1, 'b.md'); await current(2, 'b.md', 'limr.reader');
  await sideKey('Page B'); await current(1, 'c.md'); await current(2, 'a.md', 'limr.reader');
  frame = await reset('editorAndReader'); await frame.getByRole('link', { name: 'Go B' }).click();
  await current(1, 'b.md', 'limr.reader'); await current(2, 'b.md');
  await sideKey('Page B'); await current(1, 'a.md', 'limr.reader'); await current(2, 'b.md');
  await record('Paired mode restores an unrelated previous file, and leaves a newly created companion alone on back');

  for (const mode of ['none', 'reader', 'sideBySide']) {
    await reset('smart');
    await host('command', { command: 'workbench.action.closeAllEditors', args: [] });
    await host('configure', { values: { markdownOpenMode: mode } });
    await host('openRelativeSource', { relative: 'b.md', viewColumn: 1, preview: true });
    await current(1, 'b.md', mode === 'reader' ? 'limr.reader' : undefined);
    if (mode === 'sideBySide') {
      await permanentPair('b.md');
      expect((await host('snapshot')).activeEditor?.uri).toMatch(/b\.md$/);
      await host('openRelativeReader', { relative: 'b.md', viewColumn: 2 });
      await host('openRelativeSource', { relative: 'b.md', viewColumn: 2, preview: true });
      await permanentPair('b.md');
      await host('openRelativeReader', { relative: 'b.md', viewColumn: 2 });
      await host('openRelativeDefault', { relative: 'a.md', viewColumn: 2, repeat: 2 });
      await permanentPair('a.md');
      await record('Default split pins both tabs and reuses source-left/reader-right when reopened repeatedly from the reader group');
      await host('openRelativeSource', { relative: 'a.md', viewColumn: 1 });
      await current(2, 'a.md', 'limr.reader');
      await host('openRelativeSource', { relative: 'b.md', viewColumn: 1 });
      await current(2, 'b.md', 'limr.reader');
      await (await reader('Page B')).getByRole('link', { name: 'Go C' }).click();
      await permanentPair('c.md');
      await host('openRelativeSource', { relative: 'b.md', viewColumn: 1 });
      await permanentPair('b.md');
      await host('openRelativeSource', { relative: 'c.md', viewColumn: 1 });
      await permanentPair('c.md');
      await host('openRelativeSource', { relative: 'b.md', viewColumn: 1 });
      await permanentPair('b.md');
      await record('Source tabs created by paired link navigation keep following the default split when revisited');
      await host('configure', { values: { markdownLinkMode: 'besideEditor' } });
      const pairedFrame = await reader('Page B'); await pairedFrame.getByRole('link', { name: 'Go C' }).click();
      await current(1, 'c.md'); await current(2, 'b.md', 'limr.reader');
    }
    if (mode === 'none') expect((await tabs()).flatMap(group => group.tabs).filter(tab => tab.custom)).toHaveLength(0);
    if (mode === 'reader') {
      await host('command', { command: 'workbench.action.reopenTextEditor', args: [] });
      await settledCurrent(1, 'b.md');
      await host('openRelativeSource', { relative: 'a.md', viewColumn: 1 });
      await current(1, 'a.md', 'limr.reader');
      await host('openRelativeSource', { relative: 'b.md', viewColumn: 1 });
      await settledCurrent(1, 'b.md');
      await record('Native Reopen with Text Editor stays in source mode after switching away and back');
      await host('command', { command: 'workbench.action.closeAllEditors', args: [] });
      await host('openRelativeSource', { relative: 'b.md', viewColumn: 1 });
      await settledCurrent(1, 'b.md', 'limr.reader');
      await host('command', { command: 'limr.openSource', args: [] });
      await settledCurrent(2, 'b.md');
    }
  }
  await record('All three Markdown-open settings work; explicit source access remains usable in reader mode');
  await reset('smart');
  await host('openRelativeSource', { relative: 'a.md', viewColumn: 2 });
  await host('configure', { values: { markdownOpenMode: 'sideBySide', singleReader: true } });
  await host('openRelativeSource', { relative: 'b.md', viewColumn: 2, preview: true });
  await permanentPair('b.md', 2, 1);
  await host('openRelativeSource', { relative: 'c.md', viewColumn: 1, preview: true });
  await permanentPair('c.md', 2, 1);
  expect((await tabs()).flatMap(group => group.tabs).filter(tab => tab.custom === 'limr.reader')).toHaveLength(1);
  await record('An existing reader-left/source-right layout also retains its order, including single-reader mode');
  await host('openRelativeReader', { relative: 'c.md', viewColumn: 1 });
  await host('command', { command: 'workbench.action.reopenTextEditor', args: [] });
  await settledCurrent(1, 'c.md');
  expect((await tabs()).flatMap(group => group.tabs).filter(tab => tab.custom === 'limr.reader')).toHaveLength(0);
  await record('Native Reopen with Text Editor also overrides the default split without recreating the reader');
  await page.screenshot({ path: path.join(artifacts, 'navigation-modes.png') });
  return evidence;
}
