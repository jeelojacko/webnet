import { createStableRuntimeId } from '../id';
import {
  buildRectangleVertices,
  buildRegularPolygonVertices,
  type RegularPolygonMode,
} from './cadGeometryShapeBuilders';
import { resolveCurrentCadLayerId } from './cadLayers';
import { appendCadProjectEntities } from './cadProjectState';
import { createCadSelectionState } from './cadSelection';
import { nextEntityName } from './cadTransactionsEntityFactories';
import type { CadCommandDefinition } from './cadTransactions.types';
import type { CadPolygonEntity } from './cadTypes';

type XyPoint = { x: number; y: number; label: string };

export type ShapeRectangleCommand = {
  key: 'RECTANGLE';
  firstCorner: XyPoint;
  oppositeCorner: XyPoint;
};

export type ShapePolygonCommand = {
  key: 'POLYGON';
  center: XyPoint;
  through: XyPoint;
  sides: number;
  mode: RegularPolygonMode;
};

const toClosedPolygonEntity = (
  snapshot: Parameters<CadCommandDefinition<ShapeRectangleCommand>['execute']>[0],
  vertices: { x: number; y: number }[],
  createdBy: 'RECTANGLE' | 'POLYGON',
  prefix: 'RECT' | 'POLY',
): CadPolygonEntity => ({
  id: createStableRuntimeId('cad-polygon'),
  type: 'polygon',
  layerId: resolveCurrentCadLayerId(snapshot.project),
  visible: true,
  locked: false,
  // No dup closure point: polygon rings are implicitly closed.
  vertices: vertices.map((vertex) => ({ x: vertex.x, y: vertex.y })),
  vertexLabels: vertices.map(() => ''),
  metadata: {
    createdBy,
    entityName: nextEntityName(snapshot.project, prefix),
    manual: true,
  },
});

export const rectangleCommand: CadCommandDefinition<ShapeRectangleCommand> = {
  key: 'RECTANGLE',
  execute: (snapshot, command) => {
    const vertices = buildRectangleVertices(command.firstCorner, command.oppositeCorner);
    if (!vertices) return null;
    const entity = toClosedPolygonEntity(snapshot, vertices, 'RECTANGLE', 'RECT');
    const entityName = entity.metadata?.entityName as string;
    const nextProject = appendCadProjectEntities(snapshot.project, [entity]);
    return {
      nextSnapshot: {
        project: nextProject,
        selection: createCadSelectionState(nextProject, [entity.id]),
      },
      commandState: {
        key: 'RECTANGLE',
        phase: 'committed',
        prompt: `RECTANGLE committed with 4 vertices.`,
      },
      transactionLabel: `RECTANGLE (${entityName})`,
      addedEntityIds: [entity.id],
      removedEntityIds: [],
    };
  },
};

export const polygonCommand: CadCommandDefinition<ShapePolygonCommand> = {
  key: 'POLYGON',
  execute: (snapshot, command) => {
    const vertices = buildRegularPolygonVertices(
      command.center,
      command.through,
      command.sides,
      command.mode,
    );
    if (!vertices) return null;
    const entity = toClosedPolygonEntity(snapshot, vertices, 'POLYGON', 'POLY');
    const entityName = entity.metadata?.entityName as string;
    const nextProject = appendCadProjectEntities(snapshot.project, [entity]);
    return {
      nextSnapshot: {
        project: nextProject,
        selection: createCadSelectionState(nextProject, [entity.id]),
      },
      commandState: {
        key: 'POLYGON',
        phase: 'committed',
        prompt: `POLYGON committed with ${vertices.length} vertices.`,
      },
      transactionLabel: `POLYGON (${entityName})`,
      addedEntityIds: [entity.id],
      removedEntityIds: [],
    };
  },
};

export const shapeCommandDefinitions = {
  RECTANGLE: rectangleCommand,
  POLYGON: polygonCommand,
};
