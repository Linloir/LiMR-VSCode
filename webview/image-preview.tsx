import { createContext, useCallback, useContext, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { safeUrl, useDocumentSelector, useLocale, type NodeRendererProps, type RendererExtension } from '@linloir/limr';
import './image-preview.css';

interface Preview { image: HTMLImageElement; src: string; alt: string; width: number; height: number }
const PreviewContext = createContext<((image: HTMLImageElement) => void) | null>(null);

function PreviewDialog({ preview, zh, close }: { preview: Preview; zh: boolean; close(): void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const [original, setOriginal] = useState(false);
  useLayoutEffect(() => {
    const element = dialog.current!;
    element.showModal();
    closeButton.current?.focus({ preventScroll: true });
    // Do not retain an old image when the source editor changes its URL or
    // removes it. The preview always uses the host-resolved resource URL.
    const observer = new MutationObserver(() => {
      if (!preview.image.isConnected || preview.image.src !== preview.src) close();
    });
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['src'] });
    return () => { observer.disconnect(); element.close(); if (preview.image.isConnected) preview.image.focus({ preventScroll: true }); };
  }, [preview, close]);
  const fitLabel = zh ? '适应窗口' : 'Fit to window';
  const originalLabel = zh ? '原始大小' : 'Actual size';
  return createPortal(<dialog ref={dialog} className="lv-image-preview" aria-label={zh ? '图片预览' : 'Image preview'}
    onCancel={event => { event.preventDefault(); close(); }}
    onClose={close}
    onKeyDown={event => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); }
      if (event.key === 'Tab') {
        // A native dialog alone can tab out of the webview into VS Code's host.
        event.preventDefault(); event.stopPropagation();
        const controls = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
        const current = controls.indexOf(document.activeElement as HTMLButtonElement);
        controls[(current + (event.shiftKey ? -1 : 1) + controls.length) % controls.length]?.focus();
      }
    }}
    onClick={event => { event.stopPropagation(); if (event.target === event.currentTarget) close(); }}>
    <header className="lv-image-preview-header">
      <span className="lv-image-preview-caption" title={preview.alt}>{preview.alt || (zh ? '图片预览' : 'Image preview')}</span>
      <span className="lv-image-preview-dimensions">{preview.width} × {preview.height}</span>
      <button type="button" aria-pressed={original} onClick={() => setOriginal(value => !value)}>{original ? fitLabel : originalLabel}</button>
      <button ref={closeButton} type="button" className="lv-image-preview-close" aria-label={zh ? '关闭图片预览' : 'Close image preview'} onClick={close}>
        <svg viewBox="0 0 16 16" aria-hidden="true"><path d="m4 4 8 8M12 4l-8 8" /></svg>
      </button>
    </header>
    <div className="lv-image-preview-stage" data-original={original || undefined} onClick={event => { if (event.target === event.currentTarget) close(); }}>
      <img src={preview.src} alt={preview.alt} width={original ? preview.width : undefined} height={original ? preview.height : undefined}
        title={original ? fitLabel : originalLabel} onClick={() => setOriginal(value => !value)} />
    </div>
  </dialog>, document.body);
}

/** One modal per VS Code reader; the native dialog makes background content inert. */
export function ImagePreviewProvider({ children, locale }: { children: ReactNode; locale: string }) {
  const [preview, setPreview] = useState<Preview | null>(null);
  // Stable functions keep an open modal and its focus intact during host updates.
  const open = useCallback((image: HTMLImageElement) => {
    if (!image.complete || !image.naturalWidth || !image.getAttribute('src')) return;
    setPreview({ image, src: image.currentSrc || image.src, alt: image.alt, width: image.naturalWidth, height: image.naturalHeight });
  }, []);
  const close = useCallback(() => setPreview(null), []);
  return <PreviewContext.Provider value={open}>{children}{preview && <PreviewDialog preview={preview} zh={locale === 'zh-CN'} close={close} />}</PreviewContext.Provider>;
}

function PreviewImage({ src, alt, title }: { src: unknown; alt: unknown; title?: unknown }) {
  const open = useContext(PreviewContext), zh = useLocale().language?.startsWith('zh');
  const [ready, setReady] = useState(false);
  const url = safeUrl(src, true), description = String(alt ?? '');
  useLayoutEffect(() => { setReady(false); }, [url]);
  const interactive = !!open && ready;
  return <img src={url} alt={description} title={title ? String(title) : undefined} loading="lazy" decoding="async"
    className={interactive ? 'lv-previewable-image' : undefined} role={interactive ? 'button' : undefined} tabIndex={interactive ? 0 : undefined}
    aria-label={interactive ? `${zh ? '预览图片' : 'Preview image'}${description ? `: ${description}` : ''}` : undefined}
    aria-haspopup={interactive ? 'dialog' : undefined}
    onLoad={() => setReady(true)} onError={() => setReady(false)}
    onClick={event => {
      if (!interactive || event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey || window.getSelection()?.isCollapsed === false) return;
      event.preventDefault(); event.stopPropagation(); open(event.currentTarget);
    }}
    onKeyDown={event => {
      if (!interactive || !['Enter', ' '].includes(event.key)) return;
      event.preventDefault(); event.stopPropagation(); open(event.currentTarget);
    }} />;
}

function MarkdownImage({ node }: NodeRendererProps) { return <PreviewImage src={node.url} alt={node.alt} title={node.title} />; }
function FigureImage({ node }: NodeRendererProps) { return <PreviewImage src={node.attributes?.src} alt={node.attributes?.alt} title={node.attributes?.title} />; }
function ReferenceImage({ node, children }: NodeRendererProps) {
  const definition = useDocumentSelector(document => document.definitions.get(String(node.identifier)));
  return definition ? <PreviewImage src={definition.url} alt={node.alt} title={definition.title} /> : <>{children || String(node.alt ?? node.label ?? '')}</>;
}

/** Public renderer components cover Markdown, reference images and figure/img
 * syntax without changing LiMR parsing, source positions or annotation wrappers.
 */
export function readerImagePreview(): RendererExtension {
  return { name: 'vscode-image-preview', components: { image: MarkdownImage, imageReference: ReferenceImage, img: FigureImage } };
}
