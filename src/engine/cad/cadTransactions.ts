import {
  clearCadSelection,
  createCadSelectionState,
  selectAllCadEntities,
} from './cadSelection';
import { cadBuildParcelClosureSummary } from './cadCogo';
import {
  buildCadBatchCogoReportRows,
  buildCadBatchCogoSummary,
  type CadBatchCogoDraft,
} from './cadBatchCogo';
import {
  cadAlignmentDisplayStationToRawStation,
  cadAlignmentEndStation,
  cadBuildOffsetAlignmentDraft,
  cadBuildAlignmentStationPoints,
  cadBuildAlignmentDraft,
  cadPointAtAlignmentStationOffset,
  cadProjectPointToAlignment,
  formatCadStation,
} from './cadAlignment';
import { buildCadCogoComputation, buildCadCogoEntityMetadata } from './cadCogoTypes';
import {
  getCadEntityEditableName,
  getCadEntityDisplayLabel,
} from './cadEntityNames';
import {
  cadAngleDegFromCenter,
  cadArcMidpoint,
  cadBuildArcFromThreePoints,
  cadBuildTangentCurve,
  cadClosestPointOnArc,
  cadClosestPointOnSegment,
  cadDistance,
  cadInfiniteLineIntersection,
  cadIntersectArcArc,
  cadIntersectInfiniteLineArc,
  cadIsAngleOnArcSweep,
  cadIntersectSegmentArc,
  cadNormalizeAngleDeg,
  cadPointOnCircle,
  cadProjectPointOntoInfiniteLine,
  cadProjectPointOntoCircle,
  cadSegmentIntersection,
  cadSignedSweepDeg,
} from './cadGeometry';
import {
  appendCadProjectCogoComputation,
  appendCadProjectEntities,
  replaceCadProjectEntities,
} from './cadProjectState';
import type { CadSelectionState } from './cadSelection';
import type { CadCogoReportRow, CadCogoToolKey } from './cadCogoTypes';
import type {
  CadEntity,
  CadArcEntity,
  CadEntityId,
  CadGripHandle,
  CadGripHandleKind,
  CadLineEntity,
  CadParcelEntity,
  CadPolylineEntity,
  CadProject,
  CadSurveyPointEntity,
  CadTextEntity,
} from './cadTypes';
import { createStableRuntimeId } from '../id';

export type CadCommandKey =
  | 'SELECT_ALL'
  | 'CLEAR_SELECTION'
  | 'ERASE'
  | 'POINT'
  | 'COGO_POINT'
  | 'LINE'
  | 'PLINE'
  | 'TRAVERSE'
  | 'BATCH_COGO'
  | 'ARC_3PT'
  | 'ARC_CREATE'
  | 'TANGENT_CURVE'
  | 'ALIGNMENT_CREATE'
  | 'ALIGNMENT_OFFSET_CREATE'
  | 'ALIGNMENT_STATION_REPORT'
  | 'ALIGNMENT_STATION_EQUATION'
  | 'ALIGNMENT_OFFSET_POINT'
  | 'ALIGNMENT_INTERVAL_POINTS'
  | 'PARCEL_CREATE'
  | 'MOVE'
  | 'COPY'
  | 'FILLET'
  | 'PASTE'
  | 'TRIM'
  | 'INTERSECT_POINT'
  | 'EDIT_ENTITY'
  | 'GRIP_EDIT';
export type CadCommandPhase = 'idle' | 'committed';

export interface CadCommandState {
  key: CadCommandKey | 'IDLE';
  phase: CadCommandPhase;
  prompt: string;
}

export type CadCommand =
  | {
      key: 'SELECT_ALL';
    }
  | {
      key: 'CLEAR_SELECTION';
    }
  | {
      key: 'ERASE';
    }
  | {
      key: 'POINT';
      x: number;
      y: number;
      label?: string;
    }
  | {
      key: 'COGO_POINT';
      x: number;
      y: number;
      label?: string;
      basisLabel: string;
      directionLabel: string;
    }
  | {
      key: 'LINE';
      start: { x: number; y: number; label: string };
      end: { x: number; y: number; label: string };
    }
  | {
      key: 'PLINE';
      vertices: { x: number; y: number; label: string }[];
    }
  | {
      key: 'TRAVERSE';
      vertices: { x: number; y: number; label: string }[];
      rawVertices?: { x: number; y: number; label: string }[];
      mode?: 'open' | 'closed' | 'point-to-point';
      closePoint?: { x: number; y: number; label: string };
      sideshots?: Array<{
        occupyLabel: string;
        backsightLabel: string;
        side: 'left' | 'right';
        angleDeg: number;
        distance: number;
        point: { label: string; x: number; y: number };
      }>;
      adjustment?: {
        method: 'angular' | 'bowditch' | 'transit';
        targetLabel: string;
        rawClosureDistance: number;
        adjustedClosureDistance: number;
        rawClosureBearing: string | null;
        adjustedClosureBearing: string | null;
        angularCorrectionPerLegSec: number | null;
      };
    }
  | {
      key: 'BATCH_COGO';
      draft: CadBatchCogoDraft;
    }
  | {
      key: 'ARC_3PT';
      start: { x: number; y: number; label: string };
      through: { x: number; y: number; label: string };
      end: { x: number; y: number; label: string };
    }
  | {
      key: 'ARC_CREATE';
      modeLabel: string;
      definition: {
        center: { x: number; y: number };
        radius: number;
        startAngleDeg: number;
        endAngleDeg: number;
      };
      metadata?: Record<string, unknown>;
    }
  | {
      key: 'TANGENT_CURVE';
      pi: { x: number; y: number; label: string };
      backTangentPoint: { x: number; y: number; label: string };
      aheadTangentPoint: { x: number; y: number; label: string };
      radius: number;
    }
  | {
      key: 'ALIGNMENT_CREATE';
      sourceEntityIds: CadEntityId[];
      name?: string;
      startStation?: number;
    }
  | {
      key: 'ALIGNMENT_OFFSET_CREATE';
      alignmentEntityId: CadEntityId;
      offset: number;
      name?: string;
    }
  | {
      key: 'ALIGNMENT_STATION_REPORT';
      alignmentEntityId: CadEntityId;
      pointEntityId: CadEntityId;
    }
  | {
      key: 'ALIGNMENT_STATION_EQUATION';
      alignmentEntityId: CadEntityId;
      backStation: number;
      aheadStation: number;
    }
  | {
      key: 'ALIGNMENT_OFFSET_POINT';
      alignmentEntityId: CadEntityId;
      station: number;
      offset: number;
      label?: string;
    }
  | {
      key: 'ALIGNMENT_INTERVAL_POINTS';
      alignmentEntityId: CadEntityId;
      interval: number;
      startStation?: number;
      endStation?: number;
      labelPrefix?: string;
    }
  | {
      key: 'PARCEL_CREATE';
      sourceEntityId: CadEntityId;
    }
  | {
      key: 'MOVE';
      deltaX: number;
      deltaY: number;
    }
  | {
      key: 'COPY';
      deltaX: number;
      deltaY: number;
    }
  | {
      key: 'FILLET';
      radius: number;
      firstLineEntityId: CadEntityId;
      firstPickPoint: { x: number; y: number };
      secondLineEntityId: CadEntityId;
      secondPickPoint: { x: number; y: number };
    }
  | {
      key: 'PASTE';
      deltaX: number;
      deltaY: number;
      entityIds: CadEntityId[];
    }
  | {
      key: 'TRIM';
      cuttingEntityIds: CadEntityId[];
      targetEntityId: CadEntityId;
      pickPoint: { x: number; y: number };
      targetSegmentId?: string;
      extendMode?: boolean;
    }
  | {
      key: 'INTERSECT_POINT';
      x: number;
      y: number;
      label?: string;
      firstLabel: string;
      secondLabel: string;
    }
  | {
      key: 'EDIT_ENTITY';
      entityId: CadEntityId;
      edit:
        | { kind: 'entity-name'; value: string }
        | { kind: 'point-x'; value: number }
        | { kind: 'point-y'; value: number }
        | { kind: 'point-z'; value: number | null }
        | { kind: 'line-end'; toX: number; toY: number }
        | { kind: 'polyline-vertex'; vertexIndex: number; x: number; y: number };
    }
  | {
      key: 'GRIP_EDIT';
      entityId: CadEntityId;
      gripKind: CadGripHandleKind;
      x: number;
      y: number;
      vertexIndex?: number;
    };

export interface CadTransaction {
  id: string;
  sequence: number;
  commandKey: CadCommandKey;
  label: string;
  beforeSelectionIds: CadEntityId[];
  afterSelectionIds: CadEntityId[];
  addedEntityIds: CadEntityId[];
  removedEntityIds: CadEntityId[];
}

export interface CadWorkspaceSnapshot {
  project: CadProject;
  selection: CadSelectionState;
}

export interface CadCommandExecutionResult {
  nextSnapshot: CadWorkspaceSnapshot;
  commandState: CadCommandState;
  transactionLabel: string;
  addedEntityIds: CadEntityId[];
  removedEntityIds: CadEntityId[];
}

interface CadCommandDefinition<TCommand extends CadCommand> {
  key: TCommand['key'];
  execute: (_snapshot: CadWorkspaceSnapshot, _command: TCommand) => CadCommandExecutionResult | null;
}

const createIdleCommandState = (): CadCommandState => ({
  key: 'IDLE',
  phase: 'idle',
  prompt: 'Ready. Use Select All, Clear Selection, ERASE, POINT, COGO PT, LINE, PLINE, TRAVERSE, DEED, ARC 3PT, TAN CURVE, ALIGN, ALIGN OFF, STA, STA EQ, STA PT, STA INT, PARCEL, MOVE, COPY, TRIM, FILLET, INTX, or INVERSE to exercise command history.',
});

const nextManualStationId = (project: CadProject): string => {
  let maxSequence = 0;
  project.entities.forEach((entity) => {
    if (entity.type !== 'survey-point') return;
    const match = /^CAD(\d+)$/i.exec(entity.stationId);
    if (!match) return;
    maxSequence = Math.max(maxSequence, Number(match[1]));
  });
  return `CAD${maxSequence + 1}`;
};

const nextParcelName = (project: CadProject): string => {
  let maxSequence = 0;
  project.entities.forEach((entity) => {
    if (entity.type !== 'parcel') return;
    const match = /^Parcel\s+(\d+)$/i.exec(entity.parcelName.trim());
    if (!match) return;
    maxSequence = Math.max(maxSequence, Number(match[1]));
  });
  return `Parcel ${maxSequence + 1}`;
};

const nextAlignmentName = (project: CadProject): string => {
  let maxSequence = 0;
  project.entities.forEach((entity) => {
    if (entity.type !== 'alignment') return;
    const match = /^ALIGN(\d+)$/i.exec(entity.name.trim());
    if (!match) return;
    maxSequence = Math.max(maxSequence, Number(match[1]));
  });
  return `ALIGN${maxSequence + 1}`;
};

const nextEntityName = (project: CadProject, prefix: string): string => {
  const matcher = new RegExp(`^${prefix}(\\d+)$`, 'i');
  let maxSequence = 0;
  project.entities.forEach((entity) => {
    const name = getCadEntityEditableName(entity);
    const match = matcher.exec(name.trim());
    if (!match) return;
    maxSequence = Math.max(maxSequence, Number(match[1]));
  });
  return `${prefix}${maxSequence + 1}`;
};

const nextCurveSequence = (project: CadProject): number => {
  const matcher = /^(?:CURVE|BC|MP|EC|R)(\d+)$/i;
  let maxSequence = 0;
  project.entities.forEach((entity) => {
    const match = matcher.exec(getCadEntityEditableName(entity).trim());
    if (!match) return;
    maxSequence = Math.max(maxSequence, Number(match[1]));
  });
  return maxSequence + 1;
};

const buildCurveLabels = (sequence: number) => ({
  curveName: `CURVE${sequence}`,
  beginLabel: `BC${sequence}`,
  midLabel: `MP${sequence}`,
  endLabel: `EC${sequence}`,
  radiusLabel: `R${sequence}`,
});

const cloneEntityMetadata = (entity: CadEntity): Record<string, unknown> =>
  typeof entity.metadata === 'object' && entity.metadata != null ? { ...entity.metadata } : {};

const withEntityMetadataName = <TEntity extends CadEntity>(
  entity: TEntity,
  name: string,
): TEntity => ({
  ...entity,
  metadata: {
    ...cloneEntityMetadata(entity),
    entityName: name,
  },
});

const renamePointReferences = (
  entity: CadEntity,
  pointEntityId: CadEntityId,
  previousStationId: string,
  nextStationId: string,
): CadEntity => {
  if (entity.type === 'survey-point' && entity.id === pointEntityId) {
    return {
      ...entity,
      stationId: nextStationId,
    };
  }
  if (entity.type === 'text') {
    const metadata = cloneEntityMetadata(entity);
    if (entity.anchorEntityId === pointEntityId) {
      if (typeof metadata.stationId === 'string') {
        metadata.stationId = nextStationId;
      }
      return {
        ...entity,
        text: entity.text === previousStationId ? nextStationId : entity.text,
        metadata,
      };
    }
    if (typeof metadata.stationId === 'string' && metadata.stationId === previousStationId) {
      metadata.stationId = nextStationId;
      return {
        ...entity,
        metadata,
      };
    }
    return entity;
  }
  if (entity.type === 'line') {
    return {
      ...entity,
      fromStationId: entity.fromStationId === previousStationId ? nextStationId : entity.fromStationId,
      toStationId: entity.toStationId === previousStationId ? nextStationId : entity.toStationId,
    };
  }
  if (entity.type === 'polyline' || entity.type === 'polygon' || entity.type === 'parcel') {
    return {
      ...entity,
      vertexLabels: entity.vertexLabels.map((label) => (label === previousStationId ? nextStationId : label)),
    };
  }
  if (entity.type === 'error-ellipse' && entity.stationId === previousStationId) {
    return {
      ...entity,
      stationId: nextStationId,
    };
  }
  return entity;
};

const movePointReferences = (
  entity: CadEntity,
  pointEntityId: CadEntityId,
  stationId: string,
  nextX: number,
  nextY: number,
  nextZ: number | undefined,
): CadEntity => {
  if (entity.type === 'survey-point' && entity.id === pointEntityId) {
    return {
      ...entity,
      x: nextX,
      y: nextY,
      z: nextZ,
    };
  }
  if (entity.type === 'text' && entity.anchorEntityId === pointEntityId) {
    return {
      ...entity,
      x: nextX,
      y: nextY,
    };
  }
  if (entity.type === 'line') {
    return {
      ...entity,
      fromX: entity.fromStationId === stationId ? nextX : entity.fromX,
      fromY: entity.fromStationId === stationId ? nextY : entity.fromY,
      toX: entity.toStationId === stationId ? nextX : entity.toX,
      toY: entity.toStationId === stationId ? nextY : entity.toY,
    };
  }
  if (entity.type === 'polyline' || entity.type === 'polygon' || entity.type === 'parcel') {
    return {
      ...entity,
      vertices: entity.vertices.map((vertex, index) =>
        entity.vertexLabels[index] === stationId ? { x: nextX, y: nextY } : vertex,
      ),
    };
  }
  if (entity.type === 'error-ellipse' && entity.stationId === stationId) {
    return {
      ...entity,
      centerX: nextX,
      centerY: nextY,
    };
  }
  return entity;
};

const syncLinkedSurveyPointPosition = (
  project: CadProject,
  stationId: string | undefined,
  previousPoint: { x: number; y: number },
  nextPoint: { x: number; y: number },
): CadProject => {
  if (!stationId) return project;
  if (
    Math.abs(previousPoint.x - nextPoint.x) <= 1e-9 &&
    Math.abs(previousPoint.y - nextPoint.y) <= 1e-9
  ) {
    return project;
  }
  const linkedPoint = project.entities.find(
    (entity): entity is CadSurveyPointEntity =>
      entity.type === 'survey-point' &&
      entity.stationId === stationId &&
      Math.abs(entity.x - previousPoint.x) <= 1e-9 &&
      Math.abs(entity.y - previousPoint.y) <= 1e-9,
  );
  if (!linkedPoint) return project;
  return replaceCadProjectEntities(
    project,
    project.entities.map((entity) =>
      movePointReferences(
        entity,
        linkedPoint.id,
        linkedPoint.stationId,
        nextPoint.x,
        nextPoint.y,
        linkedPoint.z,
      ),
    ),
  );
};

const resolveLinkedSurveyPoint = (
  project: CadProject,
  stationId: string | undefined,
  expectedPoint?: { x: number; y: number },
): CadSurveyPointEntity | null => {
  if (!stationId) return null;
  return (
    project.entities.find(
      (entity): entity is CadSurveyPointEntity =>
        entity.type === 'survey-point' &&
        entity.stationId === stationId &&
        (expectedPoint == null ||
          (Math.abs(entity.x - expectedPoint.x) <= 1e-9 &&
            Math.abs(entity.y - expectedPoint.y) <= 1e-9)),
    ) ?? null
  );
};

const createArcSupportEntities = (
  project: CadProject,
  arcEntityId: CadEntityId,
  sequence: number,
  definition: {
    center: { x: number; y: number };
    radius: number;
    startAngleDeg: number;
    endAngleDeg: number;
  },
  createdBy: string,
): Array<CadSurveyPointEntity | CadTextEntity> => {
  const curveLabels = buildCurveLabels(sequence);
  const supportPoints = [
    {
      label: curveLabels.beginLabel,
      point: cadPointOnCircle(definition.center, definition.radius, definition.startAngleDeg),
    },
    {
      label: curveLabels.midLabel,
      point: cadArcMidpoint(
        definition.center,
        definition.radius,
        definition.startAngleDeg,
        definition.endAngleDeg,
      ),
    },
    {
      label: curveLabels.endLabel,
      point: cadPointOnCircle(definition.center, definition.radius, definition.endAngleDeg),
    },
    {
      label: curveLabels.radiusLabel,
      point: definition.center,
    },
  ];
  let workingProject = project;
  const entities: Array<CadSurveyPointEntity | CadTextEntity> = [];
  supportPoints.forEach((supportPoint) => {
    const bundle = createManualPointEntities(
      workingProject,
      supportPoint.point.x,
      supportPoint.point.y,
      supportPoint.label,
      { createdBy },
    );
    const pointEntity: CadSurveyPointEntity = {
      ...bundle.point,
      metadata: {
        ...cloneEntityMetadata(bundle.point),
        anchorCurveEntityId: arcEntityId,
        curvePointRole:
          supportPoint.label.startsWith('BC')
            ? 'begin'
            : supportPoint.label.startsWith('MP')
              ? 'mid'
              : supportPoint.label.startsWith('EC')
                ? 'end'
                : 'radius',
      },
    };
    const labelEntity: CadTextEntity | null = bundle.label
      ? {
          ...bundle.label,
          metadata: {
            ...cloneEntityMetadata(bundle.label),
            anchorCurveEntityId: arcEntityId,
          },
        }
      : null;
    workingProject = appendCadProjectEntities(workingProject, compactManualPointEntities([pointEntity, labelEntity]));
    entities.push(pointEntity);
    if (labelEntity) entities.push(labelEntity);
  });
  return entities;
};

const syncArcSupportEntities = (
  project: CadProject,
  arcEntity: Extract<CadEntity, { type: 'arc' }>,
): CadProject => {
  const supportTargets = new Map<
    'begin' | 'mid' | 'end' | 'radius',
    { x: number; y: number }
  >([
    [
      'begin',
      cadPointOnCircle(
        { x: arcEntity.centerX, y: arcEntity.centerY },
        arcEntity.radius,
        arcEntity.startAngleDeg,
      ),
    ],
    [
      'mid',
      cadArcMidpoint(
        { x: arcEntity.centerX, y: arcEntity.centerY },
        arcEntity.radius,
        arcEntity.startAngleDeg,
        arcEntity.endAngleDeg,
      ),
    ],
    [
      'end',
      cadPointOnCircle(
        { x: arcEntity.centerX, y: arcEntity.centerY },
        arcEntity.radius,
        arcEntity.endAngleDeg,
      ),
    ],
    ['radius', { x: arcEntity.centerX, y: arcEntity.centerY }],
  ]);
  const anchoredSupportPoints = project.entities.filter(
    (entity): entity is CadSurveyPointEntity =>
      entity.type === 'survey-point' &&
      entity.metadata != null &&
      typeof entity.metadata === 'object' &&
      entity.metadata.anchorCurveEntityId === arcEntity.id &&
      (entity.metadata.curvePointRole === 'begin' ||
        entity.metadata.curvePointRole === 'mid' ||
        entity.metadata.curvePointRole === 'end' ||
        entity.metadata.curvePointRole === 'radius'),
  );
  return anchoredSupportPoints.reduce((currentProject, pointEntity) => {
    const role = pointEntity.metadata?.curvePointRole;
    if (
      role !== 'begin' &&
      role !== 'mid' &&
      role !== 'end' &&
      role !== 'radius'
    ) {
      return currentProject;
    }
    const target = supportTargets.get(role);
    if (!target) return currentProject;
    return replaceCadProjectEntities(
      currentProject,
      currentProject.entities.map((entity) =>
        movePointReferences(
          entity,
          pointEntity.id,
          pointEntity.stationId,
          target.x,
          target.y,
          pointEntity.z,
        ),
      ),
    );
  }, project);
};

