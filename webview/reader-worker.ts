import { createDocumentWorkerHandler, type DocumentWorkerRequest, type DocumentWorkerResponse } from '@linloir/limr/worker-api';
import { readerWorkerOptions, readerWorkerRegistry } from '../src/shared/reader-worker-registry';

const handle = createDocumentWorkerHandler(readerWorkerRegistry, readerWorkerOptions);
const scope = globalThis as unknown as {
  addEventListener(type: 'message', listener: (event: MessageEvent<DocumentWorkerRequest>) => void): void;
  postMessage(message: DocumentWorkerResponse): void;
};
scope.addEventListener('message', event => { void handle(event.data, response => scope.postMessage(response)); });
