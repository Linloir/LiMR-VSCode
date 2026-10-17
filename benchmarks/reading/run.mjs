import assert from 'node:assert/strict';
import { layoutProtocol, waitForWorkbenchLayout } from './layout-gate.mjs';
import { captureGPU } from './gpu-info.mjs';
import { sampleProcessMemory } from './process-memory.mjs';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { access, cp, mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { chromium } from '@playwright/test';
import { downloadAndUnzipVSCode } from '@vscode/test-electron';
import { root, sha256, prepareCandidate, fileHashes } from './build.mjs';
import { installObservers, installGeometry, waitStable, scrollProbe, prepareTranslation, translationProbe, resizeProbe, stats } from './probes.mjs';
import { installNovelObservers, novelStation, novelAnchor } from './novel-probes.mjs';

const list = (key, fallback) => (process.env[key] ?? fallback).split(',').map(value => value.trim()).filter(Boolean);
const gpuPolicy = process.env.BENCH_GPU ?? 'default';
assert.ok(['default', 'disabled'].includes(gpuPolicy), 'BENCH_GPU must be default or disabled.');
const modes = list('BENCH_MODES', 'standard,justify,knuth-plass');
const sidebars = list('BENCH_SIDEBARS', 'adaptive,aligned');
const loading = process.env.BENCH_LOADING ?? 'blocking';
const phases = process.env.BENCH_PHASES ?? 'all';
assert.ok(['all', 'loading', 'handoff'].includes(phases), 'BENCH_PHASES must be all, loading or handoff.');
const workload = process.env.BENCH_WORKLOAD ?? 'paper';
assert.ok(['paper', 'novel'].includes(workload), 'BENCH_WORKLOAD must be paper or novel.');
const handoffs = list('BENCH_HANDOFF', workload === 'novel' && loading === 'progressive' ? 'read' : 'none');
assert.ok(handoffs.length && handoffs.every(value => ['none', 'read', 'reveal', 'gesture', 'initial'].includes(value)), 'Unknown handoff case.');
assert.ok(handoffs.every(value => value === 'none' || workload === 'novel' && loading === 'progressive'), 'Handoff cases require the progressive novel workload.');
assert.ok(phases !== 'handoff' || handoffs.every(value => value !== 'none'), 'The handoff phase requires a handoff case.');
const trials = Number(process.env.BENCH_TRIALS ?? 3);
assert.ok(Number.isInteger(trials) && trials > 0 && trials <= 20, 'BENCH_TRIALS must be 1–20.');
assert.ok(modes.length && modes.every(mode => ['standard', 'justify', 'knuth-plass'].includes(mode)), 'Unknown typography mode.');
assert.ok(sidebars.length && sidebars.every(mode => ['adaptive', 'aligned'].includes(mode)), 'Unknown sidebar mode.');
assert.ok(['blocking', 'progressive'].includes(loading), 'Unknown loading mode.');
const sourceDirectory = path.resolve(process.env.BENCH_SOURCE_DIR ?? path.join(root, '../test-reading'));
const outputBase = path.resolve(process.env.BENCH_OUTPUT ?? path.join(root, 'artifacts/benchmarks'));
await mkdir(outputBase, { recursive: true });
const output = await mkdtemp(path.join(outputBase, 'reading-'));
const frozenInput = path.join(output, 'inputs'); await mkdir(frozenInput);
const names = list('BENCH_DOCUMENTS', '1706.03762v7.limr.md,2305.10435v2.zh-CN.limr.md');
assert.ok(names.length && names.every(name => path.basename(name) === name), 'BENCH_DOCUMENTS accepts comma-separated filenames inside BENCH_SOURCE_DIR.');
const documents = [];
for (const name of names) {
  const bytes = await readFile(path.join(sourceDirectory, name)), source = bytes.toString('utf8');
  await writeFile(path.join(frozenInput, name), bytes);
  documents.push({ name, bytes: bytes.length, chars: source.length, sha256: sha256(bytes), sourceSHA256: sha256(source), hasTranslations: /<translations\b|:::translations\b/.test(source) });
}
assert.ok(workload !== 'novel' || documents.every(document => !document.hasTranslations), 'Novel workloads must not contain translation switches.');
const assets = process.env.BENCH_ASSETS === undefined
  ? (await readdir(sourceDirectory, { withFileTypes: true })).filter(entry => entry.isDirectory() && (entry.name.endsWith('.assets') || ['assets', 'images'].includes(entry.name))).map(entry => entry.name)
  : list('BENCH_ASSETS', '');
for (const name of assets) {
  assert.equal(path.basename(name), name, 'BENCH_ASSETS accepts directory names inside BENCH_SOURCE_DIR.');
  await cp(path.join(sourceDirectory, name), path.join(frozenInput, name), { recursive: true });
}
const inputHashes = await fileHashes(frozenInput);
const candidate = await prepareCandidate(output);
async function executablePath() {
  if (process.env.VSCODE_EXECUTABLE_PATH) return path.resolve(process.env.VSCODE_EXECUTABLE_PATH);
  const cache = path.resolve(process.env.BENCH_VSCODE_CACHE ?? path.join(root, '.vscode-test'));
  const cached = (await readdir(cache).catch(() => []))
    .filter(name => /^vscode-linux-(x64|arm64)-/.test(name) && name.includes(process.arch === 'arm64' ? '-arm64-' : '-x64-'))
    .filter(name => !process.env.VSCODE_TEST_VERSION || name.endsWith(`-${process.env.VSCODE_TEST_VERSION}`))
    .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
  for (const name of cached) { const executable = path.join(cache, name, 'code'); if (await access(executable).then(() => true, () => false)) return executable; }
  assert.equal(process.env.BENCH_DOWNLOAD, '1', 'No cached Linux Electron found. Set VSCODE_EXECUTABLE_PATH, or explicitly allow a disposable download with BENCH_DOWNLOAD=1.');
  return downloadAndUnzipVSCode({ version: process.env.VSCODE_TEST_VERSION ?? 'stable', cachePath: cache,
    platform: process.arch === 'arm64' ? 'linux-arm64' : 'linux-x64' });
}
const executable = await executablePath();
const viewport = { width: Number(process.env.BENCH_WIDTH ?? 1920), height: Number(process.env.BENCH_HEIGHT ?? 1080) };
assert.ok(viewport.width >= 1000 && viewport.height >= 600, 'Viewport must be at least 1000 × 600 for sidebar comparisons.');
const baseCases = documents.flatMap(document => modes.flatMap(mode => sidebars.flatMap(sidebar => handoffs.map(handoff => ({ document, mode, sidebar, handoff })))));
const cases = Array.from({ length: trials }, (_, trial) => baseCases.map((_, index) => ({ ...baseCases[(index + trial) % baseCases.length], trial: trial + 1 }))).flat();
const report = { schema: 1, layoutProtocol, timingProtocol: 'native-layout-verified-v1; not directly comparable to earlier command-ack-only resize measurements', startedAt: new Date().toISOString(), complete: false, output, candidate,
  environment: { node: process.version, platform: process.platform, arch: process.arch, cpus: os.cpus()[0]?.model, logicalCPUs: os.cpus().length, memoryBytes: os.totalmem(), executable, viewport,
    gpuPolicy, disableGPU: gpuPolicy === 'disabled', focusEmulation: true, syncScroll: process.env.BENCH_SYNC_SCROLL === '1',
    paperSyncVerification: process.env.BENCH_SYNC_SCROLL === '1' && workload === 'paper' ? 'trusted wheel setup, unchanged probe origin, native visible-range events during each timed scroll' : 'not requested' },
  documents, inputHashes, loading, phases, workload, handoffs, cases: [], plannedCases: cases.length,
  methodology: 'Production frozen extension; fresh disposable Electron/profile/workspace per trial; source-only host installs observers before reader open. All frame deltas use performance.now. Source receive, worker completion and document-ready are distinct; navigation timing is not readiness. No user installation or persistent settings are changed.' };
const save = async () => {
  await writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  const number = value => Number.isFinite(value) ? value.toFixed(1) : '—';
  const rows = report.cases.map(item => `| ${item.label} | ${item.valid ? 'valid' : 'INVALID'} | ${number(item.readiness?.documentReadyMs)} | ${['steady', 'fast', 'seek'].map(kind => number(item.scroll?.find(value => value.kind === kind)?.frameStats.p95)).join(' | ')} |`);
  await writeFile(path.join(output, 'report.md'), `# LiMR VS Code reading benchmark\n\n${report.cases.length}/${report.plannedCases} cases; complete=${report.complete}; valid=${report.valid ?? false}. Units: milliseconds. Each case has a fresh isolated VS Code profile. Invalid runs are diagnostic evidence, not accepted performance results.\n\n| Case | Validity | Source → document ready | Steady frame P95 | Fast frame P95 | Seek frame P95 |\n| --- | --- | ---: | ---: | ---: | ---: |\n${rows.join('\n')}\n\nRaw frame intervals, worker stages, resource hashes, resize/toggle timings and geometry are in each case's result.json; report.json contains the production build manifest.\n`);
};
await save();
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const metric = value => ({ ...value, frameStats: stats(value.frames ?? []), longtaskStats: stats(value.longtasks?.map(task => task.duration) ?? []) });
let interrupted;

async function runCase(item, ordinal) {
  const label = `${String(ordinal + 1).padStart(2, '0')}-${item.document.name}-${item.mode}-${item.sidebar}${item.handoff === 'none' ? '' : `-${item.handoff}`}-r${item.trial}`;
  const directory = path.join(output, label); await mkdir(directory);
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'limr-reading-'));
  const ipc = path.join(temporary, 'ipc'), workspace = path.join(temporary, 'workspace'), profile = path.join(temporary, 'profile'), extensionDirectory = path.join(temporary, 'extensions');
  await Promise.all([mkdir(ipc), mkdir(workspace), mkdir(path.join(profile, 'User'), { recursive: true }), mkdir(extensionDirectory)]);
  const fixture = path.join(workspace, item.document.name);
  await cp(path.join(frozenInput, item.document.name), fixture);
  // Real copies retain the host's localResourceRoots/realpath permissions. A link
  // outside the workspace would measure a different image-access failure path.
  for (const name of assets) await cp(path.join(frozenInput, name), path.join(workspace, name), { recursive: true });
  const settings = {
    'workbench.colorTheme': 'Default Dark Modern', 'window.restoreWindows': 'none', 'workbench.startupEditor': 'none', 'workbench.enableExperiments': false,
    'workbench.tips.enabled': false, 'update.mode': 'none', 'extensions.autoCheckUpdates': false, 'extensions.autoUpdate': false,
    'telemetry.telemetryLevel': 'off', 'security.workspace.trust.enabled': false, 'files.autoSave': 'off',
    'limr.skills.promptOnStartup': false, 'limr.plugins.enabled': false, 'limr.editingEnabled': false,
    'limr.language': 'zh-CN', 'limr.theme': 'playground-dark', 'limr.tocMode': 'always', 'limr.maxWidth': 860,
    'limr.typography': item.mode, 'limr.sidebarMode': 'always', 'limr.sidebarAutoCollapse': item.sidebar === 'adaptive',
    'limr.loadingMode': loading, 'limr.translationMode': 'paragraph', 'limr.syncScroll': process.env.BENCH_SYNC_SCROLL === '1' || item.handoff !== 'none',
  };
  await writeFile(path.join(profile, 'User/settings.json'), JSON.stringify(settings, null, 2));
  const port = await new Promise(resolve => { const server = createServer(); server.listen(0, '127.0.0.1', () => { const port = server.address().port; server.close(() => resolve(port)); }); });
  const environment = { ...process.env, LIMR_TEST_IPC: ipc, LIMR_TEST_DOCUMENT: fixture, LIMR_TEST_SOURCE_ONLY: '1' };
  delete environment.ELECTRON_RUN_AS_NODE; delete environment.VSCODE_IPC_HOOK_CLI;
  const log = [], resourceResponses = [], browserErrors = [];
  const child = spawn(executable, ['--no-sandbox', ...(gpuPolicy === 'disabled' ? ['--disable-gpu'] : []), '--disable-workspace-trust', '--locale=en', '--skip-welcome', '--skip-release-notes',
    '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows',
    `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, `--extensions-dir=${extensionDirectory}`,
    `--extensionDevelopmentPath=${candidate.directory}`, `--extensionTestsPath=${path.join(candidate.directory, 'benchmarks/reading/host.cjs')}`, workspace],
  { cwd: candidate.directory, env: environment, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  child.stdout.on('data', value => log.push(value.toString())); child.stderr.on('data', value => log.push(value.toString()));
  let spawnError; child.on('error', error => { spawnError = error; });
  const alive = () => child.exitCode === null && child.signalCode === null && !spawnError;
  const stop = signal => { interrupted = signal; try { process.kill(-child.pid, 'SIGTERM'); } catch { child.kill(); } };
  const onInterrupt = () => stop('SIGINT'), onTerminate = () => stop('SIGTERM');
  process.once('SIGINT', onInterrupt); process.once('SIGTERM', onTerminate);
  let browser, page, frame, requestId = 0, finished = false;
  const result = { ...item, label, valid: false, complete: false, settings, directory, measurements: {}, layoutValidation: [], issues: [] };
  const stopMemory = process.env.BENCH_MEMORY === '1' ? sampleProcessMemory(child.pid) : undefined;
  async function until(read, timeout = 60_000) {
    const start = Date.now(); let lastError;
    while (Date.now() - start < timeout) {
      try { const value = await read(); if (value) return value; } catch (error) { lastError = error; }
      if (spawnError) throw spawnError;
      if (!alive()) throw new Error(`VS Code exited ${child.exitCode ?? child.signalCode}: ${log.join('').slice(-4000)}`);
      await delay(40);
    }
    throw new Error(`Timed out: ${lastError?.message ?? 'condition did not become true'}`);
  }
  let hostQueue = Promise.resolve();
  function host(action, data = {}) {
    const request = hostQueue.then(() => sendHost(action, data));
    hostQueue = request.catch(() => {}); return request;
  }
  async function sendHost(action, data = {}) {
    const id = ++requestId;
    await writeFile(path.join(ipc, 'request.tmp'), JSON.stringify({ id, action, ...data }));
    await rename(path.join(ipc, 'request.tmp'), path.join(ipc, 'request.json'));
    const response = await until(async () => JSON.parse(await readFile(path.join(ipc, `response-${id}.json`), 'utf8')));
    if (response.error) throw new Error(response.error); return response.result;
  }
  async function verifyLayout(label, sourceSize = .12, readerExpected = true, existing) {
    const evidence = existing ?? { label, operation: 'read-only' };
    if (!existing) result.layoutValidation.push(evidence);
    await waitForWorkbenchLayout({ page, frame: readerExpected ? frame : undefined, host, sourceSize, readerExpected, evidence });
    return evidence;
  }
  async function applyLayout(sourceSize, label, readerExpected = true) {
    const evidence = { label, operation: 'set-once', commandIssuedAt: Date.now() };
    result.layoutValidation.push(evidence);
    evidence.acknowledgment = await host('layout', { sourceSize });
    evidence.commandAcknowledgedAt = Date.now();
    return verifyLayout(label, sourceSize, readerExpected, evidence);
  }
  async function measurePaneResize(sourceSize) {
    const entry = { target: { sourceSize } }; result.measurements.resize.push(entry);
    try {
      const measured = await resizeProbe(frame, async () => { entry.layout = await applyLayout(sourceSize, `resize/${sourceSize}`); }, { sourceSize });
      Object.assign(entry, metric(measured));
      entry.layoutAfter = await verifyLayout(`resize/${sourceSize}/after-stable`, sourceSize);
      return entry;
    } catch (error) {
      entry.error = error.stack ?? String(error);
      // Preserve the original timer/frames on an invalid target as evidence;
      // do not leave its rAF sampler running until browser shutdown.
      entry.partial = await frame.evaluate(() => {
        const state = window.__limrResize; if (!state) return null; state.running = false;
        return { start: state.start, frames: state.frames, ms: performance.now()-state.start,
          longtasks: window.__limrReadingBench.tasks.filter(task=>task.start>=state.start) };
      }).catch(failure=>({ error: String(failure) }));
      throw error;
    }
  }
  async function reset() { await frame.evaluate(() => document.querySelector('.lv-scroll').scrollTo({ top: 0, behavior: 'instant' })); return waitStable(frame); }
  async function preparePaperSync(label) {
    if (workload !== 'paper' || !settings['limr.syncScroll']) return null;
    assert.equal(result.configuration.syncScroll, true, 'The requested synchronization setting was not applied.');
    const entry = { label, beforeWheel: await host('readPosition', { since: Date.now() }), setup: await frame.evaluate(() => {
      const root = document.querySelector('.lv-scroll');
      window.__limrPaperWheel = null;
      root.addEventListener('wheel', event => { window.__limrPaperWheel = { at: performance.now(), trusted: event.isTrusted,
        deltaY: event.deltaY, scrollTop: root.scrollTop, x: event.clientX, y: event.clientY }; }, { once: true, passive: true, capture: true });
      return { at: performance.now(), scrollTop: root.scrollTop, geometry: window.__limrGeometry() };
    }) };
    (result.measurements.paperSync ??= []).push(entry);
    const box = await frame.locator('.lv-scroll').boundingBox(), article = await frame.locator('.limr-reader-content > article').boundingBox();
    assert.ok(box && article, 'No visible reader for the real synchronization ownership gesture.');
    const x = Math.max(box.x + 8, Math.min(box.x + box.width - 8, article.x + article.width / 2));
    await page.mouse.move(x, box.y + box.height * .55);
    await page.mouse.wheel(0, 80);
    await frame.waitForFunction(() => window.__limrPaperWheel !== null, undefined, { timeout: 6000 });
    entry.wheel = await frame.evaluate(() => window.__limrPaperWheel);
    assert.equal(entry.wheel.trusted, true, 'Synchronization setup must use a real browser wheel event.');
    entry.afterWheel = await waitStable(frame, 300);
    assert.equal(entry.afterWheel.timeout, false, 'Ownership setup did not settle.');
    assert.ok(entry.afterWheel.geometry.scrollTop > entry.setup.scrollTop, 'The real ownership wheel did not advance the reader.');
    await frame.evaluate(top => document.querySelector('.lv-scroll').scrollTo({ top, behavior: 'instant' }), entry.setup.scrollTop);
    entry.restored = await waitStable(frame, 300);
    assert.equal(entry.restored.timeout, false, 'Restoring the original probe start did not settle.');
    assert.ok(Math.abs(entry.restored.geometry.scrollTop - entry.setup.scrollTop) <= 1, 'Ownership setup changed the original probe start.');
    entry.before = await nativeRangeBaseline(entry, entry.beforeWheel.at);
    return entry;
  }
  async function nativeRangeBaseline(entry, since = Date.now()) {
    // Drain prior setup/station reveals outside the timed interval. Read-only
    // IPC neither focuses the source editor nor releases reader ownership.
    let signature, changedAt = 0;
    return until(async () => {
      const native = await host('readPosition', { since });
      entry.setupNative = native;
      const next = JSON.stringify(native.positions.map(editor => editor.visible));
      if (next !== signature) { signature = next; changedAt = native.at; }
      const lastEvent = native.events.at(-1)?.at ?? 0;
      return native.positions.length && native.at - Math.max(changedAt, lastEvent) >= 200 ? native : null;
    }, 6000);
  }
  async function prepareNovelSync(label) {
    if (workload !== 'novel' || phases !== 'all' || item.handoff !== 'none' || !settings['limr.syncScroll']) return null;
    const entry = { label, ownership: 'existing checkSourceSync real reader input before all stations' };
    (result.measurements.novelSync ??= []).push(entry);
    // Do not add wheel/reveal/scroll here: preserve novelStation's reading
    // character and the existing compressed-height/anchor workload exactly.
    entry.before = await nativeRangeBaseline(entry);
    return entry;
  }
  async function verifyNativeSync(entry, measured, requiresMovement = true) {
    if (!entry) return;
    const interval = await frame.evaluate(({ start, frames }) => ({
      start: performance.timeOrigin + start,
      end: performance.timeOrigin + start + frames.reduce((sum, elapsed) => sum + elapsed, 0),
      feedback: window.__limrReadingBench.messages.filter(message => message.type === 'reveal' && message.at >= start && message.at <= start + frames.reduce((sum, elapsed) => sum + elapsed, 0)),
    }), { start: measured.start, frames: measured.frames });
    entry.interval = interval; entry.requiresMovement = requiresMovement;
    entry.beforeVisibleRanges = entry.before.positions.map(editor => editor.visible);
    const before = entry.beforeVisibleRanges.map(ranges => JSON.stringify(ranges));
    const read = async () => {
      const native = await host('readPosition', { since: Math.ceil(interval.start) });
      entry.after = native;
      entry.duringEvents = native.events.filter(event => event.at <= Math.floor(interval.end));
      entry.changedDuringEvents = entry.duringEvents.filter(event => !before.includes(JSON.stringify(event.visible)));
      return !requiresMovement || entry.changedDuringEvents.length ? native : null;
    };
    if (requiresMovement) {
      try { await until(read, 6000); }
      catch (cause) { throw new Error(`${entry.label}: no changed source-editor range was observed during the timed scroll; synchronization was not exercised.`, { cause }); }
    } else await read();
    assert.equal(interval.feedback.length, 0, 'Reader-owned measurement echoed a native editor reveal into the reader.');
    if (requiresMovement) assert.ok(entry.changedDuringEvents.length,
      `${entry.label}: no source-editor visible range changed during the timed scroll; synchronization was not exercised.`);
  }
  async function visibleSourceTarget(geometry, offset) {
    if (geometry.visibleSources.some(range => range.start <= offset && range.end >= offset)) return { offset, inside: true };
    // VS Code can reveal the blank separator before a paragraph. Blank source
    // has no glyph or AST block; prove the exact intervening text is whitespace
    // before accepting the following visible block, never an arbitrary offset
    // tolerance that could hide a misplaced paragraph.
    const next = geometry.visibleSources.filter(range => range.start > offset).sort((a, b) => a.start - b.start)[0];
    if (!next || next.start - offset > 8192) return null;
    const gap = await host('readSourceRange', { start: offset, end: next.start });
    return gap.text.length === next.start - offset && /^[ \t\r\n]+$/.test(gap.text) ? { offset, following: next.start, gap } : null;
  }
  async function checkSourceSync() {
    // A genuine native-editor input transfers ownership; a programmatic
    // selection alone deliberately does not masquerade as user input.
    await page.locator('.editor-group-container').first().locator('.monaco-editor').first().click({ position: { x: 75, y: 90 } });
    // Clicking the already selected native character need not emit a VS Code
    // selection event, especially after the controlled provisional gesture.
    // An actual navigation key makes the source-input transfer unambiguous.
    await page.keyboard.press('ArrowDown');
    const start = await frame.evaluate(() => performance.now());
    const request = await host('revealOffset', { ratio: .35 });
    await frame.waitForFunction(start => window.__limrReadingBench.messages.some(message => message.type === 'reveal' && message.at > start), start, { timeout: 6000 });
    await waitStable(frame, 300);
    const sourceToReader = await frame.evaluate(start => ({
      reveal: window.__limrReadingBench.messages.filter(message => message.type === 'reveal' && message.at > start).at(-1),
      geometry: window.__limrGeometry(), anchor: window.__limrNovelAnchor(),
    }), start);
    result.measurements.sourceSync = { request, sourceToReader };
    assert.ok(sourceToReader.anchor, 'No source-mapped reading character was available for the synchronization check.');
    sourceToReader.target = await visibleSourceTarget(sourceToReader.geometry, sourceToReader.reveal.offset);
    assert.ok(sourceToReader.target,
      'A real source-editor reveal did not mount the corresponding offscreen reader block.');
    const box = await frame.locator('.lv-scroll').boundingBox();
    assert.ok(box, 'No visible reader viewport for a real input gesture.');
    const beforeNative = await host('readPosition');
    const originalEnd = Math.max(...beforeNative.positions.flatMap(editor => editor.visible.map(range => range.end)));
    assert.ok(Number.isFinite(originalEnd), 'No native source viewport before reader input.');
    const inputAt = await frame.evaluate(() => performance.now()), inputWall = Date.now();
    await page.mouse.move(box.x + box.width * .45, box.y + box.height * .55);
    await page.mouse.wheel(0, 600);
    await waitStable(frame, 300);
    let after = await novelAnchor(frame);
    const gestures = [{ delta: 600, anchor: after }];
    Object.assign(result.measurements.sourceSync, { inputAt, inputWall, beforeNative, gestures, after });
    assert.ok(after && after.source > sourceToReader.anchor.source, 'The real reader wheel did not advance through source content.');
    // A small wheel can return to the same source line that AtTop originally
    // requested: native cursor/sticky padding placed the reader a few lines
    // earlier. Require input beyond the original source viewport so observing
    // a native range event proves a necessary synchronization, not a no-op.
    for (let attempt = 0; after.source <= originalEnd && attempt < 4; attempt++) {
      const sourcePerPixel = (after.source - sourceToReader.anchor.source) / gestures.reduce((sum, gesture) => sum + gesture.delta, 0);
      const delta = Math.min(12000, Math.max(600, Math.ceil((originalEnd - after.source + 512) / sourcePerPixel)));
      await page.mouse.wheel(0, delta); await waitStable(frame, 300);
      after = await novelAnchor(frame); gestures.push({ delta, anchor: after });
      result.measurements.sourceSync.after = after;
      assert.ok(after, 'Reader input lost its source-mapped character.');
    }
    assert.ok(after.source > originalEnd, 'Reader input did not move beyond the original source-editor viewport.');
    const native = await until(async () => {
      const current = await host('readPosition', { since: inputWall });
      result.measurements.sourceSync.lastNative = current;
      return current.events.length && current.positions.some(editor => editor.visible.some(range => range.start <= after.source && range.end >= after.source)) ? current : null;
    }, 6000);
    const feedback = await frame.evaluate(inputAt => window.__limrReadingBench.messages.filter(message => message.type === 'reveal' && message.at > inputAt), inputAt);
    assert.equal(feedback.length, 0, 'Reader-owned scrolling echoed an editor reveal back into the reader.');
    Object.assign(result.measurements.sourceSync, { after, native, feedback });
  }
  try {
    const debug = await until(async () => (await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(3000) })).json());
    const endpoint = new URL(debug.webSocketDebuggerUrl); endpoint.hostname = '127.0.0.1'; endpoint.port = String(port);
    browser = await chromium.connectOverCDP(endpoint.toString());
    result.gpuStart = await captureGPU(browser, 'before-reader-open');
    if (!result.gpuStart.observed) result.issues.push('Initial GPU state was not observed.');
    result.host = await until(async () => JSON.parse(await readFile(path.join(ipc, 'ready.json'), 'utf8')));
    assert.equal(result.host.trusted, true); assert.equal(result.host.sourceOnly, true); assert.equal(result.host.lightweightIPC, true);
    page = await until(() => browser.contexts().flatMap(context => context.pages()).find(page => page.url().includes('workbench')));
    await page.setViewportSize(viewport); await page.bringToFront();
    const context = page.context(); await context.addInitScript(installObservers);
    if (workload === 'novel') {
      await context.exposeBinding('__limrBenchRevealSource', async (_binding, payload) => host('revealOffset', payload));
      await context.addInitScript(installNovelObservers, { handoff: item.handoff });
    }
    context.on('response', response => { const url = response.url(); if (url.includes('vscode-resource') || url.includes('vscode-cdn.net')) resourceResponses.push(response); });
    context.on('requestfailed', request => browserErrors.push({ kind: 'requestfailed', url: request.url(), error: request.failure()?.errorText }));
    page.on('pageerror', error => browserErrors.push({ kind: 'pageerror', error: String(error), stack: error.stack }));
    page.on('console', message => { if (message.type() === 'error') browserErrors.push({ kind: 'console', error: message.text(), location: message.location() }); });
    const focus = await context.newCDPSession(page); await focus.send('Emulation.setFocusEmulationEnabled', { enabled: true });
    // Install the intended two-group sizes before the new Webview is created, so
    // first-ready timing is not polluted by a later setup resize.
    await applyLayout(.12, 'initial/before-open', false);
    const openAt = Date.now(); result.open = await host('openReader', item.handoff === 'initial' ? { initialRevealRatio: .8 } : {});
    frame = await until(async () => { for (const frame of page.frames()) if (await frame.locator('meta[name="limr-parser-worker"]').count().catch(() => 0)) return frame; });
    const frameFocus = await context.newCDPSession(frame).catch(() => undefined);
    if (frameFocus) await frameFocus.send('Emulation.setFocusEmulationEnabled', { enabled: true });
    await installGeometry(frame);
    await frame.waitForFunction(chars => {
      const bench = window.__limrReadingBench;
      return document.querySelector('.lv-app[data-reader-ready="true"]') && !document.querySelector('.limr-document-loading')
        && document.querySelector('[data-limr-windowed] [data-window-slot]')
        && bench?.messages.some(message => message.type === 'state' && message.chars === chars)
        && bench.workers.some(worker => worker.requests.some(request => request.chars === chars && worker.responses.some(response => response.revision === request.revision
          && (response.type === 'snapshot' && response.complete && response.chars === chars || response.type === 'snapshot-end' && worker.responses.some(header => header.type === 'snapshot-start' && header.revision === request.revision && header.chars === chars)))));
    }, item.document.chars, { timeout: 120_000 });
    result.measurements.openToReadyWallMs = Date.now() - openAt;
    result.measurements.readiness = await frame.evaluate(chars => {
      const bench = window.__limrReadingBench, received = bench.messages.find(message => message.type === 'state' && message.chars === chars);
      const worker = bench.workers.find(worker => worker.requests.some(request => request.chars === chars));
      const request = worker.requests.find(request => request.chars === chars);
      const complete = worker.responses.find(response => response.revision === request.revision && (response.type === 'snapshot' && response.complete || response.type === 'snapshot-end'));
      const responses = worker.responses.filter(response => response.revision === request.revision);
      return { receivedAt: received.at, receivedEpoch: performance.timeOrigin + received.at, workerCreatedAt: worker.created, workerRequestedAt: request.at,
        firstProgressAt: responses.find(response => response.type === 'progress')?.at ?? null,
        prefixAt: responses.find(response => response.type === 'snapshot' && !response.complete)?.at ?? null,
        fullSnapshotStartedAt: responses.find(response => response.type === 'snapshot-start')?.at ?? null, workerCompletedAt: complete.at,
        documentReadyAt: bench.readyAt, documentReadyMs: bench.readyAt === undefined ? null : bench.readyAt - received.at,
        observedReadyMs: performance.now() - received.at, workerMs: complete.at - request.at, request,
        parserWorkerAsset: document.querySelector('meta[name="limr-parser-worker"]').content, frameURL: location.href };
    }, item.document.chars);
    const readiness = result.measurements.readiness;
    readiness.hostOpenToSourceWallMs = readiness.receivedEpoch - openAt;
    readiness.sourceToWorkerPostMs = readiness.workerRequestedAt - readiness.receivedAt;
    readiness.sourceToFirstProgressMs = readiness.firstProgressAt === null ? null : readiness.firstProgressAt - readiness.receivedAt;
    readiness.sourceToPrefixMs = readiness.prefixAt === null ? null : readiness.prefixAt - readiness.receivedAt;
    readiness.sourceToFullSnapshotMs = readiness.workerCompletedAt - readiness.receivedAt;
    assert.equal(readiness.request.mode, loading);
    for (const id of ['limr-vscode/frontmatter@1', 'limr-vscode/language-typography@1', 'limr-vscode/reading-annotations@1'])
      assert.ok(readiness.request.extensions?.some(extension => extension.id === id), `The actual worker load is missing host syntax ${id}.`);
    assert.ok(Number.isFinite(result.measurements.readiness.documentReadyMs) && result.measurements.readiness.documentReadyMs >= 0,
      'Document-ready timestamp was not observed after the matching source message.');
    assert.ok(readiness.documentReadyAt >= readiness.workerCompletedAt, 'Reader was marked complete before the parser worker finished.');
    await frame.evaluate(() => document.fonts.ready);
    const stable = await waitStable(frame); result.measurements.initialStable = metric(stable);
    result.measurements.readiness.fontsAndStableMs = await frame.evaluate(received => performance.now() - received, result.measurements.readiness.receivedAt);
    result.actual = await frame.evaluate(() => ({ typography: document.querySelector('.limr-reader-content > article')?.dataset.limrTypography,
      sidebarPresent: !!document.querySelector('.limr-sidebar'), adaptive: document.querySelector('.limr-sidebar')?.dataset.collapseOverflow === 'true',
      windowed: !!document.querySelector('[data-limr-windowed]'), userAgent: navigator.userAgent }));
    assert.equal(result.actual.typography, item.mode); assert.equal(result.actual.adaptive, item.sidebar === 'adaptive');
    assert.ok(result.actual.sidebarPresent && result.actual.windowed, 'The requested sidebar/windowing path was not actually used.');
    if (item.handoff === 'none') assert.ok(stable.geometry.heading, 'The first reader viewport has no heading.');
    assert.equal(stable.timeout, false);
    await verifyLayout('initial/ready', .12);
    result.configuration = await host('readConfiguration', { keys: ['typography', 'sidebarMode', 'sidebarAutoCollapse', 'tocMode', 'loadingMode', 'syncScroll', 'maxWidth', 'translationMode'] });
    assert.equal(result.configuration.typography, item.mode); assert.equal(result.configuration.loadingMode, loading);
    assert.equal(result.configuration.sidebarAutoCollapse, item.sidebar === 'adaptive');
    if (process.env.BENCH_SCREENSHOTS !== '0') await page.screenshot({ path: path.join(directory, 'initial.png') });
    result.measurements.scroll = [];
    result.measurements.translation = []; result.measurements.resize = [];
    result.measurements.stations = [];
    if (item.handoff !== 'none') {
      const handoff = result.measurements.handoff = await frame.evaluate(() => ({ ...window.__limrNovel,
        settled: window.__limrNovelLocate(window.__limrNovel.beforeReady), current: window.__limrNovelAnchor() }));
      assert.deepEqual(handoff.errors, [], 'The prefix observer could not exercise the requested handoff.');
      assert.ok(handoff.prefix?.heading && handoff.prefix.at < readiness.documentReadyAt,
        'An actual visible prefix was not observed before full ready; this case did not exercise progressive reading.');
      if (item.handoff === 'read' || item.handoff === 'gesture') {
        assert.ok(handoff.actions.some(action => action.kind === 'reader-wheel' && !action.complete && action.provisional && action.at < readiness.documentReadyAt), 'No reading gesture occurred in the actual prefix before full ready.');
        assert.ok(handoff.beforeReady?.scrollTop > 40 && handoff.beforeReady.at < readiness.documentReadyAt, 'No non-top source character was observed in the prefix before replacement.');
        assert.ok(handoff.settled, 'The prefix source character disappeared from the completed viewport.');
        assert.equal(handoff.settled.character, handoff.beforeReady.character);
        assert.ok(Math.abs(handoff.settled.y - handoff.beforeReady.y) <= 2, 'Prefix/full replacement moved the actual source character by more than 2 px.');
      }
      if (item.handoff !== 'read') {
        const pending = handoff.reveals.filter(message => !message.complete && message.at < readiness.documentReadyAt).at(-1);
        assert.ok(pending, 'No real editor source reveal reached the provisional reader before ready.');
        if (item.handoff === 'initial') assert.equal(pending.rootPresent, false,
          'The initial-reveal race was not exercised: the reveal arrived after scrollRoot existed.');
        if (item.handoff === 'gesture') assert.ok(handoff.actions.some(action => action.at > pending.at), 'The reader gesture did not supersede the pending source reveal.');
        else {
          handoff.target = await visibleSourceTarget(stable.geometry, pending.offset);
          assert.ok(handoff.target, 'The latest queued source reveal did not become visible after full ready.');
        }
      }
      await checkSourceSync();
    }
    if (phases === 'all' && workload === 'novel') {
      if (item.handoff === 'none' && settings['limr.syncScroll']) {
        assert.equal(result.configuration.syncScroll, true, 'The novel synchronization setting was not applied.');
        await checkSourceSync();
      }
      for (const [name, ratio] of [['first', 0], ['middle', .5], ['tail', .98]]) {
        await novelStation(frame, ratio);
        const settled = await waitStable(frame), anchor = await novelAnchor(frame);
        assert.ok(!settled.timeout && anchor, `The ${name} reading station did not display a source character.`);
        if (name === 'middle') assert.ok(anchor.source > item.document.chars * .15 && anchor.source < item.document.chars * .85, 'The middle seek did not reach middle source content.');
        if (name === 'tail') assert.ok(anchor.source > item.document.chars * .85, 'The tail seek did not reach the final portion of source.');
        result.measurements.stations.push({ name, ratio, anchor, settled: metric(settled) });
        for (const kind of ['steady', 'fast']) {
          await novelStation(frame, ratio); await waitStable(frame);
          const sync = await prepareNovelSync(`${name}/${kind}`);
          const before = await novelAnchor(frame), measured = metric(await scrollProbe(frame, kind)), after = await novelAnchor(frame);
          assert.ok(after && after.source > before.source, `${name}/${kind} did not advance through source text.`);
          result.measurements.scroll.push({ ...measured, station: name, before, after });
          await verifyNativeSync(sync, measured);
        }
      }
      for (const ratio of [1, .5, 0]) {
        const start = await frame.evaluate(() => performance.now()); await novelStation(frame, ratio);
        const settled = await waitStable(frame), anchor = await novelAnchor(frame);
        const elapsed = await frame.evaluate(start => performance.now() - start, start);
        assert.ok(!settled.timeout && anchor, 'A remote source seek left no readable text.');
        result.measurements.stations.push({ name: 'seek', ratio, anchor, settled: metric(settled), elapsed });
        if (ratio === 1) await frame.waitForFunction(() => [...document.querySelectorAll('[data-limr-block]')].some(node => {
          const r = node.getBoundingClientRect(), root = document.querySelector('.lv-scroll').getBoundingClientRect();
          return node.textContent.includes('THE-END-OF-THE-COMPLETE-BOOK') && r.bottom > root.top && r.top < root.bottom;
        }), undefined, { timeout: 6000 });
      }
      await novelStation(frame, .5); await waitStable(frame);
      for (const sourceSize of [.33, .12]) {
        const before = await novelAnchor(frame), measured = await measurePaneResize(sourceSize);
        const after = await novelAnchor(frame, before); Object.assign(measured, { before, after });
        assert.ok(after && after.character === before.character && Math.abs(after.y - before.y) <= 2, 'A pane resize moved the actual reading character by more than 2 px.');
      }
    } else if (phases === 'all') {
    for (const kind of ['steady', 'fast', 'seek']) {
      await reset(); const sync = await preparePaperSync(`scroll/${kind}`);
      await verifyLayout(`scroll/${kind}/before`);
      const measured = metric(await scrollProbe(frame, kind)); result.measurements.scroll.push(measured);
      await verifyNativeSync(sync, measured);
      await verifyLayout(`scroll/${kind}/after`);
    }
    for (const scrolling of item.document.hasTranslations ? [false, true] : []) {
      await reset();
      for (let attempt = 0; attempt < 3; attempt++) {
        if (!await prepareTranslation(frame)) { if (item.document.hasTranslations) throw new Error('The sample has translations, but no switch became visible.'); break; }
        const sync = await preparePaperSync(`translation/${scrolling ? 'scrolling' : 'stationary'}/${attempt + 1}`);
        await verifyLayout(`translation/${scrolling}/${attempt+1}/before`);
        const measured = metric(await translationProbe(frame, scrolling));
        assert.ok(measured.modeChanged && measured.committed !== null, 'A clicked translation switch did not commit a data-mode change.');
        result.measurements.translation.push(measured);
        await verifyNativeSync(sync, measured, scrolling);
        await verifyLayout(`translation/${scrolling}/${attempt+1}/after`);
      }
    }
    await reset(); result.measurements.resize = [];
    for (const sourceSize of [.33, .12]) await measurePaneResize(sourceSize);
    for (const maxWidth of [640, 860]) result.measurements.resize.push(metric(await resizeProbe(frame, () => host('configure', { values: { maxWidth } }), { maxWidth })));
    }
    const finalSource = await host('snapshot');
    result.finalSourceSHA256 = finalSource.sourceSHA256;
    assert.equal(finalSource.chars, item.document.chars, 'The measurement changed the document length.');
    assert.equal(result.finalSourceSHA256, item.document.sourceSHA256, 'The measurement changed the document source.');
    const geometries = [stable.geometry, ...result.measurements.scroll.flatMap(value => value.geometry), ...result.measurements.translation.flatMap(value => value.geometry), ...result.measurements.resize.map(value => value.settled.geometry), ...result.measurements.stations.map(value => value.settled.geometry)];
    result.geometry = { samples: geometries.length, firstHeading: stable.geometry.heading,
      missingVisibleContent: geometries.filter(value => !value.visibleBlocks).length,
      coverageMisses: geometries.filter(value => value.coverage?.some(covered => !covered)).length,
      gaps: geometries.flatMap(value => value.gaps.filter(gap => gap.px > 1).map(gap => ({ ...gap, scrollTop: value.scrollTop }))),
      overlaps: geometries.flatMap(value => value.gaps.filter(gap => gap.px < -1).map(gap => ({ ...gap, scrollTop: value.scrollTop }))) };
    if (workload === 'novel') {
      result.geometry.maxMountedBlocks = Math.max(...geometries.map(value => value.mountedBlocks ?? 0));
      if (result.geometry.maxMountedBlocks > 160) result.issues.push('Plain-novel mounted source blocks exceeded the bounded-window ceiling of 160.');
    }
    if (result.geometry.missingVisibleContent) result.issues.push('A sampled viewport had no visible source block.');
    if (result.geometry.gaps.length || result.geometry.overlaps.length) result.issues.push('Adjacent mounted slots have a gap/overlap greater than 1 px; inspect raw geometry.');
    for (const value of [result.measurements.initialStable, ...result.measurements.scroll, ...result.measurements.translation, ...result.measurements.resize, ...result.measurements.stations.map(value => value.settled)]) {
      if (value.frameStats.invalid) result.issues.push('Invalid/negative frame delta.');
      if (value.settled?.timeout) result.issues.push('Resize did not settle within 6 seconds.');
    }
    result.complete = true;
  } catch (error) {
    result.error = error.stack ?? String(error);
    await page?.screenshot({ path: path.join(directory, 'failure.png') }).catch(() => {});
  } finally {
    result.memory = stopMemory?.();
    if (browser) {
      result.gpuEnd = await captureGPU(browser, 'after-reading-phases');
      if (!result.gpuEnd.observed) result.issues.push('Final GPU state was not observed.');
    }
    if (frame) result.observations = await frame.evaluate(() => ({ ...window.__limrReadingBench, novel: window.__limrNovel, finalGeometry: window.__limrGeometry?.(),
      resources: performance.getEntriesByType('resource').map(entry => ({ name: entry.name, initiatorType: entry.initiatorType, duration: entry.duration, transferSize: entry.transferSize })) })).catch(error => ({ error: String(error) }));
    // Body hashing happens after measured phases; downloading/hashing during the
    // load itself would add instrumentation work to document-ready latency.
    result.loadedAssets = []; result.resourceErrors = [];
    for (const response of resourceResponses) {
      const url = response.url(), decoded = decodeURIComponent(url);
      if (response.status() >= 400) result.resourceErrors.push({ url, status: response.status() });
      const relative = Object.keys(candidate.manifest.assets).find(name => decoded.endsWith(`/dist/${name}`) || decoded.includes(`/dist/${name}?`));
      if (!relative || !/\.(js|css)$/.test(relative)) continue;
      try { result.loadedAssets.push({ asset: relative, url, status: response.status(), sha256: sha256(await response.body()) }); }
      catch (error) { result.issues.push(`Cannot verify loaded asset ${relative}: ${error.message}`); }
    }
    for (const asset of ['webview/main.js', 'webview/main.css', 'webview/reader-worker.js']) {
      if (!result.loadedAssets.some(item => item.asset === asset && item.sha256 === candidate.manifest.assets[asset])) result.issues.push(`No matching actually loaded asset hash: ${asset}`);
    }
    if (result.loadedAssets.some(item => item.sha256 !== candidate.manifest.assets[item.asset])) result.issues.push('A loaded asset differs from the frozen production build.');
    result.browserErrors = browserErrors;
    if (result.observations?.errors?.length || result.observations?.workers?.some(worker => worker.responses.some(response => response.type === 'error'))) result.issues.push('Reader or worker reported a runtime error.');
    if (result.resourceErrors.length) result.issues.push('A Webview resource returned HTTP 4xx/5xx.');
    result.valid = result.complete && !result.error && !result.issues.length;
    if (browser && alive()) { await host('finish').then(() => { finished = true; }, () => {}); }
    await browser?.close().catch(() => {});
    if (alive()) { try { process.kill(-child.pid, 'SIGTERM'); } catch { child.kill(); } }
    for (let attempt = 0; alive() && attempt < 20; attempt++) await delay(100);
    if (alive()) { try { process.kill(-child.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); } }
    process.removeListener('SIGINT', onInterrupt); process.removeListener('SIGTERM', onTerminate);
    result.finishedHost = finished; result.electronExit = { code: child.exitCode, signal: child.signalCode };
    await writeFile(path.join(directory, 'electron.log'), log.join(''));
    if (process.env.BENCH_KEEP_PROFILE !== '1') await rm(temporary, { recursive: true, force: true }); else result.profile = temporary;
    await writeFile(path.join(directory, 'result.json'), JSON.stringify(result, null, 2));
  }
  return result;
}

console.log(`Frozen production candidate: ${candidate.directory}\n${cases.length} isolated cases → ${output}`);
for (const [index, item] of cases.entries()) {
  console.log(`[${index + 1}/${cases.length}] ${item.document.name} ${item.mode}/${item.sidebar} round ${item.trial}`);
  const result = await runCase(item, index);
  report.cases.push({ label: result.label, gpuStart: result.gpuStart, gpuEnd: result.gpuEnd, valid: result.valid, complete: result.complete, error: result.error, issues: result.issues,
    result: path.join(result.directory, 'result.json'), layoutValidation: result.layoutValidation?.map(({label,valid,observedAt,error,actual})=>({label,valid,observedAt,error,actual})), readiness: result.measurements.readiness,
    scroll: result.measurements.scroll?.map(({ kind, station, frameStats }) => ({ kind, station, frameStats })),
    stations: result.measurements.stations?.map(({ name, ratio, anchor, elapsed }) => ({ name, ratio, anchor, elapsed })),
    handoff: result.measurements.handoff ? { kind: item.handoff, prefix: result.measurements.handoff.prefix, beforeReady: result.measurements.handoff.beforeReady, settled: result.measurements.handoff.settled } : undefined,
    translation: result.measurements.translation?.map(({ scrolling, frameStats, committed }) => ({ scrolling, frameStats, committed })),
    paperSync: result.measurements.paperSync?.map(entry => ({ label: entry.label, trustedWheel: entry.wheel?.trusted, requiresMovement: entry.requiresMovement, sourceRangeChangesDuringProbe: entry.changedDuringEvents?.length })),
    novelSync: result.measurements.novelSync?.map(entry => ({ label: entry.label, ownership: entry.ownership, sourceRangeChangesDuringProbe: entry.changedDuringEvents?.length })),
    resize: result.measurements.resize?.map(({ target, frameStats, ms }) => ({ target, frameStats, ms })), geometry: result.geometry });
  await save();
  console.log(`${result.valid ? 'VALID' : 'INVALID'} ${result.label}${result.error ? `: ${result.error.split('\n')[0]}` : ''}`);
  if (interrupted || !result.valid && process.env.BENCH_KEEP_GOING !== '1') break;
}
report.complete = report.cases.length === cases.length;
report.valid = report.complete && report.cases.every(item => item.valid);
report.finishedAt = new Date().toISOString(); await save();
console.log(`Report: ${path.join(output, 'report.json')}`);
if (!report.valid) process.exitCode = interrupted ? 130 : 1;
