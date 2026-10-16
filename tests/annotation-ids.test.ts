import { afterEach, describe, expect, it, vi } from 'vitest';
import { shortAnnotationId } from '../src/shared/annotation-ids';

describe('short source annotation IDs', () => {
  afterEach(() => vi.restoreAllMocks());
  it('uses six lowercase hexadecimal characters from 24 random bits', () => {
    const document = { source: '' }, ids = new Set<string>();
    for (let count = 0; count < 2000; count++) {
      const id = shortAnnotationId(document);
      expect(id).toMatch(/^[0-9a-f]{6}$/); ids.add(id);
    }
    expect(ids.size).toBe(2000);
  });
  it('retries collisions with source IDs, literal markers and IDs allocated in this transaction', () => {
    const document = { source: 'Literal ::%%limr%%{<#000000} text; id="010101"' };
    const next = [0, 1, 2, 2, 3];
    vi.spyOn(crypto, 'getRandomValues').mockImplementation((bytes: any) => bytes.fill(next.shift()!));
    expect(shortAnnotationId(document)).toBe('020202');
    expect(shortAnnotationId(document)).toBe('030303');
  });
  it('fails without looping forever if a broken random source cannot provide an unused ID', () => {
    vi.spyOn(crypto, 'getRandomValues').mockImplementation((bytes: any) => bytes.fill(0));
    expect(() => shortAnnotationId({ source: '000000' })).toThrow('unique LiMR annotation ID');
  });
});
