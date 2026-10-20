import { expect, it, vi } from 'vitest';
import { readFile, readdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { commandCompatibilityModules } from '../scripts/limr-commands.mjs';

const require = createRequire(import.meta.url);
const version = require('@linloir/limr/package.json').version;
const directory = path.join(path.dirname(require.resolve('@linloir/limr/package.json')), 'dist');
const files = await Promise.all((await readdir(directory)).filter(name => name.endsWith('.js')).map(async name => ({
  filename: path.join(directory, name), source: await readFile(path.join(directory, name), 'utf8'),
})));
const target = files.find(file => file.source.includes('function DocumentSearch('));
const adapted = commandCompatibilityModules(files, version).get(target.filename);

it('fails closed on version, source and module-identity drift', () => {
  expect(() => commandCompatibilityModules(files, '1.3.12')).toThrow(/Review/);
  expect(() => commandCompatibilityModules(files.map(file => file === target ? { ...file, source: file.source + '\n' } : file), version)).toThrow(/reviewed npm artifact/);
  expect(() => commandCompatibilityModules([...files, target], version)).toThrow(/exactly one/);
});

// Run the actual injected listener. Core still builds the available-action list
// and owns run(), including the toolbar's busy/error/async lifecycle.
function actions({ open = true, disabled = false, busy = false, aborted = false, available = true } = {}) {
  const from = adapted.indexOf('  useEffect8(() => {\n    const command =');
  const to = adapted.indexOf('  if (!open || !context) return null;', from);
  const document = new EventTarget(), run = vi.fn(), cleanups = [];
  new Function('document', 'useEffect8', 'open', 'context', 'busyRef', 'runtime', 'available', 'run', adapted.slice(from, to))(
    document, effect => cleanups.push(effect()), open, {}, { current: busy }, { signal: { aborted } },
    available ? [{ id: 'plugin.add-footnote', disabled: () => disabled }] : [], run,
  );
  const dispatch = () => {
    const detail = { actionId: 'plugin.add-footnote', handled: false };
    document.dispatchEvent(Object.assign(new Event('limr-vscode:selection-action'), { detail }));
    return detail;
  };
  return { run, dispatch, dispose: () => cleanups.forEach(cleanup => cleanup()) };
}

it('executes a plugin action once through the core toolbar and disposes the handler', () => {
  const bridge = actions();
  expect(bridge.dispatch().handled).toBe(true);
  expect(bridge.run).toHaveBeenCalledOnce();
  bridge.dispose();
  expect(bridge.dispatch().handled).toBe(false);
  expect(bridge.run).toHaveBeenCalledOnce();
});

it.each([{ open: false }, { disabled: true }, { busy: true }, { aborted: true }, { available: false }])(
  'does not bypass a hidden, disabled, busy or disposed action: %j', options => {
    const bridge = actions(options);
    expect(bridge.dispatch().handled).toBe(false);
    expect(bridge.run).not.toHaveBeenCalled();
    bridge.dispose();
  },
);

it.skipIf(version !== '1.3.10').each([false, true])('routes native find commands into core search with virtualization=%j', windowed => {
  const from = adapted.indexOf('  useEffect9(() => {\n    const command =');
  const to = adapted.indexOf('  if (!open) return null;', from);
  const document = new EventTarget(), focus = vi.fn(), select = vi.fn(), move = vi.fn(), setOpen = vi.fn(), cleanups = [];
  new Function('document', 'useEffect9', 'runtime', 'open', 'previousFocus', 'setOpen', 'move', 'requestAnimationFrame', 'input', adapted.slice(from, to))(
    document, effect => cleanups.push(effect()), { documentViewport: windowed ? {} : null, configuration: { get: () => ({ provisional: false }) }, signal: { aborted: false } }, true, { current: null },
    setOpen, move, fn => fn(), { current: { focus, select } },
  );
  for (const command of ['find', 'findNext', 'findPrevious'])
    document.dispatchEvent(Object.assign(new Event('limr-vscode:find'), { detail: { command } }));
  expect(move.mock.calls).toEqual([[1], [-1]]);
  expect(select).toHaveBeenCalledOnce();
  expect(focus).toHaveBeenCalledTimes(3);
  cleanups.forEach(cleanup => cleanup());
});

it.runIf(version === "1.3.11")("uses public find without rewriting the search component", () => {
  expect(adapted).not.toContain("limr-vscode:find");
  expect(adapted).toContain("limr-vscode:selection-action");
});
