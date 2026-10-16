import type { HostMessage, WebviewMessage } from '../src/shared/protocol';

interface VSCodeApi { postMessage(message: WebviewMessage): void; getState(): unknown; setState(state: unknown): void }
declare global { interface Window { acquireVsCodeApi?: () => VSCodeApi } }
const api = window.acquireVsCodeApi?.();

export const post = (message: WebviewMessage) => api?.postMessage(message);
export function listen(listener: (message: HostMessage) => void) {
  const receive = (event: MessageEvent<HostMessage>) => {
    if (event.data && typeof event.data.type === 'string') listener(event.data);
  };
  window.addEventListener('message', receive);
  return () => window.removeEventListener('message', receive);
}

/** Keep both representations: Codex consumes file-mention HTML; other tools get precise text. */
export async function copyClipboard(text: string, html?: string): Promise<'rich' | 'text' | 'host'> {
  try {
    if (html && typeof ClipboardItem !== 'undefined') {
      await navigator.clipboard.write([new ClipboardItem({
        'text/plain': new Blob([text], { type: 'text/plain' }),
        'text/html': new Blob([html], { type: 'text/html' }),
      })]);
      return 'rich';
    }
  } catch { /* A webview may deny rich clipboard access; the native text bridge still works. */ }
  // VS Code webviews can deny ClipboardItem while still allowing the user-
  // initiated copy event. This preserves Codex's file-mention HTML without
  // depending on the asynchronous clipboard permission in an embedded frame.
  if (html) {
    let supplied = false;
    const copy = (event: ClipboardEvent) => {
      if (!event.clipboardData) return;
      event.clipboardData.setData('text/plain', text);
      event.clipboardData.setData('text/html', html);
      event.preventDefault(); supplied = true;
    };
    document.addEventListener('copy', copy, true);
    try { if (document.execCommand('copy') && supplied) return 'rich'; }
    catch { /* Fall through to the native plain-text bridge. */ }
    finally { document.removeEventListener('copy', copy, true); }
  }
  try { await navigator.clipboard.writeText(text); return 'text'; }
  catch { post({ type: 'copyFallback', text }); return 'host'; }
}
