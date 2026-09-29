/**
 * Phase 20B — grading shell command adapter + criterion authoring helpers.
 *
 * The registry delegates GRADETOSURFACE / GRADING / GRADINGCALC /
 * GRADINGINQUIRY / GRADINGEXTRACTDAYLIGHT / GRADINGBAKE here by key. Every
 * mutation is routed through `actions.runGradingCommand` (the workspace
 * translates it to an undoable engine command); the richer creation form
 * lives in `CadGradingManager`, this adapter covers the selection-driven
 * prompt path so the ribbon/menu/command dock all reach the same engine.
 *
 * Authoring authority: exactly ONE numeric criterion is persisted
 * (`gradeRatio = ΔZ / horizontal`). The UI accepts Percent or explicit
 * `nH:1V` plus an Up / Down / Level direction and shows the resolved signed
 * ratio. An unlabeled `2:1` is never silently assumed H:V.
 */
import type {
  CadGrading,
  GradingCriterion,
  GradingSide,
  GradingTerminationKind,
} from '../../engine/cad/grading/gradingTypes';
import {
  gradingBoundaryLabel,
  gradingBoundaryShortLabel,
} from '../../engine/cad/grading/gradingTypes';
import type { CadCommand } from '../../engine/cad/cadTransactions.types';
import type { CadShellActions, CadWorkspaceSnapshot } from './cadShellTypes';
import type { CadGradingRow } from './cadGradingSnapshot';

/** Shell keys this adapter owns (rendered by the bounded Grading group). */
export const GRADING_SHELL_KEYS: ReadonlySet<string> = new Set([
  'GRADETOSURFACE',
  'GRADETODISTANCE',
  'GRADETOELEVATION',
  'GRADING',
  'GRADINGCALC',
  'GRADINGINQUIRY',
  'GRADINGEXTRACTDAYLIGHT',
  'GRADINGBAKE',
]);

/** Engine ops the workspace routes through `runGradingCommand`. Result
 * snapshots for Extract/Bake come from the CURRENT cache at the call site. */
export type CadGradingShellCommand = Extract<
  CadCommand,
  { key: 'GRADING_CREATE' | 'GRADING_DELETE' | 'GRADING_EDIT_CRITERIA' | 'GRADING_REASSIGN_TARGET' }
>;

export type GradingInputMode = 'percent' | 'h-v';
export type GradingSlopeDirection = 'up' | 'down' | 'level';

const H_V_PATTERN = /^\s*(-?\d+(?:\.\d+)?)\s*h?\s*:\s*(-?\d+(?:\.\d+)?)\s*v?\s*$/i;

/** `nH:m V` → |rise/run| = m/n (2H:1V ⇒ 0.5); fails closed on zero run or negative parts. */
export const parseHorizontalVerticalRatio = (text: string): number | null => {
  const match = H_V_PATTERN.exec(text);
  if (!match) return null;
  const h = Number(match[1]);
  const v = Number(match[2]);
  if (!Number.isFinite(h) || !Number.isFinite(v) || h <= 0 || v <= 0) return null;
  return v / h;
};

/** One signed grade ratio from mode + magnitude + direction (Level ⇒ 0). */
export const resolveSignedGradeRatio = (
  mode: GradingInputMode,
  magnitude: number,
  direction: GradingSlopeDirection,
): number | null => {
  if (!Number.isFinite(magnitude) || magnitude < 0) return null;
  if (mode === 'percent') {
    const ratio = magnitude / 100;
    return direction === 'down' ? -ratio : ratio;
  }
  return direction === 'down' ? -magnitude : magnitude;
};

/** Resolved signed ratio display, e.g. `+50.000%`, `-33.333%`, `0.000%`. */
export const formatSignedGradePercent = (gradeRatio: number): string => {
  const percent = gradeRatio * 100;
  const sign = percent > 0 ? '+' : percent < 0 ? '-' : '';
  return `${sign}${Math.abs(percent).toFixed(3)}%`;
};

