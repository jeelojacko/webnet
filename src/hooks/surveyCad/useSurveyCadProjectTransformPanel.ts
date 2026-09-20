// Phase 18R — PROJECTTRANSFORM compact panel state (pure derivation).
//
// Reads the live command session and the drawing, returns the review data for
// the Helmert and Grid/Ground modes. Whole-drawing scope is stated explicitly
// in the state (`scope`); the panel never implies a selection. All solves go
// through the existing 18Q solvers so panel/report/command agree exactly.

import { gridGroundTransform, solveHelmert2D } from '../../engine/cad/cadHelmert2D';
import {
  projectTransformAffectedCounts,
  type ProjectTransformAffectedCounts,
} from '../../engine/cad/cadProjectTransform';
import type { CadProject } from '../../engine/cad/cadTypes';
import type {
  CommandSession,
  GridGroundSessionDirection,
  HelmertSessionMode,
} from './useSurveyCadCommandTypes';
import type { HelmertPanelFit, HelmertPanelRow } from './useSurveyCadTransformPanel';

export interface ProjectTransformPanelState {
  scope: 'WHOLE_DRAWING';
  projectMode: 'HELMERT' | 'GRID_GROUND';
  helmertMode: HelmertSessionMode;
  direction: GridGroundSessionDirection;
  pairCount: number;
  pendingSource: { x: number; y: number; label: string } | null;
  rows: HelmertPanelRow[];
  fit: HelmertPanelFit | null;
  origin: { x: number; y: number; label: string } | null;
  combinedScaleFactor: number | null;
  effectiveFactor: number | null;
  formula: string | null;
  affected: ProjectTransformAffectedCounts;
  warnings: string[];
  stationPolicy: string;
  failReason: string | null;
  canApply: boolean;
  resultText?: string;
}

export const LANDXML_AFTER_TRANSFORM_WARNING =
  'LandXML export writes the transformed geometry in the drawing frame; it does not claim or rewrite a target CRS.';

const hasAdjustmentProvenance = (project: CadProject): boolean =>
  project.metadata.source === 'adjustment-result' ||
  project.entities.some((entity) => entity.metadata?.['adjustmentDependency'] != null);

const hasEpsgProvenance = (project: CadProject): boolean =>
  ['epsg', 'epsgCode', 'crs', 'coordinateSystem'].some(
    (key) => project.metadata[key as keyof typeof project.metadata] != null,
  ) ||
  project.entities.some((entity) =>
    ['epsg', 'epsgCode', 'crs', 'coordinateSystem'].some(
      (key) => entity.metadata?.[key] != null,
    ),
  );

export const buildProjectTransformWarnings = (project: CadProject): string[] => {
  const warnings: string[] = [];
  if (hasAdjustmentProvenance(project)) {
    warnings.push(
      'Adjustment-backed content is present. After the transform these entities detach from the current adjustment; this is informational and does not change the geometry.',
    );
  }
  if (hasEpsgProvenance(project)) {
    warnings.push(
      'The drawing carries EPSG/CRS provenance. The transform moves coordinates outside the declared CRS; no EPSG code is changed silently.',
    );
  }
  warnings.push(LANDXML_AFTER_TRANSFORM_WARNING);
  return warnings;
};

const emptyRows = (
  session: Extract<CommandSession, { key: 'PROJECTTRANSFORM' }>,
): HelmertPanelRow[] =>
  session.pairs.map((pair, index) => ({
    index: index + 1,
    sourceE: pair.source.x,
    sourceN: pair.source.y,
    targetE: pair.target.x,
    targetN: pair.target.y,
    dE: Number.NaN,
    dN: Number.NaN,
    residual: Number.NaN,
  }));

export const buildProjectTransformPanelState = (
  session: CommandSession | null,
  project: CadProject,
): ProjectTransformPanelState | null => {
  if (!session || session.key !== 'PROJECTTRANSFORM') return null;
  const affected = projectTransformAffectedCounts(project);
  const warnings = buildProjectTransformWarnings(project);
  const rigid =
    (session.projectMode === 'HELMERT' && session.helmertMode === 'RIGID') ||
    (session.projectMode === 'GRID_GROUND' && session.combinedScaleFactor === 1);
  const stationPolicy = rigid
    ? 'RIGID: stationing bit-identical'
    : 'SIMILARITY: raw chainage scaled about startStation, jumps preserved';
  const base = {
    scope: 'WHOLE_DRAWING' as const,
    projectMode: session.projectMode,
    helmertMode: session.helmertMode,
    direction: session.direction,
    pairCount: session.pairs.length,
    pendingSource: session.pendingSource,
    origin: session.origin,
    combinedScaleFactor: session.combinedScaleFactor,
    effectiveFactor: null as number | null,
    formula: null as string | null,
    affected,
    warnings,
    stationPolicy,
    resultText: session.resultText,
  };

  if (session.projectMode === 'HELMERT') {
    const pairs = session.pairs.map((pair) => ({
      sourceE: pair.source.x,
      sourceN: pair.source.y,
      targetE: pair.target.x,
      targetN: pair.target.y,
    }));
    if (session.pairs.length < 2) {
      return { ...base, rows: emptyRows(session), fit: null, failReason: null, canApply: false };
    }
    const solved = solveHelmert2D(pairs, session.helmertMode);
    if (!solved.ok) {
      return { ...base, rows: emptyRows(session), fit: null, failReason: solved.reason, canApply: false };
    }
    return {
      ...base,
      rows: session.pairs.map((pair, index) => {
        const residual = solved.residuals[index]!;
        return {
          index: index + 1,
          sourceE: pair.source.x,
          sourceN: pair.source.y,
          targetE: pair.target.x,
          targetN: pair.target.y,
          dE: residual.dE,
          dN: residual.dN,
          residual: residual.r,
        };
      }),
      fit: {
        rotationDeg: solved.rotationDeg,
        scale: solved.scale,
        scalePpm: solved.scalePpm,
        translationE: solved.translationE,
        translationN: solved.translationN,
        rmsResidual: solved.rmsResidual,
        maxResidual: solved.maxResidual,
      },
      failReason: null,
      canApply: true,
    };
  }

  if (session.origin == null || session.combinedScaleFactor == null) {
    return { ...base, rows: emptyRows(session), fit: null, failReason: null, canApply: false };
  }
  const derived = gridGroundTransform(
    session.origin.x,
    session.origin.y,
    session.combinedScaleFactor,
    session.direction,
  );
  if (!derived.ok) {
    return { ...base, rows: emptyRows(session), fit: null, failReason: derived.reason, canApply: false };
  }
  return {
    ...base,
    rows: emptyRows(session),
    fit: null,
    effectiveFactor: derived.effectiveFactor,
    formula: derived.formula,
    failReason: null,
    canApply: true,
  };
};
