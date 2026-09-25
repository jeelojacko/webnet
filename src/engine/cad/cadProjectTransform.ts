// Phase 18R: whole-drawing project coordinate transform (engine only, pure).
//
// ONE authoritative operation: `applyCadProjectCoordinateTransform` maps every
// authoritative object exactly ONCE through an orientation-preserving
// similarity (18Q `CadTransform2D` kernel + per-entity geometry), then runs a
// linked post-pass that VALIDATES SurveyPoint/Line coincidence without
// re-transforming anything (no double-transform via per-edit sync).
//
// Orientation gate: determinant must be positive; reflection, negative scale,
// non-uniform scale, and shear are BLOCKED (general affine rejected).
// consumes the 18Q Helmert solver / Grid-Ground convention only as the
// *source* of the transform + audit fields; all 2D math lives in 18Q.

import { cadNormalizeAngleDeg } from './cadGeometry';
import { dependencyOf, ownerOfCadEntity } from './cadAdjustmentDependency';
import { validateImportedTinPayload } from './cadImportedTin';
import type { HelmertControlPair, HelmertResidual } from './cadHelmert2D';
import { buildCadProjectAuthoritativeBounds } from './cadProjectAuthoritativeBounds';
import { transformCadEntityGeometry } from './cadTransformGeometry';
import {
  applyPoint,
  classifyTransform,
  type CadTransform2D,
  type CadTransformClassification,
} from './cadTransform2D';
import type { DraftDocument } from './cadDraftTypes';
import type {
  CadCogoComputation,
  CadCogoWarning,
} from './cadCogoTypes';
import type {
  CadEntity,
  CadProject,
  CadSampleLineGroup,
  CadStationEquation,
  CadSurface,
} from './cadTypes';
import { cloneCadSurfaceDefinition } from './cadSurfaceTypes';
import { transformCadSurfaceEdits } from './cadSurfaceEditTransform';
import { cloneCadProfileViews, cloneCadSurfaceProfiles } from './cadProfileTypes';
import {
  cloneCadSampleLineGroups,
  cloneCadSectionViews,
} from './cadSectionTypes';
import { transformAnalysisLegendInsertion } from './cadAnalysisLegends';

export const PROJECT_COORDINATE_TRANSFORM_TOOL_KEY = 'PROJECT_COORDINATE_TRANSFORM';

export const PROJECT_TRANSFORM_MIXED_FRAME_MESSAGE =
  'Drawing has a project coordinate transform history: adjusted-source coordinates are in a different frame. ' +
  'Import Adjusted Points / Send-to-CAD / refresh is blocked to avoid mixing frames.';

export const PROJECT_TRANSFORM_LANDXML_WARNING =
  'LandXML import into a transformed drawing is allowed, but the incoming coordinates are NOT auto-transformed. ' +
  'Confirm the source frame before merging.';

export interface CadProjectTransformOptions {
  transformId?: string;
  /** Descriptive only (e.g. HELMERT_RIGID, GRID_TO_GROUND); never drives math. */
  mode?: string;
  /** Descriptive-only frame labels; CRS metadata is never rewritten. */
  sourceFrameLabel?: string;
  targetFrameLabel?: string;
  combinedScaleFactor?: number;
  originE?: number;
  originN?: number;
  controlPairs?: HelmertControlPair[];
  residuals?: HelmertResidual[];
  rmsResidual?: number;
  maxResidual?: number;
  createdAtIso?: string;
  /** Transformed atomically with the project so sheets never aim stale. */
  draft?: DraftDocument;
}

export interface CadProjectTransformAffected {
  entities: number;
  surveyPoints: number;
  alignments: number;
  surfaces: number;
  sampleLines: number;
  tinVertices: number;
  ownershipDetached: number;
  viewsMoved: number;
}

export type ProjectTransformAffectedCounts = Pick<
  CadProjectTransformAffected,
  'entities' | 'surveyPoints' | 'alignments' | 'surfaces' | 'sampleLines' | 'tinVertices'
>;

// Request-level API (solve + delegate) lives in cadProjectTransformRequest.ts;
// re-exported here so command/panel/report seams import from one kernel path.
export type {
  ApplyCadProjectTransformResult,
  ProjectTransformGridGroundDirection,
  ProjectTransformOutcome,
  ProjectTransformRequest,
} from './cadProjectTransformRequest';
export { applyCadProjectTransform, projectTransformAffectedCounts } from './cadProjectTransformRequest';

