import { createStableRuntimeId } from '../id';
import {
  buildCircleCenterDiameterScalar,
  buildCircleCenterRadiusScalar,
  buildCircleThreePoint,
  buildCircleTwoPoint,
  buildRectangleVertices,
  buildRegularPolygonVertices,
  type RegularPolygonMode,
} from './cadGeometryShapeBuilders';
import {
  solveCadCircleTangentTangentRadius,
  solveCadCircleTangentTangentTangent,
  type CadTangentSource,
} from './cadGeometryCircleTangentSolvers';
import { resolveCurrentCadLayerId } from './cadLayers';
import { appendCadProjectEntities } from './cadProjectState';
import { createCadSelectionState } from './cadSelection';
import { nextEntityName } from './cadTransactionsEntityFactories';
import type { CadCommandDefinition, CadCommandKey } from './cadTransactions.types';
import type { CadCircleEntity, CadPolygonEntity } from './cadTypes';

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

export type ShapeCircleCommand = {
  key: 'CIRCLE';
  center: XyPoint;
  radius: number;
};

export type ShapeCircleDiameterCommand = {
  key: 'CIRCLECD';
  center: XyPoint;
  diameter: number;
};

type CadCircleCreatedBy =
  | 'CIRCLE'
  | 'CIRCLECD'
  | 'CIRCLE2P'
  | 'CIRCLE3P'
  | 'CIRCLETTR'
  | 'CIRCLETTT';

const toCircleEntity = (
  snapshot: Parameters<CadCommandDefinition<ShapeCircleCommand>['execute']>[0],
  built: { center: { x: number; y: number }; radius: number },
  createdBy: CadCircleCreatedBy,
  prefix: 'CIR' | 'CIRD' | 'CIR2P' | 'CIR3P' | 'CIRTTR' | 'CIRTTT',
): CadCircleEntity => ({
  id: createStableRuntimeId('cad-circle'),
  type: 'circle',
  layerId: resolveCurrentCadLayerId(snapshot.project),
  visible: true,
  locked: false,
  centerX: built.center.x,
  centerY: built.center.y,
  radius: built.radius,
  metadata: {
    createdBy,
    entityName: nextEntityName(snapshot.project, prefix),
    manual: true,
  },
});

const commitCircleEntity = <TKey extends CadCommandKey>(
  snapshot: Parameters<CadCommandDefinition<ShapeCircleCommand>['execute']>[0],
  entity: CadCircleEntity,
  key: TKey,
) => {
  const entityName = entity.metadata?.entityName as string;
  const nextProject = appendCadProjectEntities(snapshot.project, [entity]);
  return {
    nextSnapshot: {
      project: nextProject,
      selection: createCadSelectionState(nextProject, [entity.id]),
    },
    commandState: {
      key,
      phase: 'committed' as const,
      prompt: `${key} committed with radius ${entity.radius}.`,
    },
    transactionLabel: `${key} (${entityName})`,
    addedEntityIds: [entity.id],
    removedEntityIds: [],
  };
};

export const circleCommand: CadCommandDefinition<ShapeCircleCommand> = {
  key: 'CIRCLE',
  execute: (snapshot, command) => {
    const built = buildCircleCenterRadiusScalar(
      { x: command.center.x, y: command.center.y },
      command.radius,
    );
    if (!built) return null;
    return commitCircleEntity(snapshot, toCircleEntity(snapshot, built, 'CIRCLE', 'CIR'), 'CIRCLE');
  },
};

export const circleDiameterCommand: CadCommandDefinition<ShapeCircleDiameterCommand> = {
  key: 'CIRCLECD',
  execute: (snapshot, command) => {
    const built = buildCircleCenterDiameterScalar(
      { x: command.center.x, y: command.center.y },
      command.diameter,
    );
    if (!built) return null;
    return commitCircleEntity(snapshot, toCircleEntity(snapshot, built, 'CIRCLECD', 'CIRD'), 'CIRCLECD');
  },
};

export type ShapeCircleTwoPointCommand = {
  key: 'CIRCLE2P';
  first: XyPoint;
  second: XyPoint;
};

export type ShapeCircleThreePointCommand = {
  key: 'CIRCLE3P';
  first: XyPoint;
  second: XyPoint;
  third: XyPoint;
};

export type ShapeCircleTangentRadiusCommand = {
  key: 'CIRCLETTR';
  first: CadTangentSource;
  second: CadTangentSource;
  radius: number;
};

export type ShapeCircleTangentTangentCommand = {
  key: 'CIRCLETTT';
  first: CadTangentSource;
  second: CadTangentSource;
  third: CadTangentSource;
};

export const circleTwoPointCommand: CadCommandDefinition<ShapeCircleTwoPointCommand> = {
  key: 'CIRCLE2P',
  execute: (snapshot, command) => {
    const built = buildCircleTwoPoint(command.first, command.second);
    if (!built) return null;
    return commitCircleEntity(snapshot, toCircleEntity(snapshot, built, 'CIRCLE2P', 'CIR2P'), 'CIRCLE2P');
  },
};

export const circleThreePointCommand: CadCommandDefinition<ShapeCircleThreePointCommand> = {
  key: 'CIRCLE3P',
  execute: (snapshot, command) => {
    const built = buildCircleThreePoint(command.first, command.second, command.third);
    if (!built) return null;
    return commitCircleEntity(snapshot, toCircleEntity(snapshot, built, 'CIRCLE3P', 'CIR3P'), 'CIRCLE3P');
  },
};

export const circleTangentTangentRadiusCommand: CadCommandDefinition<ShapeCircleTangentRadiusCommand> = {
  key: 'CIRCLETTR',
  execute: (snapshot, command) => {
    const solved = solveCadCircleTangentTangentRadius(command.first, command.second, command.radius);
    if (solved.status !== 'SOLVED' || !solved.center || solved.radius == null) return null;
    const built = { center: solved.center, radius: solved.radius };
    return commitCircleEntity(snapshot, toCircleEntity(snapshot, built, 'CIRCLETTR', 'CIRTTR'), 'CIRCLETTR');
  },
};

export const circleTangentTangentTangentCommand: CadCommandDefinition<ShapeCircleTangentTangentCommand> = {
  key: 'CIRCLETTT',
  execute: (snapshot, command) => {
    const solved = solveCadCircleTangentTangentTangent(command.first, command.second, command.third);
    if (solved.status !== 'SOLVED' || !solved.center || solved.radius == null) return null;
    const built = { center: solved.center, radius: solved.radius };
    return commitCircleEntity(snapshot, toCircleEntity(snapshot, built, 'CIRCLETTT', 'CIRTTT'), 'CIRCLETTT');
  },
};

export const shapeCommandDefinitions = {
  CIRCLE: circleCommand,
  CIRCLECD: circleDiameterCommand,
  CIRCLE2P: circleTwoPointCommand,
  CIRCLE3P: circleThreePointCommand,
  CIRCLETTR: circleTangentTangentRadiusCommand,
  CIRCLETTT: circleTangentTangentTangentCommand,
  RECTANGLE: rectangleCommand,
  POLYGON: polygonCommand,
};
