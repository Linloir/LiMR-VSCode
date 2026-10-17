import { codeHighlight, registerWorkerExtension, type CodeHighlightOptions, type RendererExtension } from '@linloir/limr';

/** Theme choices change presentation, while parsing is the exact standard code
 * grammar. Core also owns literal text mapping for partial copy and search. */
export function readerCodeHighlight(options: CodeHighlightOptions = {}): RendererExtension {
  const extension = codeHighlight(options);
  extension.virtualization = { code: {
    copyText: (_node, { value }) => value,
    searchText: (_node, { value }) => value,
  } };
  const { name, tags, directives, literal, selection, display, scope } = extension;
  return registerWorkerExtension(extension, { id: 'limr/standard', options: { name, tags, directives, literal, selection, display, scope } });
}