export type ApplyCadProjectCoordinateTransformResult =
  | {
      ok: true;
      project: CadProject;
      draft?: DraftDocument;
      computation: CadCogoComputation;
      warnings: string[];
      scale: number;
      rotationDeg: number;
      transformId: string;
      affected: CadProjectTransformAffected;
    }
  | { ok: false; reason: string };

const fail = (reason: string): ApplyCadProjectCoordinateTransformResult => ({ ok: false, reason });

export const PROJECT_TRANSFORM_IMPORTED_TIN_INVALID =
  'CAD_PROJECT_TRANSFORM_IMPORTED_TIN_INVALID';

/**
 * Fail-closed preflight for every imported-TIN surface, run before any other
 * work. Reuses the 18L validator verbatim; a missing payload on an
 * `imported-tin` surface is invalid by definition. Reason carries the surface
 * id + validator reason only (never the raw payload).
 */
const preflightImportedTins = (project: CadProject): string | null => {
  for (const surface of project.surfaces ?? []) {
    const definition = surface.definition;
    if (definition.sourceKind !== 'imported-tin') continue;
    const payload = definition.importedTin;
    if (!payload) {
      return `${PROJECT_TRANSFORM_IMPORTED_TIN_INVALID}:${surface.id}: imported TIN definition missing.`;
    }
    const reason = validateImportedTinPayload(payload);
    if (reason != null) {
      return `${PROJECT_TRANSFORM_IMPORTED_TIN_INVALID}:${surface.id}: ${reason}`;
    }
  }
  return null;
};

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

/** Orientation-preserving gate: positive determinant, uniform scale, no shear. */
const gateProjectTransform = (
  transform: CadTransform2D,
): { ok: true; classification: CadTransformClassification } | { ok: false; reason: string } => {
  if (!isFiniteNumber(transform.a) || !isFiniteNumber(transform.b) ||
      !isFiniteNumber(transform.c) || !isFiniteNumber(transform.d) ||
      !isFiniteNumber(transform.tx) || !isFiniteNumber(transform.ty)) {
    return { ok: false, reason: 'CAD_PROJECT_TRANSFORM_NON_FINITE' };
  }
  const classification = classifyTransform(transform);
  if (!classification) return { ok: false, reason: 'CAD_PROJECT_TRANSFORM_SINGULAR' };
  if (classification.determinantSign <= 0) {
    return { ok: false, reason: 'CAD_PROJECT_TRANSFORM_REFLECTION_BLOCKED' };
  }
  if (classification.kind === 'GENERAL_AFFINE') {
    return { ok: false, reason: 'CAD_PROJECT_TRANSFORM_NON_UNIFORM_BLOCKED' };
  }
  if (!(classification.scale > 0) || !Number.isFinite(classification.scale)) {
    return { ok: false, reason: 'CAD_PROJECT_TRANSFORM_BAD_SCALE' };
  }
  return { ok: true, classification };
};

const scaleRawStation = (startStation: number, rawStation: number, scale: number): number =>
  startStation + scale * (rawStation - startStation);

/**
 * Station-equation propagation: resolve each raw (explicit or back − prior
 * jumps), scale it about startStation, preserve the jump, then rebuild
 * back/ahead from the scaled raw plus preserved prior jumps.
 */
const propagateStationEquations = (
  equations: CadStationEquation[],
  startStation: number,
  scale: number,
): CadStationEquation[] => {
  let deltaBefore = 0;
  return equations.map((equation) => {
    const raw = equation.rawStation ?? equation.backStation - deltaBefore;
    const jump = equation.aheadStation - equation.backStation;
    if (!isFiniteNumber(raw) || !isFiniteNumber(jump)) return { ...equation };
    const nextRaw = scaleRawStation(startStation, raw, scale);
    const backStation = nextRaw + deltaBefore;
    deltaBefore += jump;
    return {
      backStation,
      aheadStation: backStation + jump,
      ...(equation.rawStation != null ? { rawStation: nextRaw } : {}),
    };
  });
};

type EntityMetadata = Record<string, unknown>;

const metadataOf = (entity: CadEntity): EntityMetadata =>
  (entity.metadata ?? {}) as EntityMetadata;

/**
 * Detach adjustment lineage: adjustment-backed entities become
 * MANUAL (or F2F_MANUAL_OVERRIDE), the live stamp is removed so dependency
 * evaluation can never report CURRENT-adjustment, and lineage survives in
 * metadata.coordinateTransform. COGO history is untouched by design.
 */
