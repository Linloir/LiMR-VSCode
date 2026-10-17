import { useCallback, useMemo, useRef, useState } from 'react';
import type { DocumentSnapshot, RendererParameters } from '@linloir/limr';
import type { ReaderFileSettings, ReaderSettings } from '../src/shared/protocol';
import { PendingTranslationPreferences, type TranslationRequest } from './translation-pending';

/** Core owns block rendering; only this host owns persistent translation keys
 * and the global-to-paragraph preference transition. */
export function useTranslationParameters(settings: ReaderSettings | undefined, update: (settings: ReaderFileSettings, translationEpoch?: number, documentVersion?: number) => void, request: TranslationRequest | undefined, epoch = 0) {
  const controller = useRef<PendingTranslationPreferences | null>(null);
  controller.current ??= new PendingTranslationPreferences();
  const preferences = controller.current;
  preferences.configure(request, settings, epoch);
  const [generation, setGeneration] = useState(0);
  const refresh = useCallback(() => setGeneration(value => value + 1), []);
  const onDocument = useCallback((document: DocumentSnapshot, complete: boolean) => {
    const hadPending = preferences.hasPending, next = preferences.observe(document, complete);
    if (next) update(next.settings, next.translationEpoch, next.documentVersion);
    if (hadPending && !preferences.hasPending) refresh();
  }, [preferences, update, refresh]);
  const cancel = useCallback((epoch: number) => { preferences.cancel(epoch); refresh(); }, [preferences, refresh]);
  const parameters = useMemo<RendererParameters>(() => ({
    translationMode: preferences.global,
    translationModeForNode: (node, document) => preferences.mode(node, document),
    onTranslationBlockModeChange: (node, mode, document) => {
      const next = preferences.change(node, mode, document);
      if (next) update(next.settings, next.translationEpoch, next.documentVersion);
      refresh();
    },
  }), [preferences, settings?.translationMode, settings?.fileOverrides, request, epoch, update, generation, refresh]);
  return { parameters, onDocument, cancel };
}
