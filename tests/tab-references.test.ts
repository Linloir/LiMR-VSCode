import { expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
vi.mock('vscode', () => ({
  TabInputText: class { constructor(public uri: string) {} },
  TabInputCustom: class { constructor(public uri: string, public viewType: string) {} },
}));
import { TabReferences } from '../src/tab-references';

function group(column: number, files: string[], custom = false): vscode.TabGroup {
  const value = { viewColumn: column, isActive: true, tabs: [] as vscode.Tab[], get activeTab() { return this.tabs[0]; } };
  value.tabs = files.map(uri => ({ label: uri, group: value, isActive: true, isDirty: false, isPinned: true, isPreview: false,
    input: custom ? new vscode.TabInputCustom(uri as unknown as vscode.Uri, 'limr.reader') : new vscode.TabInputText(uri as unknown as vscode.Uri) }));
  return value;
}
function change(changed: vscode.TabGroup[], opened: vscode.TabGroup[] = [], closed: vscode.TabGroup[] = []) { return { changed, opened, closed }; }

it('retains source/reader identities when Cursor rebuilds the complete model', () => {
  const source = group(1, ['a.md']), reader = group(2, ['a.md'], true);
  const references = new TabReferences([source, reader]);
  const nextSource = group(1, ['a.md', 'b.md']), nextReader = group(2, ['a.md', 'b.md'], true);
  const bindings = references.update([nextSource, nextReader], change([nextSource, nextReader]));
  expect(bindings).toHaveLength(2);
  expect(references.group(source)).toBe(nextSource); expect(references.group(reader)).toBe(nextReader);
  expect(references.tab(reader.tabs[0])).toBe(nextReader.tabs[0]);
});
it('matches moved groups by editor contents before their column', () => {
  const a = group(1, ['a.md']), b = group(2, ['b.md'], true);
  const references = new TabReferences([a, b]);
  const nextB = group(1, ['b.md'], true), nextA = group(2, ['a.md']);
  references.update([nextB, nextA], change([nextB, nextA]));
  expect(references.group(a)).toBe(nextA); expect(references.group(b)).toBe(nextB);
});
it('prefers an exact group match when moved groups share a document', () => {
  const a = group(1, ['a.md', 'b.md']), b = group(2, ['b.md']);
  const references = new TabReferences([a, b]);
  const nextB = group(1, ['b.md']), nextA = group(2, ['a.md', 'b.md']);
  references.update([nextB, nextA], change([nextB, nextA]));
  expect(references.group(a)).toBe(nextA); expect(references.group(b)).toBe(nextB);
});
it('never transfers history to a new group replacing a closed group in the same column', () => {
  const a = group(1, ['a.md']), next = group(1, ['a.md']);
  const references = new TabReferences([a]);
  expect(references.update([next], change([], [next], [a]))).toEqual([]);
  expect(references.group(a)).toBe(a); expect(references.tab(a.tabs[0])).toBe(a.tabs[0]);
});
it('does not substitute a different file for a closed tab', () => {
  const a = group(1, ['a.md']), b = group(1, ['b.md']);
  const references = new TabReferences([a]);
  references.update([b], change([b]));
  expect(references.group(a)).toBe(b); expect(references.tab(a.tabs[0])).toBe(a.tabs[0]);
});
it('keeps references through multiple model rebuilds', () => {
  const first = group(1, ['a.md']); const references = new TabReferences([first]);
  let last = first;
  for (let index = 0; index < 30; index++) { last = group(1, ['a.md']); references.update([last], change([last])); }
  expect(references.group(first)).toBe(last); expect(references.tab(first.tabs[0])).toBe(last.tabs[0]);
});
it('leaves stable VS Code objects and explicit source tabs intact', () => {
  const a = group(1, ['a.md']); const references = new TabReferences([a]);
  expect(references.update([a], change([a]))).toEqual([]);
  expect(references.group(a)).toBe(a); expect(references.tab(a.tabs[0])).toBe(a.tabs[0]);
});
