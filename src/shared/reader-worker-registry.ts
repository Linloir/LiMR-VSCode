import { standardWorkerRegistry, type DocumentWorkerHandlerOptions, type WorkerExtensionRegistry } from '@linloir/limr/worker-api';
import { languageTypographySyntax, readerFrontmatterSyntax, readingAnnotationsSyntax, readerSyntaxIds } from './reader-syntax';

/** No React components, filesystem access, or Webview permissions enter here. */
export const readerWorkerRegistry: WorkerExtensionRegistry = {
  ...standardWorkerRegistry,
  [readerSyntaxIds.frontmatter]: () => readerFrontmatterSyntax(),
  [readerSyntaxIds.typography]: () => languageTypographySyntax(),
  [readerSyntaxIds.annotations]: () => readingAnnotationsSyntax(),
};

/** Only after core proves the entire source is independent prose: YAML fences
 * and annotation syntax are excluded, making those two transforms no-ops;
 * typography maps each text leaf independently and shares no cross-block data.
 * Unknown add-ons never inherit this capability from the host. */
export const readerWorkerOptions: DocumentWorkerHandlerOptions = {
  independentProseExtensions: Object.freeze(Object.values(readerSyntaxIds)),
  // Separate permission for fresh, isolated parses of incomplete Markdown.
  // Final semantics may differ; this does not permit arbitrary graph packets.
  provisionalPreviewExtensions: Object.freeze([
    'limr/standard', readerSyntaxIds.frontmatter, readerSyntaxIds.typography, readerSyntaxIds.annotations,
  ]),
};
