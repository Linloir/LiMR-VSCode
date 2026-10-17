import { describe, expect, it, vi } from 'vitest';
import { createDocument, createDocumentSession, registerWorkerExtension, standard, workerExtensionDescriptor, type DocumentWorkerPort, type DocumentWorkerRequest, type RendererExtension } from '@linloir/limr';
import { createDocumentWorkerHandler, standardWorkerRegistry } from '@linloir/limr/worker-api';
import { instantiateWorkspacePlugin } from './plugin-factory';

/** Protocol loopback for capability checks; real worker parity is tested separately. */
function parserWorker(): DocumentWorkerPort {
  const events = new EventTarget(), handle = createDocumentWorkerHandler(standardWorkerRegistry);
  let terminated = false;
  return {
    postMessage(request: DocumentWorkerRequest) {
      const input = structuredClone(request);
      queueMicrotask(() => {
        if (!terminated) void handle(input, message => {
          if (!terminated) events.dispatchEvent(new MessageEvent('message', { data: structuredClone(message) }));
        });
      });
    },
    addEventListener: events.addEventListener.bind(events) as DocumentWorkerPort['addEventListener'],
    removeEventListener: events.removeEventListener.bind(events) as DocumentWorkerPort['removeEventListener'],
    terminate() { terminated = true; },
  };
}

describe('workspace plugin namespaces', () => {
  it('wraps immutable factory results without changing shared instances or inheriting worker registration', async () => {
    const extension = Object.freeze(registerWorkerExtension({ name: 'registered-addon', transform() {} }, { id: 'addon/syntax@1' }));
    const loaded = await instantiateWorkspacePlugin(async ({ React, limr }: {
      React: typeof import('react'); limr: typeof import('@linloir/limr');
    }) => {
      expect(typeof React.createElement).toBe('function');
      expect(limr.workerExtensionDescriptor(extension)).toEqual({ id: 'addon/syntax@1' });
      return extension;
    }, 'extension:publisher.addon/registered');
    expect(loaded).not.toBe(extension);
    expect(loaded.name).toBe('extension:publisher.addon/registered');
    expect(loaded.transform).toBe(extension.transform);
    expect(workerExtensionDescriptor(loaded)).toBeUndefined();
    expect(extension.name).toBe('registered-addon');
    expect(Object.isFrozen(extension)).toBe(true);
    expect(workerExtensionDescriptor(extension)).toEqual({ id: 'addon/syntax@1' });
  });

  it('loads workspace and extension factories with the same name while retaining their authored syntax', async () => {
    const workspace: RendererExtension = { name: 'shared-name', tags: ['workspace-note'], display: 'block' };
    const addon: RendererExtension = { name: 'shared-name', tags: ['addon-note'], display: 'block' };
    const plugins = await Promise.all([
      instantiateWorkspacePlugin(() => workspace, 'workspace:notes'),
      instantiateWorkspacePlugin(() => addon, 'extension:publisher.addon/notes'),
    ]);
    const document = createDocument(':::workspace-note\nWorkspace note.\n:::\n\n:::addon-note\nAdd-on note.\n:::', { extensions: [...standard(), ...plugins] });
    expect(document.getSnapshot().blocks.map(block => block.node.name)).toEqual(['workspace-note', 'addon-note']);
    expect(plugins.map(plugin => plugin.name)).toEqual(['workspace:notes', 'extension:publisher.addon/notes']);
    expect(plugins[0].tags).toBe(workspace.tags);
    expect(plugins[1].tags).toBe(addon.tags);
    expect(workspace.name).toBe('shared-name');
    expect(addon.name).toBe('shared-name');
  });

  it('allows a factory name matching a built-in without changing renderer contracts', async () => {
    const components = { paragraph: () => null }, virtualization: RendererExtension['virtualization'] = { paragraph: { copyText: (_node, context) => context.children } };
    const plugin = await instantiateWorkspacePlugin(() => ({ name: 'gfm', components, virtualization }), 'workspace:paragraphs');
    const document = createDocument('**Still parsed**.', { extensions: [...standard(), plugin] });
    expect(document.getSnapshot().blocks[0].node.children![0].type).toBe('strong');
    expect(plugin.components).toBe(components);
    expect(plugin.virtualization).toBe(virtualization);
  });

  it('runs wrapped registered syntax through explicit main-thread compatibility without losing its transform', async () => {
    const original = registerWorkerExtension<RendererExtension>({ name: 'gfm', transform(root) { root.children![0].data = { retained: true }; } }, { id: 'addon/transform@1' });
    const plugin = await instantiateWorkspacePlugin(() => original, 'extension:publisher.addon/transform');
    const worker = vi.fn(() => { throw new Error('Wrapped syntax must not enter an unregistered worker factory'); });
    const session = createDocumentSession({ extensions: [...standard(), plugin], worker });
    try {
      const document = await session.load('**Retained source**.');
      expect(worker).not.toHaveBeenCalled();
      expect(session.getSnapshot().capabilities).toMatchObject({ worker: false, progressive: false });
      expect(session.getSnapshot().capabilities.reason).toContain('registration');
      expect(document.getSnapshot().blocks[0].node.data).toEqual({ retained: true });
      expect(document.getSnapshot().blocks[0].node.children![0].type).toBe('strong');
    } finally { session.dispose(); }
  });

  it('keeps duplicate-named pure view plugins on the host while standard syntax uses the worker', async () => {
    const original = Object.freeze({ name: 'gfm', components: { 'addon-view': () => null } });
    const plugins = await Promise.all([
      instantiateWorkspacePlugin(() => original, 'workspace:view'),
      instantiateWorkspacePlugin(() => original, 'extension:publisher.addon/view'),
    ]);
    const worker = vi.fn(parserWorker), session = createDocumentSession({ extensions: [...standard(), ...plugins], worker, fallback: 'error' });
    try {
      const document = await session.load('**Worker text**.');
      expect(worker).toHaveBeenCalledOnce();
      expect(session.getSnapshot().capabilities.worker).toBe(true);
      expect(document.getSnapshot().blocks[0].node.children![0].type).toBe('strong');
      expect(document.update('Updated **text**.').source).toBe('Updated **text**.');
    } finally { session.dispose(); }
  });

  it('retains errors for actual duplicate authored tags', async () => {
    const plugins = await Promise.all([
      instantiateWorkspacePlugin(() => ({ name: 'same', tags: ['same-note'] }), 'workspace:notes'),
      instantiateWorkspacePlugin(() => ({ name: 'same', tags: ['same-note'] }), 'extension:publisher.addon/notes'),
    ]);
    expect(() => createDocument('Text.', { extensions: [...standard(), ...plugins] })).toThrow('Duplicate LiMR tag: same-note');
  });

  it('keeps unknown syntax unregistered and reports invalid factories', async () => {
    const extension = { name: 'unregistered-addon', transform() {} };
    expect(workerExtensionDescriptor(await instantiateWorkspacePlugin(() => extension, 'workspace:unknown'))).toBeUndefined();
    await expect(instantiateWorkspacePlugin({}, 'workspace:invalid')).rejects.toThrow('default factory');
    await expect(instantiateWorkspacePlugin(() => ({}), 'workspace:invalid')).rejects.toThrow('named RendererExtension');
  });
});
