import { describe, expect, it, vi } from 'vitest';
import { preserveWorkbenchShortcuts } from './workbench-shortcuts';

const keyEvent = (values: Partial<KeyboardEvent>) => ({ key: 'p', ctrlKey: false, metaKey: false, shiftKey: false, altKey: false,
  preventDefault: vi.fn(), stopPropagation: vi.fn(), stopImmediatePropagation: vi.fn(), ...values });

describe('workbench shortcuts in the embedded reader', () => {
  it.each([
    { ctrlKey: true }, { ctrlKey: true, shiftKey: true, key: 'P' },
    { metaKey: true }, { metaKey: true, shiftKey: true, key: 'P' },
    { ctrlKey: true, key: 'f' }, { metaKey: true, key: 'f' },
  ])('routes quick open, command palette and find through native bindings: %j', modifiers => {
    const event = keyEvent(modifiers);
    preserveWorkbenchShortcuts(event as unknown as KeyboardEvent);
    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(event.stopPropagation).not.toHaveBeenCalled();
    expect(event.stopImmediatePropagation).not.toHaveBeenCalled();
  });

  it.each([
    {}, { ctrlKey: true, altKey: true }, { ctrlKey: true, altKey: true, key: 'f' }, { key: 'PageDown' },
  ])('leaves other reader keys available: %j', modifiers => {
    const event = keyEvent(modifiers);
    preserveWorkbenchShortcuts(event as unknown as KeyboardEvent);
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(event.stopPropagation).not.toHaveBeenCalled();
    expect(event.stopImmediatePropagation).not.toHaveBeenCalled();
  });
});
