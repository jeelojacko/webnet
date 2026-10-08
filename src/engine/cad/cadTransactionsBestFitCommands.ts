import { createStableRuntimeId } from '../id';
import { cadBestFitArc, type BestFitArcResult } from './cadBestFitArc';
import type { CadBestFitPoint } from './cadBestFitCommon';
import { cadBestFitLine, type BestFitLineResult } from './cadBestFitLine';
import { cadBestFitParabola, type BestFitParabolaResult } from './cadBestFitParabola';
import { formatCadBearing } from './cadCogoSummaries';
import {
  buildCadCogoEntityMetadata,
  type CadCogoReportRow,
  type CadCogoReportTable,
} from './cadCogoTypes';
import { resolveCurrentCadLayerId } from './cadLayers';
import { cadParabolaCurveLength } from './cadParabolaGeometry';
import {
  cadParabolaAxisAzimuthDeg,
  cadParabolaEntityFromCanonical,
} from './cadParabola';
import { appendCadProjectEntities } from './cadProjectState';
import { createCadSelectionState } from './cadSelection';
import {
  appendCogoComputation,
  createCogoProvenance,
} from './cadTransactionsCogoReports';
import { nextEntityName } from './cadTransactionsEntityFactories';
import type { CadCommandDefinition } from './cadTransactions.types';
import type { CadEntity, CadProject } from './cadTypes';

export interface BestFitSampleInput {
  x: number;
  y: number;
  label: string;
  sourceEntityId?: string;
}

export type BestFitLineCommand = {
  key: 'BEST_FIT_LINE';
  samples: BestFitSampleInput[];
};

export type BestFitArcCommand = {
  key: 'BEST_FIT_ARC';
  samples: BestFitSampleInput[];
};

export type BestFitParabolaCommand = {
  key: 'BEST_FIT_PARABOLA';
  samples: BestFitSampleInput[];
};

const toFitPoints = (samples: readonly BestFitSampleInput[]): CadBestFitPoint[] =>
  samples.map((sample) => ({ x: sample.x, y: sample.y }));

const snapshotSamples = (
  samples: readonly BestFitSampleInput[],
): Array<{ x: number; y: number; label: string; sourceEntityId?: string }> =>
  samples.map((sample) => ({
    x: sample.x,
    y: sample.y,
    label: sample.label,
    ...(sample.sourceEntityId != null ? { sourceEntityId: sample.sourceEntityId } : {}),
  }));

const distinctSourceIds = (samples: readonly BestFitSampleInput[]): string[] => {
  const seen = new Set<string>();
  for (const sample of samples) {
    if (sample.sourceEntityId != null) seen.add(sample.sourceEntityId);
  }
  return [...seen];
};

/**
 * Source-point IDs are survey station ids only. A free pick is labelled
 * `P<n>` by the session and carries no survey attribution, so it must never
 * surface as a source point. Resolve each sample source against the live
 * project and keep the station id of true survey-point sources.
 */
const surveySourcePointIds = (
  project: CadProject,
  samples: readonly BestFitSampleInput[],
): string[] => {
  const surveyPoints = new Map(
    project.entities
      .filter(
        (entity): entity is Extract<CadProject['entities'][number], { type: 'survey-point' }> =>
          entity.type === 'survey-point',
      )
      .map((entity) => [entity.id, entity.stationId] as const),
  );
  const labels: string[] = [];
  for (const sample of samples) {
    if (sample.sourceEntityId == null) continue;
    const stationId = surveyPoints.get(sample.sourceEntityId);
    if (stationId != null) labels.push(stationId);
  }
  return labels;
};

const commonRows = (method: string, sampleCount: number, rms: number, maxAbs: number): CadCogoReportRow[] => [
  { label: 'Method', value: method },
  { label: 'Sample count', value: String(sampleCount) },
  { label: 'RMS residual', value: rms.toFixed(4), unit: 'm' },
  { label: 'Max |residual|', value: maxAbs.toFixed(4), unit: 'm' },
];

const residualTable = (
  title: string,
  samples: readonly BestFitSampleInput[],
  residuals: readonly number[],
  closestPoints: readonly { x: number; y: number }[],
): CadCogoReportTable => ({
  title,
  columns: ['Sample', 'Easting', 'Northing', 'Residual (m)', 'Closest E', 'Closest N'],
  rows: samples.map((sample, index) => [
    sample.label,
    sample.x.toFixed(3),
    sample.y.toFixed(3),
    (residuals[index] ?? 0).toFixed(4),
    (closestPoints[index]?.x ?? 0).toFixed(3),
    (closestPoints[index]?.y ?? 0).toFixed(3),
  ]),
});

const coordRow = (label: string, value: number): CadCogoReportRow => ({
  label,
  value: value.toFixed(3),
  unit: 'm',
});

