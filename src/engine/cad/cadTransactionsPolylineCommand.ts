import { createStableRuntimeId } from '../id';
import { createCadSelectionState } from './cadSelection';
import { resolveCurrentCadLayerId } from './cadLayers';
import { nextEntityName } from './cadTransactionsEntityFactories';
import { countDistinctPlinePositions, sanitizeCadPolylineVertices } from './cadPolylineGeometry';
import {
  appendCadProjectEntities,
} from './cadProjectState';
import type { CadCommandDefinition } from './cadTransactions.types';
import type { CadPolylineEntity } from './cadTypes';

export const polylineCommand: CadCommandDefinition<{
  key: 'PLINE';
  vertices: { x: number; y: number; label: string }[];
  closed?: boolean;
}> = {
  key: 'PLINE',
  execute: (snapshot, command) => {
    const closed = command.closed === true;
    const vertices = sanitizeCadPolylineVertices(command.vertices, closed);
    if (vertices.length < (closed ? 3 : 2)) return null;
    if (closed && countDistinctPlinePositions(vertices) < 3) return null;
    const polylineName = nextEntityName(snapshot.project, 'PL');
    const polylineEntity: CadPolylineEntity = {
      id: createStableRuntimeId('cad-polyline'),
      type: 'polyline',
      layerId: resolveCurrentCadLayerId(snapshot.project),
      visible: true,
      locked: false,
      vertices: vertices.map((vertex) => ({ x: vertex.x, y: vertex.y })),
      vertexLabels: vertices.map((vertex) => vertex.label),
      closed,
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
