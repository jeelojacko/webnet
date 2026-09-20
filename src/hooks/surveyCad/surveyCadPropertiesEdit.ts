import { buildCadInverseSummary } from '../../engine/cad/cadCogo';
import {
  CAD_EDIT_LOCKED_REASON,
  checkCadEntityEditable,
  clampTransparency,
} from '../../engine/cad/cadAppearance';
import type { CadEntityPropertyEditField } from '../../engine/cad/cadProperties';
import { cadParseBearingDegrees, cadPointFromAzimuthDistance } from '../../engine/cad/cadGeometry';
import { runCadCommand, type CadHistoryState } from '../../engine/cad/cadUndoRedo';
import { commitBlockUiOp } from '../../cad-app/blocks/cadBlockUiCommands';
import type { CadEntityId, CadProject } from '../../engine/cad/cadTypes';

/** Stable rejection code for locked-source edits (Phase 18C spec §6). */
export { CAD_EDIT_LOCKED_REASON };

export type CadEditBlockReason = typeof CAD_EDIT_LOCKED_REASON | 'UNKNOWN_ENTITY';

/** Outcome of a Properties edit: applied or rejected with a stable reason. */
export interface CadPropertiesEditOutcome {
  applied: boolean;
  reason?: CadEditBlockReason | 'INVALID_VALUE';
}

/**
 * Why an edit would be rejected without dispatching: locked entity/layer
 * (LAYER_LOCKED) or missing entity. Invalid values are NOT reported here —
 * they simply fail to parse at edit time.
 */
export const describeCadEditBlock = (
  project: CadProject,
  entityId: CadEntityId,
): CadEditBlockReason | null => {
  const entity = project.entities.find((candidate) => candidate.id === entityId);
  if (!entity) return 'UNKNOWN_ENTITY';
  // Single central gate (cadAppearance): locked/hidden reasoning lives there.
  const { editable } = checkCadEntityEditable(project, entity);
  // Any block (locked or hidden source) surfaces as the stable LAYER_LOCKED
  // code on this properties path; the central gate keeps the distinction.
  return editable ? null : CAD_EDIT_LOCKED_REASON;
};

const HEX_COLOR_PATTERN = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

const parseTransparencyValue = (trimmedValue: string): number | 'bylayer' | null => {
  if (trimmedValue.toLowerCase() === 'bylayer') return 'bylayer';
  const percent = trimmedValue.endsWith('%')
    ? Number.parseFloat(trimmedValue.slice(0, -1)) / 100
    : Number.parseFloat(trimmedValue);
  if (!Number.isFinite(percent)) return null;
  // Accept 0..100 as percent for convenience; 0..1 as raw.
  const raw = !trimmedValue.endsWith('%') && percent > 1 && percent <= 100 ? percent / 100 : percent;
  if (raw < 0 || raw > 1) return null;
  return clampTransparency(raw);
};

interface EditSurveyCadPropertiesFieldOptions {
  entityId: CadEntityId;
  field: CadEntityPropertyEditField;
  history: CadHistoryState;
  updateHistory: (_updater: (_history: CadHistoryState) => CadHistoryState) => void;
  value: string;
}

