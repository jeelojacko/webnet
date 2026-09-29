/** @vitest-environment jsdom */
/**
 * Phase 20F UI slice — analytic termination (Grade to Distance / Elevation).
 *
 * Pins: engine termination helpers, criterion draft parse/summary, analytic
 * snapshot semantics (no target, grading-limit boundary, calculable without
 * a CURRENT surface), truthful Properties/report/CSV wording with cut/fill
 * N/A, the shared criterion fields, and the GTD/GTE registry commands.
 */
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';

import type {
  CadFeatureLineEntity,
  CadProject,
  CadSurveyPointEntity,
} from '../src/engine/cad/cadTypes';
import type {
  CadGrading,
  CadGradingResult,
  GradingCriterion,
} from '../src/engine/cad/grading/gradingTypes';
import {
  gradingBoundaryLabel,
  gradingBoundaryShortLabel,
  gradingCriterionRequiresSurface,
  gradingTerminationKind,
} from '../src/engine/cad/grading/gradingTypes';
import {
  formatGradingCriterion,
  gradingTargetSummary,
} from '../src/cad-app/shell/cadGradingShell';
import {
  buildCadGradingSnapshot,
  type CadGradingResultCache,
} from '../src/cad-app/shell/cadGradingSnapshot';
import { buildGradingCsv, buildGradingInquiryReport } from '../src/cad-app/shell/cadGradingReport';
import {
  defaultGradingCriterionDraft,
  parseGradingCriterionDraft,
  summarizeGradingCriterionDraft,
} from '../src/cad-app/shell/cadGradingCriterionInput';
import { CadGradingCriterionFields } from '../src/cad-app/shell/CadGradingCriterionFields';
import { GradingPropertiesBlock } from '../src/cad-app/shell/CadGradingProperties';
import { resolveShellCommandText } from '../src/cad-app/shell/cadCommandRegistry';

const pt = (id: string, x: number, y: number, z: number): CadSurveyPointEntity => ({
  id,
  type: 'survey-point',
  layerId: 'general',
  visible: true,
  locked: false,
  stationId: id,
  x,
  y,
  z,
  pointClass: 'unknown',
  source: 'parsed-input',
});

const featureLine = (): CadFeatureLineEntity => ({
  id: 'fl-1',
  type: 'feature-line',
  layerId: 'feature-lines',
  visible: true,
  locked: false,
  name: 'Ridge',
  vertices: [
    { id: 'vA', x: 0, y: 5, z: 0 },
    { id: 'vB', x: 10, y: 5, z: 0 },
  ],
  closed: false,
});

const baseProject = (entities: CadProject['entities']): CadProject => ({
  version: 2,
  id: 'grading-20f',
  name: 'grading-20f',
  metadata: {
    source: 'parsed-input',
    runMode: 'unknown',
    units: 'm',
    stationCount: 0,
    observationCount: 0,
    adjustedStationCount: 0,
  },
  layers: [],
  styleLibrary: { lineTypes: [], textStyles: [], pointSymbols: [], styles: [] },
  entities,
  cogoComputations: [],
  bounds: null,
});

const projectWith = (grading: CadGrading): CadProject => {
  const project = baseProject([pt('A', 0, 0, 0), pt('B', 10, 0, 0), featureLine()]);
  project.gradings = [grading];
  return project;
};

const analyticResult = (gradingId: string, revision: string): CadGradingResult => ({
  gradingId,
  revision,
  accuracy: 'EXACT',
  regions: [{ classification: 'FIXED', stationSpan: [0, 10] }],
  daylightPoints: [0, 25, 0, 10, 25, 0],
  gradingMesh: {
    points: [0, 0, 0, 10, 0, 0, 10, 25, 0, 0, 25, 0],
    triangles: [0, 1, 2, 0, 2, 3],
  },
  sourceLength: 10,
  gradingPlanArea: 250,
  grading3dArea: 250,
  minProjectionDistance: 20,
  maxProjectionDistance: 20,
  meanProjectionDistance: 20,
  cutSourceLength: 0,
  fillSourceLength: 0,
  tiedSourceLength: 0,
  candidateTriangleCount: 0,
  intersectionSegmentCount: 0,
  multipleSolutionCount: 0,
  diagnostics: [],
});

