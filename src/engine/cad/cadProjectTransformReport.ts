// Phase 18R — PROJECT_COORDINATE_TRANSFORM human-readable report builder.
//
// Pure: takes the engine outcome and produces the title/summary/rows the
// existing COGO report exporter renders. No DOM, no rounding policy beyond
// fixed presentation decimals, deterministic row order.

import {
  PROJECT_COORDINATE_TRANSFORM_TOOL_KEY,
  type ProjectTransformOutcome,
} from './cadProjectTransform';

export { PROJECT_COORDINATE_TRANSFORM_TOOL_KEY };

export interface ProjectTransformReportRow {
  label: string;
  value: string;
  unit?: string;
}

export interface ProjectTransformReport {
  title: string;
  summary: string;
  rows: ProjectTransformReportRow[];
}

const fixed = (value: number, digits: number): string =>
  Number.isFinite(value) ? value.toFixed(digits) : '—';

const frameLabel = (outcome: ProjectTransformOutcome): string =>
  outcome.kind === 'HELMERT_2D'
    ? `Source drawing frame -> target control frame (${outcome.helmertMode ?? 'SIMILARITY'})`
    : outcome.direction === 'GRID_TO_GROUND'
      ? 'Grid frame -> ground frame'
      : 'Ground frame -> grid frame';

export const buildProjectTransformReport = (
  outcome: ProjectTransformOutcome,
): ProjectTransformReport => {
  const modeLabel =
    outcome.kind === 'HELMERT_2D' ? 'Helmert 2D' : 'Grid/Ground';
  const summary =
    outcome.kind === 'HELMERT_2D'
      ? `Whole-drawing ${modeLabel} (${outcome.helmertMode ?? 'SIMILARITY'}): ` +
        `tE ${fixed(outcome.translationE, 3)}, tN ${fixed(outcome.translationN, 3)}, ` +
        `rot ${fixed(outcome.rotationDeg, 4)} deg, scale ${fixed(outcome.scale, 9)} ` +
        `(${fixed(outcome.scalePpm, 3)} ppm), RMS residual ${fixed(outcome.rmsResidual ?? Number.NaN, 4)}, ` +
        `max ${fixed(outcome.maxResidual ?? Number.NaN, 4)}.`
      : `Whole-drawing ${modeLabel}: CSF ${fixed(outcome.combinedScaleFactor ?? Number.NaN, 9)}, ` +
        `effective factor ${fixed(outcome.effectiveFactor ?? Number.NaN, 12)}, ` +
        `origin E ${fixed(outcome.translationE, 3)}, N ${fixed(outcome.translationN, 3)}.`;

  const rows: ProjectTransformReportRow[] = [
    { label: 'Mode', value: modeLabel },
    { label: 'Frames', value: frameLabel(outcome) },
    { label: 'Translation E (tE)', value: fixed(outcome.translationE, 3), unit: 'm' },
    { label: 'Translation N (tN)', value: fixed(outcome.translationN, 3), unit: 'm' },
    { label: 'Rotation', value: fixed(outcome.rotationDeg, 4), unit: 'deg' },
    { label: 'Scale', value: fixed(outcome.scale, 9) },
    { label: 'Scale', value: fixed(outcome.scalePpm, 3), unit: 'ppm' },
  ];

  if (outcome.kind === 'GRID_GROUND') {
    rows.push(
      { label: 'Combined scale factor (CSF)', value: fixed(outcome.combinedScaleFactor ?? Number.NaN, 9) },
      { label: 'Effective factor', value: fixed(outcome.effectiveFactor ?? Number.NaN, 12) },
    );
  } else {
    rows.push(
      { label: 'RMS residual', value: fixed(outcome.rmsResidual ?? Number.NaN, 4), unit: 'm' },
      { label: 'Max residual', value: fixed(outcome.maxResidual ?? Number.NaN, 4), unit: 'm' },
    );
    outcome.residuals.forEach((residual, index) => {
      rows.push(
        {
          label: `Residual ${index + 1} (dE,dN,r)`,
          value: `${fixed(residual.dE, 4)}, ${fixed(residual.dN, 4)}, ${fixed(residual.r, 4)}`,
          unit: 'm',
        },
      );
    });
  }

  rows.push(
    { label: 'Entities affected', value: String(outcome.affected.entities) },
    { label: 'Survey points affected', value: String(outcome.affected.surveyPoints) },
    { label: 'Alignments affected', value: String(outcome.affected.alignments) },
    { label: 'Surfaces affected', value: String(outcome.affected.surfaces) },
    { label: 'Sample lines affected', value: String(outcome.affected.sampleLines) },
    { label: 'TIN vertices transformed', value: String(outcome.affected.tinVertices) },
    { label: 'Station policy', value: outcome.stationPolicy },
  );

  outcome.warnings.forEach((warning, index) => {
    rows.push({ label: `Warning ${index + 1}`, value: warning });
  });

  return {
    title: 'Project Coordinate Transform',
    summary,
    rows,
  };
};
