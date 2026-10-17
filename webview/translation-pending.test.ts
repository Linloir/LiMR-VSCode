import { describe, expect, it } from 'vitest';
import { createDocument, standard, type DocumentSnapshot, type MarkdownNode } from '@linloir/limr';
import type { ReaderFileSettings, ReaderSettings, ReaderTranslationMode } from '../src/shared/protocol';
import { PendingTranslationPreferences, type TranslationRequest } from './translation-pending';
import { translationBlockKeys } from './translation-settings';
const block = '<translations>\n<origin>Original paragraph.</origin>\n<translation>译文段落。</translation>\n</translations>';
const settings = (translationMode: ReaderTranslationMode, fileOverrides: ReaderFileSettings = {}): ReaderSettings => ({ translationMode, fileOverrides } as ReaderSettings);
const parse = (source: string, streaming = false) => createDocument(source, { id: 'file:///pending.md', extensions: standard(), streaming }).getSnapshot();
const nodes = (snapshot: DocumentSnapshot) => {
  const result: MarkdownNode[] = [];
  const visit = (node: MarkdownNode) => { if (node.name === 'translations') result.push(node); node.children?.forEach(visit); };
  snapshot.blocks.forEach(block => visit(block.node)); return result;
};
function setup() {
  const source = `${block}\n\n${block.replace('Original paragraph.', 'Another paragraph.')}`, prefix = parse(`${block}\n\n`, true), complete = parse(source);
  const request: TranslationRequest = { uri: complete.id, version: 3, source };
  const controller = new PendingTranslationPreferences(); controller.configure(request, settings('bilingual'), 7); controller.observe(prefix, false);
  return { source, prefix, complete, request, controller };
}
describe('host provisional translation intents', () => {
  it('changes the prefix immediately without persisting a partial key universe', () => {
    const { controller, prefix, complete } = setup();
    expect(controller.change(nodes(prefix)[0], 'origin', prefix)).toBeUndefined();
    expect(controller.global).toBeUndefined(); expect(controller.mode(nodes(prefix)[0], prefix)).toBe('origin');
    expect(controller.mode(nodes(complete)[1], complete)).toBe('both');
    const update = controller.observe(complete, true)!, keys = [...translationBlockKeys(complete).values()];
    expect(update.translationEpoch).toBe(7); expect(update.documentVersion).toBe(3);
    expect(update.settings.translationParagraphs).toEqual({ [keys[0]]: 'origin', [keys[1]]: 'both' });
    expect(controller.observe(complete, true)).toBeUndefined();
  });
  it('takes the latest click and keeps unrelated settings changed during loading', () => {
    const { controller, prefix, complete, request } = setup();
    controller.change(nodes(prefix)[0], 'origin', prefix); controller.change(nodes(prefix)[0], 'translation', prefix);
    controller.configure(request, settings('bilingual', { typography: 'justify' }), 7);
    const update = controller.observe(complete, true)!;
    expect(update.settings).toMatchObject({ typography: 'justify', translationMode: 'paragraph' });
    const key = [...translationBlockKeys(complete).values()][0];
    expect(update.settings.translationParagraphs?.[key]).toBe('translation');
    // The materialized settings above consumed the intent; a duplicate receipt never persists it again.
    expect(controller.hasPending).toBe(false); expect(key).toBeTruthy();
  });
  it('an explicit choice of the same persisted global mode supersedes pending clicks', () => {
    const { controller, prefix, complete } = setup(); controller.change(nodes(prefix)[0], 'origin', prefix);
    controller.cancel(8); expect(controller.global).toBe('both'); expect(controller.observe(complete, true)).toBeUndefined();
  });
  it('new source/request or a changed global preference cancels stale completion', () => {
    const { controller, prefix, complete, request } = setup(); controller.change(nodes(prefix)[0], 'origin', prefix);
    controller.configure({ ...request, version: 4 }, settings('bilingual'), 7);
    expect(controller.observe(complete, true)).toBeUndefined();
    controller.observe(prefix, false); controller.change(nodes(prefix)[0], 'origin', prefix);
    controller.configure({ ...request, version: 5 }, settings('translated'), 8);
    expect(controller.global).toBe('translation'); expect(controller.observe(complete, true)).toBeUndefined();
  });
  it('later definitions inside the same original/translation roles do not discard the display choice', () => {
    const first = block.replace('Original paragraph.', 'Original [reference][later].');
    const prefix = parse(`${first}\n\n`, true), complete = parse(`${first}\n\n[later]: https://example.test/\n\n${block}`);
    const controller = new PendingTranslationPreferences(); controller.configure({ uri: complete.id, version: 1, source: complete.source }, settings('bilingual'));
    controller.observe(prefix, false); controller.change(nodes(prefix)[0], 'origin', prefix);
    const update = controller.observe(complete, true)!;
    expect(update.settings.translationParagraphs?.[[...translationBlockKeys(complete).values()][0]]).toBe('origin');
  });
  it('refuses reinterpreted role boundaries', () => {
    const { controller, prefix, complete } = setup(); controller.change(nodes(prefix)[0], 'origin', prefix);
    const node = nodes(complete)[0], translation = node.children?.flatMap(child => child.type === 'paragraph' ? child.children ?? [] : [child]).find(child => child.name === 'translation');
    expect(translation?.position).toBeTruthy(); translation!.position = { ...translation!.position!, start: { ...translation!.position!.start, offset: translation!.position!.start.offset + 1 } };
    expect(controller.observe(complete, true)).toBeUndefined();
  });
});
