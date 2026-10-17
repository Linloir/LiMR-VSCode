import { expect } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { installObservers } from '../../benchmarks/reading/probes.mjs';

// Only the disposable example add-on is extended. Both factories deliberately
// use a built-in name; manifest namespaces must preserve the original object.
export const largeAddonFixtures = {
  'large-view.mjs': `export default ({ React, limr }) => {
    const extension = { name: 'gfm', components: { heading: ({ node, children }) => {
      const document = limr.useDocument(), commands = limr.useLiMR();
      return React.createElement('h' + node.depth, { 'data-large-addon': 'yes',
        'data-factory-name': extension.name, 'data-document-chars': document.source.length,
        'data-document-blocks': document.blocks.length, 'data-document-complete': commands.isDocumentComplete(),
        'data-large-realm': node.data?.largePluginRealm ?? '' }, children);
    } }, virtualization: { heading: { copyText: (_node, { children }) => children } } };
    return Object.freeze(extension);
  };`,
  'large-syntax.mjs': `export default ({ React, limr }) => {
    const extension = limr.defineBlock({ name: 'large-plugin-note', component: ({ node, children }) =>
      React.createElement('aside', { 'data-large-custom': 'yes', 'data-large-realm': node.data?.largePluginRealm }, children) });
    extension.name = 'gfm';
    extension.virtualization = { 'large-plugin-note': { copyText: (_node, { children }) => children } };
    extension.transform = root => { for (const node of root.children ?? [])
      node.data = { ...node.data, largePluginRealm: typeof document === 'object' ? 'document' : 'worker' }; };
    // This registry ID intentionally does not exist in the shipping host worker.
    // The namespace wrapper must not inherit the original registration by name.
    return limr.registerWorkerExtension(extension, { id: 'acceptance/addon-transform@1' });
  };`,
};

export const largeAddonActivation = `
const previousLargeActivate = module.exports.activate;
module.exports.activate = async function (context) {
  await previousLargeActivate(context);
  const api = await vscode.extensions.getExtension('linloir.limr-vscode').activate();
  const registrations = new Map();
  for (const [kind, module] of [['view', 'large-view.mjs'], ['syntax', 'large-syntax.mjs']]) {
    context.subscriptions.push(vscode.commands.registerCommand('limrExampleTest.large.' + kind, enabled => {
      if (enabled && !registrations.has(kind)) registrations.set(kind, api.registerPlugin(context.extension.id, { id: 'large-' + kind, module }));
      else if (!enabled) { registrations.get(kind)?.dispose(); registrations.delete(kind); }
    }));
  }
  context.subscriptions.push(new vscode.Disposable(() => { for (const registration of registrations.values()) registration.dispose(); }));
};
`;

const workspaceView = `export default ({ React }) => {
  const extension = { name: 'gfm', components: { paragraph: ({ node, children }) =>
    React.createElement('p', { 'data-large-workspace': 'yes', 'data-factory-name': extension.name,
      'data-large-realm': node.data?.largePluginRealm ?? '' }, children)
  }, virtualization: { paragraph: { copyText: (_node, { children }) => children } } };
  return Object.freeze(extension);
};`;
const paragraph = index => `Paragraph ${index}. ${'The original Markdown remains readable with both independently namespaced view plugins. '.repeat(2)}`;
const sourceFor = (title, syntax = false) => `# ${title}\n\n${syntax ? ':::large-plugin-note\nAuthored custom syntax survives compatibility parsing.\n:::\n\n' : ''}`
  + Array.from({ length: 800 }, (_, index) => paragraph(index)).join('\n\n');

function completedWorker(workers, chars) {
  return workers.find(worker => worker.requests.some(request => request.chars === chars && (
    worker.responses.some(response => response.revision === request.revision && response.type === 'snapshot' && response.complete && response.chars === chars)
    || worker.responses.some(response => response.revision === request.revision && response.type === 'snapshot-start' && response.chars === chars)
      && worker.responses.some(response => response.revision === request.revision && response.type === 'snapshot-end')
  )));
}

