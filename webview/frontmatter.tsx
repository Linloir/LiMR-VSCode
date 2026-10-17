import { registerWorkerExtension, useLiMR, useLocale, type MarkdownNode, type NodeRendererProps, type RendererExtension } from '@linloir/limr';

import type { MetadataValue } from '../src/shared/frontmatter';
import { frontmatterNodeType, readerFrontmatterSyntax, readerSyntaxIds } from '../src/shared/reader-syntax';
export { parseFrontmatter } from '../src/shared/frontmatter';

function Value({ value }: { value: MetadataValue }) {
  if (Array.isArray(value)) {
    if (!value.length) return <span className="lv-frontmatter-empty">[]</span>;
    const simple = value.every(item => item === null || typeof item !== 'object');
    return <ul className={simple ? 'lv-frontmatter-tags' : 'lv-frontmatter-list'}>{value.map((item, index) => <li key={index}><Value value={item} /></li>)}</ul>;
  }
  if (value && typeof value === 'object') return Object.keys(value).length ? <Fields values={value} /> : <span className="lv-frontmatter-empty">{'{}'}</span>;
  return <span className="lv-frontmatter-value">{value === null ? 'null' : value === '' ? '“”' : String(value)}</span>;
}
function Fields({ values }: { values: Record<string, MetadataValue> }) {
  return <dl className="lv-frontmatter-fields">{Object.entries(values).map(([key, value]) => <div className="lv-frontmatter-field" key={key}>
    <dt>{key}</dt><dd><Value value={value} /></dd>
  </div>)}</dl>;
}
function FrontmatterCard({ node, source, rawChanged }: NodeRendererProps & { rawChanged(open: boolean): boolean }) {
  const zh = useLocale().language?.startsWith('zh');
  const { invalidatePresentation } = useLiMR();
  const values = node.metadata as Record<string, MetadataValue> | undefined;
  const name = typeof values?.name === 'string' && values.name.trim() ? values.name : undefined;
  const description = typeof values?.description === 'string' && values.description.trim() ? values.description : undefined;
  const remaining = Object.fromEntries(Object.entries(values ?? {}).filter(([key]) => !(key === 'name' && name !== undefined || key === 'description' && description !== undefined)));
  const raw = <pre className="lv-frontmatter-source"><code>{source}</code></pre>;
  return <section className="limr-definition lv-frontmatter" aria-label={zh ? '文档信息' : 'Document information'}>
    <div className="lv-frontmatter-heading" data-limr-ignore="true"><span className="limr-card-label">{zh ? '文档信息' : 'Document information'}</span><span className="lv-frontmatter-format">YAML</span></div>
    {name && <div className="limr-definition-title lv-frontmatter-name">{name}</div>}
    {description && <p className="lv-frontmatter-description">{description}</p>}
    {Object.keys(remaining).length > 0 && <Fields values={remaining} />}
    {values ? <details className="limr-disclosure lv-frontmatter-raw" data-limr-card-interactive="true" onToggle={event => {
      if (rawChanged(event.currentTarget.open)) invalidatePresentation();
    }}>
      <summary data-limr-ignore="true"><span className="limr-underline">{zh ? '查看原始元信息' : 'View original metadata'}</span><svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="m4 6 4 4 4-4" /></svg></summary>
      {raw}
    </details> : <><p className="lv-frontmatter-fallback">{zh ? '此段元信息按原文显示。' : 'This metadata is shown as written.'}</p>{raw}</>}
  </section>;
}

function metadataText(value: MetadataValue): string {
  if (Array.isArray(value)) return value.length ? value.map(metadataText).join('\n') : '[]';
  if (value && typeof value === 'object') return Object.keys(value).length
    ? Object.entries(value).map(([key, child]) => `${key}\n${metadataText(child)}`).join('\n') : '{}';
  return value === null ? 'null' : value === '' ? '“”' : String(value);
}

/** Atomic copy preserves the authored YAML. Search projects visible metadata;
 * its disclosure stays alive so opening the source remains stable offscreen. */
export function readerFrontmatter(): RendererExtension {
  const expanded = new WeakSet<MarkdownNode>();
  const extension: RendererExtension = {
    ...readerFrontmatterSyntax(),
    components: { [frontmatterNodeType]: props => <FrontmatterCard {...props} rawChanged={open => {
      if (expanded.has(props.node) === open) return false;
      if (open) expanded.add(props.node); else expanded.delete(props.node);
      return true;
    }} /> },
    virtualization: { [frontmatterNodeType]: {
      keepAlive: true,
      copyText: (_node, { source }) => source,
      searchText: (node, { source }) => {
        const values = node.metadata as Record<string, MetadataValue> | undefined;
        if (!values) return source;
        const promoted = ['name', 'description'].filter(key => typeof values[key] === 'string' && (values[key] as string).trim());
        const summary = [...promoted.map(key => metadataText(values[key])), ...Object.entries(values)
          .filter(([key]) => !promoted.includes(key)).map(([key, value]) => `${key}\n${metadataText(value)}`)].join('\n');
        return expanded.has(node) ? `${summary}\n${source}` : summary;
      },
    } },
  };
  return registerWorkerExtension(extension, { id: readerSyntaxIds.frontmatter });
}
