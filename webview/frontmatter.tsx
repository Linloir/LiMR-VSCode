import { useLocale, type MarkdownNode, type NodeRendererProps, type ParseContext, type RendererExtension } from '@linloir/limr';

import { parseFrontmatter, type MetadataValue, type Frontmatter } from '../src/shared/frontmatter';
export { parseFrontmatter } from '../src/shared/frontmatter';
const type = 'vscode-frontmatter';

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
function FrontmatterCard({ node, source }: NodeRendererProps) {
  const zh = useLocale().language?.startsWith('zh');
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
    {values ? <details className="limr-disclosure lv-frontmatter-raw" data-limr-card-interactive="true">
      <summary data-limr-ignore="true"><span className="limr-underline">{zh ? '查看原始元信息' : 'View original metadata'}</span><svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="m4 6 4 4 4-4" /></svg></summary>
      {raw}
    </details> : <><p className="lv-frontmatter-fallback">{zh ? '此段元信息按原文显示。' : 'This metadata is shown as written.'}</p>{raw}</>}
  </section>;
}

/** Remove only a recognized header from Markdown parsing, then restore it as a
 * source-mapped block. The document and all following UTF-16 ranges stay intact.
 */
export function readerFrontmatter(): RendererExtension {
  const prepared = new WeakMap<ParseContext, Frontmatter>();
  return { name: type, scope: 'local', components: { [type]: FrontmatterCard },
    preprocess(context) {
      const metadata = parseFrontmatter(context.source);
      if (!metadata) return [];
      prepared.set(context, metadata);
      return [{ start: 0, end: metadata.end }];
    },
    transform(root, context) {
      const metadata = prepared.get(context);
      if (!metadata || (root.position?.start.offset ?? 0) !== 0) return;
      const lines = metadata.raw.split(/\r\n|\r|\n/);
      const node: MarkdownNode = { type, value: metadata.raw, metadata: metadata.values, selection: 'atomic',
        position: { start: { offset: 0, line: 1, column: 1 }, end: { offset: metadata.end, line: lines.length, column: lines.at(-1)!.length + 1 } },
      };
      root.children = [node, ...root.children ?? []];
    },
  };
}
