import { expect } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';

const svg = (width, color) => `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="48"><rect width="100%" height="100%" fill="${color}"/></svg>`;

export async function runImageAcceptance({ page, frame, host, fixture, artifacts }) {
  const evidence = [], errors = [];
  page.on('pageerror', error => errors.push(String(error)));
  const save = async value => { evidence.push(value); await writeFile(path.join(artifacts, 'checks.json'), JSON.stringify(evidence, null, 2)); };
  await host('configure', { values: { syncScroll: false, tocMode: 'hidden', sidebarMode: 'hidden', 'plugins.enabled': true,
    'images.pathMode': 'auto', 'images.baseFolder': '', 'images.searchPaths': [] } });
  await host('writeFiles', { files: {
    'images/direct.svg': svg(121, '#67b6c4'),
    'public/papers/feature.svg': svg(162, '#f0bc69'),
    'images/name with spaces.svg': svg(143, '#958bc5'),
    '.limr/plugins/manifest.json': JSON.stringify({ plugins: [{ id: 'picture', module: 'picture.mjs' }] }),
    '.limr/plugins/picture.mjs': "export default ({ React, limr }) => limr.defineBlock({ name: 'local-picture', component: ({ node }) => React.createElement('img', { src: node.attributes.src, alt: 'Plugin image' }) });",
  } });
  await host('command', { command: 'limr.reloadPlugins' });
  const absolute = path.join(path.dirname(fixture), 'images', 'direct.svg');
  const source = `# Exact image paths\n\n![Relative](./images/direct.svg)\n\n![Rooted](/images/direct.svg)\n\n![Absolute](${absolute})\n\n![Encoded](./images/name%20with%20spaces.svg)\n\n<figure src="./public/papers/feature.svg" alt="Figure image" caption="A precise local figure." />\n\n<local-picture src="./images/direct.svg" />\n\n![Missing](./papers/feature.svg)\n`;
  await host('replaceSource', { source });
  await expect(frame.locator('h1')).toHaveText('Exact image paths');
  for (const [alt, width] of [['Relative', 121], ['Rooted', 121], ['Absolute', 121], ['Encoded', 143], ['Figure image', 162], ['Plugin image', 121]]) {
    const image = frame.getByAltText(alt, { exact: true });
    await image.scrollIntoViewIfNeeded();
    await expect.poll(() => image.evaluate(element => element.complete && element.naturalWidth)).toBe(width);
    await expect(image).toHaveAttribute('src', /vscode-(?:resource|cdn)|vscode-webview/);
  }
  await save({ check: 'Native webview decodes real document-relative, workspace-rooted, absolute and URL-encoded files, including figure and plugin images', dimensions: [121, 121, 121, 143, 162, 121] });

  const missing = frame.getByAltText('Missing', { exact: true });
  await missing.scrollIntoViewIfNeeded();
  expect(await missing.getAttribute('src')).toBeNull();
  await expect(missing).toHaveAttribute('data-lv-image-error', 'missing');
  expect(await missing.evaluate(element => element.naturalWidth)).toBe(0);
  expect((await host('snapshot')).source).toBe(source);
  await save({ check: 'An incorrect path stays unresolved even when a similarly named image exists in public; Markdown source is unchanged' });

  await host('replaceSource', { source: '# Updated image\n\n![Changed](./images/direct.svg)\n' });
  await expect(frame.getByAltText('Changed')).toHaveJSProperty('naturalWidth', 121);
  await host('replaceSource', { source: '# Updated image\n\n![Changed](./public/papers/feature.svg)\n' });
  await expect(frame.getByAltText('Changed')).toHaveJSProperty('naturalWidth', 162);
  await host('replaceSource', { source: '# Updated image\n\n![Changed](./images/direct.svg)\n' });
  await expect(frame.getByAltText('Changed')).toHaveJSProperty('naturalWidth', 121);
  await save({ check: 'Reusing an image node while its Markdown URL changes resolves the replacement and can return to a cached original' });

  await host('writeFiles', { files: {
    'docs/images/direct.svg': svg(181, '#9cb68c'),
    'images/workspace.svg': svg(151, '#76a2c4'),
    'public/images/direct.svg': svg(211, '#cb8b97'),
    'search-first/shared.svg': svg(191, '#d6b882'),
    'search-second/shared.svg': svg(201, '#929ed4'),
    'docs/nested.md': '# Nested image paths\n\n![Document preferred](./images/direct.svg)\n\n![Workspace fallback](./images/workspace.svg)\n\n![Explicit parent](../public/papers/feature.svg)\n\n![Extra search](shared.svg)\n',
  } });
  await host('openRelativeReader', { relative: 'docs/nested.md' });
  await expect.poll(async () => {
    for (const candidate of page.frames()) if (await candidate.getByRole('heading', { name: 'Nested image paths' }).count().catch(() => 0)) { frame = candidate; return true; }
    return false;
  }).toBe(true);
  for (const [alt, width] of [['Document preferred', 181], ['Workspace fallback', 151], ['Explicit parent', 162]]) {
    const image = frame.getByAltText(alt, { exact: true });
    await image.scrollIntoViewIfNeeded();
    await expect.poll(() => image.evaluate(element => element.complete && element.naturalWidth)).toBe(width);
  }
  await save({ check: 'A nested document prefers its own relative file, falls back only to the current workspace for missing ./ paths, and resolves explicit ../public paths', dimensions: [181, 151, 162] });

  const documentImage = () => frame.getByAltText('Document preferred', { exact: true });
  const workspaceImage = () => frame.getByAltText('Workspace fallback', { exact: true });
  const searchedImage = () => frame.getByAltText('Extra search', { exact: true });
  await host('configure', { values: { 'images.pathMode': 'file' } });
  await expect(documentImage()).toHaveJSProperty('naturalWidth', 181);
  await expect(workspaceImage()).toHaveAttribute('data-lv-image-error', 'missing');
  await expect(workspaceImage()).toHaveJSProperty('naturalWidth', 0);
  await host('configure', { values: { 'images.pathMode': 'workspace' } });
  await expect(documentImage()).toHaveJSProperty('naturalWidth', 121);
  await expect(workspaceImage()).toHaveJSProperty('naturalWidth', 151);
  await host('configure', { values: { 'images.pathMode': 'folder', 'images.baseFolder': 'public' } });
  await expect(documentImage()).toHaveJSProperty('naturalWidth', 211);
  await expect(workspaceImage()).toHaveJSProperty('naturalWidth', 0);
  await host('configure', { values: { 'images.searchPaths': ['search-second', 'search-first'] } });
  await searchedImage().scrollIntoViewIfNeeded();
  await expect(searchedImage()).toHaveJSProperty('naturalWidth', 201);
  await host('configure', { values: { 'images.searchPaths': ['search-first', 'search-second'] } });
  await expect(searchedImage()).toHaveJSProperty('naturalWidth', 191);
  await save({ check: 'Changing auto/file/workspace/folder settings re-resolves retained images from original Markdown URLs; explicit search paths are applied in configured order', documentWidths: [181, 121, 211], searchWidths: [201, 191] });

  await host('configure', { values: { 'images.baseFolder': 'missing-folder', 'images.searchPaths': [] } });
  await expect(documentImage()).toHaveAttribute('data-lv-image-error', 'missing');
  await expect(documentImage()).toHaveJSProperty('naturalWidth', 0);
  expect(await documentImage().getAttribute('src')).toBeNull();
  await host('configure', { values: { 'images.pathMode': 'auto' } });
  await expect(documentImage()).toHaveJSProperty('naturalWidth', 181);
  await expect(workspaceImage()).toHaveJSProperty('naturalWidth', 151);
  await save({ check: 'A missing configured folder clears previous decoded images and cannot fall back through the browser base; changing back to auto restores them without editing Markdown' });

  await host('configure', { values: { 'images.pathMode': 'workspace' } });
  await frame.evaluate(() => {
    const image = document.createElement('img'); image.src = './images/direct.svg'; image.alt = 'Portal image';
    image.style.cssText = 'position:fixed;bottom:12px;right:12px;width:121px;height:48px';
    document.body.append(image);
  });
  await expect(frame.getByAltText('Portal image')).toHaveJSProperty('naturalWidth', 121);
  expect(await frame.getByAltText('Portal image').evaluate(element => !!element.closest('.lv-scroll'))).toBe(false);
  await save({ check: 'Images inserted in body portals outside the reader scroll container use the configured workspace base too' });

  expect(errors).toEqual([]);
  await frame.locator('.lv-scroll').evaluate(element => element.scrollTop = 0);
  await page.screenshot({ path: path.join(artifacts, 'images.png') });
  return evidence;
}