const H_V_TEXT = (magnitude: number): string => {
  if (!(magnitude > 0)) return 'level';
  return `${magnitude.toFixed(3)}H:1V`;
};

/** Normalized criterion summary. Cut/fill shows CUT (positive) then FILL. */
export const formatGradingCriterion = (criterion: GradingCriterion): string => {
  if (criterion.kind === 'fixed') {
    return `Fixed ${formatSignedGradePercent(criterion.gradeRatio)} (${H_V_TEXT(Math.abs(criterion.gradeRatio))})`;
  }
  if (criterion.kind === 'cut-fill') {
    return `Cut ${formatSignedGradePercent(criterion.cutGradeRatio)} / Fill ${formatSignedGradePercent(criterion.fillGradeRatio)}`;
  }
  if (criterion.kind === 'distance') {
    return `Grade ${formatSignedGradePercent(criterion.gradeRatio)} → Distance ${criterion.distance.toFixed(3)} m`;
  }
  return `Grade ${formatSignedGradePercent(criterion.gradeRatio)} → Elevation ${criterion.targetElevation.toFixed(3)} m`;
};

/** Boundary label the Extract command produces for this criterion. */
export const gradingCriterionBoundaryLabel = (criterion: GradingCriterion): string =>
  gradingBoundaryLabel(criterion);

/** Short boundary label used in compact/label slots ('Daylight' | 'Limit'). */
export const gradingCriterionBoundaryShort = (criterion: GradingCriterion): string =>
  gradingBoundaryShortLabel(criterion);

/**
 * Truthful target summary for one criterion:
 *   surface   → `Target: <name> · criterion <...>`
 *   distance  → `Target: Distance <d> · grade <signed>`
 *   elevation → `Target: Elevation <z> · grade <signed>`
 * Analytic termination NEVER prints a target-surface name.
 */
export const gradingTargetSummary = (
  criterion: GradingCriterion,
  targetName: string,
  lengthUnit = 'm',
): string => {
  if (criterion.kind === 'distance') {
    return `Target: Distance ${criterion.distance.toFixed(3)} ${lengthUnit} · grade ${formatSignedGradePercent(criterion.gradeRatio)}`;
  }
  if (criterion.kind === 'elevation') {
    return `Target: Elevation ${criterion.targetElevation.toFixed(3)} ${lengthUnit} · grade ${formatSignedGradePercent(criterion.gradeRatio)}`;
  }
  return `Target: ${targetName} · criterion ${formatGradingCriterion(criterion)}`;
};

/** Termination method for a grading-shell key that names one (else null). */
export const gradingShellMethod = (key: string): GradingTerminationKind | null =>
  key === 'GRADETODISTANCE' ? 'distance' : key === 'GRADETOELEVATION' ? 'elevation' : null;

export const gradingSideText = (side: GradingSide): string =>
  side === 'left' ? 'Left' : 'Right';

/** One combined shell prompt result: mode + magnitude + direction → ratio. */
export interface GradingSlopeInput {
  mode: GradingInputMode;
  magnitude: number;
  direction: GradingSlopeDirection;
}

const promptSlope = (
  label: string,
  mode: GradingInputMode,
  defaultMagnitude: string,
): { magnitude: number; direction: GradingSlopeDirection } | null => {
  const text = window.prompt(
    mode === 'percent'
      ? `${label} percent (magnitude, e.g. 2 for 2%):`
      : `${label} run:rise as nH:1V (e.g. 2 for 2H:1V):`,
    defaultMagnitude,
  );
  if (text == null) return null;
  const magnitude = mode === 'percent' ? Number(text.trim()) : parseHorizontalVerticalRatio(text);
  if (magnitude == null || !Number.isFinite(magnitude) || magnitude < 0) return null;
  const dirText = window.prompt(`${label} direction — up / down / level:`, mode === 'percent' ? 'down' : 'up');
  if (dirText == null) return null;
  const token = dirText.trim().toLowerCase();
  const direction: GradingSlopeDirection =
    token === 'up' || token === 'level' || token === 'down' ? token : 'up';
  return { magnitude, direction };
};

