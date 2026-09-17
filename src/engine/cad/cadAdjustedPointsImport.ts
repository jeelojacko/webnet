import type { AdjustmentResult } from '../../types';
import type { ResultDependencyIdentity } from '../resultIntegrity';
import { ownerOfCadEntity, stampAdjustmentDependency } from './cadAdjustmentDependency';
import { buildCadCogoComputation } from './cadCogoTypes';
import { cadBuildParcelClosureSummary } from './cadCogoParcelGeometrySummaries';
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

/**
 * Local F2F-entity check, mirroring isFieldToFinishEntity from
 * ../fieldToFinish/cadGeneration (same generatedBy convention as
 * linkedSync.ts isGenerated). A runtime import of cadGeneration pulls
 * cadLabelEngine into this graph and trips the cadCogoParcel*
 * star-export cycle (cadBuildParcelLineworkDiagnostics resolves
 * undefined), so the predicate lives here. Keep in sync with
 * FIELD_TO_FINISH_GENERATOR in cadGeneration.ts.
 */
const isFieldToFinishEntity = (entity: CadEntity): boolean => {
  const metadata = entity.metadata as Record<string, unknown> | undefined;
  const provenance = metadata?.['provenance'] as Record<string, unknown> | undefined;
  return provenance?.['generatedBy'] === 'FIELD_TO_FINISH';
};

const sortStationIds = (ids: string[]) =>
  [...ids].sort((left, right) => left.localeCompare(right, undefined, { numeric: true }));

const buildImportId = (importedAtIso: string): string =>
  `adjusted-points:${importedAtIso.replace(/[^0-9A-Za-z]+/g, '')}`;

const adjustedPointEntityId = (stationId: string): string => `pt:${stationId}`;
const adjustedLabelEntityId = (stationId: string): string => `label:${stationId}`;
const adjustedEllipseEntityId = (stationId: string): string => `ellipse:${stationId}`;

const isAdjustedImportArtifact = (entity: CadEntity, stationIdSet: Set<string>): boolean => {
  // MODEL A owner precedence: another owner's entity is never an import
  // artifact, so the import can never delete F2F (or manual) geometry.
  if (isFieldToFinishEntity(entity)) return false;
  if (entity.type === 'survey-point') return stationIdSet.has(entity.stationId);
  if (entity.type === 'text' && typeof entity.metadata?.stationId === 'string') {
    return stationIdSet.has(entity.metadata.stationId);
  }
  if (entity.type === 'error-ellipse') return stationIdSet.has(entity.stationId);
  return false;
};

/**
 * MODEL A owner precedence: stations whose EXISTING point/label/ellipse
 * entities carry F2F provenance are owned by field-to-finish — the import
 * skips them entirely (entities preserved untouched, nothing created).
 * The link declares F2F-managed stations, but ownership is decided per
 * entity so a stale link never blocks an import into a freed slot.
 */
const f2fOwnedStationIdsOf = (project: CadProject): Set<string> => {
  void project.metadata.fieldToFinishLink;
  const owned = new Set<string>();
  for (const entity of project.entities) {
    if (!isFieldToFinishEntity(entity)) continue;
    if (entity.type === 'survey-point') owned.add(entity.stationId);
    else if (entity.type === 'error-ellipse') owned.add(entity.stationId);
    else if (entity.type === 'text' && typeof entity.metadata?.stationId === 'string') {
      owned.add(entity.metadata.stationId);
    }
  }
  return owned;
};

