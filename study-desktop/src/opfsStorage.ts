// Study-owned generic OPFS file helpers.
//
// Single source of truth for Study OPFS access. These are intentionally
// generic (no project-domain imports) so the standalone Study app never
// imports from the adjustment engine's `projectStorageOpfs` module.
// Behavior (paths, write semantics) matches the former shared helpers.

export const hasOpfsSupport = (): boolean =>
  typeof navigator !== 'undefined' && typeof navigator.storage?.getDirectory === 'function';

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
