// Verify the packaged icons and README through the real extension list and
// details page. Uses a disposable profile, never the user's installed extensions.
import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { createServer } from 'node:net';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { chromium, expect } from '@playwright/test';
import { downloadAndUnzipVSCode, resolveCliPathFromVSCodeExecutablePath } from '@vscode/test-electron';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
const vsix = path.resolve(process.argv[2] ?? path.join(root, 'artifacts', `limr-vscode-${manifest.version}.vsix`));
const artifacts = path.resolve(process.env.LIMR_TEST_ARTIFACTS ?? path.join(root, 'artifacts', `test-installed-icon-${manifest.version}`));
const temporary = await mkdtemp(path.join(tmpdir(), 'limr-installed-icon-'));
const profile = path.join(temporary, 'profile'), extensions = path.join(temporary, 'extensions');
await Promise.all([mkdir(path.join(profile, 'User'), { recursive: true }), mkdir(extensions), mkdir(artifacts, { recursive: true })]);
await rm(path.join(artifacts, 'result.json'), { force: true });
await writeFile(path.join(profile, 'User', 'settings.json'), JSON.stringify({
  'workbench.startupEditor': 'none', 'workbench.colorTheme': 'Default Dark Modern',
  'workbench.tips.enabled': false, 'workbench.enableExperiments': false,
  'update.mode': 'none', 'extensions.autoUpdate': false, 'extensions.autoCheckUpdates': false,
  'telemetry.telemetryLevel': 'off', 'limr.skills.promptOnStartup': false,
}));
const executable = process.env.VSCODE_EXECUTABLE_PATH ?? await downloadAndUnzipVSCode('stable');
const environment = { ...process.env };
delete environment.ELECTRON_RUN_AS_NODE;
delete environment.VSCODE_IPC_HOOK_CLI;
const common = ['--no-sandbox', `--user-data-dir=${profile}`, `--extensions-dir=${extensions}`];
const installation = await promisify(execFile)(resolveCliPathFromVSCodeExecutablePath(executable), [...common, '--install-extension', vsix, '--force'], {
  env: { ...environment, DONT_PROMPT_WSL_INSTALL: '1' }, timeout: 60_000,
});
await writeFile(path.join(artifacts, 'installation.log'), installation.stdout + installation.stderr);
const installed = path.join(extensions, `${manifest.publisher}.${manifest.name}-${manifest.version}`);
const installedManifest = JSON.parse(await readFile(path.join(installed, 'package.json'), 'utf8'));
assert.equal(installedManifest.icon, manifest.icon);
const iconBytes = await readFile(path.join(installed, installedManifest.icon));
assert.deepEqual(iconBytes, await readFile(path.join(root, manifest.icon)));
const expectedImage = `data:image/png;base64,${iconBytes.toString('base64')}`;
const server = createServer();
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port;
await new Promise(resolve => server.close(resolve));
const output = [];
const child = spawn(executable, [...common, '--disable-gpu', '--locale=en', '--skip-welcome', '--skip-release-notes',
  '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows',
  `--remote-debugging-port=${port}`], { env: environment, stdio: ['ignore', 'pipe', 'pipe'] });