const syncEditedEntityDependencies = (
  project: CadProject,
  previousEntity: CadEntity,
  updatedEntity: CadEntity,
  options?: { syncLinePoints?: boolean },
): CadProject => {
  if (
    (options?.syncLinePoints ?? true) &&
    previousEntity.type === 'line' &&
    updatedEntity.type === 'line'
  ) {
    let nextProject = syncLinkedSurveyPointPosition(
      project,
      previousEntity.fromStationId,
      { x: previousEntity.fromX, y: previousEntity.fromY },
      { x: updatedEntity.fromX, y: updatedEntity.fromY },
    );
    nextProject = syncLinkedSurveyPointPosition(
      nextProject,
      previousEntity.toStationId,
      { x: previousEntity.toX, y: previousEntity.toY },
      { x: updatedEntity.toX, y: updatedEntity.toY },
    );
    return nextProject;
  }
  if (
    (previousEntity.type === 'polyline' && updatedEntity.type === 'polyline') ||
    (previousEntity.type === 'polygon' && updatedEntity.type === 'polygon') ||
    (previousEntity.type === 'parcel' && updatedEntity.type === 'parcel')
  ) {
    return previousEntity.vertices.reduce((currentProject, previousVertex, index) => {
      const nextVertex = updatedEntity.vertices[index];
      if (!nextVertex) return currentProject;
      return syncLinkedSurveyPointPosition(
        currentProject,
        previousEntity.vertexLabels[index],
        previousVertex,
        nextVertex,
      );
    }, project);
  }
  if (previousEntity.type === 'arc' && updatedEntity.type === 'arc') {
    return syncArcSupportEntities(project, updatedEntity);
  }
  return project;
};

const buildCopiedDependentPointEntities = (
  project: CadProject,
  selectedEntities: readonly CadEntity[],
  deltaX: number,
  deltaY: number,
): {
  workingProject: CadProject;
  copiedEntities: CadEntity[];
  copiedPointByStationId: Map<string, { stationId: string; x: number; y: number }>;
  copiedArcSupportBySourceId: Map<
    CadEntityId,
    { sequence: number; arcSupportEntities: Array<CadSurveyPointEntity | CadTextEntity> }
  >;
} => {
  const copiedEntities: CadEntity[] = [];
  const copiedPointByStationId = new Map<string, { stationId: string; x: number; y: number }>();
  const copiedArcSupportBySourceId = new Map<
    CadEntityId,
    { sequence: number; arcSupportEntities: Array<CadSurveyPointEntity | CadTextEntity> }
  >();
  let workingProject = project;
  const copiedSourcePointIds = new Set<CadEntityId>();

  const copyPointEntity = (
    sourcePoint: CadSurveyPointEntity,
    requestedLabel?: string,
  ): { point: CadSurveyPointEntity; label: CadTextEntity | null } => {
    const pointBundle = createManualPointEntities(
      workingProject,
      sourcePoint.x + deltaX,
      sourcePoint.y + deltaY,
      requestedLabel,
      {
        includeTextLabel: sourcePoint.metadata?.hiddenLabel === true ? false : undefined,
        createdBy: 'COPY',
      },
    );
    const appendedEntities = compactManualPointEntities([pointBundle.point, pointBundle.label]);
    workingProject = appendCadProjectEntities(workingProject, appendedEntities);
    copiedEntities.push(...appendedEntities);
    copiedPointByStationId.set(sourcePoint.stationId, {
      stationId: pointBundle.point.stationId,
      x: pointBundle.point.x,
      y: pointBundle.point.y,
    });
    copiedSourcePointIds.add(sourcePoint.id);
    return pointBundle;
  };

  selectedEntities.forEach((entity) => {
    if (entity.type === 'survey-point') {
      copyPointEntity(entity);
      return;
    }

    if (
      entity.type === 'polyline' ||
      entity.type === 'polygon' ||
      entity.type === 'parcel'
    ) {
      entity.vertexLabels.forEach((label, index) => {
        if (!label || copiedPointByStationId.has(label)) return;
        const linkedPoint = resolveLinkedSurveyPoint(project, label, entity.vertices[index]);
        if (!linkedPoint || copiedSourcePointIds.has(linkedPoint.id)) return;
        copyPointEntity(linkedPoint);
      });
      return;
    }

    if (entity.type !== 'arc') return;
    const sequence = nextCurveSequence(workingProject);
    const curveLabels = buildCurveLabels(sequence);
    const supportPointByRole = new Map<'begin' | 'mid' | 'end' | 'radius', CadSurveyPointEntity>();
    project.entities.forEach((candidate) => {
      if (
        candidate.type !== 'survey-point' ||
        candidate.metadata == null ||
        typeof candidate.metadata !== 'object' ||
        candidate.metadata.anchorCurveEntityId !== entity.id ||
        (candidate.metadata.curvePointRole !== 'begin' &&
          candidate.metadata.curvePointRole !== 'mid' &&
          candidate.metadata.curvePointRole !== 'end' &&
          candidate.metadata.curvePointRole !== 'radius')
      ) {
        return;
      }
      supportPointByRole.set(candidate.metadata.curvePointRole, candidate);
    });
    const requestedLabels: Record<'begin' | 'mid' | 'end' | 'radius', string> = {
      begin: curveLabels.beginLabel,
      mid: curveLabels.midLabel,
      end: curveLabels.endLabel,
      radius: curveLabels.radiusLabel,
    };
    const arcSupportEntities: Array<CadSurveyPointEntity | CadTextEntity> = [];
    (['begin', 'mid', 'end', 'radius'] as const).forEach((role) => {
      const sourcePoint = supportPointByRole.get(role);
      if (!sourcePoint || copiedSourcePointIds.has(sourcePoint.id)) return;
      const pointBundle = copyPointEntity(sourcePoint, requestedLabels[role]);
      const copiedPoint: CadSurveyPointEntity = {
        ...pointBundle.point,
        metadata: {
          ...cloneEntityMetadata(pointBundle.point),
          curvePointRole: role,
        },
      };
      const copiedLabel: CadTextEntity | null = pointBundle.label
        ? {
            ...pointBundle.label,
            metadata: cloneEntityMetadata(pointBundle.label),
          }
        : null;
      workingProject = replaceCadProjectEntities(
        workingProject,
        workingProject.entities.map((candidate) => {
          if (candidate.id === pointBundle.point.id) return copiedPoint;
          if (copiedLabel && candidate.id === copiedLabel.id) return copiedLabel;
          return candidate;
        }),
      );
      arcSupportEntities.push(copiedPoint);
      if (copiedLabel) arcSupportEntities.push(copiedLabel);
    });
    copiedArcSupportBySourceId.set(entity.id, { sequence, arcSupportEntities });
  });

  return {
    workingProject,
    copiedEntities,
    copiedPointByStationId,
    copiedArcSupportBySourceId,
  };
};

const buildFilletRayDirection = (
  line: CadLineEntity,
  intersectionPoint: { x: number; y: number },
  pickPoint: { x: number; y: number },
): { directionX: number; directionY: number; trimStart: boolean } | null => {
  const start = { x: line.fromX, y: line.fromY };
  const end = { x: line.toX, y: line.toY };
  const projectedPick = cadProjectPointOntoInfiniteLine(pickPoint, start, end).point;
  const pickedStart = cadDistance(projectedPick, start) <= cadDistance(projectedPick, end);
  const primaryPoint = pickedStart ? start : end;
  const secondaryPoint = pickedStart ? end : start;
  const primaryVector = {
    x: primaryPoint.x - intersectionPoint.x,
    y: primaryPoint.y - intersectionPoint.y,
  };
  const primaryLength = Math.hypot(primaryVector.x, primaryVector.y);
  const projectedVector = {
    x: projectedPick.x - intersectionPoint.x,
    y: projectedPick.y - intersectionPoint.y,
  };
  const projectedLength = Math.hypot(projectedVector.x, projectedVector.y);
  const fallbackVector =
    projectedLength > 1e-9
      ? projectedVector
      : primaryLength > 1e-9
        ? primaryVector
        : {
            x: secondaryPoint.x - intersectionPoint.x,
            y: secondaryPoint.y - intersectionPoint.y,
          };
  const fallbackLength = Math.hypot(fallbackVector.x, fallbackVector.y);
  if (fallbackLength <= 1e-9) return null;
  return {
    directionX: fallbackVector.x / fallbackLength,
    directionY: fallbackVector.y / fallbackLength,
    trimStart: pickedStart,
  };
};

const buildFilletRayDirectionForEndpoint = (
  line: CadLineEntity,
  intersectionPoint: { x: number; y: number },
  trimStart: boolean,
): { directionX: number; directionY: number; trimStart: boolean } | null => {
  const primaryPoint = trimStart
    ? { x: line.fromX, y: line.fromY }
    : { x: line.toX, y: line.toY };
  const secondaryPoint = trimStart
    ? { x: line.toX, y: line.toY }
    : { x: line.fromX, y: line.fromY };
  const primaryVector = {
    x: primaryPoint.x - intersectionPoint.x,
    y: primaryPoint.y - intersectionPoint.y,
  };
  const primaryLength = Math.hypot(primaryVector.x, primaryVector.y);
  const fallbackVector =
    primaryLength > 1e-9
      ? primaryVector
      : {
          x: secondaryPoint.x - intersectionPoint.x,
          y: secondaryPoint.y - intersectionPoint.y,
        };
  const fallbackLength = Math.hypot(fallbackVector.x, fallbackVector.y);
  if (fallbackLength <= 1e-9) return null;
  return {
    directionX: fallbackVector.x / fallbackLength,
    directionY: fallbackVector.y / fallbackLength,
    trimStart,
  };
};

const lineSideValue = (
  lineStart: { x: number; y: number },
  lineEnd: { x: number; y: number },
  point: { x: number; y: number },
): number =>
  (lineEnd.x - lineStart.x) * (point.y - lineStart.y) -
  (lineEnd.y - lineStart.y) * (point.x - lineStart.x);

const sideMismatchPenalty = (
  lineStart: { x: number; y: number },
  lineEnd: { x: number; y: number },
  referencePoint: { x: number; y: number },
  candidatePoint: { x: number; y: number },
): number => {
  const referenceSide = lineSideValue(lineStart, lineEnd, referencePoint);
  const candidateSide = lineSideValue(lineStart, lineEnd, candidatePoint);
  if (Math.abs(referenceSide) <= 1e-9 || Math.abs(candidateSide) <= 1e-9) return 0;
  return Math.sign(referenceSide) === Math.sign(candidateSide) ? 0 : 1_000_000;
};

const buildCadLineFilletCandidate = (
  firstLine: CadLineEntity,
  firstPickPoint: { x: number; y: number },
  secondLine: CadLineEntity,
  secondPickPoint: { x: number; y: number },
  radius: number,
  intersectionPoint: { x: number; y: number },
  firstRay: { directionX: number; directionY: number; trimStart: boolean },
  secondRay: { directionX: number; directionY: number; trimStart: boolean },
): {
  firstLine: CadLineEntity;
  secondLine: CadLineEntity;
  arcDefinition: {
    center: { x: number; y: number };
    radius: number;
    startAngleDeg: number;
    endAngleDeg: number;
  };
  score: number;
} | null => {
  const dotProduct = Math.max(
    -1,
    Math.min(1, firstRay.directionX * secondRay.directionX + firstRay.directionY * secondRay.directionY),
  );
  const angle = Math.acos(dotProduct);
  if (!Number.isFinite(angle) || angle <= 1e-6 || Math.abs(Math.PI - angle) <= 1e-6) return null;

  const tangentOffset = radius / Math.tan(angle / 2);
  const centerOffset = radius / Math.sin(angle / 2);
  if (!Number.isFinite(tangentOffset) || !Number.isFinite(centerOffset)) return null;

  const firstTangentPoint = {
    x: intersectionPoint.x + firstRay.directionX * tangentOffset,
    y: intersectionPoint.y + firstRay.directionY * tangentOffset,
  };
  const secondTangentPoint = {
    x: intersectionPoint.x + secondRay.directionX * tangentOffset,
    y: intersectionPoint.y + secondRay.directionY * tangentOffset,
  };
  const bisectorVector = {
    x: firstRay.directionX + secondRay.directionX,
    y: firstRay.directionY + secondRay.directionY,
  };
  const bisectorLength = Math.hypot(bisectorVector.x, bisectorVector.y);
  if (bisectorLength <= 1e-9) return null;
  const centerPoint = {
    x: intersectionPoint.x + (bisectorVector.x / bisectorLength) * centerOffset,
    y: intersectionPoint.y + (bisectorVector.y / bisectorLength) * centerOffset,
  };
  const startAngleDeg = cadAngleDegFromCenter(centerPoint, firstTangentPoint);
  const endAngleSeedDeg = cadAngleDegFromCenter(centerPoint, secondTangentPoint);
  const ccwDeltaDeg = cadNormalizeAngleDeg(endAngleSeedDeg - startAngleDeg);
  const signedSweepDeg = ccwDeltaDeg <= 180 ? ccwDeltaDeg : -(360 - ccwDeltaDeg);
  if (Math.abs(signedSweepDeg) <= 1e-6 || Math.abs(signedSweepDeg) >= 180 - 1e-6) return null;

  const nextFirstLine: CadLineEntity = firstRay.trimStart
    ? {
        ...firstLine,
        fromX: firstTangentPoint.x,
        fromY: firstTangentPoint.y,
      }
    : {
        ...firstLine,
        toX: firstTangentPoint.x,
        toY: firstTangentPoint.y,
      };
  const nextSecondLine: CadLineEntity = secondRay.trimStart
    ? {
        ...secondLine,
        fromX: secondTangentPoint.x,
        fromY: secondTangentPoint.y,
      }
    : {
        ...secondLine,
        toX: secondTangentPoint.x,
        toY: secondTangentPoint.y,
      };

  return {
    firstLine: nextFirstLine,
    secondLine: nextSecondLine,
    arcDefinition: {
      center: centerPoint,
      radius,
      startAngleDeg,
      endAngleDeg: startAngleDeg + signedSweepDeg,
    },
    score:
      sideMismatchPenalty(
        { x: firstLine.fromX, y: firstLine.fromY },
        { x: firstLine.toX, y: firstLine.toY },
        secondPickPoint,
        centerPoint,
      ) +
      sideMismatchPenalty(
        { x: secondLine.fromX, y: secondLine.fromY },
        { x: secondLine.toX, y: secondLine.toY },
        firstPickPoint,
        centerPoint,
      ) +
      cadDistance(firstPickPoint, firstTangentPoint) +
      cadDistance(secondPickPoint, secondTangentPoint),
  };
};

const buildCadLineCornerCandidate = (
  firstLine: CadLineEntity,
  firstPickPoint: { x: number; y: number },
  secondLine: CadLineEntity,
  secondPickPoint: { x: number; y: number },
  intersectionPoint: { x: number; y: number },
  firstRay: { directionX: number; directionY: number; trimStart: boolean },
  secondRay: { directionX: number; directionY: number; trimStart: boolean },
): {
  firstLine: CadLineEntity;
  secondLine: CadLineEntity;
  score: number;
} => {
  const nextFirstLine: CadLineEntity = firstRay.trimStart
    ? {
        ...firstLine,
        fromX: intersectionPoint.x,
        fromY: intersectionPoint.y,
      }
    : {
        ...firstLine,
        toX: intersectionPoint.x,
        toY: intersectionPoint.y,
      };
  const nextSecondLine: CadLineEntity = secondRay.trimStart
    ? {
        ...secondLine,
        fromX: intersectionPoint.x,
        fromY: intersectionPoint.y,
      }
    : {
        ...secondLine,
        toX: intersectionPoint.x,
        toY: intersectionPoint.y,
      };
  return {
    firstLine: nextFirstLine,
    secondLine: nextSecondLine,
    score:
      sideMismatchPenalty(
        { x: firstLine.fromX, y: firstLine.fromY },
        { x: firstLine.toX, y: firstLine.toY },
        secondPickPoint,
        intersectionPoint,
      ) +
      sideMismatchPenalty(
        { x: secondLine.fromX, y: secondLine.fromY },
        { x: secondLine.toX, y: secondLine.toY },
        firstPickPoint,
        intersectionPoint,
      ) +
      cadDistance(firstPickPoint, intersectionPoint) +
      cadDistance(secondPickPoint, intersectionPoint),
  };
};

const buildCadLineFillet = (
  firstLine: CadLineEntity,
  firstPickPoint: { x: number; y: number },
  secondLine: CadLineEntity,
  secondPickPoint: { x: number; y: number },
  radius: number,
): {
  firstLine: CadLineEntity;
  secondLine: CadLineEntity;
  arcDefinition: {
    center: { x: number; y: number };
    radius: number;
    startAngleDeg: number;
    endAngleDeg: number;
  } | null;
} | null => {
  if (!Number.isFinite(radius) || radius < -1e-9) return null;
  const firstStart = { x: firstLine.fromX, y: firstLine.fromY };
  const firstEnd = { x: firstLine.toX, y: firstLine.toY };
  const secondStart = { x: secondLine.fromX, y: secondLine.fromY };
  const secondEnd = { x: secondLine.toX, y: secondLine.toY };
  const intersectionPoint = cadInfiniteLineIntersection(firstStart, firstEnd, secondStart, secondEnd);
  if (!intersectionPoint) return null;

  const preferredFirstRay = buildFilletRayDirection(firstLine, intersectionPoint, firstPickPoint);
  const preferredSecondRay = buildFilletRayDirection(secondLine, intersectionPoint, secondPickPoint);
  const firstRayCandidates = [true, false]
    .map((trimStart) => buildFilletRayDirectionForEndpoint(firstLine, intersectionPoint, trimStart))
    .filter((candidate): candidate is NonNullable<typeof candidate> => candidate != null)
    .sort((left, right) => {
      const leftPenalty =
        preferredFirstRay == null || preferredFirstRay.trimStart === left.trimStart ? 0 : 1000;
      const rightPenalty =
        preferredFirstRay == null || preferredFirstRay.trimStart === right.trimStart ? 0 : 1000;
      return leftPenalty - rightPenalty;
    });
  const secondRayCandidates = [true, false]
    .map((trimStart) => buildFilletRayDirectionForEndpoint(secondLine, intersectionPoint, trimStart))
    .filter((candidate): candidate is NonNullable<typeof candidate> => candidate != null)
    .sort((left, right) => {
      const leftPenalty =
        preferredSecondRay == null || preferredSecondRay.trimStart === left.trimStart ? 0 : 1000;
      const rightPenalty =
        preferredSecondRay == null || preferredSecondRay.trimStart === right.trimStart ? 0 : 1000;
      return leftPenalty - rightPenalty;
    });
  if (firstRayCandidates.length === 0 || secondRayCandidates.length === 0) return null;

  if (radius <= 1e-9) {
    const bestCornerCandidate =
      firstRayCandidates
        .flatMap((firstRay) =>
          secondRayCandidates.map((secondRay) =>
            buildCadLineCornerCandidate(
              firstLine,
              firstPickPoint,
              secondLine,
              secondPickPoint,
              intersectionPoint,
              firstRay,
              secondRay,
            ),
          ),
        )
        .sort((left, right) => left.score - right.score)[0] ?? null;
    if (!bestCornerCandidate) return null;
    return {
      firstLine: bestCornerCandidate.firstLine,
      secondLine: bestCornerCandidate.secondLine,
      arcDefinition: null,
    };
  }

  const bestCandidate =
    firstRayCandidates
      .flatMap((firstRay) =>
        secondRayCandidates.map((secondRay) =>
          buildCadLineFilletCandidate(
            firstLine,
            firstPickPoint,
            secondLine,
            secondPickPoint,
            radius,
            intersectionPoint,
            firstRay,
            secondRay,
          ),
        ),
      )
      .filter((candidate): candidate is NonNullable<typeof candidate> => candidate != null)
      .sort((left, right) => left.score - right.score)[0] ?? null;
  if (!bestCandidate) return null;

  return {
    firstLine: bestCandidate.firstLine,
    secondLine: bestCandidate.secondLine,
    arcDefinition: bestCandidate.arcDefinition,
  };
};

const stationIdExists = (project: CadProject, stationId: string): boolean =>
  project.entities.some(
    (entity) =>
      (entity.type === 'survey-point' && entity.stationId === stationId) ||
      entity.id === `pt:${stationId}` ||
      entity.id === `label:${stationId}`,
  );

const createManualPointEntities = (
  project: CadProject,
  x: number,
  y: number,
  requestedLabel?: string,
  options?: { includeTextLabel?: boolean; createdBy?: string },
): { point: CadSurveyPointEntity; label: CadTextEntity | null } => {
  const requestedStationId = requestedLabel?.trim();
  const stationId =
    requestedStationId && !stationIdExists(project, requestedStationId)
      ? requestedStationId
      : nextManualStationId(project);
  const createdBy = options?.createdBy ?? 'POINT';
  const point: CadSurveyPointEntity = {
    id: `pt:${stationId}`,
    type: 'survey-point',
    layerId: 'points',
    styleId: 'style-point',
    visible: true,
    locked: false,
    stationId,
    x,
    y,
    pointClass: 'free',
    source: project.metadata.source,
    metadata: {
      createdBy,
      manual: true,
    },
  };
  if (options?.includeTextLabel === false) {
    return {
      point,
      label: null,
    };
  }
  return {
    point,
    label: {
      id: `label:${stationId}`,
      type: 'text',
      layerId: 'labels',
      styleId: 'style-label',
      visible: true,
      locked: false,
      x,
      y,
      text: stationId,
      anchorEntityId: `pt:${stationId}`,
      metadata: {
        createdBy,
        manual: true,
        stationId,
      },
    },
  };
};

