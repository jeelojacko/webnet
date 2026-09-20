// Phase 18O — annotation UI op applier (pure project transforms).
//
// Every `CadAnnotationUiOp` EXCEPT the engine-routed creates/scale/reattach
// (CREATE_*, SET_ANNOTATION_SCALE, REATTACH_ANNOTATION, text overrides) is
// applied here as a validated project transform: style-table CRUD for all
// five tables plus annotation entity field edits. Rejections carry stable
// reason strings the managers surface verbatim (`LAYER_LOCKED`,
// `STYLE_IN_USE`, ...). The caller commits the returned project as one
// undoable history entry.

import type { CadAnnotationUiOp } from '../../cad-app/annotation/cadAnnotationUiTypes';
import { checkCadEntityEditable } from '../../engine/cad/cadAppearance';
import { validateCadProfessionalTextStyle } from '../../engine/cad/annotation/cadAnnotationValidation';
import { sanitizeCadAnnotationSettings } from '../../engine/cad/annotation/cadAnnotationSettings';
import { createStableRuntimeId } from '../../engine/id';
import type { CadCommand } from '../../engine/cad/cadTransactions.types';
import type {
  CadBearingDistanceLabelEntity,
  CadBearingLabelStyle,
  CadCurveLabelEntity,
  CadCurveLabelStyle,
  CadDimensionEntity,
  CadDimensionStyle,
  CadEntity,
  CadLeaderEntity,
  CadLeaderStyle,
  CadMTextAttachment,
  CadMTextEntity,
  CadProject,
  CadTextStyle,
} from '../../engine/cad/cadTypes';
import { buildAnnotationReferenceCounts } from './surveyCadAnnotationSnapshot';

export interface AnnotationUiOpOutcome {
  project: CadProject;
  applied: boolean;
  reason?: string;
}

const ok = (project: CadProject): AnnotationUiOpOutcome => ({ project, applied: true });
const fail = (project: CadProject, reason: string): AnnotationUiOpOutcome => ({
  project,
  applied: false,
  reason,
});

type NamedStyle = { id: string; name: string };

const uniqueName = (rows: readonly NamedStyle[], base: string, exceptId?: string): string => {
  const taken = new Set(
    rows.filter((row) => row.id !== exceptId).map((row) => row.name.trim().toLowerCase()),
  );
  const clean = base.trim().length > 0 ? base.trim() : 'Style';
  if (!taken.has(clean.toLowerCase())) return clean;
  let index = 2;
  while (taken.has(`${clean} ${index}`.toLowerCase())) index += 1;
  return `${clean} ${index}`;
};

const findStyle = <T extends NamedStyle>(rows: readonly T[], styleId: string): T | null =>
  rows.find((row) => row.id === styleId) ?? null;

/** Guarded delete: unknown → last-remaining → referenced. */
const deleteStyle = <T extends NamedStyle>(
  project: CadProject,
  rows: readonly T[],
  table: 'textStyles' | 'dimensionStyles' | 'leaderStyles' | 'bearingLabelStyles' | 'curveLabelStyles',
  styleId: string,
  setRows: (_project: CadProject, _rows: T[]) => CadProject,
): AnnotationUiOpOutcome => {
  const target = findStyle(rows, styleId);
  if (!target) return fail(project, 'STYLE_NOT_FOUND');
  if (rows.length <= 1) return fail(project, 'LAST_STYLE');
  if ((buildAnnotationReferenceCounts(project)[table][styleId] ?? 0) > 0) {
    return fail(project, 'STYLE_IN_USE');
  }
  return ok(setRows(project, rows.filter((row) => row.id !== styleId)));
};

const renameStyle = <T extends NamedStyle>(
  project: CadProject,
  rows: readonly T[],
  styleId: string,
  name: string,
  setRows: (_project: CadProject, _rows: T[]) => CadProject,
): AnnotationUiOpOutcome => {
  const target = findStyle(rows, styleId);
  if (!target) return fail(project, 'STYLE_NOT_FOUND');
  const clean = name.trim();
  if (clean.length === 0) return fail(project, 'EMPTY_NAME');
  const clash = rows.some(
    (row) => row.id !== styleId && row.name.trim().toLowerCase() === clean.toLowerCase(),
  );
  if (clash) return fail(project, 'DUPLICATE_NAME');
  return ok(setRows(project, rows.map((row) => (row.id === styleId ? { ...row, name: clean } : row))));
};

