import type { SourceEdit } from './shared/protocol';

/** Validate all offsets against one immutable UTF-16 source, before any edit. */
export function validateTransaction(source: string, candidate: unknown, expected: unknown): SourceEdit[] {
  if (!Array.isArray(candidate) || !candidate.length || typeof expected !== 'string') throw new Error('无效的 Markdown 修改请求。');
  const edits = candidate.map(edit => {
    if (!edit || typeof edit.text !== 'string' || !edit.range || !Number.isSafeInteger(edit.range.start) || !Number.isSafeInteger(edit.range.end)
      || edit.range.start < 0 || edit.range.end < edit.range.start || edit.range.end > source.length) throw new Error('修改范围已失效，请重新选择文本。');
    return { range: { start: edit.range.start as number, end: edit.range.end as number }, text: edit.text as string };
  }).sort((a, b) => a.range.start - b.range.start || a.range.end - b.range.end);
  // LiMR's applySourceEdits preserves input order for equal-position inserts.
  // Its serializer uses that to close/open adjacent ranges and to append the
  // definition after closing a range at EOF. These edits are not overlaps.
  let end = 0;
  const parts: string[] = [];
  const normalized: SourceEdit[] = [];
  for (const edit of edits) {
    if (edit.range.start < end) throw new Error('修改范围发生重叠，未写入文档。');
    parts.push(source.slice(end, edit.range.start), edit.text);
    end = edit.range.end;
    const previous = normalized.at(-1);
    if (previous && previous.range.start === edit.range.start && previous.range.end === edit.range.start) {
      // One VS Code edit gives same-offset insertions a deterministic order,
      // including inserts immediately before a replacement at that position.
      previous.text += edit.text;
      previous.range.end = edit.range.end;
    } else normalized.push({ range: { ...edit.range }, text: edit.text });
  }
  parts.push(source.slice(end));
  if (parts.join('') !== expected) throw new Error('修改内容与事务不一致，未写入文档。');
  return normalized;
}
