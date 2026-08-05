import type { AdjustmentResult } from '../../types';
import { buildCadCogoComputation } from './cadCogoTypes';
import { buildCadBounds } from './cadProjectState';
import type {
  CadDrawingDocument,
  CadDrawingImportRecord,
  CadEntity,
  CadErrorEllipseEntity,
  CadProject,
  CadSurveyPointEntity,
  CadTextEntity,
} from './cadTypes';

const sortStationIds = (ids: string[]) =>
  [...ids].sort((left, right) => left.localeCompare(right, undefined, { numeric: true }));

const buildImportId = (importedAtIso: string): string =>
  `adjusted-points:${importedAtIso.replace(/[^0-9A-Za-z]+/g, '')}`;

const adjustedPointEntityId = (stationId: string): string => `pt:${stationId}`;
const adjustedLabelEntityId = (stationId: string): string => `label:${stationId}`;
const adjustedEllipseEntityId = (stationId: string): string => `ellipse:${stationId}`;

const isAdjustedImportArtifact = (entity: CadEntity, stationIdSet: Set<string>): boolean => {
  if (entity.type === 'survey-point') return stationIdSet.has(entity.stationId);
  if (entity.type === 'text' && typeof entity.metadata?.stationId === 'string') {
    return stationIdSet.has(entity.metadata.stationId);
  }
  if (entity.type === 'error-ellipse') return stationIdSet.has(entity.stationId);
  return false;
};

const buildAdjustedPointEntities = ({
  importId,
  result,
  sourceName,
}: {
  importId: string;
  result: AdjustmentResult;
  sourceName: string;
}): CadEntity[] =>
  sortStationIds(Object.keys(result.stations)).flatMap((stationId) => {
    const station = result.stations[stationId]!;
    const commonMetadata = {
      stationId,
      importedFrom: 'adjusted-points',
      importId,
      sourceName,
      fixed: station.fixed,
      coordInputClass: station.coordInputClass ?? 'unknown',
    };
    const point: CadSurveyPointEntity = {
      id: adjustedPointEntityId(stationId),
      type: 'survey-point',
      layerId: station.fixed ? 'control-points' : 'points',
      styleId: station.fixed ? 'style-control-point' : 'style-point',
      visible: true,
      locked: false,
      stationId,
      x: station.x,
      y: station.y,
      z: station.h,
      pointClass: station.fixed ? 'control' : station.coordInputClass === 'unknown' ? 'unknown' : 'free',
      source: 'adjustment-result',
      errorEllipse: station.errorEllipse,
      metadata: commonMetadata,
    };
    const label: CadTextEntity = {
      id: adjustedLabelEntityId(stationId),
      type: 'text',
      layerId: 'labels',
      styleId: 'style-label',
      visible: true,
      locked: false,
      x: station.x,
      y: station.y,
      text: stationId,
      anchorEntityId: point.id,
      metadata: commonMetadata,
    };
    const ellipse: CadErrorEllipseEntity | null = station.errorEllipse
      ? {
          id: adjustedEllipseEntityId(stationId),
          type: 'error-ellipse',
          layerId: 'error-ellipses',
          styleId: 'style-error-ellipse',
          visible: true,
          locked: false,
          stationId,
          centerX: station.x,
          centerY: station.y,
          semiMajor: station.errorEllipse.semiMajor,
          semiMinor: station.errorEllipse.semiMinor,
          thetaDeg: station.errorEllipse.theta,
          metadata: commonMetadata,
        }
      : null;
    return ellipse ? [point, label, ellipse] : [point, label];
  });