export async function runLargePluginsAcceptance({ page, host, artifacts }) {
  const evidence = [], errors = [];
  page.on('pageerror', error => errors.push(error.message));
  // Reuse the proven Worker observer, including VS Code document.open handling.
  // It retains only lengths, descriptors and response metadata, not full ASTs.
  await page.context().addInitScript(installObservers);
  const reader = async () => {
    let found;
    await expect.poll(async () => {
      for (const candidate of page.frames()) if (await candidate.locator('.lv-scroll .limr-reader').count().catch(() => 0)) { found = candidate; return true; }
      return false;
    }, { timeout: 15_000 }).toBe(true);
    return found;
  };
  // Companion activation may replace the initially supplied guest as its
  // resource grants are installed. Reacquire it, as the existing add-on suite
  // does, and avoid installing a second observer into a fresh init-script guest.
  await expect.poll(async () => {
    try {
      const current = await reader();
      if (!await current.evaluate(() => !!window.__limrReadingBench)) await current.evaluate(installObservers);
      return true;
    } catch (error) {
      if (/Frame was detached|Execution context was destroyed/.test(String(error))) return false;
      throw error;
    }
  }).toBe(true);
  const save = async value => { evidence.push(value); await writeFile(path.join(artifacts, 'checks.json'), JSON.stringify(evidence, null, 2)); };
  const invoke = (kind, enabled) => host('command', { command: `limrExampleTest.large.${kind}`, args: [enabled] });
  const observed = async () => (await reader()).evaluate(() => ({ workers: window.__limrReadingBench?.workers ?? [], errors: window.__limrReadingBench?.errors ?? [] }));
  const checkReady = async (source, title) => {
    expect(source.length).toBeGreaterThan(64 * 1024);
    const current = await reader(), heading = current.getByRole('heading', { name: title, exact: true });
    await expect(heading).toBeVisible({ timeout: 15_000 });
    await expect(current.locator('.limr-async-reader')).toHaveCount(1);
    await expect(current.locator('.lv-app')).toHaveAttribute('data-reader-ready', 'true');
    await expect(heading).toHaveAttribute('data-large-addon', 'yes');
    await expect(heading).toHaveAttribute('data-factory-name', 'gfm');
    await expect(heading).toHaveAttribute('data-document-chars', String(source.length));
    await expect(heading).toHaveAttribute('data-document-complete', 'true');
    expect(Number(await heading.getAttribute('data-document-blocks'))).toBeGreaterThan(800);
    const paragraphs = current.locator('[data-large-workspace="yes"]');
    await expect(paragraphs.first()).toBeVisible(); await expect(paragraphs.first()).toHaveAttribute('data-factory-name', 'gfm');
    await expect(current.locator('[data-limr-windowed]')).toHaveCount(1);
    expect(await paragraphs.count()).toBeLessThan(100);
    expect((await host('snapshot')).source).toBe(source);
    return { current, heading };
  };
  await host('configure', { values: { language: 'en', loadingMode: 'blocking', typography: 'standard', syncScroll: false, tocMode: 'hidden', sidebarMode: 'hidden', 'plugins.enabled': true } });
  await host('command', { command: 'limrExample.disable', args: [] });
  await host('writeFiles', { files: {
    '.limr/plugins/manifest.json': JSON.stringify({ plugins: [{ id: 'large-view', module: 'large-view.mjs' }] }),
    '.limr/plugins/large-view.mjs': workspaceView,
  } });
  await host('command', { command: 'limr.reloadPlugins', args: [] });
  await invoke('view', true);
  await expect.poll(async () => (await reader()).locator('[data-large-addon="yes"]').count().catch(() => 0)).toBeGreaterThan(0);
  await expect.poll(async () => (await reader()).locator('[data-large-workspace="yes"]').count().catch(() => 0)).toBeGreaterThan(0);
  const installed = await host('extensionInfo', { extensionId: 'limr-examples.limr-reader-addon' });
  expect(installed.active).toBe(true); expect(installed.dependencies).toContain('linloir.limr-vscode');

  const pureSource = sourceFor('Namespaced pure view plugins');
  await host('replaceSource', { source: pureSource });
  const pure = await checkReady(pureSource, 'Namespaced pure view plugins');
  await expect.poll(async () => !!completedWorker((await observed()).workers, pureSource.length)).toBe(true);
  const pureWorker = completedWorker((await observed()).workers, pureSource.length);
  expect(pureWorker.requests.find(request => request.chars === pureSource.length).extensions.some(extension => extension.id === 'acceptance/addon-transform@1')).toBe(false);
  await page.screenshot({ path: path.join(artifacts, 'large-plugins-worker.png') });
  await save({ check: 'Workspace and installed add-on with the same built-in factory name both render; matched copy contracts preserve windowing and the full document completes in a real worker', sourceChars: pureSource.length, installed, worker: pureWorker });

  await invoke('syntax', true);
  await expect.poll(async () => (await reader()).getByRole('heading', { name: 'Namespaced pure view plugins', exact: true }).getAttribute('data-large-realm').catch(() => null)).toBe('document');
  const syntaxSource = sourceFor('Namespaced custom syntax compatibility', true);
  await host('replaceSource', { source: syntaxSource });
  const syntax = await checkReady(syntaxSource, 'Namespaced custom syntax compatibility');
  await expect(syntax.heading).toHaveAttribute('data-large-realm', 'document');
  const custom = syntax.current.locator('[data-large-custom="yes"]');
  await expect(custom).toContainText('Authored custom syntax survives compatibility parsing.');
  await expect(custom).toHaveAttribute('data-large-realm', 'document');
  const compatibility = await observed();
  expect(compatibility.workers.some(worker => worker.requests.some(request => request.chars === syntaxSource.length))).toBe(false);
  expect(compatibility.errors).toEqual([]);
  await page.screenshot({ path: path.join(artifacts, 'large-plugins-compatibility.png') });
  await save({ check: 'A wrapped registered custom syntax factory runs its exact transform in the document realm, renders authored syntax and stays windowed; its unmatched registration is never posted to the host worker', sourceChars: syntaxSource.length, realm: await custom.getAttribute('data-large-realm'), matchingWorkerRequests: 0 });

  await invoke('syntax', false);
  await expect.poll(async () => (await reader()).getByRole('heading', { name: 'Namespaced custom syntax compatibility', exact: true }).getAttribute('data-large-realm').catch(() => null)).toBe('');
  const restoredSource = sourceFor('Worker restored after syntax disposal');
  await host('replaceSource', { source: restoredSource });
  await checkReady(restoredSource, 'Worker restored after syntax disposal');
  await expect.poll(async () => !!completedWorker((await observed()).workers, restoredSource.length)).toBe(true);
  const restored = await observed(); expect(restored.errors).toEqual([]); expect(errors).toEqual([]);
  await save({ check: 'Disposing the syntax registration restores the real worker path without losing either view plugin or changing source', sourceChars: restoredSource.length, worker: completedWorker(restored.workers, restoredSource.length) });
  return evidence;
}
