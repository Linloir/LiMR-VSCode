import { registerWorkerExtension, type NodeRendererProps, type RendererExtension } from '@linloir/limr';
import { languageTypographySyntax, readerSyntaxIds } from '../src/shared/reader-syntax';
function ScriptText({ node, children }: NodeRendererProps) {
  return <span className={`lv-script-${node.lvScript}`}>{children}</span>;
}

/** Split before LiMR associates source markers with text-node identities.
 * Native text renderers retain annotation markers, selection bindings and paint. */
export function languageTypography(): RendererExtension {
  const extension: RendererExtension = {
    ...languageTypographySyntax(),
    rendererOverrides: [{ type: 'lv-script', component: ScriptText,
      virtualization: { copyText: (_node, { children }) => children, searchText: (_node, { children }) => children },
    }],
  };
  return registerWorkerExtension(extension, { id: readerSyntaxIds.typography });
}
