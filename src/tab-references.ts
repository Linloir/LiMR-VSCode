import * as vscode from 'vscode';

const tabKey = (tab: vscode.Tab) => tab.input instanceof vscode.TabInputText ? `text:${tab.input.uri}`
  : tab.input instanceof vscode.TabInputCustom ? `${tab.input.viewType}:${tab.input.uri}` : `other:${tab.label}`;
const overlap = (a: vscode.TabGroup, b: vscode.TabGroup) => {
  const keys = new Set(a.tabs.map(tabKey));
  return b.tabs.reduce((count, tab) => count + Number(keys.has(tabKey(tab))), 0);
};

/** Cursor can rebuild the public TabGroup/Tab wrappers on a full model update.
 * Match surviving groups by their contents (then column), and retain aliases
 * for references captured before an awaited editor command. */
export class TabReferences {
  private groups: readonly vscode.TabGroup[];
  private readonly groupAliases = new WeakMap<vscode.TabGroup, vscode.TabGroup>();
  private readonly tabAliases = new WeakMap<vscode.Tab, vscode.Tab>();
  constructor(groups: readonly vscode.TabGroup[]) { this.groups = [...groups]; }
  private resolve<T extends object>(aliases: WeakMap<T, T>, value: T): T {
    const path: T[] = [];
    let next: T | undefined;
    while ((next = aliases.get(value))) { path.push(value); value = next; }
    for (const previous of path) aliases.set(previous, value);
    return value;
  }
  group(group: vscode.TabGroup) { return this.resolve(this.groupAliases, group); }
  tab(tab: vscode.Tab) { return this.resolve(this.tabAliases, tab); }
  update(next: readonly vscode.TabGroup[], event: vscode.TabGroupChangeEvent) {
    const previous = this.groups.filter(group => !event.closed.includes(group) && !next.includes(group));
    const replacements: { before: vscode.TabGroup; after: vscode.TabGroup; tabs: [vscode.Tab, vscode.Tab][] }[] = [];
    for (const after of next) {
      if (this.groups.includes(after) || event.opened.includes(after)) continue;
      const candidates = previous.map(before => {
        const shared = overlap(before, after);
        return { before, shared, exact: shared === before.tabs.length && shared === after.tabs.length };
      }).sort((a, b) => Number(b.exact) - Number(a.exact) || b.shared - a.shared
        || Number(b.before.viewColumn === after.viewColumn) - Number(a.before.viewColumn === after.viewColumn));
      const best = candidates[0];
      if (!best || (!best.shared && best.before.viewColumn !== after.viewColumn)) continue;
      const before = best.before;
      previous.splice(previous.indexOf(before), 1);
      this.groupAliases.set(before, after);
      const tabs: [vscode.Tab, vscode.Tab][] = [];
      for (const old of before.tabs) {
        const current = after.tabs.find(tab => tabKey(tab) === tabKey(old));
        if (current && current !== old) { this.tabAliases.set(old, current); tabs.push([old, current]); }
      }
      replacements.push({ before, after, tabs });
    }
    this.groups = [...next];
    return replacements;
  }
}