const textTable = (project: CadProject): CadTextStyle[] =>
  (project.styleLibrary?.textStyles ?? []).filter(
    (style) => style.heightMode != null && style.heightMode !== 'legacy-screen',
  );

const setTextTable = (project: CadProject, rows: CadTextStyle[]): CadProject => {
  const legacy = (project.styleLibrary?.textStyles ?? []).filter(
    (style) => style.heightMode == null || style.heightMode === 'legacy-screen',
  );
  return { ...project, styleLibrary: { ...project.styleLibrary, textStyles: [...legacy, ...rows] } };
};

const findTextStyle = (project: CadProject, styleId: string): CadTextStyle | null =>
  findStyle(textTable(project), styleId);

const editableEntity = <T extends CadEntity>(
  project: CadProject,
  entityId: string,
  type: T['type'],
): { entity: T } | { reason: string } => {
  const entity = project.entities.find((candidate) => candidate.id === entityId);
  if (!entity || entity.type !== type) return { reason: 'ENTITY_NOT_FOUND' };
  const check = checkCadEntityEditable(project, entity);
  if (!check.editable) return { reason: check.reason ?? 'LAYER_LOCKED' };
  return { entity: entity as T };
};

const checkLayerMove = (project: CadProject, layerId: string): string | null => {
  const layer = project.layers.find((candidate) => candidate.id === layerId);
  if (!layer) return 'LAYER_NOT_FOUND';
  if (layer.locked) return 'LAYER_LOCKED';
  return null;
};

const replaceEntity = (project: CadProject, next: CadEntity): CadProject => ({
  ...project,
  entities: project.entities.map((entity) => (entity.id === next.id ? next : entity)),
});

const ATTACHMENTS: CadMTextAttachment[] = [
  'top-left', 'top-center', 'top-right',
  'middle-left', 'middle-center', 'middle-right',
  'bottom-left', 'bottom-center', 'bottom-right',
];

// ---------------------------------------------------------------------------
// Style-table ops (per table: create / duplicate / rename / delete / update)
// ---------------------------------------------------------------------------

const textStyleOp = (
  project: CadProject,
  op: Extract<CadAnnotationUiOp, { kind: `text-style-${string}` }>,
): AnnotationUiOpOutcome => {
  const rows = textTable(project);
  switch (op.kind) {
    case 'text-style-create': {
      const clean = op.name.trim();
      if (clean.length === 0) return fail(project, 'EMPTY_NAME');
      const style: CadTextStyle = {
        id: createStableRuntimeId('cad-text-style'),
        name: uniqueName(rows, clean),
        fontFamily: 'Arial',
        fontSize: 2.5,
        heightMode: 'model',
        modelHeight: 2.5,
        widthFactor: 1,
        lineSpacingFactor: 1,
      };
      return ok(setTextTable(project, [...rows, style]));
    }
    case 'text-style-duplicate': {
      const source = findStyle(rows, op.styleId);
      if (!source) return fail(project, 'STYLE_NOT_FOUND');
      // ponytail: structuredClone-free manual copy (style is a flat record).
      const copy: CadTextStyle = {
        ...source,
        id: createStableRuntimeId('cad-text-style'),
        name: uniqueName(rows, `${source.name} copy`),
      };
      return ok(setTextTable(project, [...rows, copy]));
    }
    case 'text-style-rename':
      return renameStyle(project, rows, op.styleId, op.name, setTextTable);
    case 'text-style-delete':
      return deleteStyle(project, rows, 'textStyles', op.styleId, setTextTable);
    case 'text-style-update': {
      const target = findStyle(rows, op.styleId);
      if (!target) return fail(project, 'STYLE_NOT_FOUND');
      const merged = { ...target, ...op.patch };
      const issues = validateCadProfessionalTextStyle(merged);
      if (!issues.ok) return fail(project, issues.errors[0] ?? 'INVALID_STYLE');
      return ok(setTextTable(project, rows.map((row) => (row.id === op.styleId ? merged : row))));
    }
  }
};

