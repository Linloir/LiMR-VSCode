import { createContext, useContext, useLayoutEffect, useRef } from 'react';
import { translations, useDocument, type NodeRendererProps, type RendererExtension } from '@linloir/limr';
import type { ReaderFileSettings, ReaderSettings } from '../src/shared/protocol';
import { paragraphModes, paragraphSettings, translationBlockKeys, translationOverride } from './translation-settings';

export const TranslationPreferences = createContext<{
  settings: ReaderSettings;
  update(settings: ReaderFileSettings): void;
} | null>(null);
const NativeTranslation = translations().components!.translations;

function ReaderTranslation(props: NodeRendererProps) {
  const preferences = useContext(TranslationPreferences);
  const document = useDocument();
  const host = useRef<HTMLDivElement>(null), restoreFocus = useRef(false);
  const keys = translationBlockKeys(document), key = keys.get(props.node.position?.start.offset ?? -1);
  const settings = preferences?.settings;
  const override = settings && translationOverride(settings.translationMode);
  const requested = override ?? (key && settings?.fileOverrides.translationParagraphs?.[key]) ?? props.node.attributes?.default;
  const node = requested === undefined ? props.node : { ...props.node, attributes: { ...props.node.attributes, default: requested } };

  useLayoutEffect(() => {
    const marker = host.current?.querySelector<HTMLButtonElement>('[data-translation-switch]');
    if (!marker) return;
    // LiMR 1.2.2 owns the marker, movement and collapse animations. Its built-in
    // translation labels are Chinese; adapt their accessible text to the host.
    const mode = marker.dataset.mode as typeof paragraphModes[number];
    const next = paragraphModes[(paragraphModes.indexOf(mode) + 1) % paragraphModes.length];
    const labels = settings?.locale === 'en' ? { origin: 'original', translation: 'translation', both: 'bilingual' }
      : { origin: '原文', translation: '译文', both: '对照' };
    marker.title = settings?.locale === 'en' ? `Showing ${labels[mode]}; switch to ${labels[next]}` : `当前${labels[mode]}，切换到${labels[next]}`;
    marker.setAttribute('aria-label', marker.title);
    if (restoreFocus.current) { marker.focus({ preventScroll: true }); restoreFocus.current = false; }
  });

  return <div className="lv-translation-preferences" ref={host} onClickCapture={event => {
    const marker = event.target instanceof Element ? event.target.closest<HTMLButtonElement>('[data-translation-switch]') : null;
    if (!marker || !preferences || !key) return;
    event.preventDefault(); event.stopPropagation();
    restoreFocus.current = marker === window.document.activeElement;
    const current = marker.dataset.mode as typeof paragraphModes[number];
    const next = paragraphModes[(paragraphModes.indexOf(current) + 1) % paragraphModes.length];
    preferences.update(paragraphSettings(preferences.settings.translationMode, preferences.settings.fileOverrides, keys.values(), key, next));
  }}><NativeTranslation {...props} node={node} /></div>;
}

export function readerTranslations(): RendererExtension {
  return { name: 'vscode-translation-preferences', components: { translations: ReaderTranslation } };
}
