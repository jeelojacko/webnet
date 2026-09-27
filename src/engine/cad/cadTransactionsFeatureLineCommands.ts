// Phase 20A — feature-line transactions (one undo entry each).
//
// Creation (FEATURELINE / FEATURELINECREATE) + elevation/grade edits +
// snapshot surface elevation + reverse + inquiry + surface breakline.
// Fail closed: every execute returns null when the input or result is not
// representable (never a partial edit, never Z = 0).

import { createStableRuntimeId } from '../id';
import { resolveCurrentCadLayerId } from './cadLayers';
import { buildCadSurface, getSurfaceElevationAt } from './cadSurfaces';
import { isSurfaceLayerLocked } from './cadSurfaceTypes';
import {
  raiseLowerFeatureLine,
  interpolateFeatureLineSpan,
  reverseFeatureLine,
  setFeatureLineGradeSpan,
  setFeatureLineVertexElevations,
} from './cadFeatureLineEdits';
import { createCadFeatureLine } from './cadFeatureLineCreate';
import { buildFeatureLineInquiry } from './cadFeatureLineInquiry';
import {
  getFeatureLineElevationAtStation,
  resolveCadFeatureLine,
  type ResolvedFeatureLine,
} from './cadFeatureLines';
import { appendCadProjectEntities, replaceCadProjectEntities } from './cadProjectState';
import { createCadSelectionState } from './cadSelection';
import { commitLayerProject } from './cadTransactionsLayerCommands';
import { appendCogoComputation, createCogoProvenance } from './cadTransactionsCogoReports';
import { isNativeSurfaceDefinition } from './cadTypes';
import type {
  CadCommand,
  CadCommandDefinition,
  CadCommandKey,
  CadCommandExecutionResult,
  CadWorkspaceSnapshot,
} from './cadTransactions.types';
import type { CadEntityId, CadFeatureLineEntity, CadProject, CadSurface } from './cadTypes';
import type { FeatureLineEditResult } from './cadFeatureLineEdits';

const findFeatureLine = (
  project: CadProject,
  entityId: CadEntityId,
): CadFeatureLineEntity | null =>
  (project.entities.find(
    (entity): entity is CadFeatureLineEntity =>
      entity.type === 'feature-line' && entity.id === entityId,
  ) ?? null);

const replaceFeatureLine = (
  project: CadProject,
  next: CadFeatureLineEntity,
): CadProject =>
  replaceCadProjectEntities(
    project,
    project.entities.map((entity) => (entity.id === next.id ? next : entity)),
  );

const commitFeatureLineEdit = (
  key: CadCommandKey,
  snapshot: CadWorkspaceSnapshot,
  result: FeatureLineEditResult,
  prompt: string,
): CadCommandExecutionResult | null => {
  if (!result.ok) return null;
  const project = replaceFeatureLine(snapshot.project, result.entity);
  return {
    nextSnapshot: { project, selection: createCadSelectionState(project, [result.entity.id]) },
    commandState: { key, phase: 'committed', prompt },
    transactionLabel: `${key} (${result.entity.name ?? result.entity.id})`,
    addedEntityIds: [],
    removedEntityIds: [],
  };
};

const labelOf = (entity: CadFeatureLineEntity): string => entity.name ?? entity.id;

// ---------------------------------------------------------------------------
// Creation
// ---------------------------------------------------------------------------

type CreateCommand = Extract<CadCommand, { key: 'FEATURELINE' | 'FEATURELINECREATE' }>;

const executeFeatureLineCreate = (
  snapshot: CadWorkspaceSnapshot,
  command: CreateCommand,
): CadCommandExecutionResult | null => {
  const created = createCadFeatureLine(snapshot.project, {
    sourceEntityIds: command.sourceEntityIds,
    sourceKind: command.sourceKind,
    elevation: command.elevation,
    name: command.name,
    description: command.description,
    closed: command.closed,
  });
  if (!created.ok) return null;
  const entity: CadFeatureLineEntity = {
    ...created.entity,
    layerId: resolveCurrentCadLayerId(snapshot.project),
  };
  const project = appendCadProjectEntities(snapshot.project, [entity]);
  return {
    nextSnapshot: { project, selection: createCadSelectionState(project, [entity.id]) },
    commandState: {
      key: command.key,
      phase: 'committed',
      prompt: `${labelOf(entity)} created (${entity.vertices.length} vertices).`,
    },
    transactionLabel: `FEATURELINE (${labelOf(entity)})`,
    addedEntityIds: [entity.id],
    removedEntityIds: [],
  };
};