const buildAdjustedPointEntities = ({
  identity,
  importId,
  result,
  sourceName,
  stationIds,
}: {
  identity: ResultDependencyIdentity;
  importId: string;
  result: AdjustmentResult;
  sourceName: string;
  stationIds: string[];
}): CadEntity[] =>
  stationIds.flatMap((stationId) => {
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
    return (ellipse ? [point, label, ellipse] : [point, label]).map((entity) =>
      stampAdjustmentDependency(entity, identity),
    );
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
        {
          label: 'Skipped F2F stations',
          value: record.skippedF2fStationIds?.length ? record.skippedF2fStationIds.join(', ') : 'none',
        },
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

/**
 * Parcel refresh on point move: PARCEL_DERIVED parcels follow imported
 * stations (same-station coordinate copy, in place) with recomputed
 * metrics + the new result stamp. Parcels with no vertex label matching
 * an imported station are left untouched (same reference) — they go STALE
 * via metrics/dependency eval, never silently destroyed. Manual parcels
 * (no station vertexLabels) are never touched.
 */
const refreshParcelsForMovedStations = ({
  entities,
  identity,
  result,
  stationIds,
}: {
  entities: CadEntity[];
  identity: ResultDependencyIdentity;
  result: AdjustmentResult;
  stationIds: string[];
}): CadEntity[] => {
  const moved = new Set(stationIds);
  return entities.map((entity) => {
    if (entity.type !== 'parcel' || ownerOfCadEntity(entity) !== 'PARCEL_DERIVED') return entity;
    if (!entity.vertexLabels.some((label) => moved.has(label))) return entity;
    const vertices = entity.vertices.map((vertex, index) => {
      const station = result.stations[entity.vertexLabels[index] ?? ''];
      return station ? { x: station.x, y: station.y } : vertex;
    });
    const summary = cadBuildParcelClosureSummary(vertices);
    if (!summary) return entity;
    return stampAdjustmentDependency(
      {
        ...entity,
        vertices,
        areaSquareMeters: summary.areaSquareMeters,
        perimeterMeters: summary.perimeterMeters,
        closureDeltaX: summary.closureDeltaX,
        closureDeltaY: summary.closureDeltaY,
        closureDistanceMeters: summary.closureDistanceMeters,
      },
      identity,
    );
  });
};

export const importAdjustedPointsIntoCadProject = ({
  identity,
  importedAtIso = new Date().toISOString(),
  project,
  result,
  sourceName = 'Current adjustment',
}: {
  identity: ResultDependencyIdentity;
  importedAtIso?: string;
  project: CadProject;
  result: AdjustmentResult;
  sourceName?: string;
}): { project: CadProject; record: CadDrawingImportRecord } => {
  const importId = buildImportId(importedAtIso);
  const stationIds = sortStationIds(Object.keys(result.stations));
  const f2fOwned = f2fOwnedStationIdsOf(project);
  const skippedF2fStationIds = stationIds.filter((stationId) => f2fOwned.has(stationId));
  const importableStationIds = stationIds.filter((stationId) => !f2fOwned.has(stationId));
  const stationIdSet = new Set(importableStationIds);
  const previousPointIds = new Set(
    project.entities
      .filter((entity): entity is CadSurveyPointEntity => entity.type === 'survey-point')
      .map((entity) => entity.stationId),
  );
  const importEntities = buildAdjustedPointEntities({
    identity,
    importId,
    result,
    sourceName,
    stationIds: importableStationIds,
  });
  // Import artifacts for ABSENT stations are kept (SOURCE_MISSING later,
  // never deleted); F2F-owned entities are never artifacts (see above).
  const preservedEntities = refreshParcelsForMovedStations({
    entities: project.entities.filter(
      (entity) => !isAdjustedImportArtifact(entity, stationIdSet),
    ),
    identity,
    result,
    stationIds: importableStationIds,
  });
  const createdPointCount = importableStationIds.filter((stationId) => !previousPointIds.has(stationId)).length;
  const updatedPointCount = importableStationIds.length - createdPointCount;
  const record: CadDrawingImportRecord = {
    id: importId,
    kind: 'adjusted-points',
    sourceName,
    importedAtIso,
    createdPointCount,
    updatedPointCount,
    ellipseCount: importEntities.filter((entity) => entity.type === 'error-ellipse').length,
    ...(skippedF2fStationIds.length > 0 ? { skippedF2fStationIds } : {}),
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
  identity,
  result,
  sourceName,
}: {
  document: CadDrawingDocument;
  identity: ResultDependencyIdentity;
  result: AdjustmentResult;
  sourceName?: string;
}): CadDrawingDocument => {
  const importedAtIso = new Date().toISOString();
  const { project, record } = importAdjustedPointsIntoCadProject({
    identity,
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
