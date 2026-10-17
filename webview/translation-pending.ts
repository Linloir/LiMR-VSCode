import type { DocumentSnapshot, MarkdownNode } from '@linloir/limr';
import type { ParagraphTranslationMode, ReaderFileSettings, ReaderSettings } from '../src/shared/protocol';
import { paragraphSettings, translationBlockKeys, translationOverride } from './translation-settings';

export interface TranslationRequest { uri: string; version: number; source: string }
interface Owner { start: number; end: number; source: string; signature: string; proofWork: number; lookupWork: number }
interface Intent { owner: Owner; mode: ParagraphTranslationMode }
export interface TranslationPreferenceUpdate { settings: ReaderFileSettings; translationEpoch: number; documentVersion: number }
interface Pending {
  epoch: number;
  baseline: ReaderSettings;
  intents: Map<number, Intent>;
  provisional: WeakMap<MarkdownNode, ParagraphTranslationMode>;
}
/** A host preference selects one of two named source regions. Later reference
 * definitions inside a region may resolve without changing that choice's owner.
 * Role/range changes, an incomplete pair, or duplicate roles cannot migrate. */
function owner(node: MarkdownNode, document: DocumentSnapshot, workLimit = Infinity): Owner | undefined {
  if (node.type !== 'component' || node.name !== 'translations' || node.incomplete || !node.position) return;
  const { start, end } = node.position;
  if (!Number.isSafeInteger(start.offset) || !Number.isSafeInteger(end.offset) || start.offset < 0 || end.offset <= start.offset || end.offset > document.source.length) return;
  const sections = new Map<string, MarkdownNode[]>(), visited = new Set<MarkdownNode>();
  let work = 0, invalid = false;
  const visit = (parent: MarkdownNode) => {
    if (++work > workLimit || visited.has(parent)) { invalid = true; return; } visited.add(parent);
    if (work + (parent.children?.length ?? 0) > workLimit) { invalid = true; return; }
    for (const child of parent.children ?? []) {
      if (++work > workLimit) { invalid = true; return; }
      if (child.name === 'origin' || child.name === 'translation') {
        sections.set(child.name, [...sections.get(child.name) ?? [], child]);
      } else if (child.type === 'paragraph') visit(child);
      if (invalid) return;
    }
  };
  visit(node); if (invalid) return;
  const roles: unknown[] = [];
  for (const name of ['origin', 'translation']) {
    const items = sections.get(name); if (items?.length !== 1) return;
    const section = items[0], position = section.position;
    if (section.type !== 'component' || section.incomplete || !position || !Number.isSafeInteger(position.start.offset) || !Number.isSafeInteger(position.end.offset) || position.start.offset < start.offset || position.end.offset > end.offset || position.start.offset >= position.end.offset) return;
    roles.push([name, position.start.offset, position.end.offset]);
  }
  return { start: start.offset, end: end.offset, source: document.source.slice(start.offset, end.offset), signature: JSON.stringify(roles), proofWork: work, lookupWork: 0 };
}
function sameOwner(first: Owner, node: MarkdownNode, document: DocumentSnapshot): boolean {
  if (node.position?.start.offset !== first.start || node.position.end.offset !== first.end || document.source.slice(first.start, first.end) !== first.source) return false;
  const second = owner(node, document, first.proofWork);
  return !!second && first.signature === second.signature;
}

/** Locate this source region in its indexed top-level block. Count every exact
 * translation owner before inspecting roles: a second transformed node is
 * ambiguous even when only one node has the expected role signature. */
const checkedBlockOrder = new WeakMap<DocumentSnapshot, boolean>();
/** Binary source lookup is permitted only after this metadata-only proof.
 * Touching zero-length blocks are allowed: they cannot own a positive range.
 * Do not sort or inspect children of an extension-produced ambiguous snapshot. */
function orderedSourceBlocks(snapshot: DocumentSnapshot): boolean {
  const known = checkedBlockOrder.get(snapshot); if (known !== undefined) return known;
  let end = 0, valid = true;
  for (const block of snapshot.blocks) {
    const range = block.range;
    if (!Number.isSafeInteger(range.start) || !Number.isSafeInteger(range.end) || range.start < end || range.end < range.start || range.end > snapshot.source.length) { valid = false; break; }
    end = range.end;
  }
  checkedBlockOrder.set(snapshot, valid); return valid;
}

function sourceOwner(document: DocumentSnapshot, expected: Pick<Owner, 'start' | 'end'>, workLimit = Infinity): { node: MarkdownNode; work: number } | undefined {
  if (!orderedSourceBlocks(document)) return;
  let low = 0, high = document.blocks.length;
  while (low < high) { const middle = (low + high) >>> 1; if (document.blocks[middle].range.end < expected.end) low = middle + 1; else high = middle; }
  const block = document.blocks[low]; if (!block || block.range.start > expected.start) return;
  let work = 0, matches = 0, found: MarkdownNode | undefined, invalid = false;
  const visited = new Set<MarkdownNode>();
  const visit = (node: MarkdownNode) => {
    if (++work > workLimit) { invalid = true; return; }
    const position = node.position;
    if (position && (position.start.offset > expected.start || position.end.offset < expected.end)) return;
    if (visited.has(node)) { invalid = true; return; } visited.add(node);
    if (node.type === 'component' && node.name === 'translations' && position?.start.offset === expected.start && position.end.offset === expected.end) { matches++; found = node; }
    if (work + (node.children?.length ?? 0) > workLimit) { invalid = true; return; }
    for (const child of node.children ?? []) { visit(child); if (invalid) return; }
  };
  visit(block.node); return !invalid && matches === 1 && found ? { node: found, work } : undefined;
}