const dimensionStyleOp = (
  project: CadProject,
  op: Extract<CadAnnotationUiOp, { kind: `dimension-style-${string}` }>,
): AnnotationUiOpOutcome => {
  const rows = project.dimensionStyles ?? [];
  const setRows = (next: CadProject, nextRows: CadDimensionStyle[]): CadProject => ({
    ...next,
    dimensionStyles: nextRows,
  });
  switch (op.kind) {
    case 'dimension-style-create': {
      const clean = op.name.trim();
      if (clean.length === 0) return fail(project, 'EMPTY_NAME');
      const first = rows[0];
      const style: CadDimensionStyle = {
        id: createStableRuntimeId('cad-dim-style'),
        name: uniqueName(rows, clean),
        textStyleId: first?.textStyleId ?? textTable(project)[0]?.id ?? 'label-default',
        arrowBlockDefinitionId: first?.arrowBlockDefinitionId ?? 'webnet-annotation-arrowhead-closed-arrow',
        arrowSize: first?.arrowSize ?? 2.5,
        textGap: first?.textGap ?? 1,
        extensionOffset: first?.extensionOffset ?? 1,
        extensionOvershoot: first?.extensionOvershoot ?? 1,
        decimalPrecision: first?.decimalPrecision ?? 3,
      };
      return ok(setRows(project, [...rows, style]));
    }
    case 'dimension-style-duplicate': {
      const source = findStyle(rows, op.styleId);
      if (!source) return fail(project, 'STYLE_NOT_FOUND');
      return ok(setRows(project, [
        ...rows,
        { ...source, id: createStableRuntimeId('cad-dim-style'), name: uniqueName(rows, `${source.name} copy`) },
      ]));
    }
    case 'dimension-style-rename':
      return renameStyle(project, rows, op.styleId, op.name, setRows);
    case 'dimension-style-delete':
      return deleteStyle(project, rows, 'dimensionStyles', op.styleId, setRows);
    case 'dimension-style-update': {
      const target = findStyle(rows, op.styleId);
      if (!target) return fail(project, 'STYLE_NOT_FOUND');
      if (op.patch.textStyleId != null && !findTextStyle(project, op.patch.textStyleId)) {
        return fail(project, 'STYLE_NOT_FOUND');
      }
      return ok(setRows(project, rows.map((row) => (row.id === op.styleId ? { ...row, ...op.patch } : row))));
    }
  }
};

const leaderStyleOp = (
  project: CadProject,
  op: Extract<CadAnnotationUiOp, { kind: `leader-style-${string}` }>,
): AnnotationUiOpOutcome => {
  const rows = project.leaderStyles ?? [];
  const setRows = (next: CadProject, nextRows: CadLeaderStyle[]): CadProject => ({
    ...next,
    leaderStyles: nextRows,
  });
  switch (op.kind) {
    case 'leader-style-create': {
      const clean = op.name.trim();
      if (clean.length === 0) return fail(project, 'EMPTY_NAME');
      const first = rows[0];
      const style: CadLeaderStyle = {
        id: createStableRuntimeId('cad-leader-style'),
        name: uniqueName(rows, clean),
        textStyleId: first?.textStyleId ?? textTable(project)[0]?.id ?? 'label-default',
        arrowBlockDefinitionId: first?.arrowBlockDefinitionId ?? 'webnet-annotation-arrowhead-closed-arrow',
        arrowSize: first?.arrowSize ?? 2.5,
        landingLength: first?.landingLength ?? 5,
        textGap: first?.textGap ?? 1,
      };
      return ok(setRows(project, [...rows, style]));
    }
    case 'leader-style-duplicate': {
      const source = findStyle(rows, op.styleId);
      if (!source) return fail(project, 'STYLE_NOT_FOUND');
      return ok(setRows(project, [
        ...rows,
        { ...source, id: createStableRuntimeId('cad-leader-style'), name: uniqueName(rows, `${source.name} copy`) },
      ]));
    }
    case 'leader-style-rename':
      return renameStyle(project, rows, op.styleId, op.name, setRows);
    case 'leader-style-delete':
      return deleteStyle(project, rows, 'leaderStyles', op.styleId, setRows);
    case 'leader-style-update': {
      const target = findStyle(rows, op.styleId);
      if (!target) return fail(project, 'STYLE_NOT_FOUND');
      if (op.patch.textStyleId != null && !findTextStyle(project, op.patch.textStyleId)) {
        return fail(project, 'STYLE_NOT_FOUND');
      }
      if (op.patch.landingLength != null && !(op.patch.landingLength > 0)) {
        return fail(project, 'INVALID_STYLE');
      }
      return ok(setRows(project, rows.map((row) => (row.id === op.styleId ? { ...row, ...op.patch } : row))));
    }
  }
};