/** Boolean core; the exported wrapper below attaches the stable reason. */
const runSurveyCadPropertiesEdit = ({
  entityId,
  field,
  history,
  updateHistory,
  value,
}: EditSurveyCadPropertiesFieldOptions): boolean => {
  const targetEntity = history.present.project.entities.find((entity) => entity.id === entityId);
  if (!targetEntity) return false;
  const trimmedValue = value.trim();
  if (field.kind === 'entity-name') {
    if (trimmedValue.length === 0) return false;
    updateHistory((current) =>
      runCadCommand(current, {
        key: 'EDIT_ENTITY',
        entityId,
        edit: { kind: 'entity-name', value: trimmedValue },
      }),
    );
    return true;
  }
  if (field.kind === 'point-x' || field.kind === 'point-y' || field.kind === 'point-z') {
    if (field.kind === 'point-z' && trimmedValue.length === 0) {
      updateHistory((current) =>
        runCadCommand(current, {
          key: 'EDIT_ENTITY',
          entityId,
          edit: { kind: 'point-z', value: null },
        }),
      );
      return true;
    }
    const numericValue = Number.parseFloat(trimmedValue);
    if (!Number.isFinite(numericValue)) return false;
    updateHistory((current) =>
      runCadCommand(current, {
        key: 'EDIT_ENTITY',
        entityId,
        edit:
          field.kind === 'point-x'
            ? { kind: 'point-x', value: numericValue }
            : field.kind === 'point-y'
              ? { kind: 'point-y', value: numericValue }
              : { kind: 'point-z', value: numericValue },
      }),
    );
    return true;
  }
  if (targetEntity.type === 'line' && (field.kind === 'line-length' || field.kind === 'line-azimuth')) {
    const inverse = buildCadInverseSummary(
      { x: targetEntity.fromX, y: targetEntity.fromY },
      { x: targetEntity.toX, y: targetEntity.toY },
    );
    const nextLength =
      field.kind === 'line-length' ? Number.parseFloat(trimmedValue) : inverse.distance;
    const nextAzimuth =
      field.kind === 'line-azimuth' ? cadParseBearingDegrees(trimmedValue) : inverse.azimuthDeg;
    if (!Number.isFinite(nextLength) || nextLength <= 0 || nextAzimuth == null) return false;
    const nextPoint = cadPointFromAzimuthDistance(
      { x: targetEntity.fromX, y: targetEntity.fromY },
      nextAzimuth,
      nextLength,
    );
    updateHistory((current) =>
      runCadCommand(current, {
        key: 'EDIT_ENTITY',
        entityId,
        edit: {
          kind: 'line-end',
          toX: nextPoint.x,
          toY: nextPoint.y,
        },
      }),
    );
    return true;
  }
  if (targetEntity.type === 'arc' && field.kind === 'arc-radius') {
    const numericValue = Number.parseFloat(trimmedValue);
    if (!Number.isFinite(numericValue) || numericValue <= 0) return false;
    updateHistory((current) =>
      runCadCommand(current, {
        key: 'EDIT_ENTITY',
        entityId,
        edit: { kind: 'arc-radius', value: numericValue },
      }),
    );
    return true;
  }
  if (
    targetEntity.type === 'polyline' &&
    (field.kind === 'polyline-vertex-x' ||
      field.kind === 'polyline-vertex-y' ||
      field.kind === 'polyline-segment-length' ||
      field.kind === 'polyline-segment-azimuth')
  ) {
    if (field.kind === 'polyline-vertex-x' || field.kind === 'polyline-vertex-y') {
      const vertex = targetEntity.vertices[field.vertexIndex];
      if (!vertex) return false;
      const numericValue = Number.parseFloat(trimmedValue);
      if (!Number.isFinite(numericValue)) return false;
      updateHistory((current) =>
        runCadCommand(current, {
          key: 'EDIT_ENTITY',
          entityId,
          edit: {
            kind: 'polyline-vertex',
            vertexIndex: field.vertexIndex,
            x: field.kind === 'polyline-vertex-x' ? numericValue : vertex.x,
            y: field.kind === 'polyline-vertex-y' ? numericValue : vertex.y,
          },
        }),
      );
      return true;
    }
    const startVertex = targetEntity.vertices[field.segmentIndex];
    const endVertex = targetEntity.vertices[field.segmentIndex + 1];
    if (!startVertex || !endVertex) return false;
    const inverse = buildCadInverseSummary(startVertex, endVertex);
    const nextLength =
      field.kind === 'polyline-segment-length' ? Number.parseFloat(trimmedValue) : inverse.distance;
    const nextAzimuth =
      field.kind === 'polyline-segment-azimuth' ? cadParseBearingDegrees(trimmedValue) : inverse.azimuthDeg;
    if (!Number.isFinite(nextLength) || nextLength <= 0 || nextAzimuth == null) return false;
    const nextVertex = cadPointFromAzimuthDistance(startVertex, nextAzimuth, nextLength);
    updateHistory((current) =>
      runCadCommand(current, {
        key: 'EDIT_ENTITY',
        entityId,
        edit: {
          kind: 'polyline-vertex',
          vertexIndex: field.segmentIndex + 1,
          x: nextVertex.x,
          y: nextVertex.y,
        },
      }),
    );
    return true;
  }
  if (
    targetEntity.type === 'block-reference' &&
    (field.kind === 'block-insertion-x' ||
      field.kind === 'block-insertion-y' ||
      field.kind === 'block-rotation' ||
      field.kind === 'block-scale-x' ||
      field.kind === 'block-scale-y')
  ) {
    // Phase 18N: rotation/scale/position edit through the block UI seam
    // (undoable BLOCK_EDIT); locked sources reject at the adapter gate.
    const numericValue = Number.parseFloat(trimmedValue);
    if (!Number.isFinite(numericValue)) return false;
    if (
      (field.kind === 'block-scale-x' || field.kind === 'block-scale-y') &&
      numericValue <= 0
    ) {
      return false;
    }
    const patch =
      field.kind === 'block-insertion-x'
        ? { x: numericValue }
        : field.kind === 'block-insertion-y'
          ? { y: numericValue }
          : field.kind === 'block-rotation'
            ? { rotationDeg: numericValue }
            : field.kind === 'block-scale-x'
              ? { scaleX: numericValue }
              : { scaleY: numericValue };
    let applied = false;
    updateHistory((current) => {
      const next = commitBlockUiOp(current, { kind: 'set-transform', entityId, ...patch });
      applied = next.state !== current;
      return next.state;
    });
    return applied;
  }
  if (
    field.kind === 'entity-layer' ||
    field.kind === 'entity-color' ||
    field.kind === 'entity-linetype' ||
    field.kind === 'entity-lineweight' ||
    field.kind === 'entity-transparency'
  ) {
    return editSurveyCadAppearanceField({ entityId, field, history, updateHistory, value });
  }
  return false;
};

