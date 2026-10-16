import { CORE_SCHEMA, load } from 'js-yaml';

export type MetadataValue = string | number | boolean | null | MetadataValue[] | { [key: string]: MetadataValue };
export interface Frontmatter { end: number; raw: string; values?: Record<string, MetadataValue> }

// YAML aliases may share or cycle through objects. Keep rendering bounded even
// for a small document containing an exponentially expanding alias graph.
function metadataValue(value: unknown, ancestors: Set<object>, budget: { remaining: number }, depth = 0): MetadataValue {
  if (--budget.remaining < 0 || depth > 12) throw new Error('Metadata is too large to summarize.');
  if (value === null || ['string', 'boolean', 'number'].includes(typeof value)) return value as MetadataValue;
  if (!value || typeof value !== 'object' || ancestors.has(value)) throw new Error('Unsupported metadata value.');
  ancestors.add(value);
  try {
    return Array.isArray(value)
      ? value.map(item => metadataValue(item, ancestors, budget, depth + 1))
      : Object.fromEntries(Object.entries(value).map(([key, item]) => [key, metadataValue(item, ancestors, budget, depth + 1)]));
  } finally { ancestors.delete(value); }
}

export function parseFrontmatter(source: string): Frontmatter | undefined {
  const opening = /^(?:\uFEFF)?---[ \t]*(?:\r\n|\r|\n)/.exec(source);
  if (!opening) return;
  const closing = /^---[ \t]*(?=\r\n|\r|\n|$)/m.exec(source.slice(opening[0].length));
  if (!closing) return;
  const bodyStart = opening[0].length, bodyEnd = bodyStart + closing.index;
  const end = bodyEnd + closing[0].length, raw = source.slice(0, end), body = source.slice(bodyStart, bodyEnd);
  try {
    if (body.length > 131072) throw new Error('Metadata is too large to summarize.');
    const options = { schema: CORE_SCHEMA, maxDepth: 24, maxTotalMergeKeys: 0 };
    const value: unknown = load(body, options);
    // Horizontal rules surrounding prose, lists or a setext heading are not
    // metadata. A frontmatter document must contain named fields.
    if (!value || typeof value !== 'object' || Array.isArray(value) || !Object.keys(value).length) return;
    return { end, raw, values: metadataValue(value, new Set(), { remaining: 600 }) as Record<string, MetadataValue> };
  } catch {
    // Preserve malformed YAML verbatim, but do not claim ordinary prose between
    // two horizontal rules just because it is not valid YAML.
    if (/^[ \t]*(?:[^\s:#][^\r\n:]*|["'][^"'\r\n]+["'])[ \t]*:(?:[ \t]|$)/m.test(body)) return { end, raw };
  }
}
