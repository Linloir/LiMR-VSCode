import type { HostMessage } from '../src/shared/protocol';

/** Native keybindings remain customizable in VS Code. Find uses the public
 * core controller; selection actions retain the guarded toolbar bridge. */
export function dispatchReaderCommand(
  message: Extract<HostMessage, { type: 'readerCommand' }>,
  ready: boolean,
  notify: (message: string, error?: boolean) => void,
  find?: (command?: 'open' | 'next' | 'previous' | 'close') => void,
) {
  const chinese = document.documentElement.lang.startsWith('zh');
  if (!ready || (message.command !== 'selectionAction' && !find)) {
    notify(chinese ? '文档正在更新，请稍后重试。' : 'The document is updating. Please retry when it is ready.');
    return;
  }
  if (message.command !== 'selectionAction') {
    find?.(message.command === 'find' ? 'open' : message.command === 'findNext' ? 'next' : 'previous');
    return;
  }
  // A source action must never consume text from a note editor or find input.
  const active = document.activeElement;
  if (active instanceof Element && active.closest('input,textarea,select,[contenteditable]:not([contenteditable="false"])')) return;
  const detail = { actionId: message.actionId, handled: false };
  document.dispatchEvent(new CustomEvent('limr-vscode:selection-action', { detail }));
  if (!detail.handled) notify(chinese
    ? '此选段操作暂不可用。请先选择正文，并确认已开启编辑、模块已加载。'
    : 'This selection action is unavailable. Select text and check editing permissions and loaded plugins.');
}