child.stdout.on('data', data => output.push(data.toString()));
child.stderr.on('data', data => output.push(data.toString()));
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(read, timeout = 45_000) {
  const start = Date.now(); let last;
  while (Date.now() - start < timeout) {
    try { const value = await read(); if (value) return value; } catch (error) { last = error; }
    if (child.exitCode !== null) throw new Error(`VS Code exited: ${child.exitCode}\n${output.join('')}`);
    await delay(100);
  }
  throw new Error(`Timed out: ${last ?? 'waiting for installed extension UI'}`);
}
let browser, page;
async function checkIcon(locator) {
  await locator.waitFor({ state: 'visible' });
  const info = await locator.evaluate(async (image, expected) => {
    await image.decode();
    const reference = new Image(); reference.src = expected; await reference.decode();
    const pixels = img => {
      const canvas = document.createElement('canvas'); canvas.width = img.naturalWidth; canvas.height = img.naturalHeight;
      const ctx = canvas.getContext('2d'); ctx.drawImage(img, 0, 0);
      return ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    };
    const actual = pixels(image), wanted = pixels(reference);
    return { src: image.currentSrc, width: image.naturalWidth, height: image.naturalHeight,
      matchesPackagedPixels: actual.length === wanted.length && actual.every((value, index) => value === wanted[index]) };
  }, expectedImage);
  assert.equal(info.width, 512); assert.equal(info.height, 512); assert.equal(info.matchesPackagedPixels, true);
  assert.ok(info.src.includes(manifest.icon));
  return info;
}
try {
  const endpoint = await until(async () => (await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(1500) })).json());
  browser = await chromium.connectOverCDP(endpoint.webSocketDebuggerUrl);
  page = await until(() => browser.contexts().flatMap(context => context.pages()).find(candidate => candidate.url().includes('workbench')));
  await page.setViewportSize({ width: 1440, height: 1000 }); await page.bringToFront();
  const session = await page.context().newCDPSession(page);
  await session.send('Emulation.setFocusEmulationEnabled', { enabled: true });
  await page.locator('[aria-label^="Extensions"]').first().click();
  const search = page.locator('.extensions-viewlet textarea, .extensions-viewlet input').first();
  await search.waitFor({ state: 'visible' }); await search.focus();
  await page.keyboard.press('Control+a'); await page.keyboard.insertText('@installed limr');
  const row = page.locator('.extension-list-item').filter({ hasText: 'LiMR — Markdown Reader' }).first();
  await row.waitFor({ state: 'visible' });
  const list = await checkIcon(row.locator('img').first());
  await page.screenshot({ path: path.join(artifacts, 'extension-list.png') });
  await row.click();
  const details = await checkIcon(page.locator('.extension-editor .header img').first());
  await page.screenshot({ path: path.join(artifacts, 'extension-details.png') });
  const readme = await until(async () => {
    for (const frame of page.frames()) if (await frame.getByRole('heading', { name: '这是什么', exact: true }).count().catch(() => 0)) return frame;
  });
  // Images must be real, remotely loadable resources in the installed README.
  const readmeImage = await readme.getByRole('img', { name: 'LiMR', exact: true }).evaluate(async image => {
    await image.decode();
    return { src: image.currentSrc, width: image.naturalWidth, height: image.naturalHeight };
  });
  assert.equal(readmeImage.width, 512); assert.equal(readmeImage.height, 512);
  assert.match(readmeImage.src, /^https:\/\/(?:github\.com\/Linloir\/LiMR-VSCode\/raw|raw\.githubusercontent\.com\/Linloir\/LiMR-VSCode)\/main\//);
  const links = await readme.locator('a[href]').evaluateAll(elements => elements.map(element => ({ label: element.textContent, href: element.getAttribute('href') })));
  assert.ok(links.every(link => /^(https:\/\/|#)/.test(link.href)), 'Packaged README links must be absolute HTTPS or same-page anchors.');
  assert.ok(links.some(link => link.href === 'https://github.com/Linloir/LiMR'));
  assert.ok(links.some(link => link.href === 'https://linloir.github.io/LiMR/'));
  await readme.getByRole('link', { name: 'English', exact: true }).click();
  await expect(readme.getByRole('heading', { name: 'English', exact: true })).toBeInViewport();
  await expect(readme.getByRole('heading', { name: 'What is LiMR?', exact: true })).toBeInViewport();
  await page.screenshot({ path: path.join(artifacts, 'readme-english.png') });
  await readme.getByRole('link', { name: '简体中文', exact: true }).click();
  await expect(readme.getByRole('heading', { name: 'LiMR for VS Code', exact: true })).toBeInViewport();
  await page.screenshot({ path: path.join(artifacts, 'readme-chinese.png') });
  await writeFile(path.join(artifacts, 'result.json'), JSON.stringify({ version: manifest.version,
    vsixSha256: createHash('sha256').update(await readFile(vsix)).digest('hex'),
    icon: manifest.icon, iconSha256: createHash('sha256').update(iconBytes).digest('hex'),
    installedThroughVsix: true, extensionDevelopmentPath: false, list, details,
    readme: { image: readmeImage, links, englishNavigation: true, chineseNavigation: true } }, null, 2));
  await Promise.all(['failure.png', 'failure.log', 'failure-dom.html'].map(name => rm(path.join(artifacts, name), { force: true })));
  console.log(`Installed extension icons and README passed: ${path.relative(root, artifacts)}`);
} catch (error) {
  await page?.screenshot({ path: path.join(artifacts, 'failure.png') }).catch(() => {});
  if (page) await writeFile(path.join(artifacts, 'failure-dom.html'), await page.content().catch(() => ''));
  await writeFile(path.join(artifacts, 'failure.log'), String(error.stack ?? error)); throw error;
} finally {
  await writeFile(path.join(artifacts, 'vscode.log'), output.join(''));
  await browser?.close().catch(() => {}); child.kill('SIGTERM');
  await Promise.race([new Promise(resolve => child.once('exit', resolve)), delay(3000)]);
  if (child.exitCode === null) child.kill('SIGKILL');
  await rm(temporary, { recursive: true, force: true }).catch(() => {});
}
