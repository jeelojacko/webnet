import {
  appendCadProjectEntities,
  replaceCadProjectEntities,
} from './cadProjectState';
import type {
  CadEntity,
  CadEntityId,
  CadProject,
  CadSurveyPointEntity,
  CadTextEntity,
} from './cadTypes';
import {
  buildCurveLabels,
  compactManualPointEntities,
  createManualPointEntities,
  nextCurveSequence,
} from './cadTransactionsEntityFactories';
import { cloneEntityMetadata } from './cadTransactionsMetadata';
import { resolveLinkedSurveyPoint } from './cadTransactionsPointReferences';

export const buildCopiedDependentPointEntities = (
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