const featureLineCommand: CadCommandDefinition<CreateCommand> = {
  key: 'FEATURELINE',
  execute: executeFeatureLineCreate,
};

const featureLineCreateCommand: CadCommandDefinition<CreateCommand> = {
  key: 'FEATURELINECREATE',
  execute: executeFeatureLineCreate,
};

// ---------------------------------------------------------------------------
// Elevation + grade edits
// ---------------------------------------------------------------------------

type ElevCommand = Extract<CadCommand, { key: 'FEATURELINEELEV' | 'FLSETZ' }>;

const makeElevCommand = (key: 'FEATURELINEELEV' | 'FLSETZ'): CadCommandDefinition<ElevCommand> => ({
  key,
  execute: (snapshot, command) => {
    const entity = findFeatureLine(snapshot.project, command.entityId);
    if (!entity) return null;
    return commitFeatureLineEdit(
      key,
      snapshot,
      setFeatureLineVertexElevations(entity, command.z, command.vertexIds),
      `${labelOf(entity)} elevations set to ${command.z.toFixed(3)} m.`,
    );
  },
});

type RaiseLowerCommand = Extract<CadCommand, { key: 'FLRAISELOWER' }>;

const raiseLowerCommand: CadCommandDefinition<RaiseLowerCommand> = {
  key: 'FLRAISELOWER',
  execute: (snapshot, command) => {
    const entity = findFeatureLine(snapshot.project, command.entityId);
    if (!entity) return null;
    return commitFeatureLineEdit(
      'FLRAISELOWER',
      snapshot,
      raiseLowerFeatureLine(entity, command.deltaZ, command.vertexIds),
      `${labelOf(entity)} ${command.deltaZ >= 0 ? 'raised' : 'lowered'} ${Math.abs(command.deltaZ).toFixed(3)} m.`,
    );
  },
};

const vertexStation = (
  entity: CadFeatureLineEntity,
  vertexId: string | undefined,
  station: number | undefined,
): number | null => {
  const resolved = resolveCadFeatureLine(entity);
  if (!resolved) return null;
  if (vertexId) {
    const index = entity.vertices.findIndex((vertex) => vertex.id === vertexId);
    if (index < 0) return null;
    return resolved.stations[index] ?? null;
  }
  if (station == null || !Number.isFinite(station)) return null;
  return station;
};

const resolveOrderedSpan = (
  entity: CadFeatureLineEntity,
  resolved: ResolvedFeatureLine,
  command: {
    startVertexId?: string;
    endVertexId?: string;
    startStation?: number;
    endStation?: number;
  },
): { start: number; end: number } | null => {
  const explicit =
    command.startVertexId != null ||
    command.endVertexId != null ||
    command.startStation != null ||
    command.endStation != null;
  // Ribbon/full-line default: the whole ordered 0..planLength span.
  if (!explicit) {
    return resolved.planLength > 1e-9 ? { start: 0, end: resolved.planLength } : null;
  }
  const a = vertexStation(entity, command.startVertexId, command.startStation);
  const b = vertexStation(entity, command.endVertexId, command.endStation);
  if (a == null || b == null) return null;
  const start = Math.min(a, b);
  const end = Math.max(a, b);
  return end - start > 1e-9 ? { start, end } : null;
};

type GradeCommand = Extract<CadCommand, { key: 'FLGRADE' }>;

const gradeCommand: CadCommandDefinition<GradeCommand> = {
  key: 'FLGRADE',
  execute: (snapshot, command) => {
    const entity = findFeatureLine(snapshot.project, command.entityId);
    if (!entity) return null;
    const resolved = resolveCadFeatureLine(entity);
    const span = resolved ? resolveOrderedSpan(entity, resolved, command) : null;
    if (!resolved || !span || !Number.isFinite(command.gradePercent)) return null;
    const gradeRatio = command.gradePercent / 100;
    // Closed loop: a nonzero constant grade over the ENTIRE loop is not
    // representable (it would not close) — fail closed.
    if (entity.closed === true && span.start <= 1e-9 && Math.abs(span.end - resolved.planLength) <= 1e-9 && Math.abs(gradeRatio) > 1e-12) {
      return null;
    }
    if (command.mode === 'set-end-only') {
      const zStart = getFeatureLineElevationAtStation(resolved, span.start);
      if (zStart == null) return null;
      const endIndex = resolved.stations.findIndex(
        (station) => Math.abs(station - span.end) <= 1e-9,
      );
      const endVertex = entity.vertices[endIndex];
      if (!endVertex) return null;
      const zEnd = zStart + gradeRatio * (span.end - span.start);
      return commitFeatureLineEdit(
        'FLGRADE',
        snapshot,
        setFeatureLineVertexElevations(entity, zEnd, [endVertex.id]),
        `${labelOf(entity)} end elevation set (${command.gradePercent.toFixed(3)}%).`,
      );
    }
    return commitFeatureLineEdit(
      'FLGRADE',
      snapshot,
      setFeatureLineGradeSpan(entity, { fromStation: span.start, toStation: span.end, gradeRatio }),
      `${labelOf(entity)} graded at ${command.gradePercent.toFixed(3)}%.`,
    );
  },
};

