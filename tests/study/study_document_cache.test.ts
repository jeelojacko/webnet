// Study — per-document component load cache (in-memory, in-flight dedupe).

import { describe, expect, it, vi } from 'vitest';
import { StudyDocumentComponentCache } from '../../src/study/studyDocumentCache';
import type { ImportedLegalComponent } from '../../src/study/studyTypes';

const component = (documentId: string, sourceKey: string): ImportedLegalComponent => ({
  documentId,
  id: sourceKey,
  sourceKey,
  componentType: 'section',
  label: sourceKey,
  heading: undefined,
  text: `${documentId} ${sourceKey} text`,
  contentHash: `${sourceKey}-hash`,
  extractionStatus: 'complete',
});

const deferred = <T>() => {
  let resolve!: (_value: T) => void;
  let reject!: (_reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

describe('StudyDocumentComponentCache', () => {
  it('serves one shared in-flight load for concurrent requests', async () => {
    const cache = new StudyDocumentComponentCache();
    const gate = deferred<ImportedLegalComponent[]>();
    const loader = vi.fn(() => gate.promise);
    const first = cache.get('doc-one', loader);
    const second = cache.get('doc-one', loader);
    expect(loader).toHaveBeenCalledTimes(1);
    expect(second).toBe(first);
    gate.resolve([component('doc-one', 'section:1')]);
    await expect(first).resolves.toHaveLength(1);
    // A later request hits the completed cache entry — still one loader call.
    const third = cache.get('doc-one', loader);
    await expect(third).resolves.toHaveLength(1);
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it('tracks presence per document', () => {
    const cache = new StudyDocumentComponentCache();
    expect(cache.has('doc-one')).toBe(false);
    void cache.get('doc-one', async () => []);
    expect(cache.has('doc-one')).toBe(true);
    expect(cache.cachedDocumentIds).toEqual(['doc-one']);
  });

  it('invalidates every entry so the next read reloads', async () => {
    const cache = new StudyDocumentComponentCache();
    const firstLoad = vi.fn(async (id: string) => [component(id, 'section:1')]);
    const secondLoad = vi.fn(async (id: string) => [component(id, 'section:2')]);
    await cache.get('doc-one', firstLoad);
    cache.invalidateAll();
    await cache.get('doc-one', secondLoad);
    expect(firstLoad).toHaveBeenCalledTimes(1);
    expect(secondLoad).toHaveBeenCalledTimes(1);
    expect(cache.cachedDocumentIds).toHaveLength(1);
  });

  it('drops failed loads so a later request can retry', async () => {
    const cache = new StudyDocumentComponentCache();
    const failFirst = vi.fn(async () => {
      throw new Error('quota');
    });
    await expect(cache.get('doc-one', failFirst)).rejects.toThrow('quota');
    expect(cache.has('doc-one')).toBe(false);
    const succeed = vi.fn(async (id: string) => [component(id, 'section:3')]);
    await expect(cache.get('doc-one', succeed)).resolves.toHaveLength(1);
    expect(failFirst).toHaveBeenCalledTimes(1);
    expect(succeed).toHaveBeenCalledTimes(1);
  });
});