const bearingLabelStyleOp = (
  project: CadProject,
  op: Extract<CadAnnotationUiOp, { kind: `bearing-label-style-${string}` }>,
): AnnotationUiOpOutcome => {
  const rows = project.bearingLabelStyles ?? [];
  const setRows = (next: CadProject, nextRows: CadBearingLabelStyle[]): CadProject => ({
    ...next,
    bearingLabelStyles: nextRows,
  });
  switch (op.kind) {
    case 'bearing-label-style-create': {
      const clean = op.name.trim();
      if (clean.length === 0) return fail(project, 'EMPTY_NAME');
      const first = rows[0];
      const style: CadBearingLabelStyle = {
        id: createStableRuntimeId('cad-bearing-style'),
        name: uniqueName(rows, clean),
        textStyleId: first?.textStyleId ?? textTable(project)[0]?.id ?? 'label-default',
        content: first?.content ?? 'bearing-distance',
        separator: first?.separator ?? 'newline',
        offset: { x: 0, y: 0 },
        decimalPrecision: first?.decimalPrecision ?? 3,
      };
      return ok(setRows(project, [...rows, style]));
    }
    case 'bearing-label-style-duplicate': {
      const source = findStyle(rows, op.styleId);
      if (!source) return fail(project, 'STYLE_NOT_FOUND');
      return ok(setRows(project, [
        ...rows,
        {
          ...source,
          id: createStableRuntimeId('cad-bearing-style'),
          name: uniqueName(rows, `${source.name} copy`),
          offset: { ...source.offset },
        },
      ]));
    }
    case 'bearing-label-style-rename':
      return renameStyle(project, rows, op.styleId, op.name, setRows);
    case 'bearing-label-style-delete':
      return deleteStyle(project, rows, 'bearingLabelStyles', op.styleId, setRows);
    case 'bearing-label-style-update': {
      const target = findStyle(rows, op.styleId);
      if (!target) return fail(project, 'STYLE_NOT_FOUND');
      if (op.patch.textStyleId != null && !findTextStyle(project, op.patch.textStyleId)) {
        return fail(project, 'STYLE_NOT_FOUND');
      }
      return ok(setRows(project, rows.map((row) => (row.id === op.styleId ? { ...row, ...op.patch } : row))));
    }
  }
};

