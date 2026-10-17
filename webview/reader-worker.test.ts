import { describe, expect, it, vi } from 'vitest';
import { createDocument, createDocumentSession, hasDocumentSyntax, standard, workerExtensionDescriptor, type DocumentSnapshot, type DocumentWorkerResponse, type RendererExtension, type VirtualizedTextContext } from '@linloir/limr';
import { createDocumentWorkerHandler } from '@linloir/limr/worker-api';
import { readerWorkerOptions, readerWorkerRegistry } from '../src/shared/reader-worker-registry';
import { frontmatterNodeType, readerSyntaxIds } from '../src/shared/reader-syntax';
import { readingAnnotations } from './annotations';
import { readerFrontmatter } from './frontmatter';
import { readerCodeHighlight } from './reader-extensions';
import { languageTypography } from './typography';

const hostExtensions = () => [
  ...standard().filter(extension => extension.name !== 'code-highlight'),
  readerCodeHighlight({ darkTheme: 'one-dark-pro', lightTheme: 'light-plus' }),
  readerFrontmatter(), readingAnnotations('en'), languageTypography(),
];
async function workerSnapshot(source: string, extensions: RendererExtension[]) {
  const messages: DocumentWorkerResponse[] = [];
  const descriptors = extensions.filter(hasDocumentSyntax).map(extension => {
    const descriptor = workerExtensionDescriptor(extension);
    expect(descriptor, extension.name).toBeDefined();
    return descriptor!;
  });
  await createDocumentWorkerHandler(readerWorkerRegistry, readerWorkerOptions)({ type: 'load', revision: 1, id: 'host-parity', input: source, mode: 'blocking', extensions: descriptors },
    response => messages.push(structuredClone(response)));
  expect(messages.filter(message => message.type === 'error')).toEqual([]);
  const response = messages.find(message => message.type === 'snapshot');
  if (response?.type !== 'snapshot') throw new Error('Worker did not publish a snapshot.');
  expect(response.complete).toBe(true);
  return response.snapshot;
}
const semantic = (snapshot: DocumentSnapshot) => ({
  source: snapshot.source, blocks: snapshot.blocks, headings: snapshot.headings, annotations: snapshot.annotations,
  annotationRanges: snapshot.annotationRanges, occurrences: snapshot.occurrences, definitions: snapshot.definitions,
  footnotes: snapshot.footnotes, diagnostics: snapshot.diagnostics,
});

