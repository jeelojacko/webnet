import { buildCadInverseSummary } from '../../engine/cad/cadCogo';
import type { CadEntityPropertyEditField } from '../../engine/cad/cadProperties';
import { cadParseBearingDegrees, cadPointFromAzimuthDistance } from '../../engine/cad/cadGeometry';
import { runCadCommand, type CadHistoryState } from '../../engine/cad/cadUndoRedo';
import type { CadEntityId } from '../../engine/cad/cadTypes';

interface EditSurveyCadPropertiesFieldOptions {
  entityId: CadEntityId;
  field: CadEntityPropertyEditField;
  history: CadHistoryState;
  updateHistory: (_updater: (_history: CadHistoryState) => CadHistoryState) => void;
  value: string;
}

export const editSurveyCadPropertiesField = ({
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
  return false;
};