type InterpolateCommand = Extract<CadCommand, { key: 'FLINTERPOLATE' }>;

const interpolateCommand: CadCommandDefinition<InterpolateCommand> = {
  key: 'FLINTERPOLATE',
  execute: (snapshot, command) => {
    const entity = findFeatureLine(snapshot.project, command.entityId);
    if (!entity) return null;
    const resolved = resolveCadFeatureLine(entity);
    const span = resolved ? resolveOrderedSpan(entity, resolved, command) : null;
    if (!span) return null;
    return commitFeatureLineEdit(
      'FLINTERPOLATE',
      snapshot,
      interpolateFeatureLineSpan(entity, span.start, span.end),
      `${labelOf(entity)} elevations interpolated.`,
    );
  },
};

type SurfaceElevCommand = Extract<CadCommand, { key: 'FLSURFACEELEV' }>;

const surfaceElevCommand: CadCommandDefinition<SurfaceElevCommand> = {
  key: 'FLSURFACEELEV',
  execute: (snapshot, command) => {
    const entity = findFeatureLine(snapshot.project, command.entityId);
    const surface = snapshot.project.surfaces?.find((entry) => entry.id === command.surfaceId);
    if (!entity || !surface) return null;
    const build = buildCadSurface(snapshot.project, surface);
    const zs = entity.vertices.map((vertex) => getSurfaceElevationAt(build, vertex.x, vertex.y));
    // Atomic all-or-nothing: any off-surface vertex blocks the whole edit.
    if (zs.some((z) => z == null)) return null;
    const next: CadFeatureLineEntity = {
      ...entity,
      vertices: entity.vertices.map((vertex, index) => ({ ...vertex, z: zs[index]! })),
    };
    return commitFeatureLineEdit(
      'FLSURFACEELEV',
      snapshot,
      { ok: true, entity: next },
      `${labelOf(entity)} elevations set from ${surface.name}.`,
    );
  },
};

type ReverseCommand = Extract<CadCommand, { key: 'FLREVERSE' }>;

const reverseCommand: CadCommandDefinition<ReverseCommand> = {
  key: 'FLREVERSE',
  execute: (snapshot, command) => {
    const entity = findFeatureLine(snapshot.project, command.entityId);
    if (!entity) return null;
    return commitFeatureLineEdit(
      'FLREVERSE',
      snapshot,
      { ok: true, entity: reverseFeatureLine(entity) },
      `${labelOf(entity)} reversed.`,
    );
  },
};

// ---------------------------------------------------------------------------
// Inquiry (read-only report)
// ---------------------------------------------------------------------------

type InquiryCommand = Extract<CadCommand, { key: 'FLINQUIRY' }>;

