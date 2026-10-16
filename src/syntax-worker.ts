import { parentPort } from 'node:worker_threads';
import { collectSyntaxTokens } from './syntax-tokens';

parentPort?.on('message', (request: { uri: string; version: number; source: string }) => {
  try { parentPort?.postMessage({ uri: request.uri, version: request.version, tokens: collectSyntaxTokens(request.source) }); }
  catch (error) { parentPort?.postMessage({ uri: request.uri, version: request.version, tokens: [], error: error instanceof Error ? error.message : String(error) }); }
});