const compactManualPointEntities = (
  entities: Array<CadSurveyPointEntity | CadTextEntity | null>,
): Array<CadSurveyPointEntity | CadTextEntity> =>
  entities.filter((entity): entity is CadSurveyPointEntity | CadTextEntity => entity != null);

const createCogoProvenance = ({
  toolKey,
  summary,
  sourceEntityIds,
  sourcePointIds,
  inputs,
  parameters,
}: {
  toolKey: CadCogoToolKey;
  summary: string;
  sourceEntityIds?: CadEntityId[];
  sourcePointIds?: string[];
  inputs: Record<string, unknown>;
  parameters?: Record<string, unknown>;
}) => ({
  id: createStableRuntimeId('cad-cogo'),
  toolKey,
  inputs,
  parameters,
  sourceEntityIds,
  sourcePointIds,
  resultSummary: summary,
});

const appendCogoComputation = ({
  project,
  provenance,
  title,
  summary,
  rows,
  createdEntities,
}: {
  project: CadProject;
  provenance: ReturnType<typeof createCogoProvenance>;
  title: string;
  summary: string;
  rows: Array<{ label: string; value: string; unit?: string }>;
  createdEntities: CadEntity[];
}): CadProject => {
  return appendCadProjectCogoComputation(
    project,
    buildCadCogoComputation({
      createdEntities,
      report: {
        title,
        summary,
        rows,
      },
      warnings: [],
      provenance,
    }),
  );
};

const expandSelectedEntityIds = (
  project: CadProject,
  selectedEntityIds: readonly CadEntityId[],
): CadEntityId[] => {
  const expanded = new Set(selectedEntityIds);
  project.entities.forEach((entity) => {
    if (entity.type === 'text' && entity.anchorEntityId && expanded.has(entity.anchorEntityId)) {
      expanded.add(entity.id);
      return;
    }
    if (entity.type === 'error-ellipse' && expanded.has(`pt:${entity.stationId}`)) {
      expanded.add(entity.id);
    }
  });
  return project.entities.filter((entity) => expanded.has(entity.id)).map((entity) => entity.id);
};

const getExpandedSelectedEntities = (snapshot: CadWorkspaceSnapshot): CadEntity[] => {
  const expandedIds = new Set(
    expandSelectedEntityIds(snapshot.project, snapshot.selection.selectedEntityIds),
  );
  return snapshot.project.entities.filter((entity) => expandedIds.has(entity.id) && !entity.locked);
};

const getExpandedEntitiesByIds = (
  project: CadProject,
  selectedEntityIds: readonly CadEntityId[],
): CadEntity[] => {
  const expandedIds = new Set(expandSelectedEntityIds(project, selectedEntityIds));
  return project.entities.filter((entity) => expandedIds.has(entity.id) && !entity.locked);
};

type CadTrimEntity = CadLineEntity | CadPolylineEntity | CadArcEntity;

interface CadTrimSegmentRef {
  segmentId: string;
  start: { x: number; y: number };
  end: { x: number; y: number };
  startLabel: string;
  endLabel: string;
  startDistance: number;
  length: number;
}

interface CadTrimInterval {
  start: number;
  end: number;
}

interface CadTrimPieceBuildOptions {
  preserveOriginalIdWhenSingle?: boolean;
  idForPiece?: (_index: number) => string;
  includeTrimMetadata?: boolean;
}

const TRIM_EPSILON = 1e-6;

const isTrimmableEntity = (entity: CadEntity): entity is CadTrimEntity =>
  entity.type === 'line' || entity.type === 'polyline' || entity.type === 'arc';

const buildTrimSegments = (entity: CadLineEntity | CadPolylineEntity): CadTrimSegmentRef[] => {
  if (entity.type === 'line') {
    return [
      {
        segmentId: `${entity.id}#0`,
        start: { x: entity.fromX, y: entity.fromY },
        end: { x: entity.toX, y: entity.toY },
        startLabel: entity.fromStationId,
        endLabel: entity.toStationId,
        startDistance: 0,
        length: cadDistance({ x: entity.fromX, y: entity.fromY }, { x: entity.toX, y: entity.toY }),
      },
    ];
  }

  const segments: CadTrimSegmentRef[] = [];
  let startDistance = 0;
  entity.vertices.slice(0, -1).forEach((vertex, index) => {
    const next = entity.vertices[index + 1]!;
    const length = cadDistance(vertex, next);
    segments.push({
      segmentId: `${entity.id}#${index}`,
      start: vertex,
      end: next,
      startLabel: entity.vertexLabels[index] ?? `V${index + 1}`,
      endLabel: entity.vertexLabels[index + 1] ?? `V${index + 2}`,
      startDistance,
      length,
    });
    startDistance += length;
  });
  return segments;
};

const trimEntityTotalLength = (entity: CadLineEntity | CadPolylineEntity): number => {
  const segments = buildTrimSegments(entity);
  if (segments.length === 0) return 0;
  const last = segments[segments.length - 1]!;
  return last.startDistance + last.length;
};

const pointAtLinePosition = (
  entity: CadLineEntity,
  position: number,
): { x: number; y: number } => {
  const start = { x: entity.fromX, y: entity.fromY };
  const end = { x: entity.toX, y: entity.toY };
  const length = cadDistance(start, end);
  if (length <= TRIM_EPSILON) return start;
  const t = Math.max(0, Math.min(1, position / length));
  return {
    x: start.x + (end.x - start.x) * t,
    y: start.y + (end.y - start.y) * t,
  };
};

const pointAtPolylinePosition = (
  entity: CadPolylineEntity,
  position: number,
): { x: number; y: number } => {
  const segments = buildTrimSegments(entity);
  if (segments.length === 0) return entity.vertices[0] ?? { x: 0, y: 0 };
  const totalLength = trimEntityTotalLength(entity);
  const clamped = Math.max(0, Math.min(totalLength, position));
  const segment =
    segments.find(
      (candidate) => clamped <= candidate.startDistance + candidate.length + TRIM_EPSILON,
    ) ?? segments[segments.length - 1]!;
  if (segment.length <= TRIM_EPSILON) return segment.start;
  const localDistance = Math.max(0, Math.min(segment.length, clamped - segment.startDistance));
  const t = localDistance / segment.length;
  return {
    x: segment.start.x + (segment.end.x - segment.start.x) * t,
    y: segment.start.y + (segment.end.y - segment.start.y) * t,
  };
};

const arcPositionAtAngle = (
  entity: CadArcEntity,
  angleDeg: number,
): number => {
  const signedSweep = cadSignedSweepDeg(entity.startAngleDeg, entity.endAngleDeg);
  const direction = signedSweep >= 0 ? 1 : -1;
  const magnitude = Math.abs(signedSweep);
  const normalizedStart = cadNormalizeAngleDeg(entity.startAngleDeg);
  const normalizedAngle = cadNormalizeAngleDeg(angleDeg);
  if (direction >= 0) {
    return Math.min(
      magnitude,
      cadNormalizeAngleDeg(normalizedAngle - normalizedStart),
    );
  }
  return Math.min(
    magnitude,
    cadNormalizeAngleDeg(normalizedStart - normalizedAngle),
  );
};

const angleAtArcPosition = (entity: CadArcEntity, position: number): number => {
  const signedSweep = cadSignedSweepDeg(entity.startAngleDeg, entity.endAngleDeg);
  const magnitude = Math.abs(signedSweep);
  const clamped = Math.max(0, Math.min(magnitude, position));
  return entity.startAngleDeg + (signedSweep >= 0 ? clamped : -clamped);
};

const trimLabelForEntity = (entityId: string, pieceIndex: number, endpoint: 'S' | 'E'): string =>
  `${entityId}:TR${pieceIndex}${endpoint}`;

const addTrimPosition = (positions: number[], value: number, total: number) => {
  if (value <= TRIM_EPSILON || value >= total - TRIM_EPSILON) return;
  if (positions.some((existing) => Math.abs(existing - value) <= TRIM_EPSILON)) return;
  positions.push(value);
};

const buildTrimKeepIntervals = (
  intersections: number[],
  pickPosition: number,
  total: number,
): CadTrimInterval[] => {
  if (total <= TRIM_EPSILON) return [];
  const boundaries = [0, ...intersections.filter((value) => value > TRIM_EPSILON && value < total - TRIM_EPSILON), total]
    .sort((left, right) => left - right);
  let removeIndex = -1;
  for (let index = 0; index < boundaries.length - 1; index += 1) {
    const start = boundaries[index]!;
    const end = boundaries[index + 1]!;
    if (pickPosition >= start - TRIM_EPSILON && pickPosition <= end + TRIM_EPSILON) {
      removeIndex = index;
      break;
    }
  }
  if (removeIndex < 0) return [];
  return boundaries
    .slice(0, -1)
    .map((start, index) => ({ start, end: boundaries[index + 1]! }))
    .filter((interval, index) => index !== removeIndex && interval.end - interval.start > TRIM_EPSILON);
};

const buildTrimBoundaryEntities = (
  project: CadProject,
  entityIds: readonly CadEntityId[],
): CadTrimEntity[] =>
  entityIds
    .map((entityId) => project.entities.find((entity) => entity.id === entityId))
    .filter((entity): entity is CadTrimEntity => entity != null && isTrimmableEntity(entity) && !entity.locked);

const buildTrimIntersectionsForLineLike = (
  target: CadLineEntity | CadPolylineEntity,
  boundaries: readonly CadTrimEntity[],
): number[] => {
  const positions: number[] = [];
  const segments = buildTrimSegments(target);
  const totalLength = trimEntityTotalLength(target);
  boundaries.forEach((boundary) => {
    if (boundary.id === target.id) return;
    if (boundary.type === 'arc') {
      segments.forEach((segment) => {
        cadIntersectSegmentArc(
          segment.start,
          segment.end,
          { x: boundary.centerX, y: boundary.centerY },
          boundary.radius,
          boundary.startAngleDeg,
          boundary.endAngleDeg,
        ).forEach((point) => {
          addTrimPosition(
            positions,
            segment.startDistance + cadDistance(segment.start, point),
            totalLength,
          );
        });
      });
      return;
    }
    const boundarySegments = buildTrimSegments(boundary);
    segments.forEach((targetSegment) => {
      boundarySegments.forEach((boundarySegment) => {
        const point = cadSegmentIntersection(
          targetSegment.start,
          targetSegment.end,
          boundarySegment.start,
          boundarySegment.end,
        );
        if (!point) return;
        addTrimPosition(
          positions,
          targetSegment.startDistance + cadDistance(targetSegment.start, point),
          totalLength,
        );
      });
    });
  });
  return positions.sort((left, right) => left - right);
};

const buildTrimIntersectionsForArc = (
  target: CadArcEntity,
  boundaries: readonly CadTrimEntity[],
): number[] => {
  const positions: number[] = [];
  const totalSweep = Math.abs(cadSignedSweepDeg(target.startAngleDeg, target.endAngleDeg));
  boundaries.forEach((boundary) => {
    if (boundary.id === target.id) return;
    if (boundary.type === 'arc') {
      cadIntersectArcArc(
        { x: target.centerX, y: target.centerY },
        target.radius,
        target.startAngleDeg,
        target.endAngleDeg,
        { x: boundary.centerX, y: boundary.centerY },
        boundary.radius,
        boundary.startAngleDeg,
        boundary.endAngleDeg,
      ).forEach((point) => {
        addTrimPosition(
          positions,
          arcPositionAtAngle(
            target,
            cadAngleDegFromCenter({ x: target.centerX, y: target.centerY }, point),
          ),
          totalSweep,
        );
      });
      return;
    }
    buildTrimSegments(boundary).forEach((segment) => {
      cadIntersectSegmentArc(
        segment.start,
        segment.end,
        { x: target.centerX, y: target.centerY },
        target.radius,
        target.startAngleDeg,
        target.endAngleDeg,
      ).forEach((point) => {
        addTrimPosition(
          positions,
          arcPositionAtAngle(
            target,
            cadAngleDegFromCenter({ x: target.centerX, y: target.centerY }, point),
          ),
          totalSweep,
        );
      });
    });
  });
  return positions.sort((left, right) => left - right);
};

const buildTrimmedLinePieces = (
  entity: CadLineEntity,
  intervals: readonly CadTrimInterval[],
  options?: CadTrimPieceBuildOptions,
): CadLineEntity[] => {
  const totalLength = trimEntityTotalLength(entity);
  return intervals.flatMap((interval, index) => {
    const start = pointAtLinePosition(entity, interval.start);
    const end = pointAtLinePosition(entity, interval.end);
    if (cadDistance(start, end) <= TRIM_EPSILON) return [];
    const preserveId =
      intervals.length === 1 && (options?.preserveOriginalIdWhenSingle ?? true);
    return [{
      ...entity,
      id: preserveId ? entity.id : options?.idForPiece?.(index) ?? createStableRuntimeId('cad-line'),
      fromStationId:
        interval.start <= TRIM_EPSILON ? entity.fromStationId : trimLabelForEntity(entity.id, index + 1, 'S'),
      toStationId:
        interval.end >= totalLength - TRIM_EPSILON ? entity.toStationId : trimLabelForEntity(entity.id, index + 1, 'E'),
      fromX: start.x,
      fromY: start.y,
      toX: end.x,
      toY: end.y,
      metadata:
        options?.includeTrimMetadata === false
          ? entity.metadata
          : {
              ...entity.metadata,
              createdBy: 'TRIM',
              manual: true,
            },
    }];
  });
};

const buildTrimmedPolylinePieces = (
  entity: CadPolylineEntity,
  intervals: readonly CadTrimInterval[],
  options?: CadTrimPieceBuildOptions,
): CadPolylineEntity[] => {
  const totalLength = trimEntityTotalLength(entity);
  const vertexDistances = buildTrimSegments(entity).map((segment) => segment.startDistance);
  vertexDistances.push(totalLength);
  return intervals.flatMap((interval, index) => {
    const points = [pointAtPolylinePosition(entity, interval.start)];
    const labels = [
      interval.start <= TRIM_EPSILON
        ? entity.vertexLabels[0] ?? 'V1'
        : trimLabelForEntity(entity.id, index + 1, 'S'),
    ];
    entity.vertices.forEach((vertex, vertexIndex) => {
      const distance = vertexDistances[vertexIndex] ?? 0;
      if (distance <= interval.start + TRIM_EPSILON || distance >= interval.end - TRIM_EPSILON) return;
      points.push(vertex);
      labels.push(entity.vertexLabels[vertexIndex] ?? `V${vertexIndex + 1}`);
    });
    const endPoint = pointAtPolylinePosition(entity, interval.end);
    if (cadDistance(points[points.length - 1]!, endPoint) > TRIM_EPSILON) {
      points.push(endPoint);
      labels.push(
        interval.end >= totalLength - TRIM_EPSILON
          ? entity.vertexLabels[entity.vertexLabels.length - 1] ?? `V${entity.vertexLabels.length}`
          : trimLabelForEntity(entity.id, index + 1, 'E'),
      );
    } else if (interval.end >= totalLength - TRIM_EPSILON) {
      labels[labels.length - 1] = entity.vertexLabels[entity.vertexLabels.length - 1] ?? `V${entity.vertexLabels.length}`;
    }
    if (points.length < 2) return [];
    const preserveId =
      intervals.length === 1 && (options?.preserveOriginalIdWhenSingle ?? true);
    return [{
      ...entity,
      id:
        preserveId
          ? entity.id
          : options?.idForPiece?.(index) ?? createStableRuntimeId('cad-polyline'),
      vertices: points,
      vertexLabels: labels,
      metadata:
        options?.includeTrimMetadata === false
          ? entity.metadata
          : {
              ...entity.metadata,
              createdBy: 'TRIM',
              manual: true,
            },
    }];
  });
};

const buildTrimmedArcPieces = (
  entity: CadArcEntity,
  intervals: readonly CadTrimInterval[],
  options?: CadTrimPieceBuildOptions,
): CadArcEntity[] => {
  const totalSweep = Math.abs(cadSignedSweepDeg(entity.startAngleDeg, entity.endAngleDeg));
  return intervals.flatMap((interval, index) => {
    if (interval.end - interval.start <= TRIM_EPSILON) return [];
    const preserveId =
      intervals.length === 1 && (options?.preserveOriginalIdWhenSingle ?? true);
    return [{
      ...entity,
      id: preserveId ? entity.id : options?.idForPiece?.(index) ?? createStableRuntimeId('cad-arc'),
      startAngleDeg: angleAtArcPosition(entity, interval.start),
      endAngleDeg: angleAtArcPosition(entity, interval.end),
      metadata:
        options?.includeTrimMetadata === false
          ? entity.metadata
          : {
              ...entity.metadata,
              createdBy: 'TRIM',
              manual: true,
              trimPiece: index + 1,
              trimmedFromArcId: entity.id,
              trimmedTotalSweepDeg: totalSweep,
            },
    }];
  });
};

const buildTrimmedEntityPieces = (
  entity: CadTrimEntity,
  boundaries: readonly CadTrimEntity[],
  pickPoint: { x: number; y: number },
  targetSegmentId?: string,
  options?: CadTrimPieceBuildOptions,
): CadEntity[] => {
  if (entity.type === 'line') {
    const intersections = buildTrimIntersectionsForLineLike(entity, boundaries);
    if (intersections.length === 0) return [];
    const start = { x: entity.fromX, y: entity.fromY };
    const end = { x: entity.toX, y: entity.toY };
    const projection =
      targetSegmentId === `${entity.id}#0`
        ? cadProjectPointOntoInfiniteLine(pickPoint, start, end)
        : cadProjectPointOntoInfiniteLine(cadClosestPointOnSegment(pickPoint, start, end), start, end);
    const pickPosition = cadDistance(start, projection.point);
    return buildTrimmedLinePieces(
      entity,
      buildTrimKeepIntervals(intersections, pickPosition, trimEntityTotalLength(entity)),
      options,
    );
  }

  if (entity.type === 'polyline') {
    const intersections = buildTrimIntersectionsForLineLike(entity, boundaries);
    if (intersections.length === 0) return [];
    const segments = buildTrimSegments(entity);
    const pickedSegment =
      (targetSegmentId
        ? segments.find((segment) => segment.segmentId === targetSegmentId)
        : null) ??
      segments
        .map((segment) => ({
          segment,
          point: cadClosestPointOnSegment(pickPoint, segment.start, segment.end),
        }))
        .sort(
          (left, right) =>
            cadDistance(left.point, pickPoint) - cadDistance(right.point, pickPoint),
        )[0]?.segment ??
      null;
    if (!pickedSegment) return [];
    const projectedPoint = cadClosestPointOnSegment(pickPoint, pickedSegment.start, pickedSegment.end);
    const pickPosition =
      pickedSegment.startDistance + cadDistance(pickedSegment.start, projectedPoint);
    return buildTrimmedPolylinePieces(
      entity,
      buildTrimKeepIntervals(intersections, pickPosition, trimEntityTotalLength(entity)),
      options,
    );
  }

  const intersections = buildTrimIntersectionsForArc(entity, boundaries);
  if (intersections.length === 0) return [];
  const closestPoint = cadClosestPointOnArc(
    pickPoint,
    { x: entity.centerX, y: entity.centerY },
    entity.radius,
    entity.startAngleDeg,
    entity.endAngleDeg,
  );
  const pickPosition = arcPositionAtAngle(
    entity,
    cadAngleDegFromCenter({ x: entity.centerX, y: entity.centerY }, closestPoint),
  );
  return buildTrimmedArcPieces(
    entity,
    buildTrimKeepIntervals(
      intersections,
      pickPosition,
      Math.abs(cadSignedSweepDeg(entity.startAngleDeg, entity.endAngleDeg)),
    ),
    options,
  );
};

const pointOnSegmentInclusive = (
  point: { x: number; y: number },
  start: { x: number; y: number },
  end: { x: number; y: number },
): boolean => {
  const projection = cadProjectPointOntoInfiniteLine(point, start, end);
  if (projection.t < -TRIM_EPSILON || projection.t > 1 + TRIM_EPSILON) return false;
  return cadDistance(point, projection.point) <= 1e-6;
};

const collectLineExtensionIntersections = (
  lineStart: { x: number; y: number },
  lineEnd: { x: number; y: number },
  boundaries: readonly CadTrimEntity[],
  excludeEntityId: CadEntityId,
): Array<{ point: { x: number; y: number }; t: number }> => {
  const intersections: Array<{ point: { x: number; y: number }; t: number }> = [];
  boundaries.forEach((boundary) => {
    if (boundary.id === excludeEntityId) return;
    if (boundary.type === 'arc') {
      cadIntersectInfiniteLineArc(
        lineStart,
        lineEnd,
        { x: boundary.centerX, y: boundary.centerY },
        boundary.radius,
        boundary.startAngleDeg,
        boundary.endAngleDeg,
      ).forEach((point) => {
        intersections.push({
          point,
          t: cadProjectPointOntoInfiniteLine(point, lineStart, lineEnd).t,
        });
      });
      return;
    }
    buildTrimSegments(boundary).forEach((segment) => {
      const point = cadInfiniteLineIntersection(lineStart, lineEnd, segment.start, segment.end);
      if (!point || !pointOnSegmentInclusive(point, segment.start, segment.end)) return;
      intersections.push({
        point,
        t: cadProjectPointOntoInfiniteLine(point, lineStart, lineEnd).t,
      });
    });
  });
  return intersections;
};

