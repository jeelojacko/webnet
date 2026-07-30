import type { ProjectIndexRow, ProjectSessionState, WebNetProjectManifestV5 } from './projectWorkspace';
import { createSessionFromManifest } from './projectWorkspace';

export const hasOpfsSupport = (): boolean =>
  typeof navigator !== 'undefined' && typeof navigator.storage?.getDirectory === 'function';

export const getProjectRootPath = (projectId: string): string => `projects/${projectId}`;

export const getOpfsDirectoryHandle = async (): Promise<FileSystemDirectoryHandle | null> => {
  if (!hasOpfsSupport()) return null;
  return navigator.storage.getDirectory();
};

const ensureDirectoryHandle = async (
  parent: FileSystemDirectoryHandle,
  pathSegments: string[],
): Promise<FileSystemDirectoryHandle> => {
  let current = parent;
  for (const segment of pathSegments) {
    current = await current.getDirectoryHandle(segment, { create: true });
  }
  return current;
};

const getDirectoryHandleForRelativePath = async (
  root: FileSystemDirectoryHandle,
  relativePath: string,
  create: boolean,
): Promise<FileSystemDirectoryHandle> => {
  const segments = relativePath.split('/').filter(Boolean);
  let current = root;
  for (const segment of segments) {
    current = await current.getDirectoryHandle(segment, { create });
  }
  return current;
};

export const writeTextFileToOpfs = async (
  root: FileSystemDirectoryHandle,
  relativePath: string,
  text: string,
): Promise<void> => {
  const segments = relativePath.split('/').filter(Boolean);
  const fileName = segments.pop();
  if (!fileName) return;
  const directory = await ensureDirectoryHandle(root, segments);
  const handle = await directory.getFileHandle(fileName, { create: true });
  const writable = await handle.createWritable();
  await writable.write(text);
  await writable.close();
};

const readTextFileFromOpfs = async (
  root: FileSystemDirectoryHandle,
  relativePath: string,
): Promise<string> => {
  const segments = relativePath.split('/').filter(Boolean);
  const fileName = segments.pop();
  if (!fileName) return '';
  const directory = await getDirectoryHandleForRelativePath(root, segments.join('/'), false);
  const handle = await directory.getFileHandle(fileName, { create: false });
  const file = await handle.getFile();
  return file.text();
};

export const deleteOpfsProjectRoot = async (
  root: FileSystemDirectoryHandle,
  projectId: string,
): Promise<void> => {
  const projectsDirectory = await ensureDirectoryHandle(root, ['projects']);
  try {
    await projectsDirectory.removeEntry(projectId, { recursive: true });
  } catch {
    return;
  }
};

export const readOpfsProject = async (
  indexRow: ProjectIndexRow,
): Promise<ProjectSessionState | null> => {
  const root = await getOpfsDirectoryHandle();
  if (!root) return null;
  try {
    const manifestText = await readTextFileFromOpfs(root, `${getProjectRootPath(indexRow.id)}/project.wnproj`);
    const manifest = JSON.parse(manifestText) as WebNetProjectManifestV5;
    const sourceTexts = Object.fromEntries(
      await Promise.all(
        manifest.files.map(async (file) => [file.id, await readTextFileFromOpfs(root, `${getProjectRootPath(indexRow.id)}/${file.path}`)]),
      ),
    );
    return createSessionFromManifest({ indexRow, manifest, sourceTexts });
  } catch {
    return null;
  }
};
