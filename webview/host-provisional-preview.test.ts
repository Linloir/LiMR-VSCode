import { expect, it } from 'vitest';
import { DocumentEngine, standard, workerExtensionDescriptor } from '@linloir/limr';
import { createDocumentWorkerHandler, type DocumentWorkerHandlerOptions, type DocumentWorkerResponse } from '@linloir/limr/worker-api';
import { languageTypographySyntax, readerFrontmatterSyntax, readingAnnotationsSyntax, readerSyntaxIds } from '../src/shared/reader-syntax';
import { readerWorkerRegistry, readerWorkerOptions } from '../src/shared/reader-worker-registry';

const descriptors = [...standard().map(extension => workerExtensionDescriptor(extension)!), ...Object.values(readerSyntaxIds).map(id => ({id}))];
async function collect(source: string, options: DocumentWorkerHandlerOptions) {
  const handler = createDocumentWorkerHandler(readerWorkerRegistry, options);
  const result: DocumentWorkerResponse[] = [];
  const receive = (message: DocumentWorkerResponse) => {
    result.push(structuredClone(message));
    if (message.type === 'snapshot-yield') void handler({type:'continue', revision:message.revision}, receive);
  };
  await handler({type:'load',id:'host-prefix',revision:9,input:source,mode:'progressive',extensions:descriptors},receive);
  return result;
}
it.each([
  ['ordinary metadata', '---\r\ntitle: "中文 🪶 mixed"\r\n---\r\n\r\n'],
  ['frontmatter closes beyond cut', '---\r\ntitle: "' + 'x'.repeat(33000) + '"\r\n---\r\n\r\n'],
  ['malformed frontmatter', '---\r\ntitle: [unfinished\r\n---\r\n\r\n'],
])('keeps all three host syntaxes and final full graph with %s', async (_label, header) => {
  const source = header + '[later] **中A〇Ω🪶** neutral \u0301 and &amp; escaped \\* text.\r\n\r\n'.repeat(3000) + '\r\n[later]: /full-document\r\n';
  const before = await collect(source, { independentProseExtensions: readerWorkerOptions.independentProseExtensions });
  const after = await collect(source, readerWorkerOptions);
  // Normal synchronous full parse, independent of preview/Worker/adoption.
  const expected = new DocumentEngine(source, { id: 'host-prefix', streaming: false, extensions: [
    ...standard(), readerFrontmatterSyntax(), languageTypographySyntax(), readingAnnotationsSyntax(),
  ] }).getSnapshot();
  const prefix = after.find(message=>message.type==='snapshot'&&!message.complete);
  const controlFinal = before.find(message=>message.type==='snapshot'&&message.complete);
  const final = after.find(message=>message.type==='snapshot'&&message.complete);
  expect(before.filter(message=>message.type==='error')).toEqual([]);
  expect(after.filter(message=>message.type==='error')).toEqual([]);
  expect(before.some(message=>message.type==='snapshot'&&!message.complete)).toBe(false);
  expect(prefix?.type).toBe('snapshot'); expect(final?.type).toBe('snapshot'); expect(controlFinal?.type).toBe('snapshot');
  if(prefix?.type!=='snapshot'||final?.type!=='snapshot'||controlFinal?.type!=='snapshot')throw new Error('Missing snapshot');
  expect(prefix.snapshot.source.length).toBeLessThanOrEqual(32768);expect(prefix.snapshot.streaming).toBe(true);
  expect(controlFinal.snapshot).toEqual(expected); expect(final.snapshot).toEqual(expected);
  expect(final.snapshot.source).toBe(source);
  expect(after.some(message=>message.type==='snapshot-start')).toBe(false);
  let wrappers=0;
  const walk=(node:any)=>{if(node.type==='lv-script'){wrappers++;expect(node.position).toBe(node.children[0].position);}node.children?.forEach(walk);};
  final.snapshot.blocks.forEach(block=>walk(block.node));expect(wrappers).toBeGreaterThan(0);
  expect(final.snapshot.definitions.get('later')).toBe(final.snapshot.blocks.find(block=>block.node.type==='definition')?.node);
});