describe('host parser worker contracts', () => {
  it.each([
    '\uFEFF---\r\nname: 元信息😀\r\ndescription: >\r\n  First line\r\n  第二行\r\ntags: [reader, AI]\r\n---\r\n\r\n# Body\r\n\r\nLatin &amp; 中文😀 τέλος.\r\n',
    'Before ::%%limr%%{<#r1}selected &amp; 中文😀::%%limr%%{>#r1} after.\n\n:::limr-annotation{#n1 ranges="r1" type="highlight"}\nA note\n:::\n',
    '---\nname: duplicate\nname: again\n---\n\n![Picture][ref]\n\n[ref]: ./local.svg "Resolved later by the host"\n\n```ts\nconst literal = "&amp; 中文";\n```\n\n:::code{lang="text"}\nLiteral \\* and &amp;\n:::\n',
  ])('keeps worker and host semantic trees identical, including source mappings', async source => {
    const extensions = hostExtensions();
    const host = createDocument(source, { id: 'host-parity', extensions }).getSnapshot();
    const result = await workerSnapshot(source, extensions);
    expect(semantic(result)).toEqual(semantic(host));
    if (source.includes('type="highlight"')) expect(result.annotations[0].data).toMatchObject({ readOnly: false });
  });

  it('declares the three exact host grammars and keeps theme options out of worker parsing', () => {
    expect(workerExtensionDescriptor(readerFrontmatter())).toEqual({ id: readerSyntaxIds.frontmatter });
    expect(workerExtensionDescriptor(languageTypography())).toEqual({ id: readerSyntaxIds.typography });
    expect(workerExtensionDescriptor(readingAnnotations())).toEqual({ id: readerSyntaxIds.annotations });
    expect(workerExtensionDescriptor(readerCodeHighlight({ darkTheme: 'one-dark-pro' })))
      .toEqual(workerExtensionDescriptor(readerCodeHighlight({ darkTheme: 'github-dark' })));
  });

  it('publishes a stable prose prefix only after the full-source grammar proof', async () => {
    const prose = 'Independent **prose** preserves entities &amp; 中文😀 and source positions.\n\n'.repeat(2200);
    expect(prose.length).toBeGreaterThan(128 * 1024);
    const extensions = hostExtensions(), descriptors = extensions.filter(hasDocumentSyntax).map(extension => workerExtensionDescriptor(extension)!);
    for (const source of [prose, `---\nname: Metadata prevents provisional parsing\n---\n\n${prose}`]) {
      const snapshots: DocumentSnapshot[] = [];
      // This control grants only the stable-prose proof, not generic preview.
      await createDocumentWorkerHandler(readerWorkerRegistry, { independentProseExtensions: readerWorkerOptions.independentProseExtensions })({ type: 'load', revision: 2, id: 'host-prefix', input: source, mode: 'progressive', extensions: descriptors }, response => {
        if (response.type === 'error') throw new Error(response.message);
        if (response.type === 'snapshot') snapshots.push(structuredClone(response.snapshot));
      });
      expect(snapshots.length).toBe(source === prose ? 2 : 1);
      expect(snapshots.at(-1)!.source).toBe(source);
      if (source === prose) {
        const prefix = snapshots[0];
        expect(prefix.source.length).toBeLessThan(source.length);
        expect(semantic(prefix)).toEqual(semantic(createDocument(prefix.source, { id: 'host-prefix', extensions }).getSnapshot()));
      }
    }
  });

  it('keeps an unknown workspace transform on the explicit main-thread fallback', async () => {
    const worker = vi.fn(() => { throw new Error('unregistered syntax must not enter the worker'); });
    const session = createDocumentSession({ extensions: [...hostExtensions(), { name: 'unknown-addon', transform(root) { root.children![0].data = { retained: true }; } }], worker });
    const document = await session.load('Ordinary source.');
    expect(worker).not.toHaveBeenCalled();
    expect(session.getSnapshot().capabilities.worker).toBe(false);
    expect(session.getSnapshot().capabilities.reason).toContain('registration');
    expect(document.getSnapshot().blocks[0].node.data).toEqual({ retained: true });
    session.dispose();
  });

  it('preserves raw metadata copy, hidden-YAML search and native disclosure lifetime', () => {
    const extension = readerFrontmatter(), source = '---\nname: Reader\ndescription: |\n  Two lines\n  中文😀\ntags: [one, two]\n---';
    const node = createDocument(source, { extensions: [...standard(), extension] }).getSnapshot().blocks[0].node;
    const adapter = extension.virtualization![frontmatterNodeType];
    const context: VirtualizedTextContext = { source, children: '', value: source };
    expect(adapter.keepAlive).toBe(true);
    expect(adapter.copyText(node, context)).toBe(source);
    expect(adapter.searchText!(node, context)).toContain('Two lines\n中文😀');
    expect(adapter.searchText!(node, context)).not.toContain('description: |');
    expect(adapter.searchText!(node, context)).not.toContain('---');
  });

  it('delegates partial literal copy and search to the core mapped value', () => {
    const extension = readerCodeHighlight(), adapter = extension.virtualization!.code;
    const node = { type: 'code', value: 'before &amp; after' };
    const context: VirtualizedTextContext = { source: '```text\nbefore &amp; after\n```', children: '', value: '&amp;' };
    expect(adapter.copyText(node, context)).toBe('&amp;');
    expect(adapter.searchText!(node, context)).toBe('&amp;');
  });
});
