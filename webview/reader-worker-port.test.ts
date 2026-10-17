import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { DocumentWorkerRequest } from '@linloir/limr/core';

class TestWorker extends EventTarget {
  static instances: TestWorker[] = [];
  postMessage = vi.fn(); terminate = vi.fn();
  constructor(readonly url: string) { super(); TestWorker.instances.push(this); }
}
const request: DocumentWorkerRequest = { type: 'load', revision: 7, id: 'book', input: 'Source text', mode: 'blocking', extensions: [] };
let resolveFetch: (value: { ok: boolean; status: number; text(): Promise<string> }) => void;
let fetchAsset: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.resetModules(); TestWorker.instances = [];
  fetchAsset = vi.fn(() => new Promise(resolve => { resolveFetch = resolve; }));
  vi.stubGlobal('fetch', fetchAsset); vi.stubGlobal('Worker', TestWorker);
  vi.stubGlobal('document', { querySelector: () => ({ content: 'https://extension-assets.example/reader-worker.js' }) });
  vi.stubGlobal('window', new EventTarget());
  vi.stubGlobal('ErrorEvent', class extends Event { message: string; error: unknown; constructor(type: string, options: { message: string; error: unknown }) { super(type); this.message = options.message; this.error = options.error; } });
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:reader-worker');
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
const loaded = () => resolveFetch({ ok: true, status: 200, text: async () => 'self.addEventListener("message", () => {});' });

it('queues load until the CSP-compatible asset is ready and forwards worker responses', async () => {
  const { createReaderWorker } = await import('./reader-worker-port');
  const port = createReaderWorker(), messages = vi.fn(); port.addEventListener('message', messages); port.postMessage(request);
  expect(TestWorker.instances).toHaveLength(0); loaded();
  await vi.waitFor(() => expect(TestWorker.instances).toHaveLength(1));
  const worker = TestWorker.instances[0];
  expect(worker.url).toBe('blob:reader-worker'); expect(worker.postMessage).toHaveBeenCalledWith(request, []);
  worker.dispatchEvent(new MessageEvent('message', { data: { type: 'progress', revision: 7, progress: { phase: 'parse', loaded: 5, total: 10 } } }));
  expect(messages.mock.calls[0][0].data.revision).toBe(7);
  port.postMessage({ type: 'continue', revision: 7 });
  expect(worker.postMessage).toHaveBeenLastCalledWith({ type: 'continue', revision: 7 }, []);
  port.terminate(); expect(worker.terminate).toHaveBeenCalledOnce();
  port.postMessage(request); expect(worker.postMessage).toHaveBeenCalledTimes(2);
});
it('drops cancelled document references while sharing the static asset across replacements', async () => {
  const { createReaderWorker } = await import('./reader-worker-port');
  const old = createReaderWorker(); old.postMessage(request); old.terminate();
  const replacement = createReaderWorker(); replacement.postMessage({ ...request, revision: 8, input: 'Replacement' });
  expect(fetchAsset).toHaveBeenCalledOnce(); loaded();
  await vi.waitFor(() => expect(TestWorker.instances).toHaveLength(1));
  expect(TestWorker.instances[0].postMessage.mock.calls[0][0]).toMatchObject({ revision: 8, input: 'Replacement' });
  replacement.terminate();
});
it('reports an asset failure and allows a later retry', async () => {
  const { createReaderWorker } = await import('./reader-worker-port');
  const port = createReaderWorker(), errors = vi.fn(); port.addEventListener('error', errors); port.postMessage(request);
  resolveFetch({ ok: false, status: 404, text: async () => '' });
  await vi.waitFor(() => expect(errors).toHaveBeenCalledOnce());
  expect(errors.mock.calls[0][0].message).toContain('404'); port.terminate();
  const retry = createReaderWorker(); retry.postMessage(request); loaded();
  await vi.waitFor(() => expect(TestWorker.instances).toHaveLength(1));
  expect(fetchAsset).toHaveBeenCalledTimes(2); retry.terminate();
});
