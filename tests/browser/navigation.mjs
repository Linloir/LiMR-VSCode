import { expect } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const source = `# Navigation

[Website](https://code.visualstudio.com/limr-navigation?from=reader#details)

[First file](references/first.md#L3)

[Second file](references/second.md)

[Code file](references/example.ts#L2)

[Image](sample.svg)

[Jump within document](#destination)

${'Text between headings.\n\n'.repeat(35)}
## Destination
`;

export async function runNavigationAcceptance({ page, host, ready, artifacts, externalOpens }) {
  const evidence = [];
  const save = async item => { evidence.push(item); await writeFile(path.join(artifacts, 'navigation-checks.json'), JSON.stringify(evidence, null, 2)); console.log(item.check); };
  const actions = () => page.locator('.editor-group-container.active .editor-actions');
  const readerButton = () => actions().getByRole('button', { name: /^Open Reader to the Side/ });
  const builtinButton = () => actions().getByRole('button', { name: /^Open Preview to the Side/ });
  async function readerFrame() {
    let reader;
    await expect.poll(async () => {
      for (const candidate of page.frames()) {
        if (await candidate.getByRole('heading', { name: 'Navigation', exact: true }).isVisible().catch(() => false)) { reader = candidate; return true; }
      }
      return false;
    }, { timeout: 30_000 }).toBe(true);
    return reader;
  }
  expect(ready.language).toBe('skill');
  expect(ready.automaticallyActivated).toBe(true);
  await host('configure', { values: { previewButtonMode: 'separate', syncScroll: false, markdownLinkMode: 'besideEditor' } });
  await expect(readerButton()).toBeVisible();
  await expect(readerButton()).toHaveClass(/codicon-book/);
  await expect(builtinButton()).toBeVisible();
  await page.screenshot({ path: path.join(artifacts, 'skill-separate-buttons.png') });
  await host('configure', { values: { previewButtonMode: 'merged' } });
  await expect(readerButton()).toBeVisible();
  await expect(builtinButton()).toHaveCount(0);
  await host('replaceSource', { source });
  await host('save');
  await readerButton().click();
  await expect.poll(async () => (await host('snapshot')).activeCustom).toBe('limr.reader');
  let frame = await readerFrame();
  await save({ check: 'SKILL.md activates LiMR as language skill; book icon works in separate and merged modes', language: ready.language });

  await host('writeFiles', { files: {
    'references/first.md': '# First\n\nLine three\n',
    'references/second.md': '# Second\n\nSecond document\n',
    'references/example.ts': '// Code target\nconst answer = 42;\n',
    'notes.md': '# Plain text association\n',
  } });
  await frame.evaluate(() => {
    window.limrLinkBubbles = 0;
    for (const name of ['click', 'auxclick']) window.addEventListener(name, event => {
      if (event.target instanceof Element && event.target.closest('a[href]')) window.limrLinkBubbles++;
    });
  });
  const countTabs = snapshot => snapshot.groups.flatMap(group => group.tabs).length;
  const beforeWebsite = await host('snapshot');
  await frame.getByRole('link', { name: 'Website', exact: true }).click();
  const externalRequests = async () => (await readFile(externalOpens, 'utf8')).trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
  await expect.poll(async () => (await externalRequests()).length).toBe(1);
  expect((await externalRequests())[0]).toEqual(['https://code.visualstudio.com/limr-navigation?from=reader#details']);
  expect(countTabs(await host('snapshot'))).toBe(countTabs(beforeWebsite));
  expect(await frame.evaluate(() => window.limrLinkBubbles)).toBe(0);
  await frame.getByRole('link', { name: 'Website', exact: true }).click({ button: 'middle' });
  await expect.poll(async () => (await externalRequests()).length).toBe(2);
  await frame.getByRole('link', { name: 'Website', exact: true }).focus();
  await frame.getByRole('link', { name: 'Website', exact: true }).press('Enter');
  await expect.poll(async () => (await externalRequests()).length).toBe(3);
  expect(countTabs(await host('snapshot'))).toBe(countTabs(beforeWebsite));
  expect(await frame.evaluate(() => window.limrLinkBubbles)).toBe(0);
  await save({ check: 'A real website click opens the system browser exactly once and creates no editor tab', externalRequests: await externalRequests() });

  async function follow(name, label, column, groups) {
    const before = await host('snapshot');
    const matching = snapshot => snapshot.groups.flatMap(group => group.tabs).filter(tab => tab.label === label).length;
    const alreadyInTarget = before.groups.find(group => group.viewColumn === column)?.tabs.some(tab => tab.label === label);
    await frame.getByRole('link', { name, exact: true }).click();
    await expect.poll(async () => (await host('snapshot')).groups.find(group => group.viewColumn === column)?.tabs.find(tab => tab.active)?.label).toBe(label);
    const snapshot = await host('snapshot');
    expect(snapshot.groups).toHaveLength(groups);
    expect(matching(snapshot)).toBe(matching(before) + (alreadyInTarget ? 0 : 1));
    expect(await frame.getByRole('heading', { name: 'Navigation', exact: true }).isVisible()).toBe(true);
    return snapshot;
  }
  await follow('First file', 'first.md', 1, 2);
  await expect.poll(async () => (await host('snapshot')).activeEditor?.line).toBe(2);
  await follow('Second file', 'second.md', 1, 2);
  await follow('Code file', 'example.ts', 1, 2);
  await expect.poll(async () => (await host('snapshot')).activeEditor?.line).toBe(1);
  await follow('Image', 'sample.svg', 1, 2);
  expect(await frame.evaluate(() => window.limrLinkBubbles)).toBe(0);
  await save({ check: 'Markdown, line-targeted source and image links reuse the other group, keep the reader visible and create no duplicate tabs' });

  await host('openRelativeSource', { relative: 'references/first.md', viewColumn: 3 });
  await host('openRelativeSource', { relative: 'references/second.md', viewColumn: 3 });
  await frame.getByRole('link', { name: 'First file', exact: true }).click();
  await expect.poll(async () => (await host('snapshot')).groups.find(group => group.active)?.viewColumn).toBe(1);
  // Close the duplicate in group 1 to prove reuse of the hidden tab in group 3.
  await host('command', { command: 'workbench.action.closeActiveEditor', args: [] });
  await frame.getByRole('link', { name: 'First file', exact: true }).click();
  await expect.poll(async () => (await host('snapshot')).groups.find(group => group.active)?.viewColumn).toBe(3);
  expect((await host('snapshot')).groups).toHaveLength(3);
  await save({ check: 'A previously opened target in a background tab is reused across three editor groups' });

  await host('openRelativeReader', { relative: 'SKILL.md' });
  await host('command', { command: 'workbench.action.joinAllGroups' });
  frame = await readerFrame();
  expect((await host('snapshot')).groups).toHaveLength(1);
  await follow('First file', 'first.md', 2, 2);
  await follow('Second file', 'second.md', 2, 2);
  await save({ check: 'A single reader group creates one adjacent group; later file links reuse it' });

  const beforeAnchor = await host('snapshot');
  await frame.getByRole('link', { name: 'Jump within document', exact: true }).click();
  await expect(frame.getByRole('heading', { name: 'Destination', exact: true })).toBeInViewport();
  expect(countTabs(await host('snapshot'))).toBe(countTabs(beforeAnchor));
  await save({ check: 'Same-document anchors scroll inside the reader without opening editors' });

  await host('openRelativeSource', { relative: 'notes.md', language: 'plaintext' });
  await expect(readerButton()).toBeVisible();
  await readerButton().click();
  await expect.poll(async () => (await host('snapshot')).activeCustom).toBe('limr.reader');
  await save({ check: 'The Markdown filename keeps the toolbar entry usable even with a different language association' });
  await host('openRelativeSource', { relative: 'SKILL.md' });
  await page.keyboard.down('Alt');
  try {
    await expect(builtinButton()).toBeVisible();
    await builtinButton().click({ modifiers: ['Alt'] });
  } finally { await page.keyboard.up('Alt'); }
  await expect.poll(async () => (await host('snapshot')).groups.flatMap(group => group.tabs).some(tab => /markdown.*preview/i.test(tab.webview ?? ''))).toBe(true);
  expect(await externalRequests()).toHaveLength(3);
  await save({ check: 'Alt-click on the merged skill preview button still opens the built-in Markdown preview' });
  await page.screenshot({ path: path.join(artifacts, 'navigation-complete.png') });
  return evidence;
}
