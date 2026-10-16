import { describe, expect, it } from 'vitest';
import { createDocument, standard } from '@linloir/limr';
import { paragraphSettings, translationBlockKeys } from './translation-settings';

const block = '<translations>\n<origin>Original paragraph.</origin>\n<translation>译文段落。</translation>\n</translations>';
const parse = (source: string) => createDocument(source, { extensions: standard() }).getSnapshot();

describe('per-file translation preferences', () => {
  it('changes one paragraph without resetting the other blocks when leaving a document-wide mode', () => {
    expect(paragraphSettings('translated', {}, ['first', 'second'], 'first', 'both')).toEqual({
      translationMode: 'paragraph', translationParagraphs: { first: 'both', second: 'translation' },
    });
    expect(paragraphSettings('paragraph', { typography: 'justify', translationParagraphs: { first: 'both' } }, ['first', 'second'], 'second', 'origin')).toEqual({
      typography: 'justify', translationMode: 'paragraph', translationParagraphs: { first: 'both', second: 'origin' },
    });
  });
  it('keeps block preferences after unrelated source edits and distinguishes repeated blocks', () => {
    const before = [...translationBlockKeys(parse(`${block}\n\n${block}`)).values()];
    const after = [...translationBlockKeys(parse(`# Added heading\n\n${block}\n\n${block}`)).values()];
    expect(before).toHaveLength(2);
    expect(before[0]).not.toBe(before[1]);
    expect(after).toEqual(before);
  });
  it('retains an explicitly identified paragraph when its content changes', () => {
    const identified = block.replace('<translations>', '<translations id="introduction">');
    const before = [...translationBlockKeys(parse(identified)).values()];
    const after = [...translationBlockKeys(parse(identified.replace('Original paragraph.', 'Revised paragraph.'))).values()];
    expect(before).toHaveLength(1);
    expect(after).toEqual(before);
  });
});
