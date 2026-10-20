import { expect, it, vi } from 'vitest';
import { readFile, readdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { typographyCompatibilityModules } from '../scripts/limr-typography.mjs';

const require = createRequire(import.meta.url);
const version = require('@linloir/limr/package.json').version;
const directory = path.join(path.dirname(require.resolve('@linloir/limr/package.json')), 'dist');
const files = await Promise.all((await readdir(directory)).filter(name => name.endsWith('.js')).map(async name => ({
  filename: path.join(directory, name), source: await readFile(path.join(directory, name), 'utf8'),
})));

it('guards the typography correction against unreviewed versions, source drift and ambiguous modules', () => {
  const target = files.find(file => file.source.includes('// src/react/knuth-plass-layout.ts'));
  expect(() => typographyCompatibilityModules(files, '0.0.0')).toThrow(/Review the LiMR typography adapter/);
  expect(() => typographyCompatibilityModules(files.map(file => file === target ? { ...file, source: file.source + '\n' } : file), version)).toThrow(/reviewed npm artifact/);
  expect(() => typographyCompatibilityModules([...files, target], version)).toThrow(/exactly one/);
});

// Exercise the transformed module's actual registration and release code with
// observable browser API doubles. Browser acceptance checks clipping/layout.
function harness({ prepareMilliseconds = 0 } = {}) {
  const source = [...typographyCompatibilityModules(files, version).values()][0];
  const observers = [];
  class Observer {
    targets = new Set(); disconnect = vi.fn(() => this.targets.clear());
    observe(target) { this.targets.add(target); }
    unobserve(target) { this.targets.delete(target); }
  }
  class Intersection extends Observer {
    constructor(callback, options) { super(); this.callback = callback; this.root = options.root; this.options = options; observers.push(this); }
    emit(target, isIntersecting) { this.callback([{ target, isIntersecting }], this); }
  }
  const listeners = new Set();
  const target = () => {
    const events = new Map();
    return {
      addEventListener: vi.fn((name, callback) => { const set = events.get(name) ?? new Set(); set.add(callback); events.set(name, set); }),
      removeEventListener: vi.fn((name, callback) => events.get(name)?.delete(callback)),
      emit: name => { for (const callback of events.get(name) ?? []) callback(); },
      count: name => events.get(name)?.size ?? 0,
    };
  };
  const view = { ...target(), innerWidth: 800, innerHeight: 600 };
  const document = { defaultView: view, getSelection: vi.fn(() => null), addEventListener: vi.fn(), removeEventListener: vi.fn(), fonts: { addEventListener: vi.fn(), removeEventListener: vi.fn() } };
  const frames = new Map(); let nextFrame = 1;
  const raf = vi.fn(callback => { const id = nextFrame++; frames.set(id, callback); return id; });
  const cancel = vi.fn(id => frames.delete(id));
  let time = 0;
  const work = [];
  const prepare = vi.fn(job => {
    time += prepareMilliseconds; work.push({ phase: 'read', element: job.element });
    job.measuredWidth = 800;
    return () => { work.push({ phase: 'write', element: job.element }); job.applied = (job.applied ?? 0) + 1; job.undo = () => {}; };
  });
  const finished = vi.fn(), pending = vi.fn();
  const scope = new Function('IntersectionObserver', 'ResizeObserver', 'MutationObserver', 'document', 'requestAnimationFrame', 'cancelAnimationFrame', 'observeTypographyLayout', 'queueTypographyLayout', 'prepare', 'finishTypographyLayout', 'performance',
    `${source.slice(source.indexOf('var jobs ='), source.indexOf('function collect('))}\nreturn { typeset, jobs, intersections, get frame() { return frame; } };`)(
    Intersection, Observer, Observer, document, raf, cancel, vi.fn(), pending, prepare, finished, { now: () => time });
  function runtime(scrollRoot) {
    let configuration = { scrollRoot };
    const callbacks = new Set();
    return {
      configuration: { get: () => configuration, subscribe: callback => { callbacks.add(callback); listeners.add(callback); return () => { callbacks.delete(callback); listeners.delete(callback); }; } },
      changeRoot(next) { configuration = { scrollRoot: next }; for (const callback of callbacks) callback(); },
    };
  }
  const element = (top = 1200) => ({
    matches: () => true, closest: () => null, querySelector: () => null, querySelectorAll: () => [], ownerDocument: document,
    isConnected: true, top, getBoundingClientRect() { return { top: this.top, bottom: this.top + 80, left: 0, right: 800, height: 80, width: 800 }; },
    getAnimations: () => [], removeAttribute: vi.fn(),
  });
  const root = () => ({ ...target(), contains: () => true, clientWidth: 800, clientHeight: 600, clientTop: 0, clientLeft: 0,
    getBoundingClientRect: () => ({ top: 0, bottom: 600, left: 0, right: 800, height: 600, width: 800 }) });
  const runFrame = () => { const next = [...frames]; frames.clear(); for (const [, callback] of next) callback(123.5); };
  return { ...scope, observers, listeners, runtime, element, root, view, document, frames, raf, cancel, prepare, finished, pending, runFrame, work };
}

it('shares preparation observers within each scroll root and releases each independently', () => {
  const h = harness(), first = h.root(), second = h.root();
  const a = h.element(), b = h.element(), c = h.element();
  const disposeA = h.typeset(a, h.runtime(first)), disposeB = h.typeset(b, h.runtime(first)), disposeC = h.typeset(c, h.runtime(second));
  expect(h.observers.map(observer => observer.options)).toEqual([{ root: first, rootMargin: '600px' }, { root: second, rootMargin: '600px' }]);
  h.observers[0].emit(a, true); expect(h.jobs.get(a).visible).toBe(true);
  disposeA(); expect(h.observers[0].disconnect).not.toHaveBeenCalled();
  disposeB(); expect(h.observers[0].disconnect).toHaveBeenCalledOnce();
  expect(h.observers[1].targets.has(c)).toBe(true);
  disposeB(); expect(h.observers[0].disconnect).toHaveBeenCalledOnce();
  disposeC(); expect(h.intersections.size).toBe(0); expect(h.jobs.size).toBe(0); expect(h.listeners.size).toBe(0);
});

it('preserves the viewport default and rebinds root changes without accepting stale observer notifications', () => {
  const h = harness(), a = h.element(), runtime = h.runtime(undefined);
  const dispose = h.typeset(a, runtime), old = h.observers[0];
  expect(old.root).toBeNull(); old.emit(a, true); expect(h.jobs.get(a).visible).toBe(true);
  const nextRoot = h.root(); runtime.changeRoot(nextRoot);
  const next = h.observers[1];
  expect(old.disconnect).toHaveBeenCalledOnce(); expect(next.root).toBe(nextRoot);
  old.emit(a, true); expect(h.jobs.get(a).visible).toBe(false);
  next.emit(a, true); expect(h.jobs.get(a).visible).toBe(true);
  dispose(); old.emit(a, true); next.emit(a, true);
  expect(h.jobs.size).toBe(0); expect(h.intersections.size).toBe(0); expect(h.listeners.size).toBe(0);
});

it('uses the viewport for portalled content outside the configured reader scroll root', () => {
  const h = harness(), root = { contains: () => false };
  const dispose = h.typeset(h.element(), h.runtime(root));
  expect(h.observers[0].root).toBeNull(); dispose(); expect(h.intersections.size).toBe(0);
});

it('registers a visible window without synchronous reflow, then batches reads before writes', () => {
  const h = harness(), root = h.root(), runtime = h.runtime(root);
  const visible = [h.element(40), h.element(140), h.element(240)], outside = h.element(1900);
  const releases = [...visible, outside].map(element => h.typeset(element, runtime));
  expect(h.prepare).not.toHaveBeenCalled();
  expect(h.raf).not.toHaveBeenCalled();
  for (const element of visible) h.observers[0].emit(element, true);
  expect(h.prepare).not.toHaveBeenCalled();
  expect(h.frames.size).toBe(1);
  h.runFrame();
  expect(h.work.map(item => item.phase)).toEqual(['read', 'read', 'read', 'write', 'write', 'write']);
  expect(visible.map(element => h.jobs.get(element).applied)).toEqual([1, 1, 1]);
  expect(h.jobs.get(outside).applied).toBeUndefined();
  releases.forEach(release => release());
});

it('keeps wheel-driven scrolling out of typography work while the shared frame is pending', () => {
  const h = harness(), root = h.root(), runtime = h.runtime(root), incoming = h.element(-1332);
  const dispose = h.typeset(incoming, runtime);
  incoming.top = 40;
  h.observers[0].emit(incoming, true);
  const queued = [...h.frames.keys()];
  for (let i = 0; i < 10; i++) root.emit('scroll');
  expect(root.count('scroll')).toBe(0);
  expect(h.prepare).not.toHaveBeenCalled();
  expect([...h.frames.keys()]).toEqual(queued);
  expect(h.cancel).not.toHaveBeenCalled();
  h.runFrame(); expect(h.jobs.get(incoming).applied).toBe(1);
  dispose(); expect(h.frames.size).toBe(0);
});

it('yields cold paragraph preparation after the core frame budget without losing queued work', () => {
  const h = harness({ prepareMilliseconds: 3 }), root = h.root(), runtime = h.runtime(root);
  const elements = Array.from({ length: 6 }, (_, index) => h.element(index * 80));
  const releases = elements.map(element => h.typeset(element, runtime));
  for (const element of elements) h.observers[0].emit(element, true);
  expect(h.prepare).not.toHaveBeenCalled();
  for (let frame = 1; frame <= 3; frame++) {
    h.runFrame();
    expect(h.prepare).toHaveBeenCalledTimes(frame * 2);
    expect(elements.filter(element => h.jobs.get(element).applied === 1)).toHaveLength(frame * 2);
    expect(h.frames.size).toBe(frame === 3 ? 0 : 1);
  }
  expect(h.work.map(item => item.phase)).toEqual(Array.from({ length: 3 }, () => ['read', 'read', 'write', 'write']).flat());
  releases.forEach(release => release());
});

it('drops queued jobs when the last boundary unmounts and never typesets detached content', () => {
  const h = harness(), root = h.root(), runtime = h.runtime(root), a = h.element(40), b = h.element(140);
  const releaseA = h.typeset(a, runtime), releaseB = h.typeset(b, runtime);
  h.observers[0].emit(a, true); h.observers[0].emit(b, true);
  expect(h.frames.size).toBe(1);
  releaseA(); releaseB();
  expect(h.frames.size).toBe(0); expect(h.jobs.size).toBe(0);
  expect(h.intersections.size).toBe(0); expect(h.listeners.size).toBe(0);
  h.runFrame(); expect(h.prepare).not.toHaveBeenCalled();
});

it('retains core selection and animation deferral in the budgeted queue', async () => {
  const h = harness(), root = h.root(), runtime = h.runtime(root);
  const selected = h.element(10), animated = h.element(100);
  h.document.getSelection.mockReturnValue({ rangeCount: 1, isCollapsed: false, getRangeAt: () => ({ intersectsNode: element => element === selected }) });
  let finishAnimation;
  const animation = { playState: 'running', effect: { getTiming: () => ({ iterations: 1 }) }, finished: new Promise(resolve => { finishAnimation = resolve; }) };
  animated.getAnimations = () => animation.playState === 'running' ? [animation] : [];
  const releases = [selected, animated].map(element => h.typeset(element, runtime));
  h.observers[0].emit(selected, true); h.observers[0].emit(animated, true);
  h.runFrame(); expect(h.prepare).not.toHaveBeenCalled();
  animation.playState = 'finished'; finishAnimation(); await Promise.resolve(); await Promise.resolve();
  expect(h.prepare).not.toHaveBeenCalled();
  h.runFrame(); expect(h.jobs.get(animated).applied).toBe(1);
  expect(h.jobs.get(selected).applied).toBeUndefined();
  releases.forEach(release => release());
});