const curveLabelStyleOp = (
  project: CadProject,
  op: Extract<CadAnnotationUiOp, { kind: `curve-label-style-${string}` }>,
): AnnotationUiOpOutcome => {
  const rows = project.curveLabelStyles ?? [];
  const setRows = (next: CadProject, nextRows: CadCurveLabelStyle[]): CadProject => ({
    ...next,
    curveLabelStyles: nextRows,
  });
  switch (op.kind) {
    case 'curve-label-style-create': {
      const clean = op.name.trim();
      if (clean.length === 0) return fail(project, 'EMPTY_NAME');
      const first = rows[0];
      const style: CadCurveLabelStyle = {
        id: createStableRuntimeId('cad-curve-style'),
        name: uniqueName(rows, clean),
        textStyleId: first?.textStyleId ?? textTable(project)[0]?.id ?? 'label-default',
        fields: [...(first?.fields ?? ['radius', 'delta', 'length'])],
        offset: { x: 0, y: 0 },
        decimalPrecision: first?.decimalPrecision ?? 3,
      };
      return ok(setRows(project, [...rows, style]));
    }
    case 'curve-label-style-duplicate': {
      const source = findStyle(rows, op.styleId);
      if (!source) return fail(project, 'STYLE_NOT_FOUND');
      return ok(setRows(project, [
        ...rows,
        {
          ...source,
          id: createStableRuntimeId('cad-curve-style'),
          name: uniqueName(rows, `${source.name} copy`),
          fields: [...source.fields],
          offset: { ...source.offset },
        },
      ]));
    }
    case 'curve-label-style-rename':
      return renameStyle(project, rows, op.styleId, op.name, setRows);
    case 'curve-label-style-delete':
      return deleteStyle(project, rows, 'curveLabelStyles', op.styleId, setRows);
    case 'curve-label-style-update': {
      const target = findStyle(rows, op.styleId);
      if (!target) return fail(project, 'STYLE_NOT_FOUND');
      if (op.patch.textStyleId != null && !findTextStyle(project, op.patch.textStyleId)) {
        return fail(project, 'STYLE_NOT_FOUND');
      }
      if (op.patch.fields != null && op.patch.fields.length === 0) return fail(project, 'INVALID_STYLE');
      return ok(setRows(project, rows.map((row) => (row.id === op.styleId ? { ...row, ...op.patch } : row))));
    }
  }
};

// ---------------------------------------------------------------------------
// Entity field edits (Properties palette)
// ---------------------------------------------------------------------------

const mtextUpdate = (
  project: CadProject,
  op: Extract<CadAnnotationUiOp, { kind: 'mtext-update' }>,
): AnnotationUiOpOutcome => {
  const found = editableEntity<CadMTextEntity>(project, op.entityId, 'mtext');
  if ('reason' in found) return fail(project, found.reason);
  const { patch } = op;
  if (patch.text != null && patch.text.trim().length === 0) return fail(project, 'EMPTY_TEXT');
  if (patch.rotationDeg != null && !Number.isFinite(patch.rotationDeg)) return fail(project, 'INVALID_VALUE');
  if (patch.attachment != null && !ATTACHMENTS.includes(patch.attachment)) return fail(project, 'INVALID_VALUE');
  if (patch.textStyleId != null && !findTextStyle(project, patch.textStyleId)) {
    return fail(project, 'STYLE_NOT_FOUND');
  }
  if ((patch.x != null && !Number.isFinite(patch.x)) || (patch.y != null && !Number.isFinite(patch.y))) {
    return fail(project, 'INVALID_VALUE');
  }
  if (patch.layerId != null && patch.layerId !== found.entity.layerId) {
    const blocked = checkLayerMove(project, patch.layerId);
    if (blocked) return fail(project, blocked);
  }
  return ok(replaceEntity(project, { ...found.entity, ...patch }));
};

