export interface ImageLocationInput {
  documentUri: string;
  workspaceUri?: string;
  src: string;
  wsl?: boolean;
  mode?: 'auto' | 'file' | 'workspace' | 'folder';
  baseFolder?: string;
  searchPaths?: readonly string[];
  homeUri?: string;
}
interface Candidate { uri: string; query: string; fragment: string }
export type ImageResolution =
  | ({ kind: 'local' } & Candidate)
  | { kind: 'external'; uri: string }
  | { kind: 'missing' | 'ambiguous' | 'unsupported' };

const clean = (url: URL) => { const copy = new URL(url); copy.search = ''; copy.hash = ''; return copy; };
function candidate(url: URL): Candidate {
  decodeURIComponent(url.pathname); // Reject malformed escapes before filesystem lookup.
  return { uri: clean(url).href, query: url.search.slice(1), fragment: url.hash.slice(1) };
}
/** Resolve relative paths using the selected base, followed by explicit search
 * directories in order. Auto only tries the file and its containing workspace.
 * Never search unconfigured directories or match by basename.
 * Equally plausible absolute/rooted paths remain ambiguous instead of silently
 * selecting a different image.
 */
export async function resolveReaderImage(input: ImageLocationInput, isFile: (uri: string) => Promise<boolean>): Promise<ImageResolution> {
  try {
    const value = input.src.trim();
    if (!value || value.length > 8192 || /[\u0000-\u001f\u007f]/.test(value)) return { kind: 'unsupported' };
    const document = clean(new URL(input.documentUri));
    const documentBase = new URL('./', document);
    const workspace = input.workspaceUri ? clean(new URL(input.workspaceUri)) : undefined;
    const rootBase = workspace ? new URL(`${workspace.href.replace(/\/$/, '')}/`) : undefined;
    const checked = new Set<string>();
    const tryTier = async (urls: URL[]): Promise<ImageResolution | undefined> => {
      const choices = urls.map(candidate).filter(item => !checked.has(item.uri) && !!checked.add(item.uri));
      const found = (await Promise.all(choices.map(async item => await isFile(item.uri) ? item : undefined))).filter((item): item is Candidate => !!item);
      if (found.length > 1) return { kind: 'ambiguous' };
      if (found[0]) return { kind: 'local', ...found[0] };
    };
    const withPath = (path: string) => { const url = new URL(document); url.pathname = path; return url; };
    const windowsPath = (path: string) => withPath(input.wsl ? `/mnt/${path[0].toLowerCase()}${path.slice(2)}` : `/${path}`);
    const fileResource = (url: URL): URL | undefined => {
      if (url.host && url.host !== 'localhost' && (document.protocol !== 'file:' || input.wsl)) return;
      if (input.wsl && /^\/[a-z]:\//i.test(url.pathname)) url.pathname = `/mnt/${url.pathname[1].toLowerCase()}${url.pathname.slice(3)}`;
      const resource = document.protocol === 'file:' ? url : withPath(url.pathname);
      resource.search = url.search; resource.hash = url.hash;
      return resource;
    };
    const configuredDirectory = (value: string): URL | undefined => {
      try {
        const path = value.trim().replace(/\\/g, '/');
        if (!path || /[\u0000-\u001f\u007f]/.test(path)) return;
        let url: URL | undefined;
        if (path.startsWith('//')) {
          if (document.protocol !== 'file:' || input.wsl) return;
          url = new URL(`file:${path}`);
        } else if (/^[a-z]:\//i.test(path)) url = windowsPath(path);
        else if (path === '~' || path.startsWith('~/')) {
          if (!input.homeUri) return;
          const home = new URL(`${input.homeUri.replace(/\/$/, '')}/`);
          url = new URL(path === '~' ? './' : path.slice(2).replace(/#/g, '%23').replace(/\?/g, '%3F'), home);
          if (url.protocol === 'file:') url = fileResource(url);
        } else if (/^[a-z][a-z\d+.-]*:/i.test(path)) {
          url = new URL(path);
          if (url.protocol === 'file:') url = fileResource(url);
          else if (url.protocol !== document.protocol || url.host !== document.host) return;
        } else url = new URL(path.replace(/#/g, '%23').replace(/\?/g, '%3F'), rootBase ?? documentBase);
        if (!url) return;
        url = clean(url); url.pathname = url.pathname.replace(/\/?$/, '/');
        decodeURIComponent(url.pathname);
        return url;
      } catch { return; }
    };
    const windowsDrive = /^[a-z]:[\\/]/i.test(value);
    const windowsUnc = /^\\\\[^\\]+\\/.test(value);
    const normalized = value.replace(/\\/g, '/');
    if (windowsDrive) {
      return await tryTier([windowsPath(normalized)]) ?? { kind: 'missing' };
    }
    if (windowsUnc) {
      if (document.protocol !== 'file:' || input.wsl) return { kind: 'unsupported' };
      return await tryTier([new URL(`file:${normalized}`)]) ?? { kind: 'missing' };
    }
    const scheme = /^([a-z][a-z\d+.-]*):/i.exec(value)?.[1].toLowerCase();
    if (scheme && ['http', 'https', 'data', 'blob'].includes(scheme)) return { kind: 'external', uri: value };
    if (normalized.startsWith('//')) return { kind: 'external', uri: `https:${normalized}` };
    if (scheme) {
      const url = new URL(value);
      if (scheme === 'file') {
        const resource = fileResource(url);
        if (!resource) return { kind: 'unsupported' };
        return await tryTier([resource]) ?? { kind: 'missing' };
      }
      if (url.protocol !== document.protocol || url.host !== document.host) return { kind: 'unsupported' };
      return await tryTier([url]) ?? { kind: 'missing' };
    }
    const rooted = normalized.startsWith('/');
    const relative = normalized.replace(/^\.\//, '').replace(/^\//, '');
    const resolveAgainst = async (bases: URL[], path: string) => {
      const result = await tryTier(bases.map(base => new URL(path, base)));
      if (result) return result;
      // Filename punctuation is considered only after URL semantics fail.
      if (/[#?]/.test(path)) {
        const literal = path.replace(/#/g, '%23').replace(/\?/g, '%3F');
        // A valid URL suffix need not be valid as a decoded filename. An
        // inapplicable literal fallback must not block the next configured base.
        try { return await tryTier(bases.map(base => new URL(literal, base))); } catch { return; }
      }
    };
    if (rooted) {
      const exact = rootBase ? [new URL(relative, rootBase), new URL(normalized, document)] : [new URL(normalized, document)];
      const result = await tryTier(exact);
      if (result) return result;
      if (/[#?]/.test(normalized)) {
        const literal = normalized.replace(/#/g, '%23').replace(/\?/g, '%3F');
        const result = await tryTier(rootBase ? [new URL(literal.slice(1), rootBase), new URL(literal, document)] : [new URL(literal, document)]);
        if (result) return result;
      }
      return { kind: 'missing' };
    }
    const parentPath = decodeURIComponent(relative.split(/[?#]/)[0]).split(/[\\/]/).includes('..');
    const mode = input.mode ?? 'auto';
    const primary = mode === 'file' ? [documentBase] : mode === 'workspace' ? [rootBase]
      : mode === 'folder' ? [configuredDirectory(input.baseFolder ?? '')]
      : [documentBase, ...(parentPath ? [] : [rootBase])];
    // Parent traversal already identifies an exact location relative to the
    // selected base; do not reinterpret it from additional search directories.
    const directories = [...primary, ...(parentPath ? [] : (input.searchPaths ?? []).map(configuredDirectory))];
    for (const base of directories) {
      if (!base) continue;
      const result = await resolveAgainst([base], normalized);
      if (result) return result;
    }
    return { kind: 'missing' };
  } catch { return { kind: 'unsupported' }; }
}
