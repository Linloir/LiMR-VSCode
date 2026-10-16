import { useLayoutEffect, useState } from 'react';
import type { ReaderSidebarMode } from '../src/shared/protocol';

const anchor = '[data-limr-anchor]';
const bodyAnchor = `.limr-reader-content > .limr-prose ${anchor}`;

/** LiMR 1.2.2 exposes a boolean sidebar prop but no content-aware mode or
 * children slot. Its rendered anchors already reflect registered annotation
 * types, references and plugins; highlights do not create an anchor. Observe
 * only marker insertion/removal, without parsing the source a second time or
 * subscribing to scroll, animation, selection or other attribute updates. */
export function useReaderSidebar(root: HTMLElement | null, mode: ReaderSidebarMode, documentId?: string) {
  const [hasContent, setHasContent] = useState(false);
  useLayoutEffect(() => {
    if (!root || mode !== 'content') return;
    const update = () => setHasContent(!!root.querySelector(bodyAnchor));
    const containsAnchor = (node: Node) => node instanceof Element && (node.matches(anchor) || !!node.querySelector(anchor));
    const observer = new MutationObserver(records => {
      const changed = records.some(record => {
        const nodes = [...record.addedNodes, ...record.removedNodes];
        const inBody = record.target instanceof Element && record.target.closest('.limr-reader-content');
        const replacedBody = !inBody && nodes.some(node => node instanceof Element &&
          (node.matches('.limr-reader-content') || node.querySelector('.limr-reader-content')));
        return (inBody || replacedBody) && nodes.some(containsAnchor);
      });
      if (changed) update();
    });
    // The stable host includes Reader replacements, but sidebar/overlay nodes
    // never count as document anchors, so enabling the rail cannot feed back.
    observer.observe(root, { childList: true, subtree: true });
    update();
    return () => observer.disconnect();
  }, [root, mode, documentId]);
  return mode === 'always' || mode === 'content' && hasContent;
}
