// Study native IPC loading contract (Phase 3 H2).
//
// The Tauri `invoke` bridge must load through a LITERAL dynamic
// `import('@tauri-apps/api/core')` (same shape as the Locate bridge), so the
// packaged Tauri build resolves it at runtime: a variable specifier defeats
// static resolution. These tests prove the native status path invokes
// `study_native_status` through the mocked core module (never a browser
// fallback) and that the literal specifier survives in source.

import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

import { invoke as mockInvoke } from '@tauri-apps/api/core';
import { studyNativeStatus } from '../src/studyNativeIpc';

beforeEach(() => {
  vi.mocked(mockInvoke).mockReset();
});

describe('study native IPC bridge', () => {
  it('invokes the native status command through the Tauri core module', async () => {
    const status = { db_path: '/data/study.sqlite3', schema_version: 1, stores: ['units'] };
    vi.mocked(mockInvoke).mockResolvedValueOnce(status);
    await expect(studyNativeStatus()).resolves.toEqual(status);
    expect(mockInvoke).toHaveBeenCalledTimes(1);
    expect(mockInvoke).toHaveBeenCalledWith('study_native_status', undefined);
  });

  it('propagates native failures instead of falling back to browser data', async () => {
    vi.mocked(mockInvoke).mockRejectedValueOnce(new Error('IPC unavailable'));
    await expect(studyNativeStatus()).rejects.toThrow('IPC unavailable');
  });

  it('loads the core bridge through a literal package-safe specifier', async () => {
    const sourcePath = resolve(
      dirname(fileURLToPath(import.meta.url)),
      '../src/studyNativeIpc.ts',
    );
    const source = await readFile(sourcePath, 'utf8');
    expect(source).toContain("import(/* @vite-ignore */ '@tauri-apps/api/core')");
    expect(source).not.toMatch(/import\(\s*\/\*\s*@vite-ignore\s*\*\/\s*[A-Za-z_$]/);
  });
});
