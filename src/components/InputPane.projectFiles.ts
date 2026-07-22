import type { ProjectWorkspaceFileView } from '../hooks/useProjectFileWorkflow';

export const buildProjectFileStatusChips = (file: ProjectWorkspaceFileView): string[] => {
  const chips: string[] = [file.kind];
  if (!file.enabled) chips.push('unchecked');
  if (file.isMain) chips.push('main');
  if (file.isOpenInTab) chips.push('open');
  if (file.isActive) chips.push('active');
  return chips;
};

export const reorderFileIds = (
  fileIds: string[],
  draggedFileId: string,
  targetFileId: string,
): string[] => {
  if (draggedFileId === targetFileId) return fileIds;
  const next = [...fileIds];
  const draggedIndex = next.indexOf(draggedFileId);
  const targetIndex = next.indexOf(targetFileId);
  if (draggedIndex < 0 || targetIndex < 0) return fileIds;
  const [moved] = next.splice(draggedIndex, 1);
  next.splice(targetIndex, 0, moved);
  return next;
};