const buildImportComputation = ({
  createdEntityIds,
  importId,
  importedAtIso,
  record,
  updatedEntityIds,
}: {
  createdEntityIds: string[];
  importId: string;
  importedAtIso: string;
  record: CadDrawingImportRecord;
  updatedEntityIds: string[];
}) =>
  buildCadCogoComputation({
    createdEntities: createdEntityIds.map((id) => ({
      id,
      type: 'text',
      layerId: 'labels',
      visible: false,
      locked: true,
      x: 0,
      y: 0,
      text: '',
    })),
    updatedEntities: updatedEntityIds.map((id) => ({
      id,
      type: 'text',
      layerId: 'labels',
      visible: false,
      locked: true,
      x: 0,
      y: 0,
      text: '',
    })),
    warnings: [],
    report: {
      title: 'Import Adjusted Points',
      summary: `Imported ${record.createdPointCount + record.updatedPointCount} adjusted points.`,
      rows: [
        { label: 'Source', value: record.sourceName },
        { label: 'Created points', value: String(record.createdPointCount) },
        { label: 'Updated points', value: String(record.updatedPointCount) },
        { label: 'Error ellipses', value: String(record.ellipseCount) },
      ],
    },
    provenance: {
      id: importId,
      toolKey: 'IMPORT_ADJUSTED_POINTS',
      inputs: {
        sourceName: record.sourceName,
      },
      resultSummary: `Created ${record.createdPointCount}, updated ${record.updatedPointCount}`,
      createdAtIso: importedAtIso,
    },
  });

export const importAdjustedPointsIntoCadProject = ({
  importedAtIso = new Date().toISOString(),
  project,
  result,
  sourceName = 'Current adjustment',
}: {
  importedAtIso?: string;
  project: CadProject;
  result: AdjustmentResult;
  sourceName?: string;
}): { project: CadProject; record: CadDrawingImportRecord } => {
  const importId = buildImportId(importedAtIso);
  const stationIds = sortStationIds(Object.keys(result.stations));
  const stationIdSet = new Set(stationIds);
  const previousPointIds = new Set(
    project.entities
      .filter((entity): entity is CadSurveyPointEntity => entity.type === 'survey-point')
      .map((entity) => entity.stationId),
  );
  const importEntities = buildAdjustedPointEntities({ importId, result, sourceName });
  const preservedEntities = project.entities.filter(
    (entity) => !isAdjustedImportArtifact(entity, stationIdSet),
  );
  const createdPointCount = stationIds.filter((stationId) => !previousPointIds.has(stationId)).length;
  const updatedPointCount = stationIds.length - createdPointCount;
  const record: CadDrawingImportRecord = {
    id: importId,
    kind: 'adjusted-points',
    sourceName,
    importedAtIso,
    createdPointCount,
    updatedPointCount,
    ellipseCount: importEntities.filter((entity) => entity.type === 'error-ellipse').length,
  };
  const nextEntities = [...preservedEntities, ...importEntities];
  const pointEntityIds = importEntities
    .filter((entity) => entity.type === 'survey-point')
    .map((entity) => entity.id);
  const nextProject = {
    ...project,
    metadata: {
      ...project.metadata,
      source: 'adjustment-result' as const,
      adjustedStationCount: stationIds.length,
      stationCount: nextEntities.filter((entity) => entity.type === 'survey-point').length,
    },
    entities: nextEntities,
    cogoComputations: [
      ...(project.cogoComputations ?? []),
      buildImportComputation({
        createdEntityIds: pointEntityIds.filter((id) => !previousPointIds.has(id.replace(/^pt:/, ''))),
        updatedEntityIds: pointEntityIds.filter((id) => previousPointIds.has(id.replace(/^pt:/, ''))),
        importId,
        importedAtIso,
        record,
      }),
    ],
    bounds: buildCadBounds(nextEntities),
  };
  return { project: nextProject, record };
};

export const importAdjustedPointsIntoCadDrawing = ({
  document,
  result,
  sourceName,
}: {
  document: CadDrawingDocument;
  result: AdjustmentResult;
  sourceName?: string;
}): CadDrawingDocument => {
  const importedAtIso = new Date().toISOString();
  const { project, record } = importAdjustedPointsIntoCadProject({
    importedAtIso,
    project: document.project,
    result,
    sourceName: sourceName ?? 'Current adjustment',
  });
  return {
    ...document,
    updatedAt: importedAtIso,
    project,
    imports: [...(document.imports ?? []), record],
  };
};
