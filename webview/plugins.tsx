import * as React from 'react';
import * as limr from '@linloir/limr';
import type { PluginEntry } from '../src/plugin-manifest';

/** Factories share the reader's React and LiMR instances; plugins need no bundler. */
export function useWorkspacePlugins(entries: readonly PluginEntry[], notify: (message: string, error?: boolean) => void) {
  const [loaded, setLoaded] = React.useState<{ key: string; extensions: limr.RendererExtension[] }>({ key: '', extensions: [] });
  const key = JSON.stringify(entries);
  React.useEffect(() => {
    let cancelled = false;
    const styles: HTMLLinkElement[] = [];
    const extensions: Array<limr.RendererExtension | undefined> = new Array(entries.length);
    // A slow or unresolved async factory must not hold up other extensions.
    entries.forEach((entry, index) => {
      void (async () => {
        try {
          if (entry.module) {
            const module = await import(/* webpackIgnore: true */ entry.module);
            if (cancelled) return;
            if (typeof module.default !== 'function') throw new Error('Export a default factory: ({ React, limr }) => RendererExtension.');
            const extension = await module.default({ React, limr });
            if (cancelled) return;
            if (!extension || typeof extension.name !== 'string') throw new Error('The factory must return a named RendererExtension.');
            // Registry IDs isolate module configuration and cache identity. Syntax
            // names stay unchanged so authored tags and annotations still resolve.
            extensions[index] = { ...extension, name: entry.id };
            setLoaded({ key, extensions: extensions.filter((value): value is limr.RendererExtension => !!value) });
          }
          if (entry.stylesheet && !cancelled) {
            const link = document.createElement('link'); link.rel = 'stylesheet'; link.href = entry.stylesheet;
            link.dataset.limrPlugin = entry.id;
            link.onerror = () => { if (!cancelled) notify(`LiMR plugin ${entry.id}: stylesheet failed to load.`, true); };
            // Keep stylesheet precedence deterministic even when factories finish
            // in a different order from their manifest/registration entries.
            document.head.insertBefore(link, styles.slice(index + 1).find(Boolean) ?? null);
            styles[index] = link;
          }
        } catch (error) { if (!cancelled) notify(`LiMR plugin ${entry.id}: ${error instanceof Error ? error.message : String(error)}`, true); }
      })();
    });
    return () => { cancelled = true; styles.forEach(link => link.remove()); };
  }, [key, notify]);
  return loaded.key === key ? loaded.extensions : [];
}

export class PluginBoundary extends React.Component<{
  plugins: readonly limr.RendererExtension[];
  notify(message: string, error?: boolean): void;
  children(plugins: readonly limr.RendererExtension[]): React.ReactNode;
}, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error: Error) { this.props.notify(`LiMR plugin: ${error.message}`, true); }
  componentDidUpdate(previous: Readonly<typeof this.props>) { if (previous.plugins !== this.props.plugins && this.state.failed) this.setState({ failed: false }); }
  render() { return this.props.children(this.state.failed ? [] : this.props.plugins); }
}