const cacheOf = (results: readonly CadGradingResult[]): CadGradingResultCache => ({
  get: (id, revision) => results.find((r) => r.gradingId === id && r.revision === revision),
  retained: (id) => results.filter((r) => r.gradingId === id),
});

describe('Phase 20F termination helpers', () => {
  it('classifies all four criterion kinds', () => {
    const surface: GradingCriterion = { kind: 'fixed', gradeRatio: -0.02 };
    const cutFill: GradingCriterion = { kind: 'cut-fill', cutGradeRatio: 0.5, fillGradeRatio: -0.33 };
    const distance: GradingCriterion = { kind: 'distance', gradeRatio: -0.02, distance: 20 };
    const elevation: GradingCriterion = { kind: 'elevation', gradeRatio: -0.02, targetElevation: 98 };
    expect(gradingTerminationKind(surface)).toBe('surface');
    expect(gradingTerminationKind(cutFill)).toBe('surface');
    expect(gradingTerminationKind(distance)).toBe('distance');
    expect(gradingTerminationKind(elevation)).toBe('elevation');
    expect(gradingCriterionRequiresSurface(surface)).toBe(true);
    expect(gradingCriterionRequiresSurface(distance)).toBe(false);
    expect(gradingBoundaryLabel(distance)).toBe('Grading Limit');
    expect(gradingBoundaryLabel(elevation)).toBe('Grading Limit');
    expect(gradingBoundaryLabel(surface)).toBe('Daylight');
    expect(gradingBoundaryShortLabel(distance)).toBe('Limit');
    expect(gradingBoundaryShortLabel(surface)).toBe('Daylight');
  });

  it('formats criterion + target summaries without a surface claim', () => {
    expect(formatGradingCriterion({ kind: 'distance', gradeRatio: -0.02, distance: 20 })).toContain('Distance 20.000 m');
    expect(formatGradingCriterion({ kind: 'elevation', gradeRatio: 0.03, targetElevation: 98 })).toContain('Elevation 98.000 m');
    expect(gradingTargetSummary({ kind: 'distance', gradeRatio: -0.02, distance: 20 }, '—', 'm')).toBe(
      'Target: Distance 20.000 m · grade -2.000%',
    );
    expect(gradingTargetSummary({ kind: 'elevation', gradeRatio: 0.03, targetElevation: 98 }, '—', 'm')).toBe(
      'Target: Elevation 98.000 m · grade +3.000%',
    );
    expect(gradingTargetSummary({ kind: 'fixed', gradeRatio: -0.02 }, 'EG', 'm')).toContain(
      'Target: EG · criterion Fixed -2.000%',
    );
  });

  it('parses + summarizes the shared criterion draft', () => {
    const distance = { ...defaultGradingCriterionDraft('distance'), magnitude: '2', direction: 'down' as const, distance: '20' };
    expect(parseGradingCriterionDraft(distance)).toEqual({ kind: 'distance', gradeRatio: -0.02, distance: 20 });
    expect(summarizeGradingCriterionDraft(distance, 'm')).toBe('Grade -2.000% → 20.000 m');
    const elevation = { ...defaultGradingCriterionDraft('elevation'), magnitude: '3', direction: 'up' as const, targetElevation: '98' };
    expect(parseGradingCriterionDraft(elevation)).toEqual({ kind: 'elevation', gradeRatio: 0.03, targetElevation: 98 });
    expect(summarizeGradingCriterionDraft(elevation, 'm')).toContain('elev 98.000 m');
    // Fail closed on non-positive distance / non-finite elevation.
    expect(parseGradingCriterionDraft({ ...distance, distance: '0' })).toBeNull();
    expect(parseGradingCriterionDraft({ ...elevation, targetElevation: 'abc' })).toBeNull();
  });

  it('resolves the GTD/GTE registry aliases collision-free', () => {
    expect(resolveShellCommandText('GRADETODISTANCE')?.key).toBe('GRADETODISTANCE');
    expect(resolveShellCommandText('GTD')?.key).toBe('GRADETODISTANCE');
    expect(resolveShellCommandText('GRADETOELEVATION')?.key).toBe('GRADETOELEVATION');
    expect(resolveShellCommandText('GTE')?.key).toBe('GRADETOELEVATION');
    expect(resolveShellCommandText('GTS')?.key).toBe('GRADETOSURFACE');
  });
});

