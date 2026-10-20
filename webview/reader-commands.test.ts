import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { dispatchReaderCommand } from './reader-commands';

beforeEach(() => vi.stubGlobal('document', Object.assign(new EventTarget(), { documentElement: { lang: 'en' } })));
afterEach(() => vi.unstubAllGlobals());

it('routes native commands through the public controller without dispatching a second find event', () => {
  const find = vi.fn(), legacy = vi.fn();
  document.addEventListener('limr-vscode:find', legacy);
  for (const command of ['find', 'findNext', 'findPrevious'] as const)
    dispatchReaderCommand({ type: 'readerCommand', command }, true, vi.fn(), find);
  expect(find.mock.calls).toEqual([['open'], ['next'], ['previous']]);
  expect(legacy).not.toHaveBeenCalled();
});
it('retains the guarded legacy bridge while the published dependency remains pinned', () => {
  const legacy = vi.fn(); document.addEventListener('limr-vscode:find', legacy);
  dispatchReaderCommand({ type: 'readerCommand', command: 'findNext' }, true, vi.fn());
  expect(legacy).toHaveBeenCalledOnce();
  expect(legacy.mock.calls[0][0].detail.command).toBe('findNext');
});
it('does not search a provisional reader', () => {
  const find = vi.fn(), notify = vi.fn();
  dispatchReaderCommand({ type: 'readerCommand', command: 'find' }, false, notify, find);
  expect(find).not.toHaveBeenCalled(); expect(notify).toHaveBeenCalledOnce();
});