const buildExtendedLineEntity = (
  entity: CadLineEntity,
  boundaries: readonly CadTrimEntity[],
  pickPoint: { x: number; y: number },
): CadLineEntity | null => {
  const start = { x: entity.fromX, y: entity.fromY };
  const end = { x: entity.toX, y: entity.toY };
  const projectedPick = cadProjectPointOntoInfiniteLine(pickPoint, start, end).point;
  const extendStart = cadDistance(projectedPick, start) <= cadDistance(projectedPick, end);
  const candidate = collectLineExtensionIntersections(start, end, boundaries, entity.id)
    .filter(({ t }) => (extendStart ? t < -TRIM_EPSILON : t > 1 + TRIM_EPSILON))
    .sort((left, right) => (extendStart ? right.t - left.t : left.t - right.t))[0];
  if (!candidate) return null;
  return extendStart
    ? {
        ...entity,
        fromX: candidate.point.x,
        fromY: candidate.point.y,
        metadata: {
          ...entity.metadata,
          createdBy: 'TRIM',
          manual: true,
        },
      }
    : {
        ...entity,
        toX: candidate.point.x,
        toY: candidate.point.y,
        metadata: {
          ...entity.metadata,
          createdBy: 'TRIM',
          manual: true,
        },
      };
};

const buildExtendedPolylineEntity = (
  entity: CadPolylineEntity,
  boundaries: readonly CadTrimEntity[],
  pickPoint: { x: number; y: number },
  targetSegmentId?: string,
): CadPolylineEntity | null => {
  if (entity.vertices.length < 2) return null;
  const segments = buildTrimSegments(entity);
  const totalLength = trimEntityTotalLength(entity);
  const pickedSegment =
    (targetSegmentId
      ? segments.find((segment) => segment.segmentId === targetSegmentId)
      : null) ??
    segments
      .map((segment) => ({
        segment,
        point: cadClosestPointOnSegment(pickPoint, segment.start, segment.end),
      }))
      .sort((left, right) => cadDistance(left.point, pickPoint) - cadDistance(right.point, pickPoint))[0]?.segment ??
    null;
  if (!pickedSegment) return null;
  const projectedPoint = cadClosestPointOnSegment(pickPoint, pickedSegment.start, pickedSegment.end);
  const pickPosition = pickedSegment.startDistance + cadDistance(pickedSegment.start, projectedPoint);
  const extendStart = pickPosition <= totalLength / 2;
  const lineStart = extendStart ? entity.vertices[1]! : entity.vertices[entity.vertices.length - 2]!;
  const lineEnd = extendStart ? entity.vertices[0]! : entity.vertices[entity.vertices.length - 1]!;
  const candidate = collectLineExtensionIntersections(lineStart, lineEnd, boundaries, entity.id)
    .filter(({ t }) => t > 1 + TRIM_EPSILON)
    .sort((left, right) => left.t - right.t)[0];
  if (!candidate) return null;
  return {
    ...entity,
    vertices: entity.vertices.map((vertex, index) =>
      index === (extendStart ? 0 : entity.vertices.length - 1)
        ? { x: candidate.point.x, y: candidate.point.y }
        : vertex,
    ),
    metadata: {
      ...entity.metadata,
      createdBy: 'TRIM',
      manual: true,
    },
  };
};

const collectArcExtensionIntersections = (
  arc: CadArcEntity,
  boundaries: readonly CadTrimEntity[],
): number[] => {
  const positions: number[] = [];
  boundaries.forEach((boundary) => {
    if (boundary.id === arc.id) return;
    if (boundary.type === 'arc') {
      cadIntersectArcArc(
        { x: arc.centerX, y: arc.centerY },
        arc.radius,
        0,
        360,
        { x: boundary.centerX, y: boundary.centerY },
        boundary.radius,
        boundary.startAngleDeg,
        boundary.endAngleDeg,
      ).forEach((point) => {
        addTrimPosition(
          positions,
          arcPositionAtAngle(arc, cadAngleDegFromCenter({ x: arc.centerX, y: arc.centerY }, point)),
          360,
        );
      });
      return;
    }
    buildTrimSegments(boundary).forEach((segment) => {
      cadIntersectSegmentArc(
        segment.start,
        segment.end,
        { x: arc.centerX, y: arc.centerY },
        arc.radius,
        0,
        360,
      ).forEach((point) => {
        addTrimPosition(
          positions,
          arcPositionAtAngle(arc, cadAngleDegFromCenter({ x: arc.centerX, y: arc.centerY }, point)),
          360,
        );
      });
    });
  });
  return positions.sort((left, right) => left - right);
};

const buildExtendedArcEntity = (
  entity: CadArcEntity,
  boundaries: readonly CadTrimEntity[],
  pickPoint: { x: number; y: number },
): CadArcEntity | null => {
  const totalSweep = Math.abs(cadSignedSweepDeg(entity.startAngleDeg, entity.endAngleDeg));
  const closestPoint = cadClosestPointOnArc(
    pickPoint,
    { x: entity.centerX, y: entity.centerY },
    entity.radius,
    entity.startAngleDeg,
    entity.endAngleDeg,
  );
  const pickPosition = arcPositionAtAngle(
    entity,
    cadAngleDegFromCenter({ x: entity.centerX, y: entity.centerY }, closestPoint),
  );
  const extendStart = pickPosition <= totalSweep / 2;
  const sweepSign = cadSignedSweepDeg(entity.startAngleDeg, entity.endAngleDeg) >= 0 ? 1 : -1;
  const currentStartNorm = cadNormalizeAngleDeg(entity.startAngleDeg);
  const currentEndNorm = cadNormalizeAngleDeg(entity.endAngleDeg);
  const candidate = collectArcExtensionIntersections(entity, boundaries)
    .map((position) => {
      const angleDeg = cadNormalizeAngleDeg(angleAtArcPosition(entity, position));
      if (cadIsAngleOnArcSweep(angleDeg, entity.startAngleDeg, entity.endAngleDeg, 1e-6)) {
        const atStart = cadNormalizeAngleDeg(angleDeg - currentStartNorm) <= 1e-6;
        const atEnd = cadNormalizeAngleDeg(currentEndNorm - angleDeg) <= 1e-6;
        if (!(atStart || atEnd)) return null;
      }
      const delta = extendStart
        ? (sweepSign >= 0
            ? cadNormalizeAngleDeg(currentStartNorm - angleDeg)
            : cadNormalizeAngleDeg(angleDeg - currentStartNorm))
        : (sweepSign >= 0
            ? cadNormalizeAngleDeg(angleDeg - currentEndNorm)
            : cadNormalizeAngleDeg(currentEndNorm - angleDeg));
      if (delta <= TRIM_EPSILON) return null;
      return { delta };
    })
    .filter((entry): entry is { delta: number } => entry != null)
    .sort((left, right) => left.delta - right.delta)[0];
  if (!candidate) return null;
  return extendStart
    ? {
        ...entity,
        startAngleDeg: sweepSign >= 0 ? entity.startAngleDeg - candidate.delta : entity.startAngleDeg + candidate.delta,
        metadata: {
          ...entity.metadata,
          createdBy: 'TRIM',
          manual: true,
        },
      }
    : {
        ...entity,
        endAngleDeg: sweepSign >= 0 ? entity.endAngleDeg + candidate.delta : entity.endAngleDeg - candidate.delta,
        metadata: {
          ...entity.metadata,
          createdBy: 'TRIM',
          manual: true,
        },
      };
};

const buildExtendedTrimEntity = (
  entity: CadTrimEntity,
  boundaries: readonly CadTrimEntity[],
  pickPoint: { x: number; y: number },
  targetSegmentId?: string,
): CadEntity[] => {
  if (entity.type === 'line') {
    const extended = buildExtendedLineEntity(entity, boundaries, pickPoint);
    return extended ? [extended] : [];
  }
  if (entity.type === 'polyline') {
    const extended = buildExtendedPolylineEntity(entity, boundaries, pickPoint, targetSegmentId);
    return extended ? [extended] : [];
  }
  const extended = buildExtendedArcEntity(entity, boundaries, pickPoint);
  return extended ? [extended] : [];
};

export interface CadTrimPreview {
  targetEntityId: CadEntityId;
  previewEntities: CadEntity[];
}

export interface CadFilletPreview {
  firstLineEntityId: CadEntityId;
  secondLineEntityId: CadEntityId;
  previewEntities: CadEntity[];
}

export const buildCadTrimPreview = (
  project: CadProject,
  cuttingEntityIds: readonly CadEntityId[],
  targetEntityId: CadEntityId,
  pickPoint: { x: number; y: number },
  targetSegmentId?: string,
  extendMode = false,
): CadTrimPreview | null => {
  const cuttingEntities = buildTrimBoundaryEntities(project, cuttingEntityIds);
  if (cuttingEntities.length === 0) return null;
  if (cuttingEntities.some((entity) => entity.id === targetEntityId)) return null;
  const targetEntity = project.entities.find(
    (entity): entity is CadTrimEntity =>
      entity.id === targetEntityId && isTrimmableEntity(entity) && !entity.locked,
  );
  if (!targetEntity) return null;
  const previewEntities = (
    extendMode
      ? buildExtendedTrimEntity(targetEntity, cuttingEntities, pickPoint, targetSegmentId)
      : buildTrimmedEntityPieces(
          targetEntity,
          cuttingEntities,
          pickPoint,
          targetSegmentId,
          {
            preserveOriginalIdWhenSingle: false,
            idForPiece: (index) => `${targetEntity.id}:trim-preview:${index + 1}`,
            includeTrimMetadata: false,
          },
        )
  ).map((entity, index) => ({
    ...entity,
    id: `${targetEntity.id}:trim-preview:${index + 1}`,
    metadata: targetEntity.metadata,
  }));
  if (previewEntities.length === 0) return null;
  return {
    targetEntityId: targetEntity.id,
    previewEntities,
  };
};

export const buildCadFilletPreview = (
  project: CadProject,
  radius: number,
  firstLineEntityId: CadEntityId,
  firstPickPoint: { x: number; y: number },
  secondLineEntityId: CadEntityId,
  secondPickPoint: { x: number; y: number },
): CadFilletPreview | null => {
  if (firstLineEntityId === secondLineEntityId) return null;
  const firstLine = project.entities.find(
    (entity): entity is CadLineEntity =>
      entity.type === 'line' && entity.id === firstLineEntityId && !entity.locked,
  );
  const secondLine = project.entities.find(
    (entity): entity is CadLineEntity =>
      entity.type === 'line' && entity.id === secondLineEntityId && !entity.locked,
  );
  if (!firstLine || !secondLine) return null;
  const fillet = buildCadLineFillet(
    firstLine,
    firstPickPoint,
    secondLine,
    secondPickPoint,
    radius,
  );
  if (!fillet) return null;
  return {
    firstLineEntityId,
    secondLineEntityId,
    previewEntities: [
      {
        ...fillet.firstLine,
        id: `${firstLineEntityId}:fillet-preview`,
      },
      {
        ...fillet.secondLine,
        id: `${secondLineEntityId}:fillet-preview`,
      },
      ...(fillet.arcDefinition
        ? [{
            id: 'fillet-preview:arc',
            type: 'arc' as const,
            layerId: 'preview',
            styleId: 'style-observation-line',
            visible: true,
            locked: false,
            centerX: fillet.arcDefinition.center.x,
            centerY: fillet.arcDefinition.center.y,
            radius: fillet.arcDefinition.radius,
            startAngleDeg: fillet.arcDefinition.startAngleDeg,
            endAngleDeg: fillet.arcDefinition.endAngleDeg,
            metadata: {
              createdBy: 'FILLET_PREVIEW',
            },
          }]
        : []),
    ],
  };
};

const translateEntity = (entity: CadEntity, deltaX: number, deltaY: number): CadEntity => {
  switch (entity.type) {
    case 'survey-point':
      return {
        ...entity,
        x: entity.x + deltaX,
        y: entity.y + deltaY,
      };
    case 'line':
      return {
        ...entity,
        fromX: entity.fromX + deltaX,
        fromY: entity.fromY + deltaY,
        toX: entity.toX + deltaX,
        toY: entity.toY + deltaY,
      };
    case 'polyline':
    case 'polygon':
    case 'parcel':
      return {
        ...entity,
        vertices: entity.vertices.map((vertex) => ({
          x: vertex.x + deltaX,
          y: vertex.y + deltaY,
        })),
      };
    case 'arc':
      return {
        ...entity,
        centerX: entity.centerX + deltaX,
        centerY: entity.centerY + deltaY,
      };
    case 'alignment':
      return {
        ...entity,
        elements: entity.elements.map((element) =>
          element.kind === 'line'
            ? {
                ...element,
                start: { x: element.start.x + deltaX, y: element.start.y + deltaY },
                end: { x: element.end.x + deltaX, y: element.end.y + deltaY },
              }
            : {
                ...element,
                center: { x: element.center.x + deltaX, y: element.center.y + deltaY },
              },
        ),
      };
    case 'text':
      return {
        ...entity,
        x: entity.x + deltaX,
        y: entity.y + deltaY,
      };
    case 'error-ellipse':
      return {
        ...entity,
        centerX: entity.centerX + deltaX,
        centerY: entity.centerY + deltaY,
      };
  }
};

const cadCounterClockwiseDeltaDeg = (startAngleDeg: number, endAngleDeg: number): number =>
  cadNormalizeAngleDeg(endAngleDeg - startAngleDeg);

const rebuildParcelMetrics = (entity: CadParcelEntity): CadParcelEntity => {
  const metrics = cadBuildParcelClosureSummary(entity.vertices);
  if (!metrics) {
    return {
      ...entity,
      areaSquareMeters: undefined,
      perimeterMeters: undefined,
      closureDeltaX: undefined,
      closureDeltaY: undefined,
      closureDistanceMeters: undefined,
    };
  }
  return {
    ...entity,
    areaSquareMeters: metrics.areaSquareMeters,
    perimeterMeters: metrics.perimeterMeters,
    closureDeltaX: metrics.closureDeltaX,
    closureDeltaY: metrics.closureDeltaY,
    closureDistanceMeters: metrics.closureDistanceMeters,
  };
};

const updateArcEndpointFromGrip = (
  entity: Extract<CadEntity, { type: 'arc' }>,
  gripKind: 'arc-start' | 'arc-end',
  point: { x: number; y: number },
): Extract<CadEntity, { type: 'arc' }> | null => {
  const projectedPoint = cadProjectPointOntoCircle(
    point,
    { x: entity.centerX, y: entity.centerY },
    entity.radius,
  );
  const movedAngleNorm = cadAngleDegFromCenter(
    { x: entity.centerX, y: entity.centerY },
    projectedPoint,
  );
  const currentSweep = entity.endAngleDeg - entity.startAngleDeg;
  if (gripKind === 'arc-start') {
    if (currentSweep >= 0) {
      const magnitude = cadCounterClockwiseDeltaDeg(movedAngleNorm, cadNormalizeAngleDeg(entity.endAngleDeg));
      if (magnitude <= 1e-6) {
        return {
          ...entity,
          startAngleDeg: entity.endAngleDeg - 360,
        };
      }
      return {
        ...entity,
        startAngleDeg: entity.endAngleDeg - magnitude,
      };
    }
    const magnitude = cadCounterClockwiseDeltaDeg(cadNormalizeAngleDeg(entity.endAngleDeg), movedAngleNorm);
    if (magnitude <= 1e-6) {
      return {
        ...entity,
        startAngleDeg: entity.endAngleDeg + 360,
      };
    }
    return {
      ...entity,
      startAngleDeg: entity.endAngleDeg + magnitude,
    };
  }
  if (currentSweep >= 0) {
    const magnitude = cadCounterClockwiseDeltaDeg(cadNormalizeAngleDeg(entity.startAngleDeg), movedAngleNorm);
    if (magnitude <= 1e-6) {
      return {
        ...entity,
        endAngleDeg: entity.startAngleDeg + 360,
      };
    }
    return {
      ...entity,
      endAngleDeg: entity.startAngleDeg + magnitude,
    };
  }
  const magnitude = cadCounterClockwiseDeltaDeg(movedAngleNorm, cadNormalizeAngleDeg(entity.startAngleDeg));
  if (magnitude <= 1e-6) {
    return {
      ...entity,
      endAngleDeg: entity.startAngleDeg - 360,
    };
  }
  return {
    ...entity,
    endAngleDeg: entity.startAngleDeg - magnitude,
  };
};

const updateEntityFromGrip = (
  entity: CadEntity,
  gripKind: CadGripHandleKind,
  point: { x: number; y: number },
  vertexIndex?: number,
): CadEntity | null => {
  switch (entity.type) {
    case 'line':
      if (gripKind === 'line-start') {
        return {
          ...entity,
          fromX: point.x,
          fromY: point.y,
        };
      }
      if (gripKind === 'line-end') {
        return {
          ...entity,
          toX: point.x,
          toY: point.y,
        };
      }
      return null;
    case 'polyline':
    case 'polygon':
      if (gripKind !== 'vertex' || vertexIndex == null || vertexIndex < 0 || vertexIndex >= entity.vertices.length) {
        return null;
      }
      return {
        ...entity,
        vertices: entity.vertices.map((vertex, index) =>
          index === vertexIndex ? { x: point.x, y: point.y } : vertex,
        ),
      };
    case 'parcel':
      if (gripKind !== 'vertex' || vertexIndex == null || vertexIndex < 0 || vertexIndex >= entity.vertices.length) {
        return null;
      }
      return rebuildParcelMetrics({
        ...entity,
        vertices: entity.vertices.map((vertex, index) =>
          index === vertexIndex ? { x: point.x, y: point.y } : vertex,
        ),
      });
    case 'arc':
      if (gripKind === 'arc-radius') {
        const radius = Math.hypot(point.x - entity.centerX, point.y - entity.centerY);
        if (!Number.isFinite(radius) || radius <= 1e-6) return null;
        return {
          ...entity,
          radius,
        };
      }
      if (gripKind === 'arc-start' || gripKind === 'arc-end') {
        return updateArcEndpointFromGrip(entity, gripKind, point);
      }
      return null;
    default:
      return null;
  }
};

export const buildCadGripHandles = (entity: CadEntity): CadGripHandle[] => {
  switch (entity.type) {
    case 'line':
      return [
        {
          id: `${entity.id}:line-start`,
          entityId: entity.id,
          kind: 'line-start',
          x: entity.fromX,
          y: entity.fromY,
        },
        {
          id: `${entity.id}:line-end`,
          entityId: entity.id,
          kind: 'line-end',
          x: entity.toX,
          y: entity.toY,
        },
      ];
    case 'polyline':
    case 'polygon':
    case 'parcel':
      return entity.vertices.map((vertex, index) => ({
        id: `${entity.id}:vertex:${index}`,
        entityId: entity.id,
        kind: 'vertex',
        x: vertex.x,
        y: vertex.y,
        vertexIndex: index,
      }));
    case 'arc': {
      const startPoint = cadPointOnCircle(
        { x: entity.centerX, y: entity.centerY },
        entity.radius,
        entity.startAngleDeg,
      );
      const endPoint = cadPointOnCircle(
        { x: entity.centerX, y: entity.centerY },
        entity.radius,
        entity.endAngleDeg,
      );
      const radiusPoint = cadArcMidpoint(
        { x: entity.centerX, y: entity.centerY },
        entity.radius,
        entity.startAngleDeg,
        entity.endAngleDeg,
      );
      return [
        {
          id: `${entity.id}:arc-start`,
          entityId: entity.id,
          kind: 'arc-start',
          x: startPoint.x,
          y: startPoint.y,
        },
        {
          id: `${entity.id}:arc-end`,
          entityId: entity.id,
          kind: 'arc-end',
          x: endPoint.x,
          y: endPoint.y,
        },
        {
          id: `${entity.id}:arc-radius`,
          entityId: entity.id,
          kind: 'arc-radius',
          x: radiusPoint.x,
          y: radiusPoint.y,
        },
      ];
    }
    default:
      return [];
  }
};

export const applyCadGripEdit = (
  project: CadProject,
  command: Extract<CadCommand, { key: 'GRIP_EDIT' }>,
): CadProject | null => {
  const entity = project.entities.find((candidate) => candidate.id === command.entityId && !candidate.locked);
  if (!entity) return null;
  const updatedEntity = updateEntityFromGrip(
    entity,
    command.gripKind,
    { x: command.x, y: command.y },
    command.vertexIndex,
  );
  if (!updatedEntity) return null;
  const nextProject = replaceCadProjectEntities(
    project,
    project.entities.map((candidate) => (candidate.id === entity.id ? updatedEntity : candidate)),
  );
  return syncEditedEntityDependencies(nextProject, entity, updatedEntity);
};

