/** VS Code forwards webview key events from window's bubble listener even when
 * defaultPrevented. Keep print/find handlers from racing the native bindings;
 * commands then route find to the core search controller. */
export function preserveWorkbenchShortcuts(event: KeyboardEvent) {
  if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
  const key = event.key.toLowerCase();
  if (['p', 'f'].includes(key)) event.preventDefault();
  // Keep native input undo/redo, but do not forward it to the workbench's
  // document undo stack. This also supports the currently published core.
  if (['z', 'y'].includes(key) && (event.target as Element | null)?.closest?.('.limr-document-search input'))
    event.stopPropagation();
}