const leaderUpdate = (
  project: CadProject,
  op: Extract<CadAnnotationUiOp, { kind: 'leader-update' }>,
): AnnotationUiOpOutcome => {
  const found = editableEntity<CadLeaderEntity>(project, op.entityId, 'leader');
  if ('reason' in found) return fail(project, found.reason);
  const { patch } = op;
  if (patch.leaderStyleId != null && !findStyle(project.leaderStyles ?? [], patch.leaderStyleId)) {
    return fail(project, 'STYLE_NOT_FOUND');
  }
  if (patch.textStyleId !== undefined && patch.textStyleId !== null && !findTextStyle(project, patch.textStyleId)) {
    return fail(project, 'STYLE_NOT_FOUND');
  }
  if (patch.textAttachment != null && !ATTACHMENTS.includes(patch.textAttachment)) {
    return fail(project, 'INVALID_VALUE');
  }
  if (patch.layerId != null && patch.layerId !== found.entity.layerId) {
    const blocked = checkLayerMove(project, patch.layerId);
    if (blocked) return fail(project, blocked);
  }
  let next: CadLeaderEntity = {
    ...found.entity,
    ...(patch.text !== undefined ? { text: patch.text } : {}),
    ...(patch.leaderStyleId !== undefined ? { leaderStyleId: patch.leaderStyleId } : {}),
    ...(patch.layerId !== undefined ? { layerId: patch.layerId } : {}),
  };
  if (patch.textStyleId !== undefined) {
    if (patch.textStyleId === null) delete next.textStyleId;
    else next.textStyleId = patch.textStyleId;
  }
  if (patch.textAttachment !== undefined) {
    if (patch.textAttachment === null) delete next.textAttachment;
    else next.textAttachment = patch.textAttachment;
  }
  // Landing length rescales the last (landing) segment along its direction.
  if (patch.landingLength !== undefined) {
    if (!(patch.landingLength > 0) || !Number.isFinite(patch.landingLength)) {
      return fail(project, 'INVALID_VALUE');
    }
    const vertices = next.vertices;
    if (vertices.length < 2) return fail(project, 'INVALID_VALUE');
    const anchor = vertices[vertices.length - 2]!;
    const tip = vertices[vertices.length - 1]!;
    const dx = tip.x - anchor.x;
    const dy = tip.y - anchor.y;
    const length = Math.hypot(dx, dy);
    if (length <= 1e-12) return fail(project, 'INVALID_VALUE');
    next = {
      ...next,
      vertices: [
        ...vertices.slice(0, -1),
        { x: anchor.x + (dx / length) * patch.landingLength, y: anchor.y + (dy / length) * patch.landingLength },
      ],
    };
  }
  return ok(replaceEntity(project, next));
};

const dimensionUpdate = (
  project: CadProject,
  op: Extract<CadAnnotationUiOp, { kind: 'dimension-update' }>,
): AnnotationUiOpOutcome => {
  const found = editableEntity<CadDimensionEntity>(project, op.entityId, 'dimension');
  if ('reason' in found) return fail(project, found.reason);
  const { patch } = op;
  if (patch.dimensionStyleId != null && !findStyle(project.dimensionStyles ?? [], patch.dimensionStyleId)) {
    return fail(project, 'STYLE_NOT_FOUND');
  }
  if (patch.layerId != null && patch.layerId !== found.entity.layerId) {
    const blocked = checkLayerMove(project, patch.layerId);
    if (blocked) return fail(project, blocked);
  }
  const next: CadDimensionEntity = { ...found.entity };
  if (patch.dimensionStyleId !== undefined) next.dimensionStyleId = patch.dimensionStyleId;
  if (patch.layerId !== undefined) next.layerId = patch.layerId;
  if (patch.textOverride !== undefined) {
    if (patch.textOverride === null) delete next.textOverride;
    else next.textOverride = patch.textOverride;
  }
  if (patch.textPoint !== undefined) {
    if (patch.textPoint === null) {
      delete next.textPoint;
    } else {
      if (!Number.isFinite(patch.textPoint.x) || !Number.isFinite(patch.textPoint.y)) {
        return fail(project, 'INVALID_VALUE');
      }
      next.textPoint = { x: patch.textPoint.x, y: patch.textPoint.y };
    }
  }
  return ok(replaceEntity(project, next));
};

const surveyLabelUpdate = (
  project: CadProject,
  op: Extract<CadAnnotationUiOp, { kind: 'survey-label-update' }>,
): AnnotationUiOpOutcome => {
  const bearing = editableEntity<CadBearingDistanceLabelEntity>(project, op.entityId, 'bearing-label');
  const curve =
    'reason' in bearing ? editableEntity<CadCurveLabelEntity>(project, op.entityId, 'curve-label') : null;
  const found = 'reason' in bearing ? curve : bearing;
  if (!found || 'reason' in found) return fail(project, found?.reason ?? 'ENTITY_NOT_FOUND');
  const { patch } = op;
  if (patch.labelStyleId != null) {
    const table: readonly NamedStyle[] =
      found.entity.type === 'bearing-label'
        ? (project.bearingLabelStyles ?? [])
        : (project.curveLabelStyles ?? []);
    if (!findStyle(table, patch.labelStyleId)) return fail(project, 'STYLE_NOT_FOUND');
  }
  if (patch.layerId != null && patch.layerId !== found.entity.layerId) {
    const blocked = checkLayerMove(project, patch.layerId);
    if (blocked) return fail(project, blocked);
  }
  if (patch.offset != null && (!Number.isFinite(patch.offset.x) || !Number.isFinite(patch.offset.y))) {
    return fail(project, 'INVALID_VALUE');
  }
  const next = { ...found.entity };
  if (patch.labelStyleId !== undefined) next.labelStyleId = patch.labelStyleId;
  if (patch.layerId !== undefined) next.layerId = patch.layerId;
  if (patch.offset !== undefined) next.offset = { ...patch.offset };
  if (patch.manualTextOverride !== undefined) {
    if (patch.manualTextOverride === null) delete next.manualTextOverride;
    else next.manualTextOverride = patch.manualTextOverride;
  }
  return ok(replaceEntity(project, next));
};