const inquiryCommand: CadCommandDefinition<InquiryCommand> = {
  key: 'FLINQUIRY',
  execute: (snapshot, command) => {
    const entity = findFeatureLine(snapshot.project, command.entityId);
    if (!entity) return null;
    const inquiry = buildFeatureLineInquiry(entity, command.startStation, command.endStation);
    if (!inquiry) return null;
    const summary = `${labelOf(entity)} ${inquiry.startStationText} to ${inquiry.endStationText}`;
    const provenance = createCogoProvenance({
      toolKey: 'FEATURE_LINE',
      summary,
      sourceEntityIds: [entity.id],
      inputs: { entityId: entity.id },
      parameters: { startStation: inquiry.startStation, endStation: inquiry.endStation },
    });
    const project = appendCogoComputation({
      project: snapshot.project,
      provenance,
      title: 'Feature Line Inquiry',
      summary,
      rows: [
        { label: 'Feature line', value: labelOf(entity) },
        { label: 'Start station', value: inquiry.startStationText, unit: 'm' },
        { label: 'End station', value: inquiry.endStationText, unit: 'm' },
        { label: 'Plan length', value: inquiry.planLength.toFixed(3), unit: 'm' },
        { label: '3D length', value: inquiry.length3D.toFixed(3), unit: 'm' },
        { label: 'Start elevation', value: inquiry.startZ.toFixed(3), unit: 'm' },
        { label: 'End elevation', value: inquiry.endZ.toFixed(3), unit: 'm' },
        { label: 'Delta Z', value: inquiry.deltaZ.toFixed(3), unit: 'm' },
        { label: 'Grade', value: `${inquiry.gradePercent.toFixed(3)}`, unit: '%' },
        { label: 'Slope angle', value: inquiry.slopeAngleDeg.toFixed(3), unit: 'deg' },
        { label: 'Bearing', value: inquiry.bearingText },
        ...(inquiry.curve != null
          ? [
              { label: 'Curve radius', value: inquiry.curve.radius.toFixed(3), unit: 'm' },
              { label: 'Curve sweep', value: inquiry.curve.signedSweepDeg.toFixed(3), unit: 'deg' },
              { label: 'Curve length', value: inquiry.curve.arcLength.toFixed(3), unit: 'm' },
            ]
          : []),
      ],
      createdEntities: [],
    });
    return {
      nextSnapshot: { project, selection: snapshot.selection },
      commandState: { key: 'FLINQUIRY', phase: 'committed', prompt: `FLINQUIRY: ${summary}.` },
      transactionLabel: `FLINQUIRY (${labelOf(entity)})`,
      addedEntityIds: [],
      removedEntityIds: [],
    };
  },
};

// ---------------------------------------------------------------------------
// Surface: Add Feature Line Breakline (entity-backed, Z consumed directly)
// ---------------------------------------------------------------------------

type AddFeatureLineBreaklineCommand = Extract<
  CadCommand,
  { key: 'SURFACE_ADD_FEATURE_LINE_BREAKLINE' }
>;

const addFeatureLineBreaklineCommand: CadCommandDefinition<AddFeatureLineBreaklineCommand> = {
  key: 'SURFACE_ADD_FEATURE_LINE_BREAKLINE',
  execute: (snapshot, command) => {
    const surfaces = snapshot.project.surfaces ?? [];
    const surface = surfaces.find((entry) => entry.id === command.surfaceId);
    const entity = findFeatureLine(snapshot.project, command.entityId);
    if (!surface || !entity) return null;
    if (isSurfaceLayerLocked(snapshot.project, surface)) return null;
    if (!isNativeSurfaceDefinition(surface.definition)) return null;
    if (!resolveCadFeatureLine(entity)) return null;
    const nextSurface: CadSurface = {
      ...surface,
      definition: {
        ...surface.definition,
        breaklines: [
          ...(surface.definition.breaklines ?? []),
          {
            id: createStableRuntimeId('cad-breakline'),
            type: 'standard' as const,
            source: { kind: 'entity' as const, entityId: entity.id },
            ...(command.name?.trim() ? { name: command.name.trim() } : {}),
          },
        ],
      },
      cachedRevision: null,
      buildDiagnostic: undefined,
    };
    const project = {
      ...snapshot.project,
      surfaces: surfaces.map((entry) => (entry.id === surface.id ? nextSurface : entry)),
    };
    return commitLayerProject(
      'SURFACE_ADD_FEATURE_LINE_BREAKLINE',
      snapshot,
      project,
      `SURFACE_ADD_FEATURE_LINE_BREAKLINE (${labelOf(entity)})`,
    );
  },
};

export const featureLineCommandDefinitions = {
  FEATURELINE: featureLineCommand,
  FEATURELINECREATE: featureLineCreateCommand,
  FEATURELINEELEV: makeElevCommand('FEATURELINEELEV'),
  FLSETZ: makeElevCommand('FLSETZ'),
  FLRAISELOWER: raiseLowerCommand,
  FLGRADE: gradeCommand,
  FLINTERPOLATE: interpolateCommand,
  FLSURFACEELEV: surfaceElevCommand,
  FLREVERSE: reverseCommand,
  FLINQUIRY: inquiryCommand,
  SURFACE_ADD_FEATURE_LINE_BREAKLINE: addFeatureLineBreaklineCommand,
} as const;