const detachOwnership = (entity: CadEntity, transformId: string): { entity: CadEntity; detached: boolean } => {
  const sourceOwner = ownerOfCadEntity(entity);
  const sourceAdjustmentDependency = dependencyOf(entity);
  const backed =
    sourceAdjustmentDependency !== null ||
    sourceOwner === 'ADJUSTMENT_IMPORT' ||
    sourceOwner === 'F2F_GENERATED';
  if (!backed) return { entity, detached: false };
  const metadata: EntityMetadata = { ...metadataOf(entity) };
  const provenance = metadata['provenance'];
  if (typeof provenance === 'object' && provenance !== null) {
    const record = provenance as Record<string, unknown>;
    if (record['generatedBy'] === 'FIELD_TO_FINISH') {
      metadata['provenance'] = { ...record, state: 'MANUAL_OVERRIDE' };
    } else {
      metadata['manual'] = true;
    }
  } else {
    metadata['manual'] = true;
  }
  delete metadata['adjustmentDependency'];
  metadata['coordinateTransform'] = {
    transformId,
    sourceOwner,
    sourceAdjustmentDependency,
  };
  return { entity: { ...entity, metadata }, detached: true };
};

/** Embedded display ellipse on survey points: scale semis, rotate theta. */
const transformEmbeddedEllipse = (
  entity: Extract<CadEntity, { type: 'survey-point' }>,
  scale: number,
  rotationDeg: number,
): Extract<CadEntity, { type: 'survey-point' }> => {
  if (!entity.errorEllipse) return entity;
  return {
    ...entity,
    errorEllipse: {
      ...entity.errorEllipse,
      semiMajor: entity.errorEllipse.semiMajor * scale,
      semiMinor: entity.errorEllipse.semiMinor * scale,
      theta: cadNormalizeAngleDeg(entity.errorEllipse.theta + rotationDeg),
    },
  };
};

const transformImportedTinVertices = (
  vertices: number[],
  transform: CadTransform2D,
): number[] | null => {
  if (vertices.length % 3 !== 0) return null;
  const next = new Array<number>(vertices.length);
  for (let i = 0; i < vertices.length; i += 3) {
    const moved = applyPoint(transform, { x: vertices[i]!, y: vertices[i + 1]! });
    next[i] = moved.x;
    next[i + 1] = moved.y;
    next[i + 2] = vertices[i + 2]!;
  }
  return next;
};

const transformSurface = (
  surface: CadSurface,
  transform: CadTransform2D,
  scale: number,
): { ok: true; surface: CadSurface; tinVertices: number } | { ok: false; reason: string } => {
  const definition = cloneCadSurfaceDefinition(surface.definition);
  // 18T: coordinate-bearing edits move with the frame exactly once; refs/Z/
  // deltaZ stay fixed (18R is XY-only, no vertical scaling).
  if (definition.edits != null) {
    definition.edits = transformCadSurfaceEdits(definition.edits, transform);
  }
  let tinVertices = 0;
  // Fail-closed backstop: preflight already rejected every invalid payload, so
  // this can only trigger if the surface mutated between the two reads. Never
  // warn-and-continue (that produced a mixed-frame result).
  if (definition.sourceKind === 'imported-tin') {
    const payload = definition.importedTin;
    if (!payload) {
      return {
        ok: false,
        reason: `${PROJECT_TRANSFORM_IMPORTED_TIN_INVALID}:${surface.id}: imported TIN definition missing.`,
      };
    }
    const vertices = transformImportedTinVertices(payload.vertices, transform);
    if (!vertices) {
      return {
        ok: false,
        reason: `${PROJECT_TRANSFORM_IMPORTED_TIN_INVALID}:${surface.id}: malformed imported-TIN vertex array.`,
      };
    }
    definition.importedTin = { ...payload, vertices };
    tinVertices = vertices.length / 3;
  }
  const maxEdge = definition.buildOptions?.maxEdgeLength;
  if (isFiniteNumber(maxEdge)) {
    definition.buildOptions = { ...definition.buildOptions, maxEdgeLength: maxEdge * scale };
  }
  // Invalidate: revision is content-derived, so the changed inputs already
  // retire any cached mesh/contours AND discard late old-frame worker
  // results (existing latest-wins revision ownership). Never persist caches.
  return {
    ok: true,
    surface: { ...surface, definition, cachedRevision: null, buildDiagnostic: undefined },
    tinVertices,
  };
};

