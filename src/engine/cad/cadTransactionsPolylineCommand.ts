import { createStableRuntimeId } from '../id';
import { createCadSelectionState } from './cadSelection';
import { resolveCurrentCadLayerId } from './cadLayers';
import { nextEntityName } from './cadTransactionsEntityFactories';
import { sanitizeCadPolylinePath } from './cadPolylineGeometry';
import {
  appendCadProjectEntities,
} from './cadProjectState';
import type { CadCommandDefinition } from './cadTransactions.types';
import type { CadPolylineEntity } from './cadTypes';

export const polylineCommand: CadCommandDefinition<{
  key: 'PLINE';
  vertices: { x: number; y: number; label: string }[];
  closed?: boolean;
  segmentGeometry?: CadPolylineEntity['segmentGeometry'];
  segmentWidths?: CadPolylineEntity['segmentWidths'];
}> = {
  key: 'PLINE',
  execute: (snapshot, command) => {
    const closed = command.closed === true;
    // C2: ONE canonical path normalizer — validates/canonicalizes the
    // optional bulge + width metadata before any project mutation. Malformed
    // input returns null (zero project/history mutation, one undo entry max).
    const normalized = sanitizeCadPolylinePath(
      command.vertices,
      closed,
      command.segmentGeometry,
      command.segmentWidths,
    );
    if (!normalized.ok) return null;
    const { vertices, vertexLabels } = normalized;
    const polylineName = nextEntityName(snapshot.project, 'PL');
    const polylineEntity: CadPolylineEntity = {
      id: createStableRuntimeId('cad-polyline'),
      type: 'polyline',
      layerId: resolveCurrentCadLayerId(snapshot.project),
      visible: true,
      locked: false,
      vertices,
      vertexLabels,
      closed,
      ...(normalized.segmentGeometry != null
        ? { segmentGeometry: normalized.segmentGeometry }
        : {}),
      ...(normalized.segmentWidths != null ? { segmentWidths: normalized.segmentWidths } : {}),
      metadata: {
        createdBy: 'PLINE',
        entityName: polylineName,
        manual: true,
      },
    };
    const nextProject = appendCadProjectEntities(snapshot.project, [polylineEntity]);
    return {
      nextSnapshot: {
        project: nextProject,
        selection: createCadSelectionState(nextProject, [polylineEntity.id]),
      },
      commandState: {
        key: 'PLINE',
        phase: 'committed',
        prompt: closed
          ? `PLINE closed with ${vertices.length} vertices.`
          : `PLINE committed with ${vertices.length} vertices.`,
      },
      transactionLabel: `PLINE (${polylineName})`,
      addedEntityIds: [polylineEntity.id],
      removedEntityIds: [],
    };
  },
};
