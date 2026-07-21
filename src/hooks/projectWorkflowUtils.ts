import type { ProjectIndexRow } from '../engine/projectWorkspace';

export const appendUniqueId = (ids: string[], value: string): string[] =>
  ids.includes(value) ? ids : [...ids, value];

export const removeFileId = (ids: string[], value: string): string[] =>
  ids.filter((id) => id !== value);

export const sortRecentProjectRows = (rows: ProjectIndexRow[]): ProjectIndexRow[] =>
  [...rows].sort(
    (a, b) =>
      b.lastOpenedAt.localeCompare(a.lastOpenedAt) ||
      b.updatedAt.localeCompare(a.updatedAt) ||
      a.name.localeCompare(b.name, undefined, { numeric: true }) ||
      a.id.localeCompare(b.id, undefined, { numeric: true }),
  );

export const buildFileNameCopy = (baseName: string, existingNames: Set<string>): string => {
  const dotIndex = baseName.lastIndexOf('.');
  const stem = dotIndex > 0 ? baseName.slice(0, dotIndex) : baseName;
  const ext = dotIndex > 0 ? baseName.slice(dotIndex) : '';
  let candidate = `${stem} copy${ext}`;
  let counter = 2;
  while (existingNames.has(candidate)) {
    candidate = `${stem} copy ${counter}${ext}`;
    counter += 1;
  }
  return candidate;
};
