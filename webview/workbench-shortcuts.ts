/** VS Code forwards webview key events from window's bubble listener even when
 * defaultPrevented. Cancel the embedded reader's browser-print shortcut early,
 * while allowing the original event to reach VS Code's configured keybinding. */
export function preserveWorkbenchShortcuts(event: KeyboardEvent) {
  if ((event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === 'p') event.preventDefault();
}
