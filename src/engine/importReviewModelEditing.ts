import type { ImportReviewGroup, ImportReviewItem, ImportReviewModel } from './importReviewTypes';

const cloneImportReviewModel = (model: ImportReviewModel): ImportReviewModel => ({
  groups: model.groups.map((group) => ({
    ...group,
    itemIds: [...group.itemIds],
  })),
  items: model.items.map((item) => ({ ...item })),
  warnings: [...model.warnings],
  errors: [...model.errors],
});

export const duplicateImportReviewItem = (
  model: ImportReviewModel,
  itemId: string,
  nextId: string,
): ImportReviewModel => {
  const nextModel = cloneImportReviewModel(model);
  const sourceItem = nextModel.items.find((item) => item.id === itemId);
  if (!sourceItem || sourceItem.kind === 'comment') return nextModel;
  const group = nextModel.groups.find((entry) => entry.key === sourceItem.groupKey);
  if (!group) return nextModel;
  const insertIndex = group.itemIds.indexOf(itemId);
  const duplicateItem: ImportReviewItem = {
    ...sourceItem,
    id: nextId,
    synthetic: true,
  };
  nextModel.items.push(duplicateItem);
  group.itemIds.splice(insertIndex + 1, 0, nextId);
  return nextModel;
};

export const createImportReviewGroupFromItem = (
  model: ImportReviewModel,
  itemId: string,
  nextGroupKey: string,
  label: string,
  defaultComment: string,
): ImportReviewModel => {
  const nextModel = cloneImportReviewModel(model);
  const item = nextModel.items.find((entry) => entry.id === itemId);
  if (!item || item.groupKey === 'control') return nextModel;
  const sourceGroupIndex = nextModel.groups.findIndex((group) => group.key === item.groupKey);
  if (sourceGroupIndex < 0) return nextModel;
  const sourceGroup = nextModel.groups[sourceGroupIndex];
  const nextGroup: ImportReviewGroup = {
    key: nextGroupKey,
    kind: sourceGroup.kind === 'control' ? 'setup' : sourceGroup.kind,
    label,
    defaultComment,
    synthetic: true,
    manualOrder: true,
    setupId: item.setupId ?? sourceGroup.setupId,
    backsightId: item.backsightId ?? sourceGroup.backsightId,
    itemIds: [itemId],
  };
  sourceGroup.itemIds = sourceGroup.itemIds.filter((entry) => entry !== itemId);
  item.groupKey = nextGroupKey;
  nextModel.groups.splice(sourceGroupIndex + 1, 0, nextGroup);
  return nextModel;
};

export const createEmptyImportReviewGroup = (
  model: ImportReviewModel,
  nextGroupKey: string,
  label: string,
  defaultComment: string,
  afterGroupKey?: string,
): ImportReviewModel => {
  const nextModel = cloneImportReviewModel(model);
  if (nextModel.groups.some((group) => group.key === nextGroupKey)) return nextModel;
  const insertAfterIndex =
    afterGroupKey != null
      ? nextModel.groups.findIndex((group) => group.key === afterGroupKey)
      : nextModel.groups.length - 1;
  const nextGroup: ImportReviewGroup = {
    key: nextGroupKey,
    kind: 'setup',
    label,
    defaultComment,
    synthetic: true,
    manualOrder: true,
    itemIds: [],
  };
  nextModel.groups.splice(Math.max(insertAfterIndex, 0) + 1, 0, nextGroup);
  return nextModel;
};

export const removeImportReviewGroup = (
  model: ImportReviewModel,
  groupKey: string,
): ImportReviewModel => {
  const nextModel = cloneImportReviewModel(model);
  nextModel.groups = nextModel.groups.filter(
    (group) => !(group.key === groupKey && group.synthetic && group.itemIds.length === 0),
  );
  return nextModel;
};

export const insertImportReviewCommentRow = (
  model: ImportReviewModel,
  afterItemId: string,
  nextId: string,
): ImportReviewModel => {
  const nextModel = cloneImportReviewModel(model);
  const sourceItem = nextModel.items.find((item) => item.id === afterItemId);
  if (!sourceItem) return nextModel;
  const group = nextModel.groups.find((entry) => entry.key === sourceItem.groupKey);
  if (!group) return nextModel;
  const insertIndex = group.itemIds.indexOf(afterItemId);
  const commentItem: ImportReviewItem = {
    id: nextId,
    kind: 'comment',
    index: -1,
    groupKey: sourceItem.groupKey,
    sourceType: 'Comment',
    synthetic: true,
    defaultText: '# COMMENT',
  };
  nextModel.items.push(commentItem);
  group.itemIds.splice(insertIndex + 1, 0, nextId);
  return nextModel;
};

export const moveImportReviewItem = (
  model: ImportReviewModel,
  itemId: string,
  nextGroupKey: string,
): ImportReviewModel => {
  const nextModel = cloneImportReviewModel(model);
  const item = nextModel.items.find((entry) => entry.id === itemId);
  if (!item || item.groupKey === nextGroupKey) return nextModel;
  const sourceGroup = nextModel.groups.find((group) => group.key === item.groupKey);
  const targetGroup = nextModel.groups.find((group) => group.key === nextGroupKey);
  if (!sourceGroup || !targetGroup) return nextModel;
  sourceGroup.itemIds = sourceGroup.itemIds.filter((entry) => entry !== itemId);
  targetGroup.itemIds.push(itemId);
  sourceGroup.manualOrder = true;
  targetGroup.manualOrder = true;
  item.groupKey = nextGroupKey;
  return nextModel;
};

export const reorderImportReviewItemWithinGroup = (
  model: ImportReviewModel,
  itemId: string,
  direction: 'up' | 'down',
): ImportReviewModel => {
  const nextModel = cloneImportReviewModel(model);
  const item = nextModel.items.find((entry) => entry.id === itemId);
  if (!item) return nextModel;
  const group = nextModel.groups.find((entry) => entry.key === item.groupKey);
  if (!group) return nextModel;
  const index = group.itemIds.indexOf(itemId);
  if (index < 0) return nextModel;
  const targetIndex = direction === 'up' ? index - 1 : index + 1;
  if (targetIndex < 0 || targetIndex >= group.itemIds.length) return nextModel;
  const [moved] = group.itemIds.splice(index, 1);
  group.itemIds.splice(targetIndex, 0, moved);
  group.manualOrder = true;
  return nextModel;
};

export const removeImportReviewItem = (
  model: ImportReviewModel,
  itemId: string,
): ImportReviewModel => {
  const nextModel = cloneImportReviewModel(model);
  const item = nextModel.items.find((entry) => entry.id === itemId);
  if (!item?.synthetic) return nextModel;
  nextModel.items = nextModel.items.filter((entry) => entry.id !== itemId);
  nextModel.groups.forEach((group) => {
    group.itemIds = group.itemIds.filter((entry) => entry !== itemId);
  });
  return nextModel;
};
