export interface PluginEntry { id: string; stylesheet?: string; module?: string }

export function localPluginPath(value: unknown): string {
  if (typeof value !== 'string' || !value || /[\\\u0000?#:%]/.test(value) || value.startsWith('/') || /^[a-z][a-z\d+.-]*:/i.test(value))
    throw new Error('Plugin paths must be relative local paths.');
  if (value.split('/').some(segment => !segment || segment === '.' || segment === '..'))
    throw new Error('Plugin paths cannot leave their directory.');
  return value;
}

export function parsePluginManifest(source: string): PluginEntry[] {
  const manifest: unknown = JSON.parse(source);
  if (!manifest || typeof manifest !== 'object' || !('plugins' in manifest) || !Array.isArray(manifest.plugins))
    throw new Error('Expected a manifest with a plugins array.');
  const ids = new Set<string>();
  return manifest.plugins.map((entry: unknown) => {
    if (!entry || typeof entry !== 'object' || !('id' in entry) || typeof entry.id !== 'string' || !/^[a-z][a-z0-9-]*$/.test(entry.id) || ids.has(entry.id))
      throw new Error('Each plugin needs a unique lowercase id.');
    ids.add(entry.id);
    const plugin: PluginEntry = { id: entry.id };
    if ('stylesheet' in entry) { plugin.stylesheet = localPluginPath(entry.stylesheet); if (!/\.css$/i.test(plugin.stylesheet)) throw new Error('Stylesheets must be CSS files.'); }
    if ('module' in entry) { plugin.module = localPluginPath(entry.module); if (!/\.m?js$/i.test(plugin.module)) throw new Error('Modules must be JavaScript ESM files.'); }
    if (!plugin.stylesheet && !plugin.module) throw new Error('A plugin needs a stylesheet or module.');
    return plugin;
  });
}