type AppearanceField =
  | { kind: 'entity-layer' }
  | { kind: 'entity-color' }
  | { kind: 'entity-linetype' }
  | { kind: 'entity-lineweight' }
  | { kind: 'entity-transparency' };

/**
 * Phase 18C appearance edits: Layer move + ByLayer-or-explicit intent.
 * Undoable via EDIT_ENTITY; locked sources reject (false, LAYER_LOCKED
 * reason via describeCadEditBlock). No ByBlock: blockDefinitions exist as of
 * 18N, but ByBlock intent stays deferred.
 */
const editSurveyCadAppearanceField = ({
  entityId,
  field,
  history,
  updateHistory,
  value,
}: EditSurveyCadPropertiesFieldOptions & { field: AppearanceField }): boolean => {
  const project = history.present.project;
  if (describeCadEditBlock(project, entityId) != null) return false;
  const targetEntity = project.entities.find((entity) => entity.id === entityId);
  if (!targetEntity) return false;
  const trimmedValue = value.trim();
  if (field.kind === 'entity-layer') {
    const targetLayer =
      project.layers.find((layer) => layer.id === trimmedValue) ??
      project.layers.find((layer) => layer.name.toLowerCase() === trimmedValue.toLowerCase());
    if (!targetLayer || targetLayer.id === targetEntity.layerId) return false;
    const layerId = targetLayer.id;
    updateHistory((current) =>
      runCadCommand(current, { key: 'EDIT_ENTITY', entityId, edit: { kind: 'entity-layer', layerId } }),
    );
    return true;
  }
  const byLayer = trimmedValue.toLowerCase() === 'bylayer';
  if (field.kind === 'entity-color') {
    if (!byLayer && !HEX_COLOR_PATTERN.test(trimmedValue)) return false;
    const color = byLayer ? undefined : trimmedValue;
    updateHistory((current) =>
      runCadCommand(current, { key: 'EDIT_ENTITY', entityId, edit: { kind: 'entity-appearance', patch: { color } } }),
    );
    return true;
  }
  if (field.kind === 'entity-linetype') {
    const lineType = byLayer
      ? undefined
      : (project.styleLibrary.lineTypes.find(
          (entry) => entry.id === trimmedValue || entry.name.toLowerCase() === trimmedValue.toLowerCase(),
        )?.id ?? null);
    if (lineType === null) return false;
    updateHistory((current) =>
      runCadCommand(current, {
        key: 'EDIT_ENTITY',
        entityId,
        edit: { kind: 'entity-appearance', patch: { lineTypeId: lineType } },
      }),
    );
    return true;
  }
  if (field.kind === 'entity-lineweight') {
    const lineweightMm = byLayer || trimmedValue.toLowerCase() === 'default'
      ? undefined
      : Number.parseFloat(trimmedValue);
    if (lineweightMm !== undefined && (!Number.isFinite(lineweightMm) || lineweightMm < 0)) return false;
    updateHistory((current) =>
      runCadCommand(current, {
        key: 'EDIT_ENTITY',
        entityId,
        edit: { kind: 'entity-appearance', patch: { lineweightMm } },
      }),
    );
    return true;
  }
  const transparency = parseTransparencyValue(trimmedValue);
  if (transparency === null) return false;
  const transparencyValue = transparency === 'bylayer' ? undefined : transparency;
  updateHistory((current) =>
    runCadCommand(current, {
      key: 'EDIT_ENTITY',
      entityId,
      edit: { kind: 'entity-appearance', patch: { transparency: transparencyValue } },
    }),
  );
  return true;
};

/**
 * Phase 18C Properties edit entry point: undoable on success, rejected
 * with a stable reason (LAYER_LOCKED for locked sources) otherwise.
 */
export const editSurveyCadPropertiesField = (
  options: EditSurveyCadPropertiesFieldOptions,
): CadPropertiesEditOutcome => {
  if (runSurveyCadPropertiesEdit(options)) return { applied: true };
  // Locked sources gate appearance/layer edits only; geometry failures are
  // value errors (geometry lock gating stays on the engine command path).
  if (
    options.field.kind === 'entity-layer' ||
    options.field.kind === 'entity-color' ||
    options.field.kind === 'entity-linetype' ||
    options.field.kind === 'entity-lineweight' ||
    options.field.kind === 'entity-transparency'
  ) {
    const block = describeCadEditBlock(options.history.present.project, options.entityId);
    return { applied: false, reason: block ?? 'INVALID_VALUE' };
  }
  return { applied: false, reason: 'INVALID_VALUE' };
};