const buildCopiedEntities = (
  project: CadProject,
  selectedEntities: CadEntity[],
  deltaX: number,
  deltaY: number,
): CadEntity[] => {
  const selectedPointStationIds = new Set(
    selectedEntities
      .filter((entity): entity is CadSurveyPointEntity => entity.type === 'survey-point')
      .map((entity) => entity.stationId),
  );
  const { copiedEntities, copiedPointByStationId, copiedArcSupportBySourceId } = buildCopiedDependentPointEntities(
    project,
    selectedEntities,
    deltaX,
    deltaY,
  );

  selectedEntities.forEach((entity) => {
    if (entity.type === 'survey-point') return;
    if (entity.type === 'text' && entity.anchorEntityId) {
      const anchoredStationId = entity.anchorEntityId.startsWith('pt:')
        ? entity.anchorEntityId.slice(3)
        : null;
      if (anchoredStationId && copiedPointByStationId.has(anchoredStationId)) return;
    }
    if (entity.type === 'error-ellipse' && selectedPointStationIds.has(entity.stationId)) return;

    switch (entity.type) {
      case 'line': {
        const copiedFrom = copiedPointByStationId.get(entity.fromStationId);
        const copiedTo = copiedPointByStationId.get(entity.toStationId);
        copiedEntities.push({
          ...entity,
          id: createStableRuntimeId('cad-line'),
          fromStationId: copiedFrom?.stationId ?? entity.fromStationId,
          toStationId: copiedTo?.stationId ?? entity.toStationId,
          fromX: copiedFrom?.x ?? entity.fromX + deltaX,
          fromY: copiedFrom?.y ?? entity.fromY + deltaY,
          toX: copiedTo?.x ?? entity.toX + deltaX,
          toY: copiedTo?.y ?? entity.toY + deltaY,
          metadata: {
            ...entity.metadata,
            createdBy: 'COPY',
            manual: true,
          },
        });
        break;
      }
      case 'polyline':
      case 'polygon':
      case 'parcel':
        copiedEntities.push({
          ...entity,
          id: createStableRuntimeId(
            entity.type === 'polyline'
              ? 'cad-polyline'
              : entity.type === 'polygon'
                ? 'cad-polygon'
                : 'cad-parcel',
          ),
          vertices: entity.vertices.map((vertex) => ({
            x: vertex.x + deltaX,
            y: vertex.y + deltaY,
          })),
          vertexLabels: entity.vertexLabels.map(
            (label) => copiedPointByStationId.get(label)?.stationId ?? label,
          ),
          metadata: {
            ...entity.metadata,
            createdBy: 'COPY',
            manual: true,
          },
        });
        break;
      case 'arc':
        {
          const copiedArcSupport = copiedArcSupportBySourceId.get(entity.id);
          const copiedArc = {
          ...entity,
          id: createStableRuntimeId('cad-arc'),
          centerX: entity.centerX + deltaX,
          centerY: entity.centerY + deltaY,
          metadata: {
            ...entity.metadata,
            entityName:
              copiedArcSupport != null
                ? buildCurveLabels(copiedArcSupport.sequence).curveName
                : getCadEntityEditableName(entity),
            createdBy: 'COPY',
            manual: true,
          },
          } satisfies CadArcEntity;
          copiedEntities.push(copiedArc);
          if (copiedArcSupport) {
            copiedArcSupport.arcSupportEntities.forEach((supportEntity) => {
              const replacement =
                supportEntity.type === 'survey-point'
                  ? {
                      ...supportEntity,
                      metadata: {
                        ...cloneEntityMetadata(supportEntity),
                        anchorCurveEntityId: copiedArc.id,
                      },
                    }
                  : {
                      ...supportEntity,
                      anchorEntityId:
                        supportEntity.anchorEntityId && supportEntity.anchorEntityId.startsWith('pt:')
                          ? `pt:${supportEntity.text}`
                          : supportEntity.anchorEntityId,
                      metadata: {
                        ...cloneEntityMetadata(supportEntity),
                        anchorCurveEntityId: copiedArc.id,
                      },
                    };
              const index = copiedEntities.findIndex((candidate) => candidate.id === supportEntity.id);
              if (index >= 0) copiedEntities[index] = replacement;
            });
          }
        }
        break;
      case 'alignment':
        copiedEntities.push({
          ...entity,
          id: createStableRuntimeId('cad-alignment'),
          elements: entity.elements.map((element) =>
            element.kind === 'line'
              ? {
                  ...element,
                  start: { x: element.start.x + deltaX, y: element.start.y + deltaY },
                  end: { x: element.end.x + deltaX, y: element.end.y + deltaY },
                }
              : {
                  ...element,
                  center: { x: element.center.x + deltaX, y: element.center.y + deltaY },
                },
          ),
          metadata: {
            ...entity.metadata,
            createdBy: 'COPY',
            manual: true,
          },
        });
        break;
      case 'text':
        copiedEntities.push({
          ...entity,
          id: createStableRuntimeId('cad-text'),
          x: entity.x + deltaX,
          y: entity.y + deltaY,
          anchorEntityId: undefined,
          metadata: {
            ...entity.metadata,
            createdBy: 'COPY',
            manual: true,
          },
        });
        break;
      case 'error-ellipse':
        copiedEntities.push({
          ...entity,
          id: createStableRuntimeId('cad-ellipse'),
          centerX: entity.centerX + deltaX,
          centerY: entity.centerY + deltaY,
          metadata: {
            ...entity.metadata,
            createdBy: 'COPY',
            manual: true,
          },
        });
        break;
      default:
        break;
    }
  });

  return copiedEntities;
};

const selectAllCommand: CadCommandDefinition<{ key: 'SELECT_ALL' }> = {
  key: 'SELECT_ALL',
  execute: (snapshot) => {
    const nextSelection = selectAllCadEntities(snapshot.project);
    if (nextSelection.selectedEntityIds.length === snapshot.selection.selectedEntityIds.length) {
      const same =
        nextSelection.selectedEntityIds.every(
          (entityId, index) => snapshot.selection.selectedEntityIds[index] === entityId,
        );
      if (same) return null;
    }
    return {
      nextSnapshot: {
        project: snapshot.project,
        selection: nextSelection,
      },
      commandState: {
        key: 'SELECT_ALL',
        phase: 'committed',
        prompt: 'SELECT_ALL committed. All visible entities selected.',
      },
      transactionLabel: `SELECT_ALL (${nextSelection.selectedEntityIds.length})`,
      addedEntityIds: [],
      removedEntityIds: [],
    };
  },
};

const clearSelectionCommand: CadCommandDefinition<{ key: 'CLEAR_SELECTION' }> = {
  key: 'CLEAR_SELECTION',
  execute: (snapshot) => {
    if (snapshot.selection.selectedEntityIds.length === 0) return null;
    return {
      nextSnapshot: {
        project: snapshot.project,
        selection: clearCadSelection(),
      },
      commandState: {
        key: 'CLEAR_SELECTION',
        phase: 'committed',
        prompt: 'CLEAR_SELECTION committed. Selection set cleared.',
      },
      transactionLabel: 'CLEAR_SELECTION',
      addedEntityIds: [],
      removedEntityIds: [],
    };
  },
};

const eraseCommand: CadCommandDefinition<{ key: 'ERASE' }> = {
  key: 'ERASE',
  execute: (snapshot) => {
    const selectedEntities = getExpandedSelectedEntities(snapshot);
    if (selectedEntities.length === 0) return null;
    const removedEntityIds = selectedEntities.map((entity) => entity.id);
    const removedEntityIdSet = new Set(removedEntityIds);
    const nextProject = replaceCadProjectEntities(
      snapshot.project,
      snapshot.project.entities.filter((entity) => !removedEntityIdSet.has(entity.id)),
    );
    return {
      nextSnapshot: {
        project: nextProject,
        selection: createCadSelectionState(nextProject),
      },
      commandState: {
        key: 'ERASE',
        phase: 'committed',
        prompt: `ERASE committed. Removed ${removedEntityIds.length} entr${removedEntityIds.length === 1 ? 'y' : 'ies'}.`,
      },
      transactionLabel: `ERASE (${removedEntityIds.length})`,
      addedEntityIds: [],
      removedEntityIds,
    };
  },
};

const pointCommand: CadCommandDefinition<{
  key: 'POINT';
  x: number;
  y: number;
  label?: string;
}> = {
  key: 'POINT',
  execute: (snapshot, command) => {
    const entities = createManualPointEntities(snapshot.project, command.x, command.y, command.label);
    const appendedEntities = compactManualPointEntities([entities.point, entities.label]);
    const nextProject = appendCadProjectEntities(
      snapshot.project,
      appendedEntities,
    );
    return {
      nextSnapshot: {
        project: nextProject,
        selection: createCadSelectionState(nextProject, [entities.point.id]),
      },
      commandState: {
        key: 'POINT',
        phase: 'committed',
        prompt: `POINT committed at (${command.x.toFixed(3)}, ${command.y.toFixed(3)}).`,
      },
      transactionLabel: `POINT (${entities.point.stationId})`,
      addedEntityIds: [entities.point.id, entities.label?.id].filter(
        (entityId): entityId is string => entityId != null,
      ),
      removedEntityIds: [],
    };
  },
};

const cogoPointCommand: CadCommandDefinition<{
  key: 'COGO_POINT';
  x: number;
  y: number;
  label?: string;
  basisLabel: string;
  directionLabel: string;
}> = {
  key: 'COGO_POINT',
  execute: (snapshot, command) => {
    const summary = `Created point from ${command.basisLabel} using ${command.directionLabel}`;
    const provenance = createCogoProvenance({
      toolKey: 'COGO_POINT',
      summary,
      sourcePointIds: [command.basisLabel],
      inputs: {
        basisLabel: command.basisLabel,
        directionLabel: command.directionLabel,
      },
      parameters: {
        x: command.x,
        y: command.y,
      },
    });
    const entities = createManualPointEntities(snapshot.project, command.x, command.y, command.label);
    const pointEntity: CadSurveyPointEntity = {
      ...entities.point,
      metadata: buildCadCogoEntityMetadata(entities.point.metadata, provenance),
    };
    const labelEntity = entities.label
      ? {
          ...entities.label,
          metadata: buildCadCogoEntityMetadata(entities.label.metadata, provenance),
        }
      : null;
    const appendedEntities = compactManualPointEntities([pointEntity, labelEntity]);
    const nextProjectWithEntities = appendCadProjectEntities(
      snapshot.project,
      appendedEntities,
    );
    const nextProject = appendCogoComputation({
      project: nextProjectWithEntities,
      provenance,
      title: 'COGO Point',
      summary,
      rows: [
        { label: 'Point', value: pointEntity.stationId },
        { label: 'Northing', value: command.y.toFixed(3), unit: 'm' },
        { label: 'Easting', value: command.x.toFixed(3), unit: 'm' },
      ],
      createdEntities: appendedEntities,
    });
    return {
      nextSnapshot: {
        project: nextProject,
        selection: createCadSelectionState(nextProject, [pointEntity.id]),
      },
      commandState: {
        key: 'COGO_POINT',
        phase: 'committed',
        prompt: `COGO_POINT committed from ${command.basisLabel} using ${command.directionLabel}.`,
      },
      transactionLabel: `COGO_POINT (${pointEntity.stationId})`,
      addedEntityIds: [pointEntity.id, labelEntity?.id].filter(
        (entityId): entityId is string => entityId != null,
      ),
      removedEntityIds: [],
    };
  },
};

const lineCommand: CadCommandDefinition<{
  key: 'LINE';
  start: { x: number; y: number; label: string };
  end: { x: number; y: number; label: string };
}> = {
  key: 'LINE',
  execute: (snapshot, command) => {
    if (
      Math.abs(command.start.x - command.end.x) <= 1e-9 &&
      Math.abs(command.start.y - command.end.y) <= 1e-9
    ) {
      return null;
    }
    const lineName = nextEntityName(snapshot.project, 'LINE');
    const lineEntity: CadEntity = {
      id: createStableRuntimeId('cad-line'),
      type: 'line',
      layerId: 'observation-lines',
      styleId: 'style-observation-line',
      visible: true,
      locked: false,
      fromStationId: command.start.label,
      toStationId: command.end.label,
      fromX: command.start.x,
      fromY: command.start.y,
      toX: command.end.x,
      toY: command.end.y,
      sourceObservationIds: [],
      metadata: {
        createdBy: 'LINE',
        entityName: lineName,
        manual: true,
      },
    };
    const nextProject = appendCadProjectEntities(snapshot.project, [lineEntity]);
    return {
      nextSnapshot: {
        project: nextProject,
        selection: createCadSelectionState(nextProject, [lineEntity.id]),
      },
      commandState: {
        key: 'LINE',
        phase: 'committed',
        prompt: `LINE committed from ${command.start.label} to ${command.end.label}.`,
      },
      transactionLabel: `LINE (${lineName})`,
      addedEntityIds: [lineEntity.id],
      removedEntityIds: [],
    };
  },
};

const findExistingTraversePoint = (
  project: CadProject,
  vertex: { x: number; y: number; label: string },
): CadSurveyPointEntity | null =>
  project.entities.find(
    (entity): entity is CadSurveyPointEntity =>
      entity.type === 'survey-point' &&
      entity.stationId === vertex.label &&
      Math.abs(entity.x - vertex.x) <= 1e-9 &&
      Math.abs(entity.y - vertex.y) <= 1e-9,
  ) ?? null;

const ensureNamedPointEntity = (
  project: CadProject,
  point: { x: number; y: number; label: string },
  provenance: ReturnType<typeof createCogoProvenance>,
): {
  project: CadProject;
  pointEntity: CadSurveyPointEntity;
  createdPoint: CadSurveyPointEntity | null;
} => {
  const existingPoint = findExistingTraversePoint(project, point);
  if (existingPoint) {
    return {
      project,
      pointEntity: existingPoint,
      createdPoint: null,
    };
  }

  const pointBundle = createManualPointEntities(project, point.x, point.y, point.label, {
    includeTextLabel: false,
    createdBy: 'BATCH_COGO',
  });
  const pointEntity: CadSurveyPointEntity = {
    ...pointBundle.point,
    metadata: buildCadCogoEntityMetadata(pointBundle.point.metadata, provenance),
  };
  return {
    project: appendCadProjectEntities(project, [pointEntity]),
    pointEntity,
    createdPoint: pointEntity,
  };
};

const polylineCommand: CadCommandDefinition<{
  key: 'PLINE';
  vertices: { x: number; y: number; label: string }[];
}> = {
  key: 'PLINE',
  execute: (snapshot, command) => {
    const vertices = command.vertices.filter((vertex, index, list) => {
      const previous = list[index - 1];
      if (!previous) return true;
      return Math.abs(vertex.x - previous.x) > 1e-9 || Math.abs(vertex.y - previous.y) > 1e-9;
    });
    if (vertices.length < 2) return null;
    const polylineName = nextEntityName(snapshot.project, 'PL');
    const polylineEntity: CadPolylineEntity = {
      id: createStableRuntimeId('cad-polyline'),
      type: 'polyline',
      layerId: 'observation-lines',
      styleId: 'style-observation-line',
      visible: true,
      locked: false,
      vertices: vertices.map((vertex) => ({ x: vertex.x, y: vertex.y })),
      vertexLabels: vertices.map((vertex) => vertex.label),
      closed: false,
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
        prompt: `PLINE committed with ${vertices.length} vertices.`,
      },
      transactionLabel: `PLINE (${polylineName})`,
      addedEntityIds: [polylineEntity.id],
      removedEntityIds: [],
    };
  },
};

const traverseCommand: CadCommandDefinition<{
  key: 'TRAVERSE';
  vertices: { x: number; y: number; label: string }[];
  rawVertices?: { x: number; y: number; label: string }[];
  mode?: 'open' | 'closed' | 'point-to-point';
  closePoint?: { x: number; y: number; label: string };
  sideshots?: Array<{
    occupyLabel: string;
    backsightLabel: string;
    side: 'left' | 'right';
    angleDeg: number;
    distance: number;
    point: { label: string; x: number; y: number };
  }>;
  adjustment?: {
    method: 'angular' | 'bowditch' | 'transit';
    targetLabel: string;
    rawClosureDistance: number;
    adjustedClosureDistance: number;
    rawClosureBearing: string | null;
    adjustedClosureBearing: string | null;
    angularCorrectionPerLegSec: number | null;
  };
}> = {
  key: 'TRAVERSE',
  execute: (snapshot, command) => {
    const vertices = command.vertices.filter((vertex, index, list) => {
      const previous = list[index - 1];
      if (!previous) return true;
      return Math.abs(vertex.x - previous.x) > 1e-9 || Math.abs(vertex.y - previous.y) > 1e-9;
    });
    if (vertices.length < 2) return null;

    const totalLength = vertices.slice(0, -1).reduce(
      (sum, vertex, index) => sum + cadDistance(vertex, vertices[index + 1]!),
      0,
    );
    const firstVertex = vertices[0]!;
    const lastVertex = vertices[vertices.length - 1]!;
    const closureDeltaX = firstVertex.x - lastVertex.x;
    const closureDeltaY = firstVertex.y - lastVertex.y;
    const closureDistance = Math.hypot(closureDeltaX, closureDeltaY);
    const closureRatio = closureDistance > 1e-9 ? totalLength / closureDistance : null;
    const traverseMode = command.mode ?? 'open';
    const summary = `Created traverse with ${vertices.length} stations`;
    const provenance = createCogoProvenance({
      toolKey: 'TRAVERSE',
      summary,
      sourcePointIds: vertices.map((vertex) => vertex.label),
      inputs: {
        vertices,
        rawVertices: command.rawVertices ?? vertices,
        mode: traverseMode,
        closePoint: command.closePoint,
        sideshots: command.sideshots ?? [],
        adjustment: command.adjustment ?? null,
      },
      parameters: {
        totalLength,
        closureDistance,
      },
    });
    let workingProject = snapshot.project;
    const createdEntities: CadEntity[] = [];
    const vertexLabels: string[] = [];

    vertices.forEach((vertex) => {
      const existingPoint = findExistingTraversePoint(workingProject, vertex);
      if (existingPoint) {
        vertexLabels.push(existingPoint.stationId);
        return;
      }
      const pointBundle = createManualPointEntities(workingProject, vertex.x, vertex.y, vertex.label, {
        includeTextLabel: false,
        createdBy: 'TRAVERSE',
      });
      const pointEntity: CadSurveyPointEntity = {
        ...pointBundle.point,
        metadata: buildCadCogoEntityMetadata(pointBundle.point.metadata, provenance),
      };
      workingProject = appendCadProjectEntities(workingProject, [pointEntity]);
      createdEntities.push(pointEntity);
      vertexLabels.push(pointEntity.stationId);
    });

    (command.sideshots ?? []).forEach((sideshot) => {
      const existingPoint = findExistingTraversePoint(workingProject, sideshot.point);
      if (existingPoint) return;
      const pointBundle = createManualPointEntities(
        workingProject,
        sideshot.point.x,
        sideshot.point.y,
        sideshot.point.label,
        {
          includeTextLabel: false,
          createdBy: 'TRAVERSE',
        },
      );
      const pointEntity: CadSurveyPointEntity = {
        ...pointBundle.point,
        metadata: buildCadCogoEntityMetadata({
          ...pointBundle.point.metadata,
          traverseSideshot: {
            occupyLabel: sideshot.occupyLabel,
            backsightLabel: sideshot.backsightLabel,
            side: sideshot.side,
            angleDeg: sideshot.angleDeg,
            distance: sideshot.distance,
          },
        }, provenance),
      };
      workingProject = appendCadProjectEntities(workingProject, [pointEntity]);
      createdEntities.push(pointEntity);

      const occupyPoint = vertices.find((vertex) => vertex.label === sideshot.occupyLabel);
      if (!occupyPoint) return;
      const lineEntity: CadEntity = {
        id: createStableRuntimeId('cad-traverse-sideshot'),
        type: 'line',
        layerId: 'observation-lines',
        styleId: 'style-observation-line',
        visible: true,
        locked: false,
        fromStationId: sideshot.occupyLabel,
        toStationId: pointEntity.stationId,
        fromX: occupyPoint.x,
        fromY: occupyPoint.y,
        toX: pointEntity.x,
        toY: pointEntity.y,
        sourceObservationIds: [],
        metadata: buildCadCogoEntityMetadata({
          createdBy: 'TRAVERSE',
          manual: true,
          traverseSideshot: {
            backsightLabel: sideshot.backsightLabel,
            side: sideshot.side,
            angleDeg: sideshot.angleDeg,
            distance: sideshot.distance,
          },
        }, provenance),
      };
      workingProject = appendCadProjectEntities(workingProject, [lineEntity]);
      createdEntities.push(lineEntity);
    });

    const traverseName = nextEntityName(workingProject, 'TRAV');
    const polylineEntity: CadPolylineEntity = {
      id: createStableRuntimeId('cad-traverse'),
      type: 'polyline',
      layerId: 'observation-lines',
      styleId: 'style-observation-line',
      visible: true,
      locked: false,
      vertices: vertices.map((vertex) => ({ x: vertex.x, y: vertex.y })),
      vertexLabels,
      closed: traverseMode === 'closed',
      metadata: buildCadCogoEntityMetadata({
        createdBy: 'TRAVERSE',
        entityName: traverseName,
        manual: true,
        traverseMode,
        sideshotCount: command.sideshots?.length ?? 0,
        traverseAdjustmentMethod: command.adjustment?.method ?? null,
      }, provenance),
    };
    const adjustmentRows: CadCogoReportRow[] =
      command.adjustment == null
        ? []
        : [
            { label: 'Adjustment', value: command.adjustment.method },
            { label: 'Adjustment target', value: command.adjustment.targetLabel },
            { label: 'Raw closure', value: command.adjustment.rawClosureDistance.toFixed(3), unit: 'm' },
            { label: 'Adjusted closure', value: command.adjustment.adjustedClosureDistance.toFixed(3), unit: 'm' },
            { label: 'Raw closure bearing', value: command.adjustment.rawClosureBearing ?? '--' },
            { label: 'Adjusted closure bearing', value: command.adjustment.adjustedClosureBearing ?? '--' },
            {
              label: 'Angular correction / leg',
              value:
                command.adjustment.angularCorrectionPerLegSec == null
                  ? '--'
                  : `${command.adjustment.angularCorrectionPerLegSec.toFixed(2)}"`,
            },
          ];
    const nextProjectWithEntities = appendCadProjectEntities(workingProject, [polylineEntity]);
    const nextProject = appendCogoComputation({
      project: nextProjectWithEntities,
      provenance,
      title: 'Traverse',
      summary,
      rows: [
        { label: 'Stations', value: vertices.length.toString() },
        { label: 'Mode', value: traverseMode },
        { label: 'Total length', value: totalLength.toFixed(3), unit: 'm' },
        { label: 'Closure dE', value: closureDeltaX.toFixed(3), unit: 'm' },
        { label: 'Closure dN', value: closureDeltaY.toFixed(3), unit: 'm' },
        { label: 'Closure', value: closureDistance.toFixed(3), unit: 'm' },
        { label: 'Closure ratio', value: closureRatio == null ? '--' : `1:${closureRatio.toFixed(0)}` },
        { label: 'Sideshots', value: (command.sideshots?.length ?? 0).toString() },
        ...adjustmentRows,
      ],
      createdEntities: [...createdEntities, polylineEntity],
    });
    return {
      nextSnapshot: {
        project: nextProject,
        selection: createCadSelectionState(nextProject, [polylineEntity.id]),
      },
      commandState: {
        key: 'TRAVERSE',
        phase: 'committed',
        prompt: `TRAVERSE committed with ${vertices.length} stations. Closure ${closureDistance.toFixed(3)} m.`,
      },
      transactionLabel: `TRAVERSE (${traverseName})`,
      addedEntityIds: [...createdEntities.map((entity) => entity.id), polylineEntity.id],
      removedEntityIds: [],
    };
  },
};