const angleRow = (label: string, valueDeg: number): CadCogoReportRow => ({
  label,
  value: valueDeg.toFixed(4),
  unit: 'deg',
});

const solveLineEntity = (
  layerId: string,
  entityName: string,
  createdBy: string,
  result: BestFitLineResult,
  metadata: Record<string, unknown>,
): CadEntity => ({
  id: createStableRuntimeId('cad-polyline'),
  type: 'polyline',
  layerId,
  visible: true,
  locked: false,
  vertices: [
    { x: result.endP0.x, y: result.endP0.y },
    { x: result.endP1.x, y: result.endP1.y },
  ],
  vertexLabels: ['', ''],
  closed: false,
  metadata: {
    ...metadata,
    createdBy,
    entityName,
    manual: true,
  },
});

const commitLineResult = (
  snapshot: Parameters<CadCommandDefinition<BestFitLineCommand>['execute']>[0],
  command: BestFitLineCommand,
  result: BestFitLineResult,
): ReturnType<CadCommandDefinition<BestFitLineCommand>['execute']> => {
  const entityName = nextEntityName(snapshot.project, 'BFL');
  const summary = `Best-fit line ${entityName} from ${command.samples.length} samples (RMS ${result.rms.toFixed(4)} m)`;
  const provenance = createCogoProvenance({
    toolKey: 'BEST_FIT_LINE',
    summary,
    sourceEntityIds: distinctSourceIds(command.samples),
    sourcePointIds: surveySourcePointIds(snapshot.project, command.samples),
    inputs: { samples: snapshotSamples(command.samples) },
    parameters: { method: 'orthogonal-least-squares' },
  });
  const entity = solveLineEntity(
    resolveCurrentCadLayerId(snapshot.project),
    entityName,
    'BEST_FIT_LINE',
    result,
    buildCadCogoEntityMetadata(undefined, provenance),
  );
  const rows: CadCogoReportRow[] = [
    ...commonRows('Orthogonal least squares (PCA)', command.samples.length, result.rms, result.maxAbs),
    angleRow('Azimuth', result.azimuthDeg),
    { label: 'Bearing', value: formatCadBearing(result.azimuthDeg) },
    coordRow('Span', result.spanLength),
  ];
  const nextProjectWithEntities = appendCadProjectEntities(snapshot.project, [entity]);
  const nextProject = appendCogoComputation({
    project: nextProjectWithEntities,
    provenance,
    title: 'Best Fit Line',
    summary,
    rows,
    tables: [residualTable('Best Fit Line residuals', command.samples, result.residuals, result.closestPoints)],
    createdEntities: [entity],
  });
  return {
    nextSnapshot: {
      project: nextProject,
      selection: createCadSelectionState(nextProject, [entity.id]),
    },
    commandState: {
      key: 'BEST_FIT_LINE',
      phase: 'committed',
      prompt: `BEST_FIT_LINE committed as ${entityName}.`,
    },
    transactionLabel: `BEST_FIT_LINE (${entityName})`,
    addedEntityIds: [entity.id],
    removedEntityIds: [],
  };
};

export const bestFitLineCommand: CadCommandDefinition<BestFitLineCommand> = {
  key: 'BEST_FIT_LINE',
  execute: (snapshot, command) => {
    if (command.samples.length < 2) return null;
    const result = cadBestFitLine(toFitPoints(command.samples));
    if (!result) return null;
    return commitLineResult(snapshot, command, result);
  },
};

const commitArcResult = (
  snapshot: Parameters<CadCommandDefinition<BestFitArcCommand>['execute']>[0],
  command: BestFitArcCommand,
  result: BestFitArcResult,
): ReturnType<CadCommandDefinition<BestFitArcCommand>['execute']> => {
  const entityName = nextEntityName(snapshot.project, 'BFA');
  const summary = `Best-fit arc ${entityName} from ${command.samples.length} samples (RMS ${result.rms.toFixed(4)} m)`;
  const provenance = createCogoProvenance({
    toolKey: 'BEST_FIT_ARC',
    summary,
    sourceEntityIds: distinctSourceIds(command.samples),
    sourcePointIds: surveySourcePointIds(snapshot.project, command.samples),
    inputs: { samples: snapshotSamples(command.samples) },
    parameters: { method: 'geometric-least-squares' },
  });
  const entity: CadEntity = {
    id: createStableRuntimeId('cad-arc'),
    type: 'arc',
    layerId: resolveCurrentCadLayerId(snapshot.project),
    visible: true,
    locked: false,
    centerX: result.centerX,
    centerY: result.centerY,
    radius: result.radius,
    startAngleDeg: result.startAngleDeg,
    endAngleDeg: result.endAngleDeg,
    metadata: buildCadCogoEntityMetadata(
      { createdBy: 'BEST_FIT_ARC', entityName, manual: true },
      provenance,
    ),
  };
  const rows: CadCogoReportRow[] = [
    ...commonRows('Geometric least squares', command.samples.length, result.rms, result.maxAbs),
    coordRow('Center E', result.centerX),
    coordRow('Center N', result.centerY),
    coordRow('Radius', result.radius),
    angleRow('Start angle', result.startAngleDeg),
    angleRow('End angle', result.endAngleDeg),
    angleRow('Sweep', result.sweepDeg),
    coordRow('Arc length', result.arcLength),
  ];
  const nextProjectWithEntities = appendCadProjectEntities(snapshot.project, [entity]);
  const nextProject = appendCogoComputation({
    project: nextProjectWithEntities,
    provenance,
    title: 'Best Fit Arc',
    summary,
    rows,
    tables: [residualTable('Best Fit Arc residuals', command.samples, result.residuals, result.closestPoints)],
    createdEntities: [entity],
  });
  return {
    nextSnapshot: {
      project: nextProject,
      selection: createCadSelectionState(nextProject, [entity.id]),
    },
    commandState: {
      key: 'BEST_FIT_ARC',
      phase: 'committed',
      prompt: `BEST_FIT_ARC committed as ${entityName}.`,
    },
    transactionLabel: `BEST_FIT_ARC (${entityName})`,
    addedEntityIds: [entity.id],
    removedEntityIds: [],
  };
};