/**
 * Leader anchor command for reattach (re-assert the binding) or
 * convert-fixed (freeze at the resolved point). Engine-routed: the caller
 * dispatches the returned command through runCadCommand.
 */
export const buildLeaderAnchorCommand = (
  project: CadProject,
  entityId: string,
  mode: 'reattach' | 'fixed',
): { command: CadCommand } | { reason: string } => {
  const found = editableEntity<CadLeaderEntity>(project, entityId, 'leader');
  if ('reason' in found) return { reason: found.reason };
  if (found.entity.arrowAnchor.kind === 'fixed') return { reason: 'ANCHOR_FIXED' };
  return {
    command:
      mode === 'reattach'
        ? { key: 'REATTACH_ANNOTATION', entityId, slot: 'leader-arrow', anchor: found.entity.arrowAnchor }
        : { key: 'REATTACH_ANNOTATION', entityId, slot: 'leader-arrow' },
  };
};

/**
 * Apply one UI op as a pure project transform. Engine-routed kinds
 * (creates, annotation-scale, leader-reattach/convert, text overrides) are
 * NOT handled here — the caller dispatches those through runCadCommand.
 * Returns the outcome with a stable rejection reason when not applied.
 */
export const applyCadAnnotationUiOp = (
  project: CadProject,
  op: CadAnnotationUiOp,
): AnnotationUiOpOutcome => {
  switch (op.kind) {
    case 'annotation-scale': {
      const settings = sanitizeCadAnnotationSettings({ scaleDenominator: op.scaleDenominator });
      if (settings.scaleDenominator === project.annotationSettings?.scaleDenominator) {
        return fail(project, 'UNCHANGED');
      }
      return ok({ ...project, annotationSettings: settings });
    }
    case 'text-style-create':
    case 'text-style-duplicate':
    case 'text-style-rename':
    case 'text-style-delete':
    case 'text-style-update':
      return textStyleOp(project, op);
    case 'dimension-style-create':
    case 'dimension-style-duplicate':
    case 'dimension-style-rename':
    case 'dimension-style-delete':
    case 'dimension-style-update':
      return dimensionStyleOp(project, op);
    case 'leader-style-create':
    case 'leader-style-duplicate':
    case 'leader-style-rename':
    case 'leader-style-delete':
    case 'leader-style-update':
      return leaderStyleOp(project, op);
    case 'bearing-label-style-create':
    case 'bearing-label-style-duplicate':
    case 'bearing-label-style-rename':
    case 'bearing-label-style-delete':
    case 'bearing-label-style-update':
      return bearingLabelStyleOp(project, op);
    case 'curve-label-style-create':
    case 'curve-label-style-duplicate':
    case 'curve-label-style-rename':
    case 'curve-label-style-delete':
    case 'curve-label-style-update':
      return curveLabelStyleOp(project, op);
    case 'mtext-update':
      return mtextUpdate(project, op);
    case 'leader-update':
      return leaderUpdate(project, op);
    case 'dimension-update':
      return dimensionUpdate(project, op);
    case 'survey-label-update':
      return surveyLabelUpdate(project, op);
    case 'leader-reattach':
    case 'leader-convert-fixed':
      // Engine-routed (REATTACH_ANNOTATION); the hook dispatches these.
      return fail(project, 'USE_ENGINE_COMMAND');
  }
};
