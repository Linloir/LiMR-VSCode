const issued = new WeakMap<object, { source: string; ids: Set<string> }>();

/** Six lowercase hexadecimal characters from 24 random bits. Document
 * checks also reserve orphan/literal IDs so a new definition cannot bind them.
 * This only allocates IDs; existing source IDs are never normalized. */
export function shortAnnotationId(document: { readonly source: string }): string {
  let state = issued.get(document);
  if (!state || state.source !== document.source) {
    state = { source: document.source, ids: new Set() };
    issued.set(document, state);
  }
  for (let attempt = 0; attempt < 128; attempt++) {
    const bytes = crypto.getRandomValues(new Uint8Array(3));
    const id = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
    if (state.ids.has(id) || document.source.includes(id)) continue;
    state.ids.add(id);
    return id;
  }
  throw new Error('Unable to allocate a unique LiMR annotation ID. Please retry.');
}