const batchCogoCommand: CadCommandDefinition<{
  key: 'BATCH_COGO';
  draft: CadBatchCogoDraft;
}> = {
  key: 'BATCH_COGO',
  execute: (snapshot, command) => {
    if (!command.draft.canCommit || !command.draft.startPoint) return null;
    const summary = buildCadBatchCogoSummary(command.draft);
    const provenance = createCogoProvenance({
      toolKey: 'BATCH_COGO',
      summary,
      sourcePointIds: command.draft.startPoint ? [command.draft.startPoint.label] : [],
      inputs: {
        sourceText: command.draft.sourceText,
        startPoint: command.draft.startPoint,
        startPointSource: command.draft.startPointSource,
        previewRows: command.draft.previewRows,
        operations: command.draft.operations.map((operation) =>
          operation.kind === 'line'
            ? {
                kind: operation.kind,
                lineNumber: operation.lineNumber,
                from: operation.from,
                to: operation.to,
                bearing: operation.bearing,
                distance: operation.distance,
              }
            : {
                kind: operation.kind,
                lineNumber: operation.lineNumber,
                from: operation.from,
                to: operation.to,
                side: operation.side,
                radius: operation.radius,
                deltaDeg: operation.deltaDeg,
              },
        ),
      },
      parameters: {
        rowsParsed: command.draft.previewRows.length,
        pointCount: command.draft.generatedPointCount,
        lineCount: command.draft.generatedLineCount,
        arcCount: command.draft.generatedArcCount,
      },
    });

    let workingProject = snapshot.project;
    const createdEntities: CadEntity[] = [];
    const startResult = ensureNamedPointEntity(workingProject, command.draft.startPoint, provenance);
    workingProject = startResult.project;
    if (startResult.createdPoint) {
      createdEntities.push(startResult.createdPoint);
    }

    for (const operation of command.draft.operations) {
      const fromPointEntityResult = ensureNamedPointEntity(workingProject, operation.from, provenance);
      workingProject = fromPointEntityResult.project;
      if (fromPointEntityResult.createdPoint) {
        createdEntities.push(fromPointEntityResult.createdPoint);
      }

      const toPointEntityResult = ensureNamedPointEntity(workingProject, operation.to, provenance);
      workingProject = toPointEntityResult.project;
      if (toPointEntityResult.createdPoint) {
        createdEntities.push(toPointEntityResult.createdPoint);
      }

      if (operation.kind === 'line') {
        const lineName = nextEntityName(workingProject, 'LINE');
        const lineEntity: CadLineEntity = {
          id: createStableRuntimeId('cad-batch-cogo-line'),
          type: 'line',
          layerId: 'observation-lines',
          styleId: 'style-observation-line',
          visible: true,
          locked: false,
          fromStationId: fromPointEntityResult.pointEntity.stationId,
          toStationId: toPointEntityResult.pointEntity.stationId,
          fromX: operation.from.x,
          fromY: operation.from.y,
          toX: operation.to.x,
          toY: operation.to.y,
          sourceObservationIds: [],
          metadata: buildCadCogoEntityMetadata(
            {
              createdBy: 'BATCH_COGO',
              entityName: lineName,
              manual: true,
              batchRow: operation.lineNumber,
              batchKind: 'line',
            },
            provenance,
          ),
        };
        workingProject = appendCadProjectEntities(workingProject, [lineEntity]);
        createdEntities.push(lineEntity);
        continue;
      }

      const curveSequence = nextCurveSequence(workingProject);
      const curveName = `CURVE${curveSequence}`;
      const arcEntity: CadArcEntity = {
        id: createStableRuntimeId('cad-batch-cogo-arc'),
        type: 'arc',
        layerId: 'observation-lines',
        styleId: 'style-observation-line',
        visible: true,
        locked: false,
        centerX: operation.definition.center.x,
        centerY: operation.definition.center.y,
        radius: operation.definition.radius,
        startAngleDeg: operation.definition.startAngleDeg,
        endAngleDeg: operation.definition.endAngleDeg,
        metadata: buildCadCogoEntityMetadata(
          {
            createdBy: 'BATCH_COGO',
            entityName: curveName,
            manual: true,
            batchRow: operation.lineNumber,
            batchKind: 'curve',
            fromStationId: fromPointEntityResult.pointEntity.stationId,
            toStationId: toPointEntityResult.pointEntity.stationId,
            curveSide: operation.side,
            deltaDeg: operation.deltaDeg,
          },
          provenance,
        ),
      };
      const arcSupportEntities = createArcSupportEntities(
        workingProject,
        arcEntity.id,
        curveSequence,
        {
          center: { x: operation.definition.center.x, y: operation.definition.center.y },
          radius: operation.definition.radius,
          startAngleDeg: operation.definition.startAngleDeg,
          endAngleDeg: operation.definition.endAngleDeg,
        },
        'BATCH_COGO',
      );
      workingProject = appendCadProjectEntities(workingProject, [arcEntity, ...arcSupportEntities]);
      createdEntities.push(arcEntity, ...arcSupportEntities);
    }

    const nextProject = appendCadProjectCogoComputation(
      workingProject,
      buildCadCogoComputation({
        createdEntities,
        report: {
          title: 'Batch COGO',
          summary,
          rows: buildCadBatchCogoReportRows(command.draft),
        },
        warnings: command.draft.warnings,
        provenance,
      }),
    );

    const selectedEntityIds = createdEntities.length > 0 ? [createdEntities[createdEntities.length - 1]!.id] : [];
    return {
      nextSnapshot: {
        project: nextProject,
        selection: createCadSelectionState(nextProject, selectedEntityIds),
      },
      commandState: {
        key: 'BATCH_COGO',
        phase: 'committed',
        prompt: `BATCH_COGO committed with ${command.draft.previewRows.length} parsed row${command.draft.previewRows.length === 1 ? '' : 's'}.`,
      },
      transactionLabel: `BATCH_COGO (${command.draft.previewRows.length})`,
      addedEntityIds: createdEntities.map((entity) => entity.id),
      removedEntityIds: [],
    };
  },
};

const arc3ptCommand: CadCommandDefinition<{
  key: 'ARC_3PT';
  start: { x: number; y: number; label: string };
  through: { x: number; y: number; label: string };
  end: { x: number; y: number; label: string };
}> = {
  key: 'ARC_3PT',
  execute: (snapshot, command) => {
    const arcDefinition = cadBuildArcFromThreePoints(command.start, command.through, command.end);
    if (!arcDefinition) return null;
    const curveSequence = nextCurveSequence(snapshot.project);
    const curveLabels = buildCurveLabels(curveSequence);
    const summary = `Created ${curveLabels.curveName} with ${curveLabels.beginLabel}, ${curveLabels.midLabel}, ${curveLabels.endLabel}, ${curveLabels.radiusLabel}`;
    const provenance = createCogoProvenance({
      toolKey: 'ARC_CREATE',
      summary,
      sourcePointIds: [curveLabels.beginLabel, curveLabels.midLabel, curveLabels.endLabel, curveLabels.radiusLabel],
      inputs: {
        start: command.start,
        through: command.through,
        end: command.end,
      },
      parameters: {
        mode: 'ARC_3PT',
      },
    });
    const arcEntity: CadEntity = {
      id: createStableRuntimeId('cad-arc'),
      type: 'arc',
      layerId: 'observation-lines',
      styleId: 'style-observation-line',
      visible: true,
      locked: false,
      centerX: arcDefinition.center.x,
      centerY: arcDefinition.center.y,
      radius: arcDefinition.radius,
      startAngleDeg: arcDefinition.startAngleDeg,
      endAngleDeg: arcDefinition.endAngleDeg,
      metadata: buildCadCogoEntityMetadata({
        createdBy: 'ARC_3PT',
        entityName: curveLabels.curveName,
        manual: true,
        startLabel: command.start.label,
        throughLabel: command.through.label,
        endLabel: command.end.label,
      }, provenance),
    };
    const supportEntities = createArcSupportEntities(
      snapshot.project,
      arcEntity.id,
      curveSequence,
      {
        center: { x: arcDefinition.center.x, y: arcDefinition.center.y },
        radius: arcDefinition.radius,
        startAngleDeg: arcDefinition.startAngleDeg,
        endAngleDeg: arcDefinition.endAngleDeg,
      },
      'ARC_3PT',
    );
    const nextProjectWithEntities = appendCadProjectEntities(snapshot.project, [arcEntity, ...supportEntities]);
    const nextProject = appendCogoComputation({
      project: nextProjectWithEntities,
      provenance,
      title: 'Arc 3 Point',
      summary,
      rows: [
        { label: 'Radius', value: arcDefinition.radius.toFixed(3), unit: 'm' },
        { label: 'Delta', value: arcDefinition.deltaDeg.toFixed(6), unit: 'deg' },
      ],
      createdEntities: [arcEntity, ...supportEntities],
    });
    return {
      nextSnapshot: {
        project: nextProject,
        selection: createCadSelectionState(nextProject, [arcEntity.id]),
      },
      commandState: {
        key: 'ARC_3PT',
        phase: 'committed',
        prompt: `ARC_3PT committed as ${curveLabels.curveName}.`,
      },
      transactionLabel: `ARC_3PT (${curveLabels.curveName})`,
      addedEntityIds: [arcEntity.id, ...supportEntities.map((entity) => entity.id)],
      removedEntityIds: [],
    };
  },
};

const arcCreateCommand: CadCommandDefinition<{
  key: 'ARC_CREATE';
  modeLabel: string;
  definition: {
    center: { x: number; y: number };
    radius: number;
    startAngleDeg: number;
    endAngleDeg: number;
  };
  metadata?: Record<string, unknown>;
}> = {
  key: 'ARC_CREATE',
  execute: (snapshot, command) => {
    const curveSequence = nextCurveSequence(snapshot.project);
    const curveLabels = buildCurveLabels(curveSequence);
    const summary = `${command.modeLabel} created ${curveLabels.curveName} radius ${command.definition.radius.toFixed(3)} m`;
    const provenance = createCogoProvenance({
      toolKey: 'ARC_CREATE',
      summary,
      inputs: {
        modeLabel: command.modeLabel,
        definition: command.definition,
      },
      parameters: command.metadata,
    });
    const arcEntity: CadEntity = {
      id: createStableRuntimeId('cad-arc'),
      type: 'arc',
      layerId: 'observation-lines',
      styleId: 'style-observation-line',
      visible: true,
      locked: false,
      centerX: command.definition.center.x,
      centerY: command.definition.center.y,
      radius: command.definition.radius,
      startAngleDeg: command.definition.startAngleDeg,
      endAngleDeg: command.definition.endAngleDeg,
      metadata: buildCadCogoEntityMetadata({
        createdBy: command.modeLabel,
        entityName: curveLabels.curveName,
        manual: true,
        ...(command.metadata ?? {}),
      }, provenance),
    };
    const supportEntities = createArcSupportEntities(
      snapshot.project,
      arcEntity.id,
      curveSequence,
      {
        center: { x: command.definition.center.x, y: command.definition.center.y },
        radius: command.definition.radius,
        startAngleDeg: command.definition.startAngleDeg,
        endAngleDeg: command.definition.endAngleDeg,
      },
      command.modeLabel,
    );
    const nextProjectWithEntities = appendCadProjectEntities(snapshot.project, [arcEntity, ...supportEntities]);
    const nextProject = appendCogoComputation({
      project: nextProjectWithEntities,
      provenance,
      title: command.modeLabel,
      summary,
      rows: [
        { label: 'Radius', value: command.definition.radius.toFixed(3), unit: 'm' },
        { label: 'Start angle', value: command.definition.startAngleDeg.toFixed(6), unit: 'deg' },
        { label: 'End angle', value: command.definition.endAngleDeg.toFixed(6), unit: 'deg' },
      ],
      createdEntities: [arcEntity, ...supportEntities],
    });
    return {
      nextSnapshot: {
        project: nextProject,
        selection: createCadSelectionState(nextProject, [arcEntity.id]),
      },
      commandState: {
        key: 'ARC_CREATE',
        phase: 'committed',
        prompt: `${command.modeLabel} committed as ${curveLabels.curveName}.`,
      },
      transactionLabel: `${command.modeLabel} (${curveLabels.curveName})`,
      addedEntityIds: [arcEntity.id, ...supportEntities.map((entity) => entity.id)],
      removedEntityIds: [],
    };
  },
};

const tangentCurveCommand: CadCommandDefinition<{
  key: 'TANGENT_CURVE';
  pi: { x: number; y: number; label: string };
  backTangentPoint: { x: number; y: number; label: string };
  aheadTangentPoint: { x: number; y: number; label: string };
  radius: number;
}> = {
  key: 'TANGENT_CURVE',
  execute: (snapshot, command) => {
    const arcDefinition = cadBuildTangentCurve(
      command.pi,
      command.backTangentPoint,
      command.aheadTangentPoint,
      command.radius,
    );
    if (!arcDefinition) return null;
    const curveSequence = nextCurveSequence(snapshot.project);
    const curveLabels = buildCurveLabels(curveSequence);
    const summary = `Created ${curveLabels.curveName} tangent curve with ${curveLabels.beginLabel}, ${curveLabels.midLabel}, ${curveLabels.endLabel}, ${curveLabels.radiusLabel}`;
    const provenance = createCogoProvenance({
      toolKey: 'TANGENT_CURVE',
      summary,
      sourcePointIds: ['PI', 'Back tangent', 'Ahead tangent', curveLabels.radiusLabel],
      inputs: {
        pi: command.pi,
        backTangentPoint: command.backTangentPoint,
        aheadTangentPoint: command.aheadTangentPoint,
      },
      parameters: {
        radius: command.radius,
      },
    });
    const arcEntity: CadEntity = {
      id: createStableRuntimeId('cad-arc'),
      type: 'arc',
      layerId: 'observation-lines',
      styleId: 'style-observation-line',
      visible: true,
      locked: false,
      centerX: arcDefinition.center.x,
      centerY: arcDefinition.center.y,
      radius: arcDefinition.radius,
      startAngleDeg: arcDefinition.startAngleDeg,
      endAngleDeg: arcDefinition.endAngleDeg,
      metadata: buildCadCogoEntityMetadata({
        createdBy: 'TANGENT_CURVE',
        entityName: curveLabels.curveName,
        manual: true,
        piLabel: command.pi.label,
        backLabel: command.backTangentPoint.label,
        aheadLabel: command.aheadTangentPoint.label,
      }, provenance),
    };
    const supportEntities = createArcSupportEntities(
      snapshot.project,
      arcEntity.id,
      curveSequence,
      {
        center: { x: arcDefinition.center.x, y: arcDefinition.center.y },
        radius: arcDefinition.radius,
        startAngleDeg: arcDefinition.startAngleDeg,
        endAngleDeg: arcDefinition.endAngleDeg,
      },
      'TANGENT_CURVE',
    );
    const nextProjectWithEntities = appendCadProjectEntities(snapshot.project, [arcEntity, ...supportEntities]);
    const nextProject = appendCogoComputation({
      project: nextProjectWithEntities,
      provenance,
      title: 'Tangent Curve',
      summary,
      rows: [
        { label: 'PI', value: command.pi.label },
        { label: 'Radius', value: command.radius.toFixed(3), unit: 'm' },
        { label: 'Delta', value: arcDefinition.deltaDeg.toFixed(6), unit: 'deg' },
      ],
      createdEntities: [arcEntity, ...supportEntities],
    });
    return {
      nextSnapshot: {
        project: nextProject,
        selection: createCadSelectionState(nextProject, [arcEntity.id]),
      },
      commandState: {
        key: 'TANGENT_CURVE',
        phase: 'committed',
        prompt: `TANGENT_CURVE committed as ${curveLabels.curveName} with radius ${command.radius.toFixed(3)}.`,
      },
      transactionLabel: `TANGENT_CURVE (${curveLabels.curveName})`,
      addedEntityIds: [arcEntity.id, ...supportEntities.map((entity) => entity.id)],
      removedEntityIds: [],
    };
  },
};

const alignmentCreateCommand: CadCommandDefinition<{
  key: 'ALIGNMENT_CREATE';
  sourceEntityIds: CadEntityId[];
  name?: string;
  startStation?: number;
}> = {
  key: 'ALIGNMENT_CREATE',
  execute: (snapshot, command) => {
    const sourceEntities = snapshot.project.entities.filter(
      (entity): entity is CadLineEntity | CadArcEntity =>
        command.sourceEntityIds.includes(entity.id) && (entity.type === 'line' || entity.type === 'arc'),
    );
    const draft = cadBuildAlignmentDraft(sourceEntities);
    if (!draft) return null;

    const alignmentName = command.name?.trim() || nextAlignmentName(snapshot.project);
    const startStation = command.startStation ?? 0;
    const summary = `Created alignment ${alignmentName} from ${draft.elements.length} element${draft.elements.length === 1 ? '' : 's'} (${draft.totalLength.toFixed(3)} m)`;
    const provenance = createCogoProvenance({
      toolKey: 'ALIGNMENT',
      summary,
      sourceEntityIds: draft.sourceEntityIds,
      inputs: {
        sourceEntityIds: draft.sourceEntityIds,
        alignmentName,
      },
      parameters: {
        startStation,
      },
    });
    const alignmentEntity: CadEntity = {
      id: createStableRuntimeId('cad-alignment'),
      type: 'alignment',
      layerId: 'planning',
      styleId: 'style-observation-line',
      visible: true,
      locked: false,
      name: alignmentName,
      elements: draft.elements,
      startStation,
      metadata: buildCadCogoEntityMetadata({
        createdBy: 'ALIGNMENT_CREATE',
        manual: true,
        sourceEntityIds: draft.sourceEntityIds,
      }, provenance),
    };
    const nextProjectWithEntities = appendCadProjectEntities(snapshot.project, [alignmentEntity]);
    const nextProject = appendCogoComputation({
      project: nextProjectWithEntities,
      provenance,
      title: 'Alignment Create',
      summary,
      rows: [
        { label: 'Alignment', value: alignmentName },
        { label: 'Elements', value: String(draft.elements.length) },
        { label: 'Start station', value: formatCadStation(startStation), unit: 'm' },
        { label: 'End station', value: formatCadStation(startStation + draft.totalLength), unit: 'm' },
        { label: 'Length', value: draft.totalLength.toFixed(3), unit: 'm' },
        { label: 'Start point', value: `${draft.startPoint.x.toFixed(3)}, ${draft.startPoint.y.toFixed(3)}` },
        { label: 'End point', value: `${draft.endPoint.x.toFixed(3)}, ${draft.endPoint.y.toFixed(3)}` },
      ],
      createdEntities: [alignmentEntity],
    });

    return {
      nextSnapshot: {
        project: nextProject,
        selection: createCadSelectionState(nextProject, [alignmentEntity.id]),
      },
      commandState: {
        key: 'ALIGNMENT_CREATE',
        phase: 'committed',
        prompt: `ALIGNMENT_CREATE committed for ${alignmentName}. Length ${draft.totalLength.toFixed(3)} m.`,
      },
      transactionLabel: `ALIGNMENT_CREATE (${alignmentName})`,
      addedEntityIds: [alignmentEntity.id],
      removedEntityIds: [],
    };
  },
};

