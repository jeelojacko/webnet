import { getOpfsDirectoryHandle, writeTextFileToOpfs } from '../engine/projectStorageOpfs';
import type { StudyFileAsset, StudyFileRole } from './studyTypes';

const STUDY_OPFS_ROOT = 'study';

export const sanitizeStudyPathSegment = (value: string): string => {
  const sanitized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return sanitized || 'untitled';
};

export const buildStudyOpfsPath = ({
  documentId,
  role,
  fileName,
}: {
  documentId: string;
  role: StudyFileRole;
  fileName: string;
}): string =>
  [
    STUDY_OPFS_ROOT,
    'documents',
    sanitizeStudyPathSegment(documentId),
    role,
    sanitizeStudyPathSegment(fileName),
  ].join('/');

export const saveStudyTextAssetToOpfs = async ({
  documentId,
  role,
  fileName,
  text,
  mediaType = 'text/plain',
  nowIso = new Date().toISOString(),
}: {
  documentId: string;
  role: StudyFileRole;
  fileName: string;
  text: string;
  mediaType?: string;
  nowIso?: string;
}): Promise<StudyFileAsset | null> => {
  const root = await getOpfsDirectoryHandle();
  if (!root) return null;
  const storagePath = buildStudyOpfsPath({ documentId, role, fileName });
  await writeTextFileToOpfs(root, storagePath, text);
  return {
    id: `asset-${sanitizeStudyPathSegment(documentId)}-${Date.now().toString(36)}`,
    role,
    label: fileName,
    storagePath,
    mediaType,
    byteLength: new Blob([text]).size,
    createdAt: nowIso,
  };
};