const transformSampleGroups = (
  groups: CadSampleLineGroup[] | undefined,
  startByAlignmentId: Map<string, number>,
  scale: number,
  rigid: boolean,
  warnings: string[],
): { groups: CadSampleLineGroup[] | undefined; sampleLines: number } => {
  if (groups == null) return { groups: undefined, sampleLines: 0 };
  let sampleLines = 0;
  const next = cloneCadSampleLineGroups(groups).map((group) => {
    const start = startByAlignmentId.get(group.alignmentEntityId);
    if (start == null) {
      warnings.push(`Sample-line group ${group.id}: alignment ref missing; raw stations carried.`);
    }
    return {
      ...group,
      sampleLines: group.sampleLines.map((line) => {
        sampleLines += 1;
        return {
          ...line,
          rawStation: start == null || rigid || !isFiniteNumber(line.rawStation)
            ? line.rawStation
            : scaleRawStation(start, line.rawStation, scale),
          leftWidth: isFiniteNumber(line.leftWidth) ? line.leftWidth * scale : line.leftWidth,
          rightWidth: isFiniteNumber(line.rightWidth) ? line.rightWidth * scale : line.rightWidth,
        };
      }),
    };
  });
  return { groups: next, sampleLines };
};

/**
 * Draft viewports/labels are transformed atomically inside this same
 * operation (not a follow-up edit): a finished sheet must never render
 * silently aimed at the old frame. Presentation (scales, paper-mm) untouched.
 */
const transformDraftDocument = (draft: DraftDocument, transform: CadTransform2D): DraftDocument => ({
  ...draft,
  sheets: draft.sheets.map((sheet) => ({
    ...sheet,
    viewports: sheet.viewports.map((viewport) => {
      const center = applyPoint(transform, { x: viewport.modelCenterX, y: viewport.modelCenterY });
      return { ...viewport, modelCenterX: center.x, modelCenterY: center.y };
    }),
  })),
  labels: draft.labels.map((label) => {
    const at = applyPoint(transform, { x: label.xModel, y: label.yModel });
    return { ...label, xModel: at.x, yModel: at.y };
  }),
});

/** Linked post-pass: VALIDATE coincidence, never re-transform (no double-apply). */
const validateCoincidence = (entities: CadEntity[]): string[] => {
  const warnings: string[] = [];
  const pointByStation = new Map<string, { x: number; y: number }>();
  for (const entity of entities) {
    if (entity.type === 'survey-point') pointByStation.set(entity.stationId, { x: entity.x, y: entity.y });
  }
  const agrees = (stored: number, live: number): boolean =>
    Math.abs(stored - live) <= 1e-9 * Math.max(1, Math.abs(stored), Math.abs(live));
  let mismatches = 0;
  for (const entity of entities) {
    if (entity.type !== 'line') continue;
    const ends: Array<[string, number, number]> = [
      [entity.fromStationId, entity.fromX, entity.fromY],
      [entity.toStationId, entity.toX, entity.toY],
    ];
    for (const [stationId, x, y] of ends) {
      const point = pointByStation.get(stationId);
      if (!point) continue;
      if (!agrees(x, point.x) || !agrees(y, point.y)) {
        mismatches += 1;
        if (warnings.length < 5) {
          warnings.push(`Line ${entity.id}: endpoint ${stationId} no longer coincides with its survey point.`);
        }
      }
    }
  }
  if (mismatches > warnings.length) {
    warnings.push(`${mismatches - warnings.length} further endpoint coincidences diverge.`);
  }
  return warnings;
};

const priorTransformCount = (project: CadProject): number =>
  (project.cogoComputations ?? []).filter(
    (entry) => entry.toolKey === PROJECT_COORDINATE_TRANSFORM_TOOL_KEY,
  ).length;

export const hasProjectCoordinateTransform = (project: CadProject): boolean =>
  priorTransformCount(project) > 0;

/** Mixed-frame export gate: adjusted-source writes are blocked after a transform. */
export const projectTransformMixedFrameError = (project: CadProject): string | null =>
  hasProjectCoordinateTransform(project) ? PROJECT_TRANSFORM_MIXED_FRAME_MESSAGE : null;

