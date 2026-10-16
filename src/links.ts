export interface ReaderLinkInput {
  documentUri: string;
  workspaceUri?: string;
  href: string;
}

export type ReaderLink =
  | { kind: 'external'; uri: string }
  | { kind: 'anchor'; id: string }
  | { kind: 'internal'; uri: string; line?: number; fragment?: string };

/** Resolve Markdown links without losing a Remote-WSL authority or file drive. */
export function resolveReaderLink({ documentUri, workspaceUri, href }: ReaderLinkInput): ReaderLink {
  const value = href.trim();
  if (!value || /[\u0000-\u001f\u007f]/.test(value)) throw new Error('无效的 Markdown 链接。');
  if (value.startsWith('#')) return { kind: 'anchor', id: decodeURIComponent(value.slice(1)) };

  const scheme = /^([a-z][a-z\d+.-]*):/i.exec(value)?.[1].toLowerCase();
  if (scheme) {
    if (!['https', 'http', 'mailto'].includes(scheme)) throw new Error('不支持此链接类型。');
    return { kind: 'external', uri: new URL(value).href };
  }

  // Windows separators are accepted for file links, but must not become a
  // protocol-relative external URL after normalization.
  const path = value.replace(/\\/g, '/');
  if (path.startsWith('//')) throw new Error('不支持此链接类型。');
  const base = new URL(documentUri);
  let target: URL;
  if (path.startsWith('/') && workspaceUri) {
    const workspace = new URL(workspaceUri);
    workspace.search = ''; workspace.hash = '';
    if (!workspace.pathname.endsWith('/')) workspace.pathname += '/';
    target = new URL(path.slice(1), workspace);
  } else target = new URL(path, base);

  // A relative link must retain its original provider; do not turn it into a
  // local file URI (which would route a remote document to the wrong machine).
  const expectedBase = path.startsWith('/') && workspaceUri ? new URL(workspaceUri) : base;
  if (target.protocol !== expectedBase.protocol || target.host !== expectedBase.host) throw new Error('不支持此链接类型。');
  decodeURIComponent(target.pathname); // Reject malformed percent escapes.
  const fragment = target.hash ? decodeURIComponent(target.hash.slice(1)) : undefined;
  const lineMatch = /^L([1-9]\d*)(?:C[1-9]\d*)?(?:-L?[1-9]\d*(?:C[1-9]\d*)?)?$/i.exec(fragment ?? '');
  const line = lineMatch ? Number(lineMatch[1]) : undefined;
  target.search = ''; target.hash = '';
  return { kind: 'internal', uri: target.href,
    ...(line !== undefined && Number.isSafeInteger(line) ? { line } : {}),
    ...(fragment !== undefined ? { fragment } : {}),
  };
}
