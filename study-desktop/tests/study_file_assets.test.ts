/** @vitest-environment jsdom */
import { afterEach, describe, expect, it } from 'vitest';

import { saveStudyTextAsset } from '../src/studyFileAssets';
import { buildStudyOpfsPath } from '../src/studyOpfs';
import { createFakeNativeFiles } from './study_native_conformance_support';

// Phase 2H: the platform-neutral asset boundary. Browser keeps the exact OPFS
// path/metadata contract; Tauri stores bytes through the narrow native file
// commands with no desktop OPFS fallback. Native IPC is mocked; Rust
// traversal rules are covered by `study_files.rs` unit tests.

const writtenOpfs = new Map<string, string>();

const makeOpfsDir = (prefix: string): FileSystemDirectoryHandle => {
  const dir = {
    getDirectoryHandle: async (name: string) => makeOpfsDir(`${prefix}${name}/`),
    getFileHandle: async (name: string) => ({
      createWritable: async () => ({
        write: async (text: string) => {
          writtenOpfs.set(`${prefix}${name}`, text);
        },
        close: async () => undefined,
      }),
    }),
  };
  return dir as unknown as FileSystemDirectoryHandle;
};

const installOpfsFixture = (): void => {
  writtenOpfs.clear();
  Object.defineProperty(globalThis.navigator, 'storage', {
    configurable: true,
    value: { getDirectory: async () => makeOpfsDir('') },
  });
};

const removeOpfsFixture = (): void => {
  writtenOpfs.clear();
  Object.defineProperty(globalThis.navigator, 'storage', {
    configurable: true,
    value: undefined,
  });
};

afterEach(() => {
  removeOpfsFixture();
});

describe('study text asset boundary', () => {
  it('browser path keeps the exact OPFS path, bytes, and metadata semantics', async () => {
    installOpfsFixture();
    const asset = await saveStudyTextAsset(
      {
        documentId: 'Doc Surveys Act',
        role: 'normalized-markdown',
        fileName: 'Part 1.md',
        text: '# Part 1 — monuments',
        nowIso: '2026-09-10T10:00:00.000Z',
      },
      { platform: 'browser' },
    );
    const expectedPath = buildStudyOpfsPath({
      documentId: 'Doc Surveys Act',
      role: 'normalized-markdown',
      fileName: 'Part 1.md',
    });
    expect(expectedPath).toBe('study/documents/doc-surveys-act/normalized-markdown/part-1.md');
    expect(asset).toMatchObject({
      role: 'normalized-markdown',
      label: 'Part 1.md',
      storagePath: expectedPath,
      mediaType: 'text/plain',
      byteLength: new TextEncoder().encode('# Part 1 — monuments').length,
      createdAt: '2026-09-10T10:00:00.000Z',
    });
    expect(asset?.id.startsWith('asset-doc-surveys-act-')).toBe(true);
    expect(writtenOpfs.get(expectedPath)).toBe('# Part 1 — monuments');
  });

  it('browser path returns null without OPFS support (unchanged fallback)', async () => {
    removeOpfsFixture();
    await expect(
      saveStudyTextAsset(
        { documentId: 'd', role: 'pdf', fileName: 'a.pdf', text: 'x' },
        { platform: 'browser' },
      ),
    ).resolves.toBeNull();
  });

  it('tauri path stores bytes natively under the same logical path, never OPFS', async () => {
    removeOpfsFixture();
    const files = createFakeNativeFiles();
    const text = '# Part 1 — monuments ✓';
    const asset = await saveStudyTextAsset(
      {
        documentId: 'Doc Surveys Act',
        role: 'normalized-markdown',
        fileName: 'Part 1.md',
        text,
        mediaType: 'text/markdown',
        nowIso: '2026-09-10T10:00:00.000Z',
      },
      { platform: 'tauri', native: files },
    );
    expect(asset).toMatchObject({
      role: 'normalized-markdown',
      label: 'Part 1.md',
      storagePath: 'study/documents/doc-surveys-act/normalized-markdown/part-1.md',
      mediaType: 'text/markdown',
      byteLength: new TextEncoder().encode(text).length,
      createdAt: '2026-09-10T10:00:00.000Z',
    });
    expect(asset?.id.startsWith('asset-doc-surveys-act-')).toBe(true);
    // Native bytes decode back to the exact text; nothing touched OPFS.
    const stored = await files.read(asset?.storagePath ?? '');
    expect(new TextDecoder().decode(new Uint8Array(stored))).toBe(text);
    expect(writtenOpfs.size).toBe(0);
  });

  it('tauri path propagates traversal rejections and stores nothing', async () => {
    const files = createFakeNativeFiles();
    await expect(
      saveStudyTextAsset(
        { documentId: '..', role: 'pdf', fileName: 'evil.pdf', text: 'x' },
        { platform: 'tauri', native: files },
      ),
    ).rejects.toThrow('rejected study file path');
    expect(files.files.size).toBe(0);
  });

  it('tauri path propagates native write failures fail-closed', async () => {
    const files = createFakeNativeFiles();
    const failing = {
      ...files,
      write: async (): Promise<number> => {
        throw new Error('native asset store locked');
      },
    };
    await expect(
      saveStudyTextAsset(
        { documentId: 'd', role: 'backup', fileName: 'b.txt', text: 'x' },
        { platform: 'tauri', native: failing },
      ),
    ).rejects.toThrow('native asset store locked');
  });
});