export const bestFitArcCommand: CadCommandDefinition<BestFitArcCommand> = {
  key: 'BEST_FIT_ARC',
  execute: (snapshot, command) => {
    if (command.samples.length < 3) return null;
    const result = cadBestFitArc(toFitPoints(command.samples));
    if (!result) return null;
    return commitArcResult(snapshot, command, result);
  },
};

const commitParabolaResult = (
  snapshot: Parameters<CadCommandDefinition<BestFitParabolaCommand>['execute']>[0],
  command: BestFitParabolaCommand,
  result: BestFitParabolaResult,
): ReturnType<CadCommandDefinition<BestFitParabolaCommand>['execute']> => {
  const entityName = nextEntityName(snapshot.project, 'BFP');
  const summary = `Best-fit parabola ${entityName} from ${command.samples.length} samples (RMS ${result.rms.toFixed(4)} m)`;
  const provenance = createCogoProvenance({
    toolKey: 'BEST_FIT_PARABOLA',
    summary,
    sourceEntityIds: distinctSourceIds(command.samples),
    sourcePointIds: surveySourcePointIds(snapshot.project, command.samples),
    inputs: { samples: snapshotSamples(command.samples) },
    parameters: { method: 'rotated-geometric-least-squares' },
  });
  const entity = cadParabolaEntityFromCanonical(result.canonical, {
    id: createStableRuntimeId('cad-parabola'),
    layerId: resolveCurrentCadLayerId(snapshot.project),
    metadata: buildCadCogoEntityMetadata(
      { createdBy: 'BEST_FIT_PARABOLA', entityName, manual: true },
      provenance,
    ),
  });
  if (!entity) return null;
  const length = cadParabolaCurveLength(result.canonical) ?? 0;
  const rows: CadCogoReportRow[] = [
    ...commonRows('Rotated geometric least squares', command.samples.length, result.rms, result.maxAbs),
    coordRow('Vertex E', result.canonical.vertexX),
    coordRow('Vertex N', result.canonical.vertexY),
    angleRow('Axis azimuth', cadParabolaAxisAzimuthDeg(entity)),
    coordRow('Focal length', result.canonical.focalLength),
    { label: 't range', value: `${result.canonical.tStart.toFixed(4)} .. ${result.canonical.tEnd.toFixed(4)}` },
    coordRow('Curve length', length),
  ];
  const nextProjectWithEntities = appendCadProjectEntities(snapshot.project, [entity]);
  const nextProject = appendCogoComputation({
    project: nextProjectWithEntities,
    provenance,
    title: 'Best Fit Parabola',
    summary,
    rows,
    tables: [residualTable('Best Fit Parabola residuals', command.samples, result.residuals, result.closestPoints)],
    createdEntities: [entity],
  });
  return {
    nextSnapshot: {
      project: nextProject,
      selection: createCadSelectionState(nextProject, [entity.id]),
    },
    commandState: {
      key: 'BEST_FIT_PARABOLA',
      phase: 'committed',
      prompt: `BEST_FIT_PARABOLA committed as ${entityName}.`,
    },
    transactionLabel: `BEST_FIT_PARABOLA (${entityName})`,
    addedEntityIds: [entity.id],
    removedEntityIds: [],
  };
};

export const bestFitParabolaCommand: CadCommandDefinition<BestFitParabolaCommand> = {
  key: 'BEST_FIT_PARABOLA',
  execute: (snapshot, command) => {
    if (command.samples.length < 5) return null;
    const result = cadBestFitParabola(toFitPoints(command.samples));
    if (!result) return null;
    return commitParabolaResult(snapshot, command, result);
  },
};