/** Selected feature line id + its first selected course (snapshot order). */
const selectedFeatureLine = (
  snapshot: CadWorkspaceSnapshot | null | undefined,
): { entityId: string; course: { index: number; fromVertexId: string; toVertexId: string } } | null => {
  const preview = snapshot?.selectionPreview ?? [];
  const lineId = preview.find((entry) => entry.type === 'feature-line')?.id ?? null;
  if (lineId == null) return null;
  const entry = snapshot?.featureLine?.featureLines.find((row) => row.id === lineId) ?? null;
  const selectedEntry =
    snapshot?.featureLine?.selectedFeatureLine?.id === lineId
      ? snapshot.featureLine.selectedFeatureLine
      : null;
  const course = selectedEntry?.courses[0] ?? entry?.courses[0] ?? null;
  if (course == null) return null;
  return {
    entityId: lineId,
    course: { index: course.index, fromVertexId: course.fromVertexId, toVertexId: course.toVertexId },
  };
};

const resolveTargetSurfaceId = (
  snapshot: CadWorkspaceSnapshot | null | undefined,
): string | null => {
  const surfaces = snapshot?.surface?.surfaces ?? [];
  const selected = snapshot?.surface?.selectedSurfaceId ?? null;
  const current = surfaces.filter((row) => row.status === 'CURRENT');
  if (selected != null && current.some((row) => row.id === selected)) return selected;
  return current.length === 1 ? current[0]!.id : null;
};

export const gradingShellAvailable = (
  key: string,
  snapshot: CadWorkspaceSnapshot | null | undefined,
): boolean => {
  if (key === 'GRADETOSURFACE') {
    return selectedFeatureLine(snapshot) != null && resolveTargetSurfaceId(snapshot) != null;
  }
  if (key === 'GRADETODISTANCE' || key === 'GRADETOELEVATION') {
    // Analytic termination never needs a target surface.
    return selectedFeatureLine(snapshot) != null;
  }
  if (key === 'GRADING' || key === 'GRADINGCALC' || key === 'GRADINGINQUIRY') {
    return (snapshot?.grading?.gradings.length ?? 0) > 0;
  }
  const selected = snapshot?.grading?.selectedGradingId ?? null;
  if (selected == null) return false;
  const row = snapshot?.grading?.gradings.find((entry) => entry.id === selected) ?? null;
  return key === 'GRADINGEXTRACTDAYLIGHT' || key === 'GRADINGBAKE' ? row?.status === 'CURRENT' : true;
};

