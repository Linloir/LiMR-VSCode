import type { DocumentWorkerPort, DocumentWorkerRequest } from '@linloir/limr/core';

let asset: Promise<string> | undefined;
/** Webviews require a data/blob worker. Fetch only the extension-owned static
 * asset; document paths and resource grants stay in the extension host. */
function workerAsset(): Promise<string> {
  return asset ??= (async () => {
    const source = document.querySelector<HTMLMetaElement>('meta[name="limr-parser-worker"]')?.content;
    if (!source) throw new Error('The parser worker asset is unavailable.');
    const response = await fetch(source);
    if (!response.ok) throw new Error(`Unable to load parser worker (${response.status}).`);
    const url = URL.createObjectURL(new Blob([await response.text()], { type: 'text/javascript' }));
    window.addEventListener('unload', () => URL.revokeObjectURL(url), { once: true });
    return url;
  })().catch(error => { asset = undefined; throw error; });
}

/** The core session can post immediately while this host adapter resolves CSP
 * transport. Termination drops queued document references and stale callbacks. */
export function createReaderWorker(): DocumentWorkerPort {
  const events = new EventTarget();
  let worker: Worker | undefined, terminated = false;
  let queued: { message: DocumentWorkerRequest; transfer?: Transferable[] }[] = [];
  void workerAsset().then(url => {
    if (terminated) return;
    worker = new Worker(url);
    worker.addEventListener('message', event => events.dispatchEvent(new MessageEvent('message', { data: event.data })));
    worker.addEventListener('error', event => events.dispatchEvent(new ErrorEvent('error', { message: event.message, error: event.error })));
    for (const { message, transfer } of queued) worker.postMessage(message, transfer ?? []);
    queued = [];
  }).catch(error => {
    queued = [];
    if (!terminated) events.dispatchEvent(new ErrorEvent('error', { message: error instanceof Error ? error.message : String(error), error }));
  });
  return {
    postMessage(message, transfer) {
      if (terminated) return;
      if (worker) worker.postMessage(message, transfer ?? []);
      else queued.push({ message, transfer });
    },
    addEventListener: events.addEventListener.bind(events) as DocumentWorkerPort['addEventListener'],
    removeEventListener: events.removeEventListener.bind(events) as DocumentWorkerPort['removeEventListener'],
    terminate() { terminated = true; queued = []; worker?.terminate(); },
  };
}