const buildComputation = (
  transformId: string,
  createdAtIso: string,
  updatedEntityIds: string[],
  reportRows: Array<[string, string]>,
  warnings: CadCogoWarning[],
  resultSummary: string,
  auditInputs: Record<string, unknown>,
  mode: string,
): CadCogoComputation => ({
  id: transformId,
  toolKey: PROJECT_COORDINATE_TRANSFORM_TOOL_KEY,
  createdAtIso,
  provenance: {
    id: transformId,
    toolKey: PROJECT_COORDINATE_TRANSFORM_TOOL_KEY,
    inputs: auditInputs,
    parameters: { mode },
    resultSummary,
  },
  report: {
    title: 'Project coordinate transform',
    summary: resultSummary,
    rows: reportRows.map(([label, value]) => ({ label, value })),
  },
  warnings,
  createdEntityIds: [],
  updatedEntityIds,
  removedEntityIds: [],
});

export const applyCadProjectCoordinateTransform = (
  project: CadProject,
  transform: CadTransform2D,
  options: CadProjectTransformOptions = {},
): ApplyCadProjectCoordinateTransformResult => {
  // Imported-TIN integrity gate FIRST: any malformed payload blocks the whole
  // operation with zero mutation (no computation, no draft, no cache/invalid
  // state changes).
  const tinPreflight = preflightImportedTins(project);
  if (tinPreflight != null) return fail(tinPreflight);
  const gate = gateProjectTransform(transform);
  if (!gate.ok) return fail(gate.reason);
  const { classification } = gate;
  const scale = Math.abs(classification.scale);
  const rotationDeg = classification.rotationDeg;
  const rigid = classification.kind === 'RIGID_ORIENTATION_PRESERVING';

  const transformId = options.transformId ?? `project-coordinate-transform-${priorTransformCount(project) + 1}`;
  const createdAtIso = options.createdAtIso ?? new Date().toISOString();
  const warnings: string[] = [];

  const startByAlignmentId = new Map<string, number>();
  for (const entity of project.entities) {
    if (entity.type === 'alignment') startByAlignmentId.set(entity.id, entity.startStation);
  }

  let ownershipDetached = 0;
  let alignmentCount = 0;
  let surveyPointCount = 0;
  const entities: CadEntity[] = [];
  for (const entity of project.entities) {
    // 18Q per-entity semantics, exactly once; scaled alignments allowed
    // because stationing propagates below (not BLOCKED at project scope).
    const geometry = transformCadEntityGeometry(entity, transform, classification, {
      allowAlignmentScale: true,
    });
    if (!geometry || !geometry.ok) {
      return fail(`CAD_PROJECT_TRANSFORM_GEOMETRY_FAILED:${entity.id}`);
    }
    let next = geometry.entity;
    if (next.type === 'alignment') {
      alignmentCount += 1;
      // startStation is numerically UNCHANGED; raw chainage scales about it.
      // Rigid carries equations verbatim (bit-identical stationing).
      if (next.stationEquations && !rigid) {
        next = {
          ...next,
          stationEquations: propagateStationEquations(next.stationEquations, next.startStation, scale),
        };
      }
    }
    if (next.type === 'survey-point') {
      surveyPointCount += 1;
      next = transformEmbeddedEllipse(next, scale, rotationDeg);
    }
    const owned = detachOwnership(next, transformId);
    if (owned.detached) ownershipDetached += 1;
    entities.push(owned.entity);
  }

  let surfaceCount = 0;
  let tinVertexCount = 0;
  const surfaces: CadSurface[] = [];
  for (const surface of project.surfaces ?? []) {
    const result = transformSurface(surface, transform, scale);
    if (!result.ok) return fail(result.reason);
    surfaceCount += 1;
    tinVertexCount += result.tinVertices;
    surfaces.push(result.surface);
  }

  const sample = transformSampleGroups(
    project.sampleLineGroups,
    startByAlignmentId,
    scale,
    rigid,
    warnings,
  );

  const profileViews = (project.profileViews ?? []).map((view) => {
    const at = applyPoint(transform, { x: view.insertionX, y: view.insertionY });
    return { ...cloneCadProfileViews([view])[0]!, insertionX: at.x, insertionY: at.y };
  });
  const sectionViews = (project.sectionViews ?? []).map((view) => {
    const at = applyPoint(transform, { x: view.insertionX, y: view.insertionY });
    return { ...cloneCadSectionViews([view])[0]!, insertionX: at.x, insertionY: at.y };
  });

  warnings.push(...validateCoincidence(entities));
  warnings.push(
    'Source/target frame labels are descriptive-only; drawing units and CRS metadata are unchanged.',
  );

  const affected: CadProjectTransformAffected = {
    entities: entities.length,
    surveyPoints: surveyPointCount,
    alignments: alignmentCount,
    surfaces: surfaceCount,
    sampleLines: sample.sampleLines,
    tinVertices: tinVertexCount,
    ownershipDetached,
    viewsMoved: profileViews.length + sectionViews.length,
  };
  const scalePpm = (scale - 1) * 1e6;
  const auditInputs: Record<string, unknown> = {
    transformId,
    mode: options.mode ?? (rigid ? 'SIMILARITY_RIGID' : 'SIMILARITY'),
    sourceFrameLabel: options.sourceFrameLabel ?? 'source',
    targetFrameLabel: options.targetFrameLabel ?? 'target',
    matrix: { ...transform },
    translationE: transform.tx,
    translationN: transform.ty,
    rotationDeg,
    scale,
    scalePpm,
    ...(options.combinedScaleFactor != null ? { combinedScaleFactor: options.combinedScaleFactor } : {}),
    ...(options.originE != null && options.originN != null
      ? { originE: options.originE, originN: options.originN }
      : {}),
    ...(options.controlPairs != null ? { controlPairs: options.controlPairs } : {}),
    ...(options.residuals != null ? { residuals: options.residuals } : {}),
    ...(options.rmsResidual != null ? { rmsResidual: options.rmsResidual } : {}),
    ...(options.maxResidual != null ? { maxResidual: options.maxResidual } : {}),
    affected: { ...affected },
    createdAtIso,
  };
  const resultSummary =
    `Moved ${affected.entities} entities by ${options.sourceFrameLabel ?? 'source'} → ` +
    `${options.targetFrameLabel ?? 'target'} (rotation ${rotationDeg.toFixed(6)}°, scale ${scale}, ` +
    `${scalePpm.toFixed(3)} ppm, ${ownershipDetached} ownership-detached).`;
  const cogoWarnings: CadCogoWarning[] = warnings.map((message) => ({
    code: 'PROJECT_TRANSFORM_NOTICE',
    message,
    severity: 'warning' as const,
  }));
  const computation = buildComputation(
    transformId,
    createdAtIso,
    entities.map((entity) => entity.id),
    [
      ['Transform ID', transformId],
      ['Mode', options.mode ?? (rigid ? 'SIMILARITY_RIGID' : 'SIMILARITY')],
      ['Rotation (deg)', String(rotationDeg)],
      ['Scale', String(scale)],
      ['Scale (ppm)', scalePpm.toFixed(3)],
      ['Entities moved', String(affected.entities)],
      ['Ownership detached', String(ownershipDetached)],
    ],
    cogoWarnings,
    resultSummary,
    auditInputs,
    options.mode ?? (rigid ? 'SIMILARITY_RIGID' : 'SIMILARITY'),
  );

  const transformedProject = {
    ...project,
    entities,
    surfaces,
    // Phase 18U: legend insertion points are XY geometry and move with the
    // frame. Analysis thresholds/results are NOT carried here: a band set is
    // metric-space truth on the map, so it is untouched by a frame change.
    ...(project.analysisLegends != null
      ? {
          analysisLegends: project.analysisLegends.map((legend) =>
            transformAnalysisLegendInsertion(legend, transform),
          ),
        }
      : {}),
    surfaceProfiles: cloneCadSurfaceProfiles(project.surfaceProfiles),
    profileViews,
    sampleLineGroups: sample.groups,
    sectionViews,
    cogoComputations: [...(project.cogoComputations ?? []), computation],
  };
  // Bounds come from the fully assembled TRANSFORMED state so imported-TIN
  // extents (not entity-backed) are included; old bounds are never transformed.
  const next: CadProject = {
    ...transformedProject,
    bounds: buildCadProjectAuthoritativeBounds(transformedProject),
  };
  // Styles, block definitions, point groups, and F2F catalog/settings pass
  // through by spread above — presentation and library space never move.
  // Surface/profile/section/volume derived caches are session-only and never
  // persist, so there is nothing to write; nulling cachedRevision forces a
  // rebuild and retires old-frame worker results via revision ownership.

  const draft = options.draft ? transformDraftDocument(options.draft, transform) : undefined;
  return {
    ok: true,
    project: next,
    ...(draft ? { draft } : {}),
    computation,
    warnings,
    scale,
    rotationDeg,
    transformId,
    affected,
  };
};

