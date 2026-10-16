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
    void (async () => {
      const extensions: limr.RendererExtension[] = [];
      for (const entry of entries) {
        try {
          if (entry.module) {
            const module = await import(/* webpackIgnore: true */ entry.module);
            if (typeof module.default !== 'function') throw new Error('Export a default factory: ({ React, limr }) => RendererExtension.');
            const extension = await module.default({ React, limr });
            if (!extension || typeof extension.name !== 'string') throw new Error('The factory must return a named RendererExtension.');
            extensions.push(extension);
          }
          if (entry.stylesheet && !cancelled) {
            const link = document.createElement('link'); link.rel = 'stylesheet'; link.href = entry.stylesheet;
            link.dataset.limrPlugin = entry.id;
            link.onerror = () => { if (!cancelled) notify(`LiMR plugin ${entry.id}: stylesheet failed to load.`, true); };
            document.head.append(link); styles.push(link);
          }
        } catch (error) { if (!cancelled) notify(`LiMR plugin ${entry.id}: ${error instanceof Error ? error.message : String(error)}`, true); }
        if (cancelled) break;
      }
      if (!cancelled) setLoaded({ key, extensions });
    })();
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