function samePreferences(first: ReaderSettings, second: ReaderSettings): boolean {
  if (first.translationMode !== second.translationMode) return false;
  const left = first.fileOverrides.translationParagraphs, right = second.fileOverrides.translationParagraphs;
  if (left === right) return true;
  const keys = Object.keys(left ?? {});
  return keys.length === Object.keys(right ?? {}).length && keys.every(key => left?.[key] === right?.[key]);
}

/** Host-only intent while the full key universe is unavailable. No settings
 * persistence is performed against a provisional/truncated document. */
export class PendingTranslationPreferences {
  private request?: TranslationRequest;
  private settings?: ReaderSettings;
  private bound?: { snapshot: DocumentSnapshot; complete: boolean };
  private pending?: Pending;
  private epoch = 0;
  configure(request: TranslationRequest | undefined, settings: ReaderSettings | undefined, epoch = 0): void {
    if (this.request !== request) {
      if (this.request?.uri !== request?.uri) this.epoch = epoch;
      this.request = request; this.pending = undefined; this.bound = undefined;
    }
    if (epoch > this.epoch) this.cancel(epoch);
    if (this.pending && (!settings || !samePreferences(this.pending.baseline, settings))) this.pending = undefined;
    this.settings = settings;
  }
  /** An explicit native UI choice also cancels when its selected value happens
   * to equal the persisted global mode. Configuration echoes do not do this. */
  cancel(epoch: number): void { if (Number.isSafeInteger(epoch) && epoch >= this.epoch) { this.epoch = epoch; this.pending = undefined; } }
  get hasPending(): boolean { return !!this.pending; }
  get global(): ParagraphTranslationMode | undefined {
    return this.pending ? undefined : this.settings && translationOverride(this.settings.translationMode);
  }
  mode(node: MarkdownNode, document: DocumentSnapshot): ParagraphTranslationMode | undefined {
    const settings = this.settings; if (!settings || document.id !== this.request?.uri) return;
    const pending = this.pending;
    if (pending) {
      const temporary = pending.provisional.get(node); if (temporary !== undefined) return temporary;
      const intent = pending.intents.get(node.position?.start.offset ?? -1);
      if (intent && sourceOwner(document, intent.owner, intent.owner.lookupWork)?.node === node && sameOwner(intent.owner, node, document)) return intent.mode;
      const global = translationOverride(pending.baseline.translationMode); if (global) return global;
    }
    if (settings.translationMode !== 'paragraph') return;
    const key = translationBlockKeys(document).get(node.position?.start.offset ?? -1);
    return key ? settings.fileOverrides.translationParagraphs?.[key] : undefined;
  }
  change(node: MarkdownNode, mode: ParagraphTranslationMode, document: DocumentSnapshot): TranslationPreferenceUpdate | undefined {
    const settings = this.settings, request = this.request;
    if (!settings || !request || document.id !== request.uri || this.bound?.snapshot !== document) return;
    if (this.bound.complete) {
      const keys = translationBlockKeys(document), key = keys.get(node.position?.start.offset ?? -1);
      return key ? { settings: paragraphSettings(settings.translationMode, settings.fileOverrides, keys.values(), key, mode), translationEpoch: this.epoch, documentVersion: request.version } : undefined;
    }
    const pending = this.pending ??= { epoch: this.epoch, baseline: settings, intents: new Map(), provisional: new WeakMap() };
    pending.provisional.set(node, mode);
    const identity = owner(node, document);
    const found = identity && sourceOwner(document, identity);
    if (identity && found?.node === node) { identity.lookupWork = found.work; pending.intents.set(identity.start, { owner: identity, mode }); }
    return;
  }
  observe(document: DocumentSnapshot, complete: boolean): TranslationPreferenceUpdate | undefined {
    const request = this.request;
    // configure() clears this binding on every request identity change. An
    // already validated immutable receipt needs neither another full-source
    // equality check nor another owner scan.
    if (this.bound?.snapshot === document && this.bound.complete === complete) return;
    if (!request || document.id !== request.uri || complete && document.source !== request.source) return;
    this.bound = { snapshot: document, complete };
    const pending = this.pending, settings = this.settings;
    if (!complete || !pending || !settings) return;
    this.pending = undefined;
    // Validate uniqueness before meaning, using only the old prefix's source
    // range and measured lookup/proof budgets. Never walk unrelated final blocks.
    const matches = new Map<number, MarkdownNode>();
    for (const [start, intent] of pending.intents) {
      const found = sourceOwner(document, intent.owner, intent.owner.lookupWork);
      if (found && sameOwner(intent.owner, found.node, document)) matches.set(start, found.node);
    }
    if (!matches.size) return;
    // Leaving a global preference still needs the complete key universe so
    // never-clicked full-document paragraphs keep their original global mode.
    const keys = translationBlockKeys(document);
    let result: ReaderFileSettings | undefined;
    for (const [start, intent] of pending.intents) {
      if (!matches.get(start)) continue;
      const key = keys.get(start); if (!key) continue;
      result = paragraphSettings(result ? 'paragraph' : pending.baseline.translationMode, result ?? settings.fileOverrides, keys.values(), key, intent.mode);
    }
    return result ? { settings: result, translationEpoch: pending.epoch, documentVersion: request.version } : undefined;
  }
}
