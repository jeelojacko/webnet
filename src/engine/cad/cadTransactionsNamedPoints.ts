import type { CadProject, CadSurveyPointEntity } from './cadTypes';
import {
  appendCadProjectEntities,
} from './cadProjectState';
import {
  createManualPointEntities,
} from './cadTransactionsEntityFactories';
import {
  buildCadCogoEntityMetadata,
} from './cadCogoTypes';
import type { createCogoProvenance } from './cadTransactionsCogoReports';

export const findExistingTraversePoint = (
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

export const ensureNamedPointEntity = (
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
