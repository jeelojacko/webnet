import { checkCadEntityEditable } from './cadAppearance';
import { buildCadCogoEntityMetadata, type CadCogoReportTable } from './cadCogoTypes';
import { resolveCurrentCadLayerId } from './cadLayers';
import { appendCadProjectEntities, replaceCadProjectEntities } from './cadProjectState';
import { createCadSelectionState } from './cadSelection';
import { buildTrimmedEntityPieces } from './cadTransactionsTrim';
import { createArcSupportEntities } from './cadTransactionsLinkedEntities';
import { buildCurveLabels, nextCurveSequence } from './cadTransactionsEntityFactories';
import { appendCogoComputation, createCogoProvenance } from './cadTransactionsCogoReports';
import { createStableRuntimeId } from '../id';
import type { CadArcDefinition, CadWorldPoint } from './cadGeometry';
import type { CadCurveLineInput } from './cadCurvesTwoTangent';
import type { CadCurveRay } from './cadCurvesTwoTangent';
import type { CadCurveMetricsSummary } from './cadCogoCurveMetrics';
import type {
  CadArcEntity,
  CadEntity,
  CadEntityId,
  CadLineEntity,
  CadProject,
} from './cadTypes';
import type { CadCommandKey } from './cadTransactions.types';
/**
 * Phase CAD Curves F1 — shared transaction plumbing for the six atomic curve
 * commands. Pure entity construction, provenance, trim, and report helpers;
 * no command-specific geometry decisions live here.
 */

export const findEditableLine = (
  project: CadProject,
  entityId: CadEntityId,
): CadLineEntity | null => {
  const entity = project.entities.find((candidate) => candidate.id === entityId);
  if (!entity || entity.type !== 'line') return null;
  if (!checkCadEntityEditable(project, entity).editable) return null;
  return entity;
};

export const findEditableArc = (
  project: CadProject,
  entityId: CadEntityId,
): CadArcEntity | null => {
  const entity = project.entities.find((candidate) => candidate.id === entityId);
  if (!entity || entity.type !== 'arc') return null;
  if (!checkCadEntityEditable(project, entity).editable) return null;
  return entity;
};

export const lineInputOf = (entity: CadLineEntity): CadCurveLineInput => ({
  entityId: entity.id,
  segmentId: `${entity.id}#0`,
  start: { x: entity.fromX, y: entity.fromY },
  end: { x: entity.toX, y: entity.toY },
});

export interface CadCurveArcBuildInput {
  project: CadProject;
  definition: CadArcDefinition;
  createdBy: string;
  metadata?: Record<string, unknown>;
  provenance?: ReturnType<typeof createCogoProvenance>;
}

/** Build (without appending) a curve arc entity with its curve labels. */
export const buildCadCurveArcEntity = ({
  project,
  definition,
  createdBy,
  metadata,
  provenance,
}: CadCurveArcBuildInput): { arcEntity: CadArcEntity; sequence: number } => {
  const sequence = nextCurveSequence(project);
  const labels = buildCurveLabels(sequence);
  const baseMetadata: Record<string, unknown> = {
    createdBy,
    entityName: labels.curveName,
    manual: true,
    ...(metadata ?? {}),
  };
  const arcEntity: CadArcEntity = {
    id: createStableRuntimeId('cad-arc'),
    type: 'arc',
    layerId: resolveCurrentCadLayerId(project),
    visible: true,
    locked: false,
    centerX: definition.center.x,
    centerY: definition.center.y,
    radius: definition.radius,
    startAngleDeg: definition.startAngleDeg,
    endAngleDeg: definition.endAngleDeg,
    metadata: provenance
      ? buildCadCogoEntityMetadata(baseMetadata, provenance)
      : baseMetadata,
  };
  return { arcEntity, sequence };
};

export const buildCadCurveArcDefinition = (entity: CadArcEntity): {
  center: CadWorldPoint;
  radius: number;
  startAngleDeg: number;
  endAngleDeg: number;
} => ({
  center: { x: entity.centerX, y: entity.centerY },
  radius: entity.radius,
  startAngleDeg: entity.startAngleDeg,
  endAngleDeg: entity.endAngleDeg,
});

/**
 * Replace a source line with its trimmed/extended piece. Prefers the canonical
 * `buildTrimmedEntityPieces` path (TRIM label law + metadata); falls back to a
 * direct extension when the curve's tangency point lies outside the source
 * segment so no finite intersection is reported. The trim pick is the
 * endpoint on the trimmed-away side (TRIM removes the interval it lands in).
 */