/** Build the wire payload for the create flow (prompts collect the rest). */
const buildCreateCommand = (
  snapshot: CadWorkspaceSnapshot | null | undefined,
): CadGradingShellCommand | null => {
  const selected = selectedFeatureLine(snapshot);
  const targetSurfaceId = resolveTargetSurfaceId(snapshot);
  if (!selected || targetSurfaceId == null) return null;
  const sideText = window.prompt('Grading side — left / right / both:', 'right');
  if (sideText == null) return null;
  const sideToken = sideText.trim().toLowerCase();
  const side: GradingSide | 'both' = sideToken === 'both' ? 'both' : sideToken === 'left' ? 'left' : 'right';
  const modeText = window.prompt('Criterion — fixed / cutfill:', 'fixed');
  if (modeText == null) return null;
  const isCutFill = modeText.trim().toLowerCase().startsWith('cut');
  const name = window.prompt('Grading name:', 'Grading')?.trim() ?? '';
  const maxDistance = Number(window.prompt('Max search distance (m):', '20')?.trim());
  if (!Number.isFinite(maxDistance) || maxDistance <= 0) return null;
  const chordText = window.prompt('Curve chord tolerance (m):', '0.1');
  if (chordText == null) return null;
  const curveChordTolerance = Number(chordText.trim());
  if (!Number.isFinite(curveChordTolerance) || curveChordTolerance <= 0) return null;
  const inputMode: GradingInputMode = 'percent';
  let criterion: GradingCriterion;
  if (isCutFill) {
    const cut = promptSlope('Cut', 'h-v', '2');
    const fill = promptSlope('Fill', 'h-v', '3');
    if (!cut || !fill) return null;
    const cutRatio = resolveSignedGradeRatio('h-v', cut.magnitude, cut.direction);
    const fillRatio = resolveSignedGradeRatio('h-v', fill.magnitude, fill.direction);
    if (cutRatio == null || fillRatio == null || !(cutRatio > 0) || !(fillRatio < 0)) return null;
    criterion = { kind: 'cut-fill', cutGradeRatio: cutRatio, fillGradeRatio: fillRatio };
  } else {
    const slope = promptSlope('Fixed', inputMode, '2');
    if (!slope) return null;
    const ratio = resolveSignedGradeRatio(inputMode, slope.magnitude, slope.direction);
    if (ratio == null) return null;
    criterion = { kind: 'fixed', gradeRatio: ratio };
  }
  return {
    key: 'GRADING_CREATE',
    ...(name.length > 0 ? { name } : {}),
    sourceFeatureLineId: selected.entityId,
    vertexAId: selected.course.fromVertexId,
    vertexBId: selected.course.toVertexId,
    targetSurfaceId,
    side,
    criterion,
    maxSearchDistance: maxDistance,
    curveChordTolerance,
  };
};

export const executeGradingShellCommand = (
  key: string,
  actions: CadShellActions | null,
  snapshot: CadWorkspaceSnapshot | null | undefined,
): boolean => {
  if (!actions) return false;
  const run = actions.runGradingCommand;
  switch (key) {
    case 'GRADETOSURFACE': {
      if (!run) return false;
      const command = buildCreateCommand(snapshot);
      return command != null && run(command);
    }
    case 'GRADING':
      actions.openGradingManager?.(snapshot?.grading?.selectedGradingId ?? undefined);
      return actions.openGradingManager != null;
    case 'GRADETODISTANCE':
      actions.openGradingManager?.(undefined, 'definition', 'distance');
      return actions.openGradingManager != null;
    case 'GRADETOELEVATION':
      actions.openGradingManager?.(undefined, 'definition', 'elevation');
      return actions.openGradingManager != null;
    case 'GRADINGCALC': {
      const id = selectedGradingId(snapshot);
      if (id == null) return false;
      return (actions.requestGradingCalculate?.(id) ?? null) != null;
    }
    case 'GRADINGINQUIRY':
      actions.openGradingManager?.(snapshot?.grading?.selectedGradingId ?? undefined, 'inquiry');
      return actions.openGradingManager != null;
    case 'GRADINGEXTRACTDAYLIGHT': {
      const id = selectedGradingId(snapshot);
      return id == null ? false : (actions.extractGradingDaylight?.(id) ?? null) != null;
    }
    case 'GRADINGBAKE': {
      const id = selectedGradingId(snapshot);
      return id == null ? false : (actions.bakeGradingSurface?.(id) ?? null) != null;
    }
    default:
      return false;
  }
};

const selectedGradingId = (
  snapshot: CadWorkspaceSnapshot | null | undefined,
): string | null => {
  const id = snapshot?.grading?.selectedGradingId ?? null;
  if (id == null) return null;
  const row = snapshot?.grading?.gradings.find((entry) => entry.id === id);
  return row != null ? row.id : null;
};

/** Selected grading row, if any (manager/properties share this lookup). */
export const selectedGradingRow = (
  snapshot: CadWorkspaceSnapshot | null | undefined,
): CadGradingRow | null => {
  const id = snapshot?.grading?.selectedGradingId ?? null;
  if (id == null) return null;
  return snapshot?.grading?.gradings.find((entry) => entry.id === id) ?? null;
};

/** Criterion label for a persisted definition (manager/Properties). */
export const gradingCriterionText = (grading: CadGrading): string =>
  formatGradingCriterion(grading.criterion);