const alignmentOffsetCreateCommand: CadCommandDefinition<{
  key: 'ALIGNMENT_OFFSET_CREATE';
  alignmentEntityId: CadEntityId;
  offset: number;
  name?: string;
}> = {
  key: 'ALIGNMENT_OFFSET_CREATE',
  execute: (snapshot, command) => {
    const sourceAlignment = snapshot.project.entities.find(
      (entity): entity is Extract<CadEntity, { type: 'alignment' }> =>
        entity.type === 'alignment' && entity.id === command.alignmentEntityId,
    );
    if (!sourceAlignment || !Number.isFinite(command.offset) || Math.abs(command.offset) <= 1e-9) {
      return null;
    }

    const draft = cadBuildOffsetAlignmentDraft(sourceAlignment, command.offset);
    if (!draft) return null;

    const alignmentName = command.name?.trim() || nextAlignmentName(snapshot.project);
    const summary = `Created offset alignment ${alignmentName} from ${sourceAlignment.name} at ${command.offset.toFixed(3)} m`;
    const provenance = createCogoProvenance({
      toolKey: 'ALIGNMENT_OFFSET',
      summary,
      sourceEntityIds: [sourceAlignment.id],
      inputs: {
        alignmentEntityId: sourceAlignment.id,
        alignmentName: sourceAlignment.name,
      },
      parameters: {
        offset: command.offset,
        createdAlignmentName: alignmentName,
      },
    });
    const alignmentEntity: CadEntity = {
      id: createStableRuntimeId('cad-alignment'),
      type: 'alignment',
      layerId: 'planning',
      styleId: 'style-observation-line',
      visible: true,
      locked: false,
      name: alignmentName,
      elements: draft.elements,
      startStation: sourceAlignment.startStation,
      stationEquations: sourceAlignment.stationEquations?.map((equation) => ({ ...equation })),
      metadata: buildCadCogoEntityMetadata({
        createdBy: 'ALIGNMENT_OFFSET_CREATE',
        manual: true,
        sourceEntityIds: [sourceAlignment.id],
      }, provenance),
    };
    const nextProjectWithEntities = appendCadProjectEntities(snapshot.project, [alignmentEntity]);
    const endStation = cadAlignmentEndStation(alignmentEntity) ?? alignmentEntity.startStation;
    const nextProject = appendCogoComputation({
      project: nextProjectWithEntities,
      provenance,
      title: 'Offset Alignment',
      summary,
      rows: [
        { label: 'Source alignment', value: sourceAlignment.name },
        { label: 'Offset alignment', value: alignmentName },
        { label: 'Offset', value: command.offset.toFixed(3), unit: 'm' },
        { label: 'Start station', value: formatCadStation(alignmentEntity.startStation), unit: 'm' },
        { label: 'End station', value: formatCadStation(endStation), unit: 'm' },
        { label: 'Length', value: draft.totalLength.toFixed(3), unit: 'm' },
      ],
      createdEntities: [alignmentEntity],
    });

    return {
      nextSnapshot: {
        project: nextProject,
        selection: createCadSelectionState(nextProject, [alignmentEntity.id]),
      },
      commandState: {
        key: 'ALIGNMENT_OFFSET_CREATE',
        phase: 'committed',
        prompt: `ALIGNMENT_OFFSET_CREATE committed for ${alignmentName}.`,
      },
      transactionLabel: `ALIGNMENT_OFFSET_CREATE (${alignmentName})`,
      addedEntityIds: [alignmentEntity.id],
      removedEntityIds: [],
    };
  },
};

const alignmentStationReportCommand: CadCommandDefinition<{
  key: 'ALIGNMENT_STATION_REPORT';
  alignmentEntityId: CadEntityId;
  pointEntityId: CadEntityId;
}> = {
  key: 'ALIGNMENT_STATION_REPORT',
  execute: (snapshot, command) => {
    const alignmentEntity = snapshot.project.entities.find(
      (entity): entity is Extract<CadEntity, { type: 'alignment' }> =>
        entity.type === 'alignment' && entity.id === command.alignmentEntityId,
    );
    const pointEntity = snapshot.project.entities.find(
      (entity): entity is CadSurveyPointEntity =>
        entity.type === 'survey-point' && entity.id === command.pointEntityId,
    );
    if (!alignmentEntity || !pointEntity) return null;
    const projection = cadProjectPointToAlignment(alignmentEntity, {
      x: pointEntity.x,
      y: pointEntity.y,
    });
    if (!projection) return null;

    const formattedStation = formatCadStation(projection.station);
    const summary = `Projected ${pointEntity.stationId} onto ${alignmentEntity.name} at station ${formattedStation}`;
    const provenance = createCogoProvenance({
      toolKey: 'ALIGNMENT_STATION',
      summary,
      sourceEntityIds: [alignmentEntity.id, pointEntity.id],
      sourcePointIds: [pointEntity.stationId],
      inputs: {
        alignmentEntityId: alignmentEntity.id,
        pointEntityId: pointEntity.id,
      },
      parameters: {
        station: projection.station,
        offset: projection.offset,
      },
    });
    const nextProject = appendCogoComputation({
      project: snapshot.project,
      provenance,
      title: 'Alignment Station',
      summary,
      rows: [
        { label: 'Alignment', value: alignmentEntity.name },
        { label: 'Point', value: pointEntity.stationId },
        { label: 'Station', value: formattedStation, unit: 'm' },
        { label: 'Offset', value: projection.offset.toFixed(3), unit: 'm' },
        { label: 'Projected Northing', value: projection.point.y.toFixed(3), unit: 'm' },
        { label: 'Projected Easting', value: projection.point.x.toFixed(3), unit: 'm' },
        { label: 'Element', value: `${projection.elementKind} ${projection.elementIndex + 1}` },
      ],
      createdEntities: [],
    });
    return {
      nextSnapshot: {
        project: nextProject,
        selection: snapshot.selection,
      },
      commandState: {
        key: 'ALIGNMENT_STATION_REPORT',
        phase: 'committed',
        prompt: `ALIGNMENT_STATION committed for ${pointEntity.stationId} on ${alignmentEntity.name}.`,
      },
      transactionLabel: `ALIGNMENT_STATION (${pointEntity.stationId})`,
      addedEntityIds: [],
      removedEntityIds: [],
    };
  },
};

const alignmentStationEquationCommand: CadCommandDefinition<{
  key: 'ALIGNMENT_STATION_EQUATION';
  alignmentEntityId: CadEntityId;
  backStation: number;
  aheadStation: number;
}> = {
  key: 'ALIGNMENT_STATION_EQUATION',
  execute: (snapshot, command) => {
    const alignmentEntity = snapshot.project.entities.find(
      (entity): entity is Extract<CadEntity, { type: 'alignment' }> =>
        entity.type === 'alignment' && entity.id === command.alignmentEntityId,
    );
    if (!alignmentEntity) return null;
    if (
      !Number.isFinite(command.backStation) ||
      !Number.isFinite(command.aheadStation) ||
      command.aheadStation < command.backStation - 1e-9
    ) {
      return null;
    }

    const rawStation = cadAlignmentDisplayStationToRawStation(alignmentEntity, command.backStation);
    if (rawStation == null) return null;
    if (
      (alignmentEntity.stationEquations ?? []).some((equation) =>
        Math.abs((equation.rawStation ?? Number.NaN) - rawStation) <= 1e-9,
      )
    ) {
      return null;
    }

    const updatedAlignment: Extract<CadEntity, { type: 'alignment' }> = {
      ...alignmentEntity,
      stationEquations: [
        ...(alignmentEntity.stationEquations ?? []),
        {
          backStation: command.backStation,
          aheadStation: command.aheadStation,
          rawStation,
        },
      ].sort((left, right) => {
        const leftRaw = left.rawStation ?? left.backStation;
        const rightRaw = right.rawStation ?? right.backStation;
        return leftRaw - rightRaw;
      }),
    };

    const summary = `Added station equation ${command.backStation.toFixed(3)} ahead ${command.aheadStation.toFixed(3)} on ${alignmentEntity.name}`;
    const provenance = createCogoProvenance({
      toolKey: 'ALIGNMENT_STATION_EQUATION',
      sourceEntityIds: [alignmentEntity.id],
      inputs: {
        alignmentEntityId: alignmentEntity.id,
        alignmentName: alignmentEntity.name,
      },
      parameters: {
        alignmentEntityId: alignmentEntity.id,
        alignmentName: alignmentEntity.name,
        backStation: command.backStation,
        aheadStation: command.aheadStation,
        rawStation,
      },
      summary,
    });
    updatedAlignment.metadata = buildCadCogoEntityMetadata(updatedAlignment.metadata, provenance);

    const nextProjectWithAlignment = replaceCadProjectEntities(
      snapshot.project,
      snapshot.project.entities.map((entity) => (entity.id === updatedAlignment.id ? updatedAlignment : entity)),
    );
    const nextProject = appendCadProjectCogoComputation(
      nextProjectWithAlignment,
      buildCadCogoComputation({
        createdEntities: [],
        updatedEntities: [updatedAlignment],
        removedEntityIds: [],
        report: {
          title: 'Alignment Station Equation',
          summary,
          rows: [
            { label: 'Alignment', value: alignmentEntity.name },
            { label: 'Back station', value: formatCadStation(command.backStation) },
            { label: 'Ahead station', value: formatCadStation(command.aheadStation) },
            { label: 'Raw station', value: formatCadStation(rawStation) },
            { label: 'Equation count', value: String(updatedAlignment.stationEquations?.length ?? 0) },
          ],
        },
        warnings: [],
        provenance,
      }),
    );

    return {
      nextSnapshot: {
        project: nextProject,
        selection: createCadSelectionState(nextProject, [updatedAlignment.id]),
      },
      commandState: {
        key: 'ALIGNMENT_STATION_EQUATION',
        phase: 'committed',
        prompt: `ALIGNMENT_STATION_EQUATION committed for ${alignmentEntity.name}.`,
      },
      transactionLabel: `ALIGNMENT_STATION_EQUATION (${alignmentEntity.name})`,
      addedEntityIds: [],
      removedEntityIds: [],
    };
  },
};

const alignmentOffsetPointCommand: CadCommandDefinition<{
  key: 'ALIGNMENT_OFFSET_POINT';
  alignmentEntityId: CadEntityId;
  station: number;
  offset: number;
  label?: string;
}> = {
  key: 'ALIGNMENT_OFFSET_POINT',
  execute: (snapshot, command) => {
    const alignmentEntity = snapshot.project.entities.find(
      (entity): entity is Extract<CadEntity, { type: 'alignment' }> =>
        entity.type === 'alignment' && entity.id === command.alignmentEntityId,
    );
    if (!alignmentEntity) return null;
    const stationPoint = cadPointAtAlignmentStationOffset(alignmentEntity, command.station, command.offset);
    if (!stationPoint) return null;

    const formattedStation = formatCadStation(command.station);
    const summary = `Created station-offset point on ${alignmentEntity.name} at station ${formattedStation}`;
    const provenance = createCogoProvenance({
      toolKey: 'ALIGNMENT_POINT',
      summary,
      sourceEntityIds: [alignmentEntity.id],
      inputs: {
        alignmentEntityId: alignmentEntity.id,
        alignmentName: alignmentEntity.name,
      },
      parameters: {
        station: command.station,
        offset: command.offset,
      },
    });
    const entities = createManualPointEntities(
      snapshot.project,
      stationPoint.point.x,
      stationPoint.point.y,
      command.label,
      {
        createdBy: 'ALIGNMENT_OFFSET_POINT',
      },
    );
    const pointEntity: CadSurveyPointEntity = {
      ...entities.point,
      metadata: buildCadCogoEntityMetadata(entities.point.metadata, provenance),
    };
    const labelEntity = entities.label
      ? {
          ...entities.label,
          metadata: buildCadCogoEntityMetadata(entities.label.metadata, provenance),
        }
      : null;
    const createdEntities = compactManualPointEntities([pointEntity, labelEntity]);
    const nextProjectWithEntities = appendCadProjectEntities(snapshot.project, createdEntities);
    const nextProject = appendCogoComputation({
      project: nextProjectWithEntities,
      provenance,
      title: 'Alignment Station Offset Point',
      summary,
      rows: [
        { label: 'Alignment', value: alignmentEntity.name },
        { label: 'Point', value: pointEntity.stationId },
        { label: 'Station', value: formattedStation, unit: 'm' },
        { label: 'Offset', value: command.offset.toFixed(3), unit: 'm' },
        { label: 'Northing', value: stationPoint.point.y.toFixed(3), unit: 'm' },
        { label: 'Easting', value: stationPoint.point.x.toFixed(3), unit: 'm' },
        { label: 'Element', value: `${stationPoint.elementKind} ${stationPoint.elementIndex + 1}` },
      ],
      createdEntities,
    });
    return {
      nextSnapshot: {
        project: nextProject,
        selection: createCadSelectionState(nextProject, [pointEntity.id]),
      },
      commandState: {
        key: 'ALIGNMENT_OFFSET_POINT',
        phase: 'committed',
        prompt: `ALIGNMENT_OFFSET_POINT committed for ${pointEntity.stationId} on ${alignmentEntity.name}.`,
      },
      transactionLabel: `ALIGNMENT_OFFSET_POINT (${pointEntity.stationId})`,
      addedEntityIds: createdEntities.map((entity) => entity.id),
      removedEntityIds: [],
    };
  },
};

const alignmentIntervalPointsCommand: CadCommandDefinition<{
  key: 'ALIGNMENT_INTERVAL_POINTS';
  alignmentEntityId: CadEntityId;
  interval: number;
  startStation?: number;
  endStation?: number;
  labelPrefix?: string;
}> = {
  key: 'ALIGNMENT_INTERVAL_POINTS',
  execute: (snapshot, command) => {
    const alignmentEntity = snapshot.project.entities.find(
      (entity): entity is Extract<CadEntity, { type: 'alignment' }> =>
        entity.type === 'alignment' && entity.id === command.alignmentEntityId,
    );
    if (!alignmentEntity) return null;
    const stationPoints = cadBuildAlignmentStationPoints(alignmentEntity, {
      startStation: command.startStation,
      endStation: command.endStation,
      interval: command.interval,
      includeStart: true,
      includeEnd: true,
    });
    if (stationPoints.length === 0) return null;

    const prefix = command.labelPrefix?.trim();
    const summary = `Created ${stationPoints.length} alignment interval point${stationPoints.length === 1 ? '' : 's'} on ${alignmentEntity.name}`;
    const provenance = createCogoProvenance({
      toolKey: 'ALIGNMENT_INTERVALS',
      summary,
      sourceEntityIds: [alignmentEntity.id],
      inputs: {
        alignmentEntityId: alignmentEntity.id,
        alignmentName: alignmentEntity.name,
        labelPrefix: prefix ?? null,
      },
      parameters: {
        interval: command.interval,
        startStation: command.startStation ?? alignmentEntity.startStation,
        endStation: command.endStation ?? cadAlignmentEndStation(alignmentEntity) ?? alignmentEntity.startStation,
      },
    });
    let workingProject = snapshot.project;
    const createdEntities: CadEntity[] = [];
    const selectedPointIds: CadEntityId[] = [];
    stationPoints.forEach((stationPoint, index) => {
      const label = prefix ? `${prefix}${index + 1}` : undefined;
      const pointBundle = createManualPointEntities(
        workingProject,
        stationPoint.point.x,
        stationPoint.point.y,
        label,
        {
          createdBy: 'ALIGNMENT_INTERVAL_POINTS',
        },
      );
      const pointEntity: CadSurveyPointEntity = {
        ...pointBundle.point,
        metadata: buildCadCogoEntityMetadata(pointBundle.point.metadata, provenance),
      };
      const labelEntity = pointBundle.label
        ? {
            ...pointBundle.label,
            metadata: buildCadCogoEntityMetadata(pointBundle.label.metadata, provenance),
          }
        : null;
      const entities = compactManualPointEntities([pointEntity, labelEntity]);
      workingProject = appendCadProjectEntities(workingProject, entities);
      createdEntities.push(...entities);
      selectedPointIds.push(pointEntity.id);
    });
    const startStation = command.startStation ?? alignmentEntity.startStation;
    const endStation = command.endStation ?? cadAlignmentEndStation(alignmentEntity) ?? alignmentEntity.startStation;
    const nextProject = appendCogoComputation({
      project: workingProject,
      provenance: {
        ...provenance,
        parameters: {
          interval: command.interval,
          startStation,
          endStation,
          pointCount: stationPoints.length,
        },
      },
      title: 'Alignment Interval Points',
      summary,
      rows: [
        { label: 'Alignment', value: alignmentEntity.name },
        { label: 'Start station', value: formatCadStation(startStation), unit: 'm' },
        { label: 'End station', value: formatCadStation(endStation), unit: 'm' },
        { label: 'Interval', value: command.interval.toFixed(3), unit: 'm' },
        { label: 'Points', value: String(stationPoints.length) },
      ],
      createdEntities,
    });
    return {
      nextSnapshot: {
        project: nextProject,
        selection: createCadSelectionState(nextProject, selectedPointIds),
      },
      commandState: {
        key: 'ALIGNMENT_INTERVAL_POINTS',
        phase: 'committed',
        prompt: `ALIGNMENT_INTERVAL_POINTS committed with ${stationPoints.length} point${stationPoints.length === 1 ? '' : 's'} on ${alignmentEntity.name}.`,
      },
      transactionLabel: `ALIGNMENT_INTERVAL_POINTS (${stationPoints.length})`,
      addedEntityIds: createdEntities.map((entity) => entity.id),
      removedEntityIds: [],
    };
  },
};

const parcelCreateCommand: CadCommandDefinition<{
  key: 'PARCEL_CREATE';
  sourceEntityId: CadEntityId;
}> = {
  key: 'PARCEL_CREATE',
  execute: (snapshot, command) => {
    const sourcePolyline = snapshot.project.entities.find(
      (entity): entity is CadPolylineEntity =>
        entity.type === 'polyline' && entity.id === command.sourceEntityId,
    );
    if (!sourcePolyline) return null;
    const metrics = cadBuildParcelClosureSummary(sourcePolyline.vertices);
    if (!metrics) return null;
    const ringVertices =
      sourcePolyline.vertices.length > 1 &&
      Math.abs(sourcePolyline.vertices[0]!.x - sourcePolyline.vertices[sourcePolyline.vertices.length - 1]!.x) <= 1e-9 &&
      Math.abs(sourcePolyline.vertices[0]!.y - sourcePolyline.vertices[sourcePolyline.vertices.length - 1]!.y) <= 1e-9
        ? sourcePolyline.vertices.slice(0, -1)
        : sourcePolyline.vertices;
    const ringLabels =
      sourcePolyline.vertexLabels.length > 1 &&
      sourcePolyline.vertexLabels[0] === sourcePolyline.vertexLabels[sourcePolyline.vertexLabels.length - 1]
        ? sourcePolyline.vertexLabels.slice(0, -1)
        : sourcePolyline.vertexLabels;
    const parcelName = nextParcelName(snapshot.project);
    const summary = `Created ${parcelName} from ${sourcePolyline.id}`;
    const provenance = createCogoProvenance({
      toolKey: 'PARCEL_CREATE',
      summary,
      sourceEntityIds: [sourcePolyline.id],
      sourcePointIds: ringLabels,
      inputs: {
        sourceEntityId: sourcePolyline.id,
      },
      parameters: {
        areaSquareMeters: metrics.areaSquareMeters,
        perimeterMeters: metrics.perimeterMeters,
        closureDistanceMeters: metrics.closureDistanceMeters,
      },
    });
    const parcelEntity: CadParcelEntity = {
      id: createStableRuntimeId('cad-parcel'),
      type: 'parcel',
      layerId: 'parcels',
      styleId: 'style-parcel',
      visible: true,
      locked: false,
      vertices: ringVertices.map((vertex) => ({ x: vertex.x, y: vertex.y })),
      vertexLabels: [...ringLabels],
      parcelName,
      areaSquareMeters: metrics.areaSquareMeters,
      perimeterMeters: metrics.perimeterMeters,
      closureDeltaX: metrics.closureDeltaX,
      closureDeltaY: metrics.closureDeltaY,
      closureDistanceMeters: metrics.closureDistanceMeters,
      metadata: buildCadCogoEntityMetadata({
        createdBy: 'PARCEL_CREATE',
        manual: true,
        sourceEntityId: sourcePolyline.id,
      }, provenance),
    };
    const nextProjectWithEntities = appendCadProjectEntities(snapshot.project, [parcelEntity]);
    const nextProject = appendCogoComputation({
      project: nextProjectWithEntities,
      provenance,
      title: 'Parcel Create',
      summary,
      rows: [
        { label: 'Parcel', value: parcelName },
        { label: 'Area', value: metrics.areaSquareMeters.toFixed(3), unit: 'm2' },
        { label: 'Perimeter', value: metrics.perimeterMeters.toFixed(3), unit: 'm' },
        { label: 'Closure', value: metrics.closureDistanceMeters.toFixed(3), unit: 'm' },
      ],
      createdEntities: [parcelEntity],
    });
    return {
      nextSnapshot: {
        project: nextProject,
        selection: createCadSelectionState(nextProject, [parcelEntity.id]),
      },
      commandState: {
        key: 'PARCEL_CREATE',
        phase: 'committed',
        prompt: `PARCEL_CREATE committed for ${parcelName}. Closure ${metrics.closureDistanceMeters.toFixed(3)} m.`,
      },
      transactionLabel: `PARCEL_CREATE (${parcelName})`,
      addedEntityIds: [parcelEntity.id],
      removedEntityIds: [],
    };
  },
};

const replaceEntityInProject = (
  project: CadProject,
  entityId: CadEntityId,
  updater: (_entity: CadEntity) => CadEntity,
): CadProject =>
  replaceCadProjectEntities(
    project,
    project.entities.map((entity) => (entity.id === entityId ? updater(entity) : entity)),
  );

