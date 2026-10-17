import * as React from 'react';
import * as limr from '@linloir/limr';

/** Preserve the host's existing manifest namespace without mutating a factory's
 * result. Syntax names and renderer contracts stay intact. A worker registration
 * belongs to the original instance and cannot be inherited by this wrapper. */
export async function instantiateWorkspacePlugin(factory: unknown, id: string): Promise<limr.RendererExtension> {
  if (typeof factory !== 'function') throw new Error('Export a default factory: ({ React, limr }) => RendererExtension.');
  const extension = await factory({ React, limr });
  if (!extension || typeof extension.name !== 'string') throw new Error('The factory must return a named RendererExtension.');
  return { ...extension, name: id };
}
