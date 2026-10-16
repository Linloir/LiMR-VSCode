import { describe, expect, it } from 'vitest';
import { localPluginPath, parsePluginManifest } from '../src/plugin-manifest';

describe('workspace plugin manifest', () => {
  it('accepts CSS and syntax modules in deterministic order', () => {
    expect(parsePluginManifest('{"plugins":[{"id":"paper","stylesheet":"theme.css"},{"id":"aside","module":"syntax/aside.mjs"}]}')).toEqual([
      { id: 'paper', stylesheet: 'theme.css' }, { id: 'aside', module: 'syntax/aside.mjs' },
    ]);
  });
  it.each(['../escape.js', '/tmp/a.js', 'https://host/a.js', 'x\\a.js', 'x/%2e%2e/a.js', 'a.js?x=1', './a.js'])('rejects nonlocal or ambiguous path %s', path => {
    expect(() => localPluginPath(path)).toThrow();
  });
  it('rejects duplicate ids and inert entries', () => {
    expect(() => parsePluginManifest('{"plugins":[{"id":"x","module":"x.js"},{"id":"x","stylesheet":"x.css"}]}')).toThrow();
    expect(() => parsePluginManifest('{"plugins":[{"id":"x"}]}')).toThrow();
  });
});