describe('Phase 20F analytic snapshot + report', () => {
  const grading: CadGrading = {
    id: 'g-d',
    name: 'Ridge - Distance',
    sourceFeatureLineId: 'fl-1',
    sourceCourse: { vertexAId: 'vA', vertexBId: 'vB' },
    side: 'right',
    criterion: { kind: 'distance', gradeRatio: -0.02, distance: 20 },
    maxSearchDistance: 20,
    curveChordTolerance: 0.1,
  };

  it('reads analytic rows truthfully with no target surface', () => {
    const snapshot = buildCadGradingSnapshot(projectWith(grading), null, null, null);
    const row = snapshot.gradings[0]!;
    expect(row.method).toBe('distance');
    expect(row.analytic).toBe(true);
    expect(row.targetName).toBe('—');
    expect(row.targetSurfaceId).toBe('');
    expect(row.boundaryLabel).toBe('Grading Limit');
    expect(row.cutFillApplicable).toBe(false);
    expect(row.calculable).toBe(true);
    expect(row.lengthUnit).toBe('m');
  });

  it('reports the analytic limit block with cut/fill N/A', () => {
    const first = buildCadGradingSnapshot(projectWith(grading), null, null, null).gradings[0]!;
    const result = analyticResult(first.id, first.revision);
    const row = buildCadGradingSnapshot(projectWith(grading), null, cacheOf([result]), null).gradings[0]!;
    expect(row.status).toBe('CURRENT');
    const report = buildGradingInquiryReport(row.definition, row.source, row, row.currentResult);
    expect(report).toContain('Target: Distance 20.000 m · grade -2.000%');
    expect(report).not.toContain('Target: —');
    expect(report).toContain('cut — · fill — · tied —');
    expect(report).toContain('Grading Limit vertices');
    const csv = buildGradingCsv(row.definition, row.source!, result);
    expect(csv.split('\n')[0]).toContain('Limit E');
    expect(csv.split('\n')[0]).not.toContain('Daylight');
  });
});

describe('Phase 20F criterion fields + properties', () => {
  let host: HTMLDivElement;
  let root: Root;

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  const mount = (node: ReactNode): HTMLDivElement => {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => root.render(node));
    return host;
  };

  it('renders analytic fields and never a target-surface selector', () => {
    const html = mount(
      <CadGradingCriterionFields
        draft={defaultGradingCriterionDraft('distance')}
        onChange={() => {}}
        lengthUnit="m"
      />,
    );
    expect(html.querySelector<HTMLSelectElement>('[data-cad-grading-field="cad-grading-method"]')?.value).toBe('distance');
    expect(html.querySelector('[aria-label="Target distance"]')).not.toBeNull();
    expect(html.querySelector('[aria-label="Target surface"]')).toBeNull();
  });

  it('renders the surface target gate only for surface termination', () => {
    const html = mount(
      <CadGradingCriterionFields
        draft={defaultGradingCriterionDraft('surface')}
        onChange={() => {}}
        lengthUnit="m"
        surfaceSlot={<div data-testid="gate" />}
      />,
    );
    expect(html.querySelector('[data-testid="gate"]')).not.toBeNull();
    expect(html.querySelector('[aria-label="Target distance"]')).toBeNull();
  });

  it('properties show method + analytic target and N/A cut/fill', () => {
    const grading: CadGrading = {
      id: 'g-e',
      name: 'Ridge - Elevation',
      sourceFeatureLineId: 'fl-1',
      sourceCourse: { vertexAId: 'vA', vertexBId: 'vB' },
      side: 'right',
      criterion: { kind: 'elevation', gradeRatio: -0.02, targetElevation: 98 },
      maxSearchDistance: 20,
      curveChordTolerance: 0.1,
    };
    const first = buildCadGradingSnapshot(projectWith(grading), null, null, null).gradings[0]!;
    const result = analyticResult(first.id, first.revision);
    const row = buildCadGradingSnapshot(projectWith(grading), null, cacheOf([result]), null).gradings[0]!;
    const html = mount(<GradingPropertiesBlock row={row} />);
    expect(html.querySelector('[data-cad-grading-properties-method]')?.textContent).toBe('Elevation');
    expect(html.textContent).toContain('Target: Elevation 98.000 m · grade -2.000%');
    expect(html.textContent).not.toContain('Target Surface');
    expect(html.querySelector('[data-cad-grading-cutfill]')?.textContent).toContain('— (analytic)');
  });
});