const editEntityCommand: CadCommandDefinition<{
  key: 'EDIT_ENTITY';
  entityId: CadEntityId;
  edit:
    | { kind: 'entity-name'; value: string }
    | { kind: 'point-x'; value: number }
    | { kind: 'point-y'; value: number }
    | { kind: 'point-z'; value: number | null }
    | { kind: 'line-end'; toX: number; toY: number }
    | { kind: 'polyline-vertex'; vertexIndex: number; x: number; y: number };
}> = {
  key: 'EDIT_ENTITY',
  execute: (snapshot, command) => {
    const targetEntity = snapshot.project.entities.find((entity) => entity.id === command.entityId);
    if (!targetEntity) return null;

    if (command.edit.kind === 'entity-name') {
      const nextName = command.edit.value.trim();
      if (!nextName) return null;
      let nextProject: CadProject | null = null;
      if (targetEntity.type === 'survey-point') {
        if (
          stationIdExists(snapshot.project, nextName) &&
          nextName.toUpperCase() !== targetEntity.stationId.trim().toUpperCase()
        ) {
          return null;
        }
        nextProject = replaceCadProjectEntities(
          snapshot.project,
          snapshot.project.entities.map((entity) =>
            renamePointReferences(entity, targetEntity.id, targetEntity.stationId, nextName),
          ),
        );
      } else if (targetEntity.type === 'alignment') {
        nextProject = replaceEntityInProject(snapshot.project, targetEntity.id, (entity) =>
          entity.type === 'alignment' ? { ...entity, name: nextName } : entity,
        );
      } else if (targetEntity.type === 'parcel') {
        nextProject = replaceEntityInProject(snapshot.project, targetEntity.id, (entity) =>
          entity.type === 'parcel' ? { ...entity, parcelName: nextName } : entity,
        );
      } else {
        nextProject = replaceEntityInProject(snapshot.project, targetEntity.id, (entity) =>
          withEntityMetadataName(entity, nextName),
        );
      }
      if (!nextProject) return null;
      return {
        nextSnapshot: {
          project: nextProject,
          selection: createCadSelectionState(nextProject, [targetEntity.id]),
        },
        commandState: {
          key: 'EDIT_ENTITY',
          phase: 'committed',
          prompt: `EDIT_ENTITY committed for ${nextName}.`,
        },
        transactionLabel: `EDIT_ENTITY (${nextName})`,
        addedEntityIds: [],
        removedEntityIds: [],
      };
    }

    if (targetEntity.type === 'survey-point') {
      const nextX = command.edit.kind === 'point-x' ? command.edit.value : targetEntity.x;
      const nextY = command.edit.kind === 'point-y' ? command.edit.value : targetEntity.y;
      const nextZ =
        command.edit.kind === 'point-z'
          ? command.edit.value ?? undefined
          : targetEntity.z;
      if (
        !Number.isFinite(nextX) ||
        !Number.isFinite(nextY) ||
        (nextZ != null && !Number.isFinite(nextZ))
      ) {
        return null;
      }
      const nextProject = replaceCadProjectEntities(
        snapshot.project,
        snapshot.project.entities.map((entity) =>
          movePointReferences(entity, targetEntity.id, targetEntity.stationId, nextX, nextY, nextZ),
        ),
      );
      return {
        nextSnapshot: {
          project: nextProject,
          selection: createCadSelectionState(nextProject, [targetEntity.id]),
        },
        commandState: {
          key: 'EDIT_ENTITY',
          phase: 'committed',
          prompt: `EDIT_ENTITY committed for ${targetEntity.stationId}.`,
        },
        transactionLabel: `EDIT_ENTITY (${targetEntity.stationId})`,
        addedEntityIds: [],
        removedEntityIds: [],
      };
    }

    if (targetEntity.type === 'line' && command.edit.kind === 'line-end') {
      const edit = command.edit;
      const updatedEntity: CadEntity = {
        ...targetEntity,
        toX: edit.toX,
        toY: edit.toY,
      };
      const nextProjectBase = replaceEntityInProject(snapshot.project, targetEntity.id, (_entity) =>
        updatedEntity,
      );
      const nextProject = syncEditedEntityDependencies(nextProjectBase, targetEntity, updatedEntity);
      return {
        nextSnapshot: {
          project: nextProject,
          selection: createCadSelectionState(nextProject, [targetEntity.id]),
        },
        commandState: {
          key: 'EDIT_ENTITY',
          phase: 'committed',
          prompt: `EDIT_ENTITY committed for ${getCadEntityDisplayLabel(targetEntity)}.`,
        },
        transactionLabel: `EDIT_ENTITY (${getCadEntityDisplayLabel(targetEntity)})`,
        addedEntityIds: [],
        removedEntityIds: [],
      };
    }

    if (targetEntity.type === 'polyline' && command.edit.kind === 'polyline-vertex') {
      const edit = command.edit;
      const vertex = targetEntity.vertices[edit.vertexIndex];
      if (!vertex) return null;
      const updatedEntity: CadEntity = {
        ...targetEntity,
        vertices: targetEntity.vertices.map((entry, index) =>
          index === edit.vertexIndex ? { x: edit.x, y: edit.y } : entry,
        ),
      };
      const nextProjectBase = replaceEntityInProject(snapshot.project, targetEntity.id, (_entity) => updatedEntity);
      const nextProject = syncEditedEntityDependencies(nextProjectBase, targetEntity, updatedEntity);
      return {
        nextSnapshot: {
          project: nextProject,
          selection: createCadSelectionState(nextProject, [targetEntity.id]),
        },
        commandState: {
          key: 'EDIT_ENTITY',
          phase: 'committed',
          prompt: `EDIT_ENTITY committed for ${getCadEntityDisplayLabel(targetEntity)}.`,
        },
        transactionLabel: `EDIT_ENTITY (${getCadEntityDisplayLabel(targetEntity)})`,
        addedEntityIds: [],
        removedEntityIds: [],
      };
    }

    return null;
  },
};

const moveCommand: CadCommandDefinition<{
  key: 'MOVE';
  deltaX: number;
  deltaY: number;
}> = {
  key: 'MOVE',
  execute: (snapshot, command) => {
    if (Math.abs(command.deltaX) <= 1e-9 && Math.abs(command.deltaY) <= 1e-9) return null;
    const selectedEntities = getExpandedSelectedEntities(snapshot);
    if (selectedEntities.length === 0) return null;
    const selectedIdSet = new Set(selectedEntities.map((entity) => entity.id));
    const nextProjectBase = replaceCadProjectEntities(
      snapshot.project,
      snapshot.project.entities.map((entity) =>
        selectedIdSet.has(entity.id) ? translateEntity(entity, command.deltaX, command.deltaY) : entity,
      ),
    );
    const translatedEntityById = new Map(
      nextProjectBase.entities.map((entity) => [entity.id, entity] as const),
    );
    const nextProject = selectedEntities.reduce((currentProject, previousEntity) => {
      const updatedEntity = translatedEntityById.get(previousEntity.id);
      if (!updatedEntity) return currentProject;
      return syncEditedEntityDependencies(currentProject, previousEntity, updatedEntity, {
        syncLinePoints: false,
      });
    }, nextProjectBase);
    return {
      nextSnapshot: {
        project: nextProject,
        selection: createCadSelectionState(nextProject, selectedEntities.map((entity) => entity.id)),
      },
      commandState: {
        key: 'MOVE',
        phase: 'committed',
        prompt: `MOVE committed by (${command.deltaX.toFixed(3)}, ${command.deltaY.toFixed(3)}).`,
      },
      transactionLabel: `MOVE (${selectedEntities.length})`,
      addedEntityIds: [],
      removedEntityIds: [],
    };
  },
};

const copyCommand: CadCommandDefinition<{
  key: 'COPY';
  deltaX: number;
  deltaY: number;
}> = {
  key: 'COPY',
  execute: (snapshot, command) => {
    if (Math.abs(command.deltaX) <= 1e-9 && Math.abs(command.deltaY) <= 1e-9) return null;
    const selectedEntities = getExpandedSelectedEntities(snapshot);
    if (selectedEntities.length === 0) return null;
    const copiedEntities = buildCopiedEntities(snapshot.project, selectedEntities, command.deltaX, command.deltaY);
    if (copiedEntities.length === 0) return null;
    const nextProject = appendCadProjectEntities(snapshot.project, copiedEntities);
    return {
      nextSnapshot: {
        project: nextProject,
        selection: createCadSelectionState(
          nextProject,
          copiedEntities.map((entity) => entity.id),
        ),
      },
      commandState: {
        key: 'COPY',
        phase: 'committed',
        prompt: `COPY committed by (${command.deltaX.toFixed(3)}, ${command.deltaY.toFixed(3)}).`,
      },
      transactionLabel: `COPY (${copiedEntities.length})`,
      addedEntityIds: copiedEntities.map((entity) => entity.id),
      removedEntityIds: [],
    };
  },
};

const filletCommand: CadCommandDefinition<{
  key: 'FILLET';
  radius: number;
  firstLineEntityId: CadEntityId;
  firstPickPoint: { x: number; y: number };
  secondLineEntityId: CadEntityId;
  secondPickPoint: { x: number; y: number };
}> = {
  key: 'FILLET',
  execute: (snapshot, command) => {
    if (command.firstLineEntityId === command.secondLineEntityId) return null;
    const firstLine = snapshot.project.entities.find(
      (entity): entity is CadLineEntity =>
        entity.type === 'line' && entity.id === command.firstLineEntityId && !entity.locked,
    );
    const secondLine = snapshot.project.entities.find(
      (entity): entity is CadLineEntity =>
        entity.type === 'line' && entity.id === command.secondLineEntityId && !entity.locked,
    );
    if (!firstLine || !secondLine) return null;

    const fillet = buildCadLineFillet(
      firstLine,
      command.firstPickPoint,
      secondLine,
      command.secondPickPoint,
      command.radius,
    );
    if (!fillet) return null;

    const updatedProject = replaceCadProjectEntities(
      snapshot.project,
      snapshot.project.entities.map((entity) => {
        if (entity.id === firstLine.id) return fillet.firstLine;
        if (entity.id === secondLine.id) return fillet.secondLine;
        return entity;
      }),
    );
    if (!fillet.arcDefinition) {
      return {
        nextSnapshot: {
          project: updatedProject,
          selection: createCadSelectionState(updatedProject, [firstLine.id, secondLine.id]),
        },
        commandState: {
          key: 'FILLET',
          phase: 'committed',
          prompt: `FILLET committed as hard corner radius ${command.radius.toFixed(3)}.`,
        },
        transactionLabel: 'FILLET (0)',
        addedEntityIds: [],
        removedEntityIds: [],
      };
    }

    const curveSequence = nextCurveSequence(snapshot.project);
    const curveLabels = buildCurveLabels(curveSequence);
    const arcEntity: CadArcEntity = {
      id: createStableRuntimeId('cad-arc'),
      type: 'arc',
      layerId: 'observation-lines',
      styleId: 'style-observation-line',
      visible: true,
      locked: false,
      centerX: fillet.arcDefinition.center.x,
      centerY: fillet.arcDefinition.center.y,
      radius: fillet.arcDefinition.radius,
      startAngleDeg: fillet.arcDefinition.startAngleDeg,
      endAngleDeg: fillet.arcDefinition.endAngleDeg,
      metadata: {
        createdBy: 'FILLET',
        entityName: curveLabels.curveName,
        manual: true,
        filletRadius: command.radius,
        sourceLineIds: [firstLine.id, secondLine.id],
      },
    };
    const supportEntities = createArcSupportEntities(
      updatedProject,
      arcEntity.id,
      curveSequence,
      fillet.arcDefinition,
      'FILLET',
    );
    const nextProject = appendCadProjectEntities(updatedProject, [arcEntity, ...supportEntities]);
    return {
      nextSnapshot: {
        project: nextProject,
        selection: createCadSelectionState(nextProject, [arcEntity.id]),
      },
      commandState: {
        key: 'FILLET',
        phase: 'committed',
        prompt: `FILLET committed as ${curveLabels.curveName} radius ${command.radius.toFixed(3)}.`,
      },
      transactionLabel: `FILLET (${curveLabels.curveName})`,
      addedEntityIds: [arcEntity.id, ...supportEntities.map((entity) => entity.id)],
      removedEntityIds: [],
    };
  },
};

const pasteCommand: CadCommandDefinition<{
  key: 'PASTE';
  deltaX: number;
  deltaY: number;
  entityIds: CadEntityId[];
}> = {
  key: 'PASTE',
  execute: (snapshot, command) => {
    if (Math.abs(command.deltaX) <= 1e-9 && Math.abs(command.deltaY) <= 1e-9) return null;
    const sourceEntities = getExpandedEntitiesByIds(snapshot.project, command.entityIds);
    if (sourceEntities.length === 0) return null;
    const copiedEntities = buildCopiedEntities(snapshot.project, sourceEntities, command.deltaX, command.deltaY);
    if (copiedEntities.length === 0) return null;
    const nextProject = appendCadProjectEntities(snapshot.project, copiedEntities);
    return {
      nextSnapshot: {
        project: nextProject,
        selection: createCadSelectionState(
          nextProject,
          copiedEntities.map((entity) => entity.id),
        ),
      },
      commandState: {
        key: 'PASTE',
        phase: 'committed',
        prompt: `PASTE committed by (${command.deltaX.toFixed(3)}, ${command.deltaY.toFixed(3)}).`,
      },
      transactionLabel: `PASTE (${copiedEntities.length})`,
      addedEntityIds: copiedEntities.map((entity) => entity.id),
      removedEntityIds: [],
    };
  },
};

const trimCommand: CadCommandDefinition<{
  key: 'TRIM';
  cuttingEntityIds: CadEntityId[];
  targetEntityId: CadEntityId;
  pickPoint: { x: number; y: number };
  targetSegmentId?: string;
  extendMode?: boolean;
}> = {
  key: 'TRIM',
  execute: (snapshot, command) => {
    const cuttingEntities = buildTrimBoundaryEntities(snapshot.project, command.cuttingEntityIds);
    if (cuttingEntities.length === 0) return null;
    if (cuttingEntities.some((entity) => entity.id === command.targetEntityId)) return null;
    const targetEntity = snapshot.project.entities.find(
      (entity): entity is CadTrimEntity =>
        entity.id === command.targetEntityId && isTrimmableEntity(entity) && !entity.locked,
    );
    if (!targetEntity) return null;

    const trimmedPieces = command.extendMode
      ? buildExtendedTrimEntity(
          targetEntity,
          cuttingEntities,
          command.pickPoint,
          command.targetSegmentId,
        )
      : buildTrimmedEntityPieces(
          targetEntity,
          cuttingEntities,
          command.pickPoint,
          command.targetSegmentId,
        );
    if (trimmedPieces.length === 0) return null;

    const nextProject = replaceCadProjectEntities(
      snapshot.project,
      snapshot.project.entities.flatMap((entity) => {
        if (entity.id !== targetEntity.id) return [entity];
        return trimmedPieces;
      }),
    );
    const preservedTargetId = trimmedPieces.some((entity) => entity.id === targetEntity.id);
    const cuttingSelectionIds = cuttingEntities
      .filter((entity) => nextProject.entities.some((candidate) => candidate.id === entity.id))
      .map((entity) => entity.id);

    return {
      nextSnapshot: {
        project: nextProject,
        selection: createCadSelectionState(nextProject, cuttingSelectionIds),
      },
      commandState: {
        key: 'TRIM',
        phase: 'committed',
        prompt: command.extendMode
          ? `TRIM extend committed on ${targetEntity.id}.`
          : `TRIM committed on ${targetEntity.id}. ${trimmedPieces.length} piece${trimmedPieces.length === 1 ? '' : 's'} remain.`,
      },
      transactionLabel: command.extendMode ? `EXTEND (${targetEntity.id})` : `TRIM (${targetEntity.id})`,
      addedEntityIds: trimmedPieces
        .map((entity) => entity.id)
        .filter((entityId) => entityId !== targetEntity.id),
      removedEntityIds: preservedTargetId ? [] : [targetEntity.id],
    };
  },
};

const intersectPointCommand: CadCommandDefinition<{
  key: 'INTERSECT_POINT';
  x: number;
  y: number;
  label?: string;
  firstLabel: string;
  secondLabel: string;
}> = {
  key: 'INTERSECT_POINT',
  execute: (snapshot, command) => {
    const summary = `Created point at ${command.firstLabel} x ${command.secondLabel}`;
    const provenance = createCogoProvenance({
      toolKey: 'INTERSECT_POINT',
      summary,
      inputs: {
        firstLabel: command.firstLabel,
        secondLabel: command.secondLabel,
      },
      parameters: {
        x: command.x,
        y: command.y,
      },
    });
    const entities = createManualPointEntities(snapshot.project, command.x, command.y, command.label);
    const pointEntity: CadSurveyPointEntity = {
      ...entities.point,
      metadata: buildCadCogoEntityMetadata(entities.point.metadata, provenance),
    };
    const labelEntity = entities.label
      ? {
          ...entities.label,
          metadata: buildCadCogoEntityMetadata(entities.label.metadata, provenance),
        }
      : null;
    const appendedEntities = compactManualPointEntities([pointEntity, labelEntity]);
    const nextProjectWithEntities = appendCadProjectEntities(
      snapshot.project,
      appendedEntities,
    );
    const nextProject = appendCogoComputation({
      project: nextProjectWithEntities,
      provenance,
      title: 'Intersection Point',
      summary,
      rows: [
        { label: 'Point', value: pointEntity.stationId },
        { label: 'Northing', value: command.y.toFixed(3), unit: 'm' },
        { label: 'Easting', value: command.x.toFixed(3), unit: 'm' },
      ],
      createdEntities: appendedEntities,
    });
    return {
      nextSnapshot: {
        project: nextProject,
        selection: createCadSelectionState(nextProject, [pointEntity.id]),
      },
      commandState: {
        key: 'INTERSECT_POINT',
        phase: 'committed',
        prompt: `INTERSECT_POINT committed at ${command.firstLabel} x ${command.secondLabel}.`,
      },
      transactionLabel: `INTERSECT_POINT (${pointEntity.stationId})`,
      addedEntityIds: [pointEntity.id, labelEntity?.id].filter(
        (entityId): entityId is string => entityId != null,
      ),
      removedEntityIds: [],
    };
  },
};

const gripEditCommand: CadCommandDefinition<{
  key: 'GRIP_EDIT';
  entityId: CadEntityId;
  gripKind: CadGripHandleKind;
  x: number;
  y: number;
  vertexIndex?: number;
}> = {
  key: 'GRIP_EDIT',
  execute: (snapshot, command) => {
    const nextProject = applyCadGripEdit(snapshot.project, command);
    if (!nextProject) return null;
    return {
      nextSnapshot: {
        project: nextProject,
        selection: createCadSelectionState(nextProject, [command.entityId]),
      },
      commandState: {
        key: 'GRIP_EDIT',
        phase: 'committed',
        prompt: `GRIP_EDIT committed on ${command.entityId}.`,
      },
      transactionLabel: `GRIP_EDIT (${command.entityId})`,
      addedEntityIds: [],
      removedEntityIds: [],
    };
  },
};

export const CAD_COMMAND_REGISTRY: Record<CadCommandKey, CadCommandDefinition<CadCommand>> = {
  SELECT_ALL: selectAllCommand as CadCommandDefinition<CadCommand>,
  CLEAR_SELECTION: clearSelectionCommand as CadCommandDefinition<CadCommand>,
  ERASE: eraseCommand as CadCommandDefinition<CadCommand>,
  POINT: pointCommand as CadCommandDefinition<CadCommand>,
  COGO_POINT: cogoPointCommand as CadCommandDefinition<CadCommand>,
  LINE: lineCommand as CadCommandDefinition<CadCommand>,
  PLINE: polylineCommand as CadCommandDefinition<CadCommand>,
  TRAVERSE: traverseCommand as CadCommandDefinition<CadCommand>,
  BATCH_COGO: batchCogoCommand as CadCommandDefinition<CadCommand>,
  ARC_3PT: arc3ptCommand as CadCommandDefinition<CadCommand>,
  ARC_CREATE: arcCreateCommand as CadCommandDefinition<CadCommand>,
  TANGENT_CURVE: tangentCurveCommand as CadCommandDefinition<CadCommand>,
  ALIGNMENT_CREATE: alignmentCreateCommand as CadCommandDefinition<CadCommand>,
  ALIGNMENT_OFFSET_CREATE: alignmentOffsetCreateCommand as CadCommandDefinition<CadCommand>,
  ALIGNMENT_STATION_REPORT: alignmentStationReportCommand as CadCommandDefinition<CadCommand>,
  ALIGNMENT_STATION_EQUATION: alignmentStationEquationCommand as CadCommandDefinition<CadCommand>,
  ALIGNMENT_OFFSET_POINT: alignmentOffsetPointCommand as CadCommandDefinition<CadCommand>,
  ALIGNMENT_INTERVAL_POINTS: alignmentIntervalPointsCommand as CadCommandDefinition<CadCommand>,
  PARCEL_CREATE: parcelCreateCommand as CadCommandDefinition<CadCommand>,
  EDIT_ENTITY: editEntityCommand as CadCommandDefinition<CadCommand>,
  MOVE: moveCommand as CadCommandDefinition<CadCommand>,
  COPY: copyCommand as CadCommandDefinition<CadCommand>,
  FILLET: filletCommand as CadCommandDefinition<CadCommand>,
  PASTE: pasteCommand as CadCommandDefinition<CadCommand>,
  TRIM: trimCommand as CadCommandDefinition<CadCommand>,
  INTERSECT_POINT: intersectPointCommand as CadCommandDefinition<CadCommand>,
  GRIP_EDIT: gripEditCommand as CadCommandDefinition<CadCommand>,
};

export const createCadIdleCommandState = createIdleCommandState;

export const executeCadCommand = (
  snapshot: CadWorkspaceSnapshot,
  command: CadCommand,
): CadCommandExecutionResult | null => CAD_COMMAND_REGISTRY[command.key].execute(snapshot, command);
