// Phase 18R: request-level project transform (solve, then delegate).
//
// Thin entry consumed by the PROJECTTRANSFORM command / panel / submit seam:
// solves via the 18Q Helmert / Grid-Ground solvers, then delegates to the
// authoritative kernel `applyCadProjectCoordinateTransform`. Deterministic:
// the same project + request yields the same transformId and floats, so the
// submit dry-run and the command commit agree exactly.

import {
  gridGroundTransform,
  solveHelmert2D,
  type HelmertControlPair,
  type HelmertMode,
  type HelmertResidual,
} from './cadHelmert2D';
import {
  applyCadProjectCoordinateTransform,
  type ProjectTransformAffectedCounts,
} from './cadProjectTransform';
import type { CadProject } from './cadTypes';
import { isExplicitTopologyDefinition } from './cadTypes';
import type { DraftDocument } from './cadDraftTypes';

export type { ProjectTransformAffectedCounts };

export type ProjectTransformGridGroundDirection = 'GRID_TO_GROUND' | 'GROUND_TO_GRID';

export type ProjectTransformRequest =
  | { kind: 'HELMERT_2D'; mode: HelmertMode; pairs: HelmertControlPair[] }
  | {
      kind: 'GRID_GROUND';
      originE: number;
      originN: number;
      combinedScaleFactor: number;
      direction: ProjectTransformGridGroundDirection;
    };

interface ProjectTransformOutcomeBase {
  translationE: number;
  translationN: number;
  rotationDeg: number;
  scale: number;
  scalePpm: number;
  affected: ProjectTransformAffectedCounts;
  stationPolicy: string;
  warnings: string[];
}

export type ProjectTransformOutcome =
  | (ProjectTransformOutcomeBase & {
      kind: 'HELMERT_2D';
      helmertMode: HelmertMode;
      residuals: HelmertResidual[];
      rmsResidual: number;
      maxResidual: number;
    })
  | (ProjectTransformOutcomeBase & {
      kind: 'GRID_GROUND';
      direction: ProjectTransformGridGroundDirection;
      combinedScaleFactor: number;
      effectiveFactor: number;
    });

export type ApplyCadProjectTransformResult =
  | { ok: true; project: CadProject; draft?: DraftDocument; outcome: ProjectTransformOutcome }
  | { ok: false; reason: string };

/** Pre-transform affected counts for panel preview (pure, no mutation). */
export const projectTransformAffectedCounts = (
  project: CadProject,
): ProjectTransformAffectedCounts => {
  let surveyPoints = 0;
  let alignments = 0;
  for (const entity of project.entities) {
    if (entity.type === 'survey-point') surveyPoints += 1;
    if (entity.type === 'alignment') alignments += 1;
  }
  let sampleLines = 0;
  for (const group of project.sampleLineGroups ?? []) sampleLines += group.sampleLines.length;
  let tinVertices = 0;
  for (const surface of project.surfaces ?? []) {
    const payload = surface.definition.importedTin;
    if (isExplicitTopologyDefinition(surface.definition) && payload && payload.vertices.length % 3 === 0) {
      tinVertices += payload.vertices.length / 3;
    }
  }
  return {
    entities: project.entities.length,
    surveyPoints,
    alignments,
    surfaces: (project.surfaces ?? []).length,
    sampleLines,
    tinVertices,
  };
};

const stationPolicyFor = (rigid: boolean): string =>
  rigid
    ? 'RIGID: stationing bit-identical'
    : 'SIMILARITY: raw chainage scaled about startStation, jumps preserved';

export const applyCadProjectTransform = (
  project: CadProject,
  request: ProjectTransformRequest,
  options: { draft?: DraftDocument } = {},
): ApplyCadProjectTransformResult => {
  if (request.kind === 'HELMERT_2D') {
    const solved = solveHelmert2D(request.pairs, request.mode);
    if (!solved.ok) return { ok: false, reason: solved.reason };
    const applied = applyCadProjectCoordinateTransform(project, solved.transform, {
      mode: `HELMERT_${request.mode}`,
      sourceFrameLabel: 'source drawing frame',
      targetFrameLabel: 'target control frame',
      controlPairs: request.pairs,
      residuals: solved.residuals,
      rmsResidual: solved.rmsResidual,
      maxResidual: solved.maxResidual,
      ...(options.draft ? { draft: options.draft } : {}),
    });
    if (!applied.ok) return applied;
    const scalePpm = (applied.scale - 1) * 1e6;
    return {
      ok: true,
      project: applied.project,
      ...(applied.draft ? { draft: applied.draft } : {}),
      outcome: {
        kind: 'HELMERT_2D',
        helmertMode: request.mode,
        translationE: solved.translationE,
        translationN: solved.translationN,
        rotationDeg: applied.rotationDeg,
        scale: applied.scale,
        scalePpm,
        residuals: solved.residuals,
        rmsResidual: solved.rmsResidual,
        maxResidual: solved.maxResidual,
        affected: applied.affected,
        stationPolicy: stationPolicyFor(applied.scale === 1 || request.mode === 'RIGID'),
        warnings: applied.warnings,
      },
    };
  }
  const derived = gridGroundTransform(
    request.originE,
    request.originN,
    request.combinedScaleFactor,
    request.direction,
  );
  if (!derived.ok) return { ok: false, reason: derived.reason };
  const applied = applyCadProjectCoordinateTransform(project, derived.transform, {
    mode: request.direction,
    sourceFrameLabel: request.direction === 'GRID_TO_GROUND' ? 'grid frame' : 'ground frame',
    targetFrameLabel: request.direction === 'GRID_TO_GROUND' ? 'ground frame' : 'grid frame',
    combinedScaleFactor: request.combinedScaleFactor,
    originE: request.originE,
    originN: request.originN,
    ...(options.draft ? { draft: options.draft } : {}),
  });
  if (!applied.ok) return applied;
  return {
    ok: true,
    project: applied.project,
    ...(applied.draft ? { draft: applied.draft } : {}),
    outcome: {
      kind: 'GRID_GROUND',
      direction: request.direction,
      translationE: derived.transform.tx,
      translationN: derived.transform.ty,
      rotationDeg: applied.rotationDeg,
      scale: applied.scale,
      scalePpm: (applied.scale - 1) * 1e6,
      combinedScaleFactor: request.combinedScaleFactor,
      effectiveFactor: derived.effectiveFactor,
      affected: applied.affected,
      stationPolicy: stationPolicyFor(applied.scale === 1),
      warnings: applied.warnings,
    },
  };
};
