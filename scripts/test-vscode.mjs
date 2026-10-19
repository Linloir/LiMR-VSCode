import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtemp, mkdir, readFile, writeFile, rename, rm, cp, access } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { downloadAndUnzipVSCode } from '@vscode/test-electron';
import { chromium } from '@playwright/test';
import { createHash } from 'node:crypto';
import { build as buildExtension } from 'esbuild';
import { runReaderAcceptance } from '../tests/browser/reader.mjs';
import { runAnimationAcceptance } from '../tests/browser/animations.mjs';
import { runSidebarMotionAcceptance } from '../tests/browser/sidebar-motion.mjs';
import { runBlockMotion } from '../tests/browser/block-motion.mjs';
import { runRegressionAcceptance } from '../tests/browser/regressions.mjs';
import { runFeatureAcceptance } from '../tests/browser/features.mjs';
import { runSkillAcceptance } from '../tests/browser/skills.mjs';
import { fileHashes } from '../benchmarks/reading/build.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const skillSuite = process.env.LIMR_TEST_SUITE === 'skills' || process.argv.includes('--skills');
const syntaxSuite = process.env.LIMR_TEST_SUITE === 'syntax-highlighting' || process.argv.includes('--syntax-highlighting');
const entrypointsSuite = process.argv.includes('--entrypoints');
const openModesSuite = process.argv.includes('--open-modes');
const previewDefaultSuite = process.argv.includes('--preview-default');
const navigationSuite = process.env.LIMR_TEST_SUITE === 'navigation' || process.argv.includes('--navigation') || process.argv.includes('--navigation-modes');
const extensionPluginSuite = process.env.LIMR_TEST_SUITE === 'extension-plugins' || process.argv.includes('--extension-plugins');
const largePluginSuite = process.env.LIMR_TEST_SUITE === 'large-plugins' || process.argv.includes('--large-plugins');
// Fixtures and the integration host stay in this repository. Only the actual
// product bundle can be selected from an immutable, previously built candidate.
const extensionPath = process.env.LIMR_TEST_EXTENSION_PATH ? path.resolve(process.env.LIMR_TEST_EXTENSION_PATH) : root;
assert.ok(!skillSuite || extensionPath === root, 'The skill-isolation suite builds its own disposable product and cannot use LIMR_TEST_EXTENSION_PATH.');
const artifacts = process.env.LIMR_TEST_ARTIFACTS ? path.resolve(root, process.env.LIMR_TEST_ARTIFACTS) : path.join(root, 'artifacts', 'test-vscode');
const temporary = await mkdtemp(path.join(process.env.LIMR_TEST_TEMP_ROOT ?? os.tmpdir(), 'limr-vscode-test-'));
const ipc = path.join(temporary, 'ipc');
const workspace = path.join(temporary, 'workspace');
const userData = path.join(temporary, 'profile');
const extensionDirectory = path.join(temporary, 'extensions');
const fixture = path.join(workspace, navigationSuite ? 'SKILL.md' : 'reader.md');
const source = '# LiMR acceptance\n\nBefore **selected words** after. 中文字体测试。\n\n- [ ] An editable task\n\n```typescript\nconst answer = 42;\n```\n';
await Promise.all([mkdir(ipc), mkdir(workspace), mkdir(path.join(userData, 'User'), { recursive: true }), mkdir(extensionDirectory), mkdir(artifacts, { recursive: true })]);
// A failed rerun must not leave a previous success report at the current path.
await rm(path.join(artifacts, 'result.json'), { force: true });
await writeFile(fixture, source);
await writeFile(path.join(workspace, 'sample.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="40"><rect width="120" height="40" fill="#61afef"/><text x="10" y="27" fill="white">LiMR local</text></svg>');
let theme = 'Default Dark Modern';
// Optional real theme installation, copied only into this disposable profile.
const themeDirectory = process.env.LIMR_TEST_THEME_DIR;
if (themeDirectory) {
  await cp(themeDirectory, path.join(extensionDirectory, 'zhuangtongfa.material-theme'), { recursive: true });
  theme = 'One Dark Pro';
}
if (extensionPluginSuite || largePluginSuite) {
  // Install a real companion extension into this disposable VS Code profile.
  // The example itself activates through extensionDependencies and exports API v1.
  const addon = path.join(extensionDirectory, 'limr-examples.limr-reader-addon');
  await cp(path.join(root, 'examples/vscode-reader-addon'), addon, { recursive: true });
  await writeFile(path.join(addon, 'broken.mjs'), 'export default function () { throw new Error("Expected add-on factory failure"); }');
  await writeFile(path.join(addon, 'pending.mjs'), 'export default function () { window.limrTestPendingFactory = true; return new Promise(() => {}); }');
  const entry = path.join(addon, 'extension.cjs');
  await writeFile(entry, await readFile(entry, 'utf8') + `
const exampleActivate = module.exports.activate;
module.exports.activate = async function (context) {
  await exampleActivate(context);
  const api = await vscode.extensions.getExtension('linloir.limr-vscode').activate();
  const bad = [];
  context.subscriptions.push(
    new vscode.Disposable(() => bad.splice(0).forEach(value => value.dispose())),
    vscode.commands.registerCommand('limrExampleTest.missing', () => {
      const registration = api.registerPlugin(context.extension.id, { id: 'missing', module: 'missing.mjs' });
      bad.push(registration); context.subscriptions.push(registration);
    }),
    vscode.commands.registerCommand('limrExampleTest.throwing', () => {
      const registration = api.registerPlugin(context.extension.id, { id: 'throwing', module: 'broken.mjs' });
      bad.push(registration); context.subscriptions.push(registration);
    }),
    vscode.commands.registerCommand('limrExampleTest.pending', () => {
      const registration = api.registerPlugin(context.extension.id, { id: 'pending', module: 'pending.mjs' });
      bad.push(registration); context.subscriptions.push(registration);
    }),
    vscode.commands.registerCommand('limrExampleTest.clear', () => bad.splice(0).forEach(value => value.dispose()))
  );
};
`);
  if (largePluginSuite) {
    const { largeAddonFixtures, largeAddonActivation } = await import('../tests/browser/large-plugins.mjs');
    for (const [name, contents] of Object.entries(largeAddonFixtures)) await writeFile(path.join(addon, name), contents);
    await writeFile(entry, await readFile(entry, 'utf8') + largeAddonActivation);
  }
}
await writeFile(path.join(userData, 'User', 'settings.json'), JSON.stringify({
  'workbench.colorTheme': theme,
  'window.restoreWindows': 'none',
  'workbench.startupEditor': 'none',
  'workbench.enableExperiments': false,
  'workbench.tips.enabled': false,
  'update.mode': 'none',
  'extensions.autoCheckUpdates': false,
  'extensions.autoUpdate': false,
  'telemetry.telemetryLevel': 'off',
  'security.workspace.trust.enabled': false,
  'editor.fontFamily': "Consolas, Monaco, 'Courier New', monospace",
  'editor.fontSize': 16,
  'files.autoSave': 'off',
  'limr.tocMode': 'hidden',
  'limr.language': 'zh-CN',
  'limr.skills.promptOnStartup': skillSuite,
  'limr.syncScroll': false,
}, null, 2));
const executable = process.env.VSCODE_EXECUTABLE_PATH ?? await downloadAndUnzipVSCode(process.env.VSCODE_TEST_VERSION ?? 'stable');
await access(path.join(extensionPath, 'dist', 'extension.cjs'));
const assets = await fileHashes(path.join(extensionPath, 'dist'));
const candidate = await readFile(path.join(extensionPath, 'reading-build.json'), 'utf8').then(JSON.parse).catch(error => {
  if (error.code !== 'ENOENT') throw error;
});
if (candidate) assert.deepEqual(assets, candidate.assets, 'Frozen candidate assets must match their build manifest.');
const productManifest = JSON.parse(await readFile(path.join(extensionPath, 'package.json'), 'utf8'));
const coreManifest = await readFile(path.join(extensionPath, 'node_modules/@linloir/limr/package.json'), 'utf8').then(JSON.parse).catch(error => {
  if (error.code !== 'ENOENT') throw error;
});
const coreVersion = candidate?.coreVersion ?? coreManifest?.version ?? productManifest.dependencies['@linloir/limr'];
assert.match(coreVersion, /^\d+\.\d+\.\d+$/, 'Packaged products must pin an exact core version.');
const build = {
  extensionPath,
  extensionVersion: productManifest.version,
  limrVersion: coreVersion,
  coreVersionSource: candidate ? 'frozen build' : coreManifest ? 'node_modules' : 'packaged dependency pin; compare bundled asset hashes',
  sha256: Object.fromEntries(['extension.cjs', 'syntax-worker.cjs', 'webview/main.js', 'webview/main.css', 'webview/reader-worker.js'].map(file => [`dist/${file}`, assets[file]])),
  assets,
  ...(candidate ? { candidate: { sourceSHA256: candidate.sourceSHA256, coreSHA256: candidate.coreSHA256, builtAt: candidate.builtAt } } : {}),
};
await writeFile(path.join(artifacts, 'build.json'), JSON.stringify(build, null, 2));
let developmentPath = extensionPath;
if (skillSuite) {
  // Exercise first-use onboarding even when the developer has a global skill.
  // Only this disposable bundle sees the empty skill home; no real home/config
  // environment variables or installed skills are changed.
  developmentPath = path.join(temporary, 'development-extension');
  await mkdir(developmentPath);
  for (const entry of ['package.json', 'package.nls.json', 'package.nls.zh-cn.json', 'dist', 'skills', 'docs', 'media']) {
    await cp(path.join(root, entry), path.join(developmentPath, entry), { recursive: true });
  }
  const skillHome = path.join(temporary, 'skill-home');
  await mkdir(skillHome);
  await buildExtension({
    entryPoints: [path.join(root, 'src', 'extension.ts')], outfile: path.join(developmentPath, 'dist', 'extension.cjs'),
    bundle: true, platform: 'node', format: 'cjs', target: 'node20', external: ['vscode'],
    define: { 'process.env.CODEX_HOME': 'undefined' },
    plugins: [{ name: 'isolated-skill-home', setup(build) {
      build.onResolve({ filter: /^node:os$/ }, () => ({ path: 'skill-home', namespace: 'acceptance' }));
      build.onLoad({ filter: /.*/, namespace: 'acceptance' }, () => ({ contents: `export const homedir = () => ${JSON.stringify(skillHome)};`, loader: 'js' }));
    } }],
  });
  build.skillIsolation = { homedir: skillHome, codexHomeLookup: 'disabled only in disposable test bundle', extensionSha256: createHash('sha256').update(await readFile(path.join(developmentPath, 'dist', 'extension.cjs'))).digest('hex') };
}
const port = await new Promise(resolve => { const server = createServer(); server.listen(0, '127.0.0.1', () => { const port = server.address().port; server.close(() => resolve(port)); }); });
const output = [];
const environment = { ...process.env, LIMR_TEST_IPC: ipc, LIMR_TEST_DOCUMENT: fixture, LIMR_TEST_THEME: theme,
  ...(syntaxSuite || navigationSuite || entrypointsSuite || openModesSuite || previewDefaultSuite ? { LIMR_TEST_SOURCE_ONLY: '1' } : {}) };
const externalOpens = path.join(temporary, 'external-opens.jsonl');
if (navigationSuite) {
  // Observe real openExternal requests without launching the user's browser.
  const bin = path.join(temporary, 'bin'); await mkdir(bin);
  await writeFile(externalOpens, '');
  await writeFile(path.join(bin, 'xdg-open'), `#!${process.execPath}\nrequire('node:fs').appendFileSync(${JSON.stringify(externalOpens)}, JSON.stringify(process.argv.slice(2)) + '\\n');\n`, { mode: 0o755 });
  environment.PATH = `${bin}${path.delimiter}${environment.PATH}`;
}
if (process.env.LIMR_TEST_FONT_DIR) {
  const escapeXml = value => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;');
  const fontConfig = path.join(temporary, 'fonts.conf');
  await writeFile(fontConfig, `<?xml version="1.0"?><!DOCTYPE fontconfig SYSTEM "fonts.dtd"><fontconfig><include>/etc/fonts/fonts.conf</include><dir>${escapeXml(process.env.LIMR_TEST_FONT_DIR)}</dir><cachedir>${escapeXml(path.join(temporary, 'font-cache'))}</cachedir></fontconfig>`);
  environment.FONTCONFIG_FILE = fontConfig;
}
// Remote VS Code shells inherit this from their CLI; it turns Electron into Node.
delete environment.ELECTRON_RUN_AS_NODE;
delete environment.VSCODE_IPC_HOOK_CLI;
const child = spawn(executable, [
  '--no-sandbox', ...(process.env.LIMR_TEST_GPU === '1' ? [] : ['--disable-gpu']), '--disable-workspace-trust', '--locale=en', '--skip-welcome', '--skip-release-notes',
  ...(process.env.LIMR_TEST_NATIVE_DEVICE_SCALE ? [`--force-device-scale-factor=${Number(process.env.LIMR_TEST_NATIVE_DEVICE_SCALE)}`] : []),
  '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows',
  `--remote-debugging-port=${port}`, `--user-data-dir=${userData}`, `--extensions-dir=${extensionDirectory}`,
  `--extensionDevelopmentPath=${developmentPath}`, `--extensionTestsPath=${path.join(root, 'tests', 'integration', 'index.cjs')}`, workspace,
], { cwd: root, env: environment, stdio: ['ignore', 'pipe', 'pipe'] });
child.stdout.on('data', data => { output.push(data.toString()); });
child.stderr.on('data', data => { output.push(data.toString()); });
let browser;
let requestId = 0;
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(read, timeout = 30_000) {
  const started = Date.now();
  let lastError;
  while (Date.now() - started < timeout) {
    try { const result = await read(); if (result) return result; } catch (error) { lastError = error; }
    // The integration host can finish and exit between writing its final IPC
    // reply and our next poll. Consume that reply before treating exit as failure.
    if (child.exitCode !== null) throw new Error(`VS Code exited with ${child.exitCode}:\n${output.join('')}`);
    await delay(80);
  }
  throw new Error(`Timed out waiting for the VS Code acceptance host. ${lastError ?? ''}`);
}
async function host(action, data = {}) {
  const id = ++requestId;
  const temporaryRequest = path.join(ipc, 'request.tmp');
  await writeFile(temporaryRequest, JSON.stringify({ id, action, ...data }));
  await rename(temporaryRequest, path.join(ipc, 'request.json'));
  const response = await until(async () => JSON.parse(await readFile(path.join(ipc, `response-${id}.json`), 'utf8')));
  if (response.error) throw new Error(response.error);
  return response.result;
}
try {
  const debug = await until(async () => (await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(3000) })).json(), 60_000);
  const endpoint = new URL(debug.webSocketDebuggerUrl);
  // A remote WSL adapter tunnels a different Windows loopback port locally.
  endpoint.hostname = '127.0.0.1'; endpoint.port = String(port);
  browser = await chromium.connectOverCDP(endpoint.toString());
  const ready = await until(async () => JSON.parse(await readFile(path.join(ipc, 'ready.json'), 'utf8')),
    Number(process.env.LIMR_TEST_HOST_READY_TIMEOUT ?? 60_000));
  assert.equal(ready.trusted, true);
  console.log(`Extension host ready: ${JSON.stringify(ready)}`);
  const page = await until(async () => browser.contexts().flatMap(context => context.pages()).find(page => page.url().includes('workbench')));
  await page.setViewportSize({ width: 1920, height: 1080 });
  const frame = syntaxSuite || navigationSuite || entrypointsSuite || openModesSuite || previewDefaultSuite ? undefined : await until(async () => { for (const frame of page.frames()) if (await frame.locator('.limr-reader').count().catch(() => 0)) return frame; }, 60_000);
  await page.bringToFront();
  for (const target of (process.env.LIMR_TEST_NO_FOCUS_EMULATION ? [] : [page, ...(frame ? [frame] : [])])) {
    const session = await page.context().newCDPSession(target).catch(() => undefined);
    if (session) await session.send('Emulation.setFocusEmulationEnabled', { enabled: true });
  }
  const runAcceptance = skillSuite ? runSkillAcceptance
    : entrypointsSuite ? (await import('../tests/browser/entrypoints.mjs')).runEntrypointsAcceptance
    : openModesSuite ? (await import('../tests/browser/open-modes.mjs')).runOpenModesAcceptance
    : previewDefaultSuite ? (await import('../tests/browser/preview-default.mjs')).runPreviewDefaultAcceptance
    : process.argv.includes('--annotation-selection') ? (await import('../tests/browser/annotation-selection.mjs')).runAnnotationSelectionAcceptance
    : process.argv.includes('--core-compatibility') ? (await import('../tests/browser/core-compatibility.mjs')).runCoreCompatibilityAcceptance
    : process.env.LIMR_TEST_SUITE === 'annotations' || process.argv.includes('--annotations') ? (await import('../tests/browser/annotations.mjs')).runAnnotationAcceptance
    : process.argv.includes('--navigation-modes') ? (await import('../tests/browser/navigation-modes.mjs')).runNavigationModesAcceptance
    : navigationSuite ? (await import('../tests/browser/navigation.mjs')).runNavigationAcceptance
    : process.env.LIMR_TEST_SUITE === 'image-preview' || process.argv.includes('--image-preview') ? (await import('../tests/browser/image-preview.mjs')).runImagePreviewAcceptance
    : process.argv.includes('--limits') ? (await import('../tests/browser/load-limits.mjs')).runLoadLimitsAcceptance
    : process.env.LIMR_TEST_SUITE === 'loading' || process.argv.includes('--loading') ? (await import('../tests/browser/loading.mjs')).runLoadingAcceptance
    : process.env.LIMR_TEST_SUITE === 'table-layout' || process.argv.includes('--table-layout') ? (await import('../tests/browser/table-layout.mjs')).runTableLayoutAcceptance
    : syntaxSuite ? (await import('../tests/browser/syntax-highlighting.mjs')).runSyntaxHighlightingAcceptance
    : extensionPluginSuite ? (await import('../tests/browser/extension-plugins.mjs')).runExtensionPluginsAcceptance
    : largePluginSuite ? (await import('../tests/browser/large-plugins.mjs')).runLargePluginsAcceptance
    : process.env.LIMR_TEST_SUITE === 'images' || process.argv.includes('--images') ? (await import('../tests/browser/images.mjs')).runImageAcceptance
    : process.env.LIMR_TEST_SUITE === 'sidebar-mode' || process.argv.includes('--sidebar-mode') ? (await import('../tests/browser/sidebar-mode.mjs')).runSidebarModeAcceptance
    : process.argv.includes('--scroll-layout-anchor') ? (await import('../tests/browser/scroll-layout-anchor.mjs')).runScrollLayoutAnchorAcceptance
    : process.argv.includes('--scroll-idle') ? (await import('../tests/browser/scroll-idle.mjs')).runScrollIdleAcceptance
    : process.argv.includes('--host-shortcuts') ? (await import('../tests/browser/host-shortcuts.mjs')).runHostShortcutsAcceptance
    : process.argv.includes('--large-scroll') ? (await import('../tests/browser/large-scroll.mjs')).runLargeScrollAcceptance
    : process.argv.includes('--scroll-reload') ? (await import('../tests/browser/scroll-reload.mjs')).runScrollReloadAcceptance
    : process.argv.includes('--scroll-refresh') ? (await import('../tests/browser/scroll-refresh.mjs')).runScrollRefreshAcceptance
    : process.env.LIMR_TEST_SUITE === 'scroll-sync' || process.argv.includes('--scroll-sync') ? (await import('../tests/browser/scroll-sync.mjs')).runScrollSyncAcceptance
    : process.env.LIMR_TEST_SUITE === 'scroll-jitter' || process.argv.includes('--scroll-jitter') ? (await import('../tests/browser/scroll-jitter.mjs')).runScrollJitterAcceptance
    : process.env.LIMR_TEST_SUITE === 'translation-scroll' || process.argv.includes('--translation-scroll') ? (await import('../tests/browser/translation-scroll.mjs')).runTranslationScrollAcceptance
    : process.env.LIMR_TEST_SUITE === 'frontmatter' || process.argv.includes('--frontmatter') ? (await import('../tests/browser/frontmatter.mjs')).runFrontmatterAcceptance
    : process.env.LIMR_TEST_SUITE === 'features' || process.argv.includes('--features') ? runFeatureAcceptance
    : process.env.LIMR_TEST_SUITE === 'regressions' || process.argv.includes('--regressions') ? runRegressionAcceptance
    : process.env.LIMR_TEST_SUITE === 'sidebar-motion' ? runSidebarMotionAcceptance
    : process.env.LIMR_TEST_SUITE === 'block-motion' ? runBlockMotion
    : process.env.LIMR_TEST_SUITE === 'animations' || process.argv.includes('--animations') ? runAnimationAcceptance : runReaderAcceptance;
  const evidence = await runAcceptance({ browser, page, frame, host, source, fixture, artifacts, theme, ready, externalOpens });
  await writeFile(path.join(artifacts, 'result.json'), JSON.stringify({ ...ready, theme, fixture, build, suite: runAcceptance.name, clientUserAgent: await page.evaluate(() => navigator.userAgent), evidence }, null, 2));
  await Promise.all(['failure.png', 'failure.log'].map(name => rm(path.join(artifacts, name), { force: true })));
  await host('finish');
  console.log(`LiMR VS Code acceptance passed. Evidence: ${path.relative(root, path.join(artifacts, 'result.json'))}`);
} catch (error) {
  await writeFile(path.join(artifacts, 'failure.log'), `${error.stack ?? error}\n\n${output.join('')}`);
  for (const page of browser?.contexts().flatMap(context => context.pages()) ?? []) await page.screenshot({ path: path.join(artifacts, 'failure.png') }).catch(() => {});
  throw error;
} finally {
  await writeFile(path.join(artifacts, 'vscode.log'), output.join(''));
  await browser?.close().catch(() => {});
  child.kill('SIGTERM');
  await Promise.race([new Promise(resolve => child.once('exit', resolve)), delay(5000)]);
  if (child.exitCode === null) child.kill('SIGKILL');
  if (!process.env.LIMR_TEST_KEEP_PROFILE) await rm(temporary, { recursive: true, force: true }).catch(() => {});
  else console.log(`Kept acceptance profile: ${temporary}`);
}