export const trimCadLineToCurve = ({
  line,
  curveEntity,
  ray,
  tangentPoint,
}: {
  line: CadLineEntity;
  curveEntity: CadArcEntity;
  ray: CadCurveRay;
  tangentPoint: CadWorldPoint;
}): CadLineEntity | null => {
  const trimAwayPick = ray.trimStart
    ? { x: line.fromX, y: line.fromY }
    : { x: line.toX, y: line.toY };
  const pieces = buildTrimmedEntityPieces(line, [curveEntity], trimAwayPick, `${line.id}#0`);
  const piece = pieces.find(
    (candidate): candidate is CadLineEntity =>
      candidate.type === 'line' && candidate.id === line.id,
  ) ?? pieces.find((candidate): candidate is CadLineEntity => candidate.type === 'line');
  if (piece) return piece;
  if (!Number.isFinite(tangentPoint.x) || !Number.isFinite(tangentPoint.y)) return null;
  return ray.trimStart
    ? { ...line, fromX: tangentPoint.x, fromY: tangentPoint.y }
    : { ...line, toX: tangentPoint.x, toY: tangentPoint.y };
};

export const replaceSourceLines = (
  project: CadProject,
  replacements: ReadonlyArray<{ sourceId: CadEntityId; piece: CadLineEntity }>,
): CadProject => {
  const byId = new Map(replacements.map((entry) => [entry.sourceId, entry.piece]));
  return replaceCadProjectEntities(
    project,
    project.entities.map((entity) => byId.get(entity.id) ?? entity),
  );
};

export interface CadCurveCommitInput {
  toolKey: CadCommandKey;
  title: string;
  summary: string;
  provenance: ReturnType<typeof createCogoProvenance>;
  arcEntity: CadArcEntity;
  reportRows: Array<{ label: string; value: string; unit?: string }>;
  reportTables?: CadCogoReportTable[];
  /** Working project already containing trimmed sources and the arc. */
  project: CadProject;
  supportEntities: CadEntity[];
  transactionLabel: string;
}

export const commitCadCurve = ({
  toolKey,
  title,
  summary,
  provenance,
  arcEntity,
  supportEntities,
  reportRows,
  reportTables,
  project,
  transactionLabel,
}: CadCurveCommitInput) => {
  const nextProject = appendCogoComputation({
    project,
    provenance,
    title,
    summary,
    rows: reportRows,
    tables: reportTables ?? [],
    createdEntities: [arcEntity, ...supportEntities],
  });
  return {
    nextSnapshot: {
      project: nextProject,
      selection: createCadSelectionState(nextProject, [arcEntity.id]),
    },
    commandState: {
      key: toolKey,
      phase: 'committed' as const,
      prompt: `${toolKey} committed.`,
    },
    transactionLabel,
    addedEntityIds: [arcEntity.id, ...supportEntities.map((entity) => entity.id)],
    removedEntityIds: [],
  };
};

/** Create arc + BC/MP/EC/R support entities on a working project (no COGO). */
export const appendCurveArcWithSupport = ({
  project,
  arcEntity,
  sequence,
  createdBy,
}: {
  project: CadProject;
  arcEntity: CadArcEntity;
  sequence: number;
  createdBy: string;
}): { project: CadProject; supportEntities: CadEntity[] } => {
  const supportEntities = createArcSupportEntities(
    project,
    arcEntity.id,
    sequence,
    buildCadCurveArcDefinition(arcEntity),
    createdBy,
  );
  return {
    project: appendCadProjectEntities(project, [arcEntity, ...supportEntities]),
    supportEntities,
  };
};

export const buildCurveMetricRows = (
  metrics: CadCurveMetricsSummary,
): Array<{ label: string; value: string; unit?: string }> => [
  { label: 'Radius', value: metrics.radius.toFixed(3), unit: 'm' },
  { label: 'Delta', value: metrics.deltaDeg.toFixed(6), unit: 'deg' },
  { label: 'Arc length', value: metrics.arcLength.toFixed(3), unit: 'm' },
  { label: 'Chord', value: metrics.chordLength.toFixed(3), unit: 'm' },
  { label: 'Tangent', value: metrics.tangentLength.toFixed(3), unit: 'm' },
  { label: 'External', value: metrics.externalDistance.toFixed(3), unit: 'm' },
  { label: 'Mid-ordinate', value: metrics.middleOrdinate.toFixed(3), unit: 'm' },
];
