import { createContext, useContext, useSyncExternalStore } from 'react';

export interface Draft { base: string; value: string; error?: string; saving?: boolean }
export class DraftStore {
  private values = new Map<string, Draft>();
  private listeners = new Set<() => void>();
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => this.listeners.delete(listener); };
  get(id: string, body: string) {
    let value = this.values.get(id);
    if (!value) { value = { base: body, value: body }; this.values.set(id, value); }
    return value;
  }
  set(id: string, draft: Draft) { this.values.set(id, draft); this.listeners.forEach(listener => listener()); }
}
export interface EditorSession {
  busy: boolean;
  editingEnabled: boolean;
  drafts: DraftStore;
  waitForCommit(): Promise<void>;
  notify(message: string, error?: boolean): void;
}
export const EditorContext = createContext<EditorSession | null>(null);
export function useEditorSession() {
  const session = useContext(EditorContext);
  if (!session) throw new Error('Missing reader editing session.');
  return session;
}
export function useDraft(id: string, body: string) {
  const { drafts } = useEditorSession();
  return useSyncExternalStore(drafts.subscribe, () => drafts.get(id, body));
}
