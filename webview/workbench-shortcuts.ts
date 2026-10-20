/** VS Code forwards webview key events from window's bubble listener even when
 * defaultPrevented. Keep print/find handlers from racing the native bindings;
 * commands then route find to the core search controller. */
export function preserveWorkbenchShortcuts(event: KeyboardEvent) {
  if ((event.ctrlKey || event.metaKey) && !event.altKey && ['p', 'f'].includes(event.key.toLowerCase())) event.preventDefault();
}
