// Study — platform-neutral Study asset operation boundary (Phase 2H).
//
// Browser path delegates to the exact OPFS helper (`saveStudyTextAssetToOpfs`;
// logical paths `study/documents/...`). Tauri path UTF-8-encodes the text and
// calls the narrow Rust `study_files_*` commands — bytes land natively, with
// NO desktop OPFS fallback. Fail-closed: native IPC errors (including Rust
// traversal rejections) propagate to the caller.
//
// Returned metadata semantics match the browser helper exactly.

import {
  buildStudyOpfsPath,
  sanitizeStudyPathSegment,
  saveStudyTextAssetToOpfs,
} from './studyOpfs';
import { studyNativeFilesRead, studyNativeFilesWrite } from './studyNativeIpc';
import type { StudyStoragePlatform } from './studyStoragePlatform';
import { resolveStudyStoragePlatform } from './studyStoragePlatform';
import type { StudyFileAsset, StudyFileRole } from './studyTypes';

export interface StudyTextAssetInput {
  documentId: string;
  role: StudyFileRole;
  fileName: string;
  text: string;
  mediaType?: string;
  nowIso?: string;
}

export interface StudyNativeFileAssetIpc {
  write: (_path: string, _contents: number[]) => Promise<number>;
  read: (_path: string) => Promise<number[]>;
}

export const defaultNativeFileAssetIpc: StudyNativeFileAssetIpc = {
  write: studyNativeFilesWrite,
  read: studyNativeFilesRead,
};

export const saveStudyTextAsset = async (
  input: StudyTextAssetInput,
  deps: {
    platform?: StudyStoragePlatform;
    native?: StudyNativeFileAssetIpc;
  } = {},
): Promise<StudyFileAsset | null> => {
  const platform = deps.platform ?? resolveStudyStoragePlatform();
  if (platform !== 'tauri') return saveStudyTextAssetToOpfs(input);
  // Tauri: native bytes only — never touch OPFS on desktop.
  const native = deps.native ?? defaultNativeFileAssetIpc;
  const storagePath = buildStudyOpfsPath({
    documentId: input.documentId,
    role: input.role,
    fileName: input.fileName,
  });
  const mediaType = input.mediaType ?? 'text/plain';
  const nowIso = input.nowIso ?? new Date().toISOString();
  const bytes = Array.from(new TextEncoder().encode(input.text));
  const byteLength = await native.write(storagePath, bytes);
  return {
    id: `asset-${sanitizeStudyPathSegment(input.documentId)}-${Date.now().toString(36)}`,
    role: input.role,
    label: input.fileName,
    storagePath,
    mediaType,
    byteLength,
    createdAt: nowIso,
  };
};
