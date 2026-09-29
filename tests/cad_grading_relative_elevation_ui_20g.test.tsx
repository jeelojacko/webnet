/** @vitest-environment jsdom */
/**
 * Phase 20G UI slice — Grade to Relative Elevation.
 *
 * Pins the shell contract for the new target-free family: truthful method
 * labels (never plain "Elevation"), draft parse/summarize/diagnosis and
 * round-trip, the shared criterion fields (including the locked group
 * family), the GTRE registry command, snapshot/status semantics without a
 * CURRENT surface, Properties display, inquiry report + CSV wording, and the
 * group member table. Numerical oracles live in the 20G oracle suite.
 */
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';

import type { CadFeatureLineEntity, CadProject } from '../src/engine/cad/cadTypes';
import type { CadGrading, CadGradingResult, GradingCriterion } from '../src/engine/cad/grading/gradingTypes';
import {
  gradingBoundaryLabel,
  gradingBoundaryShortLabel,
  gradingCriterionRequiresSurface,
  gradingTerminationKind,
} from '../src/engine/cad/grading/gradingTypes';
import {
  formatGradingCriterion,
  gradingShellMethod,
  GRADING_SHELL_KEYS,
  gradingTargetSummary,
} from '../src/cad-app/shell/cadGradingShell';
import {
  buildCadGradingSnapshot,
  type CadGradingResultCache,
} from '../src/cad-app/shell/cadGradingSnapshot';
import { buildGradingCsv, buildGradingInquiryReport } from '../src/cad-app/shell/cadGradingReport';
import {
  defaultGradingCriterionDraft,
  gradingCriterionDraftFromCriterion,
  gradingDraftDiagnosis,
  gradingMethodLabel,
  parseGradingCriterionDraft,
  summarizeGradingCriterionDraft,
} from '../src/cad-app/shell/cadGradingCriterionInput';
import { CadGradingCriterionFields } from '../src/cad-app/shell/CadGradingCriterionFields';
import { GradingPropertiesBlock } from '../src/cad-app/shell/CadGradingProperties';
import { courseCriterionTypeText, buildCourseMemberRows } from '../src/cad-app/shell/cadGradingGroupCourseCriteria';
import { resolveShellCommandText } from '../src/cad-app/shell/cadCommandRegistry';
import { relativeElevationDisplay } from '../src/cad-app/shell/cadGradingDisplay';
import type { CadGradingGroup } from '../src/engine/cad/grading/gradingGroupTypes';

const REL = (gradeRatio: number, relativeElevation: number): GradingCriterion => ({
  kind: 'relative-elevation',
  gradeRatio,
  relativeElevation,
});
const DIST = { kind: 'distance', gradeRatio: -0.5, distance: 20 } as const;
const ELEV = { kind: 'elevation', gradeRatio: -0.5, targetElevation: 90 } as const;

const featureLine = (): CadFeatureLineEntity => ({
  id: 'fl-1',
  type: 'feature-line',
  layerId: 'feature-lines',
  visible: true,
  locked: false,
  name: 'Ridge',
  vertices: [
    { id: 'vA', x: 0, y: 5, z: 100 },
    { id: 'vB', x: 100, y: 5, z: 102 },
  ],
  closed: false,
});

const baseProject = (): CadProject => ({
  version: 2,
  id: 'grading-20g',
  name: 'grading-20g',
  metadata: {
    source: 'parsed-input', runMode: 'unknown', units: 'm',
    stationCount: 0, observationCount: 0, adjustedStationCount: 0,
  },
  layers: [],
  styleLibrary: { lineTypes: [], textStyles: [], pointSymbols: [], styles: [] },
  entities: [featureLine()],
  cogoComputations: [],
  bounds: null,
});

const gradingOf = (criterion: GradingCriterion): CadGrading => ({
  id: 'g-1',
  name: 'Ridge - Relative',
  sourceFeatureLineId: 'fl-1',
  sourceCourse: { vertexAId: 'vA', vertexBId: 'vB' },
  side: 'right',
  criterion,
  maxSearchDistance: 50,
  curveChordTolerance: 0.05,
});

const projectWith = (grading: CadGrading): CadProject => ({ ...baseProject(), gradings: [grading] });

const relativeResult = (gradingId: string, revision: string): CadGradingResult => ({
  gradingId,
  revision,
  accuracy: 'EXACT',
  regions: [{ classification: 'FIXED', stationSpan: [0, 100] }],
  daylightPoints: [0, -20, 90, 100, -20, 92],
  gradingMesh: { points: [0, 5, 100, 100, 5, 102, 100, -20, 92, 0, -20, 90], triangles: [0, 1, 2, 0, 2, 3] },
  sourceLength: 100,
  gradingPlanArea: 2000,
  grading3dArea: 2000,
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

// ---------------------------------------------------------------------------
// 1. Labels and helpers
// ---------------------------------------------------------------------------
describe('(1) labels', () => {
  it('labels the method Relative Elevation, never plain Elevation', () => {
    expect(gradingMethodLabel('relative-elevation')).toBe('Relative Elevation');
    expect(gradingMethodLabel('elevation')).toBe('Elevation');
    expect(gradingMethodLabel('distance')).toBe('Distance');
    expect(gradingMethodLabel('surface')).toBe('Surface');
    expect(gradingMethodLabel('relative-elevation')).not.toBe('Elevation');
  });

  it('classifies the family as its own target-free termination', () => {
    const criterion = REL(-0.5, -10);
    expect(gradingTerminationKind(criterion)).toBe('relative-elevation');
    expect(gradingCriterionRequiresSurface(criterion)).toBe(false);
    expect(gradingBoundaryLabel(criterion)).toBe('Grading Limit');
    expect(gradingBoundaryShortLabel(criterion)).toBe('Limit');
  });

  it('formats criterion + target summaries distinctly from absolute Elevation', () => {
    const relative = formatGradingCriterion(REL(-0.5, -10));
    const absolute = formatGradingCriterion(ELEV);
    expect(relative).toContain('Relative Elevation');
    expect(relative).toContain('-10.000');
    expect(relative).toContain('offset 20.000');
    expect(absolute).not.toContain('Relative');
    expect(relative).not.toBe(absolute);

    const relativeTarget = gradingTargetSummary(REL(-0.5, -10), 'SURVEY', 'm');
    expect(relativeTarget).toBe('Target: Relative Elevation -10.000 m relative · grade -50.000%');
    expect(relativeTarget).not.toContain('SURVEY');
    expect(relativeTarget).not.toBe(gradingTargetSummary(ELEV, 'SURVEY', 'm'));
  });

  it('exposes the derived offset through one shared helper', () => {
    expect(relativeElevationDisplay(REL(-0.5, -10), 'm')).toEqual({
      grade: '-50.000%',
      relativeElevation: '-10.000 m relative',
      derivedOffset: '20.000 m',
    });
    expect(relativeElevationDisplay(DIST, 'm')).toBeNull();
    expect(relativeElevationDisplay(ELEV, 'm')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 2. Draft model
// ---------------------------------------------------------------------------
describe('(2) shared draft model', () => {
  const validDraft = () => ({
    ...defaultGradingCriterionDraft('relative-elevation'),
    magnitude: '50',
    direction: 'down' as const,
    relativeElevation: '-10',
  });

  it('parses a valid draft and summarizes it with the derived offset', () => {
    expect(parseGradingCriterionDraft(validDraft())).toEqual(REL(-0.5, -10));
    expect(summarizeGradingCriterionDraft(validDraft(), 'm')).toBe(
      'Grade -50.000% → relative elev -10.000 m · offset 20.000 m',
    );
    expect(gradingDraftDiagnosis(validDraft())).toBeNull();
  });

  it('round-trips a persisted criterion through the draft model', () => {
    const draft = gradingCriterionDraftFromCriterion(REL(-0.5, -10));
    expect(draft.method).toBe('relative-elevation');
    expect(draft.relativeElevation).toBe('-10');
    expect(parseGradingCriterionDraft(draft)).toEqual(REL(-0.5, -10));
  });

  it('fails closed on zero/malformed values and never parses to a fixed criterion', () => {
    expect(parseGradingCriterionDraft({ ...validDraft(), magnitude: '0' })).toBeNull();
    expect(parseGradingCriterionDraft({ ...validDraft(), relativeElevation: '0' })).toBeNull();
    expect(parseGradingCriterionDraft({ ...validDraft(), relativeElevation: 'abc' })).toBeNull();
    // Opposite signs derive d <= 0 and must never be silently accepted.
    expect(parseGradingCriterionDraft({ ...validDraft(), direction: 'up' })).toBeNull();
    expect(parseGradingCriterionDraft(validDraft())).not.toMatchObject({ kind: 'fixed' });
  });

  it('surfaces the wrong-direction error before Calculate', () => {
    const opposite = { ...validDraft(), direction: 'up' as const };
    expect(gradingDraftDiagnosis(opposite)).toBe(
      'Criterion: invalid — grade and relative elevation point in opposite directions',
    );
    expect(summarizeGradingCriterionDraft(opposite, 'm')).toBeNull();
  });

  it('accepts an upward draft', () => {
    const up = { ...defaultGradingCriterionDraft('relative-elevation'), magnitude: '50', direction: 'up' as const, relativeElevation: '10' };
    expect(parseGradingCriterionDraft(up)).toEqual(REL(0.5, 10));
    expect(summarizeGradingCriterionDraft(up, 'm')).toContain('offset 20.000 m');
  });
});

// ---------------------------------------------------------------------------
// 3. Registry + shell key set
// ---------------------------------------------------------------------------
describe('(3) registry', () => {
  it('resolves GRADETORELATIVEELEVATION and its GTRE alias collision-free', () => {
    expect(resolveShellCommandText('GRADETORELATIVEELEVATION')?.key).toBe('GRADETORELATIVEELEVATION');
    expect(resolveShellCommandText('GTRE')?.key).toBe('GRADETORELATIVEELEVATION');
    expect(resolveShellCommandText('GRADETORELATIVEELEVATION')?.label).toBe('Grade to Relative Elevation');
    // Existing aliases are untouched.
    expect(resolveShellCommandText('GTS')?.key).toBe('GRADETOSURFACE');
    expect(resolveShellCommandText('GTD')?.key).toBe('GRADETODISTANCE');
    expect(resolveShellCommandText('GTE')?.key).toBe('GRADETOELEVATION');
    // No accidental alias capture.
    expect(resolveShellCommandText('GTR')).toBeNull();
  });

  it('maps the shell key to the family and includes it in the grading shell key set', () => {
    expect(gradingShellMethod('GRADETORELATIVEELEVATION')).toBe('relative-elevation');
    expect(gradingShellMethod('GRADETODISTANCE')).toBe('distance');
    expect(gradingShellMethod('GRADETOELEVATION')).toBe('elevation');
    expect(gradingShellMethod('GRADETOSURFACE')).toBeNull();
    expect(GRADING_SHELL_KEYS.has('GRADETORELATIVEELEVATION')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 4. Criterion fields (React)
// ---------------------------------------------------------------------------
describe('(4) criterion fields', () => {
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

  it('renders its own signed Relative elevation field with help text', () => {
    const html = mount(
      <CadGradingCriterionFields draft={defaultGradingCriterionDraft('relative-elevation')} onChange={() => {}} lengthUnit="m" />,
    );
    const select = html.querySelector<HTMLSelectElement>('[data-cad-grading-field="cad-grading-method"]');
    expect(select?.value).toBe('relative-elevation');
    expect(Array.from(select!.options).map((option) => option.textContent)).toEqual([
      'Surface', 'Distance', 'Elevation', 'Relative Elevation',
    ]);
    const field = html.querySelector<HTMLInputElement>('[data-cad-grading-field="cad-grading-relative-elevation"]');
    expect(field).not.toBeNull();
    expect(html.textContent).toContain('Positive = above source; negative = below source.');
    // The absolute-elevation field and any target-surface slot are absent.
    expect(html.querySelector('[data-cad-grading-field="cad-grading-elevation"]')).toBeNull();
    expect(html.querySelector('[aria-label="Target surface"]')).toBeNull();
  });

  it('locks cleanly to the group family without offering cross-family methods', () => {
    const html = mount(
      <CadGradingCriterionFields draft={defaultGradingCriterionDraft('relative-elevation')} onChange={() => {}} lengthUnit="m" methods={['relative-elevation']} />,
    );
    expect(html.querySelector('[data-cad-grading-field="cad-grading-method"]')).toBeNull();
    expect(html.textContent).toContain('Method: Relative Elevation (locked to group family)');
    expect(html.querySelector('[data-cad-grading-field="cad-grading-relative-elevation"]')).not.toBeNull();
    expect(html.querySelector('[data-cad-grading-field="cad-grading-distance"]')).toBeNull();
  });

  it('renders the wrong-direction diagnosis inline', () => {
    const html = mount(
      <CadGradingCriterionFields
        draft={{ ...defaultGradingCriterionDraft('relative-elevation'), magnitude: '50', direction: 'up', relativeElevation: '-10' }}
        onChange={() => {}}
        lengthUnit="m"
      />,
    );
    expect(html.querySelector('[data-cad-grading-diagnosis]')?.textContent).toBe(
      'Criterion: invalid — grade and relative elevation point in opposite directions',
    );
  });
});

// ---------------------------------------------------------------------------
// 5. Snapshot, Properties, report/CSV
// ---------------------------------------------------------------------------
describe('(5) snapshot / properties / report', () => {
  const grading = gradingOf(REL(-0.5, -10));

  it('reads a calculable row with no target surface and no CURRENT requirement', () => {
    const snapshot = buildCadGradingSnapshot(projectWith(grading), null, null, null);
    const row = snapshot.gradings[0]!;
    expect(row.method).toBe('relative-elevation');
    expect(row.analytic).toBe(true);
    expect(row.targetName).toBe('—');
    expect(row.targetSurfaceId).toBe('');
    expect(row.boundaryLabel).toBe('Grading Limit');
    expect(row.cutFillApplicable).toBe(false);
    expect(row.calculable).toBe(true);
    expect(row.status).toBe('UNBUILT');
  });

  it('reaches CURRENT on a matching result and stays non-exportable when stale', () => {
    const first = buildCadGradingSnapshot(projectWith(grading), null, null, null).gradings[0]!;
    const current = relativeResult(first.id, first.revision);
    const row = buildCadGradingSnapshot(projectWith(grading), null, cacheOf([current]), null).gradings[0]!;
    expect(row.status).toBe('CURRENT');
    const staleRow = buildCadGradingSnapshot(projectWith(grading), null, cacheOf([relativeResult(first.id, 'grev1:stale')]), null).gradings[0]!;
    expect(staleRow.status).toBe('NEEDS_RECALC');
  });

  it('shows method, signed Δ and derived offset in Properties', () => {
    const row = buildCadGradingSnapshot(projectWith(grading), null, null, null).gradings[0]!;
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    act(() => root.render(<GradingPropertiesBlock row={row} />));
    expect(host.textContent).toContain('Relative Elevation');
    expect(host.querySelector('[data-cad-grading-relative-elevation]')?.textContent).toBe('-10.000 m relative');
    expect(host.querySelector('[data-cad-grading-relative-offset]')?.textContent).toBe('20.000 m');
    expect(host.querySelector('[data-cad-grading-relative-grade]')?.textContent).toBe('-50.000%');
    act(() => root.unmount());
    host.remove();
  });

  it('reports and exports the relative criterion with no target surface or fake zeros', () => {
    const first = buildCadGradingSnapshot(projectWith(grading), null, null, null).gradings[0]!;
    const result = relativeResult(first.id, first.revision);
    const row = buildCadGradingSnapshot(projectWith(grading), null, cacheOf([result]), null).gradings[0]!;
    const report = buildGradingInquiryReport(row.definition, row.source, row, row.currentResult);
    expect(report).toContain('Target: Relative Elevation -10.000 m relative · grade -50.000%');
    expect(report).toContain('cut — · fill — · tied —');
    expect(report).toContain('Grading Limit vertices');
    expect(report).not.toContain('Target: —');

    const csv = buildGradingCsv(row.definition, row.source!, result);
    const header = csv.split('\n')[0]!;
    expect(header).toContain('Limit E');
    expect(header).not.toContain('Daylight');
    expect(csv).not.toContain('Elevation 90');
  });
});

// ---------------------------------------------------------------------------
// 6. Group member table
// ---------------------------------------------------------------------------
describe('(6) group member table', () => {
  const group: CadGradingGroup = {
    id: 'gg',
    name: 'Pad',
    sourceFeatureLineId: 'fl-1',
    sourceCourses: [
      { vertexAId: 'a', vertexBId: 'b' },
      { vertexAId: 'b', vertexBId: 'c' },
    ],
    side: 'right',
    criterion: REL(-0.5, -10),
    courseCriteria: [{ sourceCourse: { vertexAId: 'b', vertexBId: 'c' }, criterion: REL(-0.5, -12) }],
    maxSearchDistance: 50,
    curveChordTolerance: 0.05,
    cornerMode: 'miter',
    closed: false,
  };

  it('tags the family truthfully and carries the signed Δ as the target value', () => {
    expect(courseCriterionTypeText(REL(-0.5, -10))).toBe('Relative Elevation');
    expect(courseCriterionTypeText(ELEV)).toBe('Elevation');
    expect(courseCriterionTypeText(DIST)).toBe('Distance');

    const rows = buildCourseMemberRows(group, null);
    expect(rows.map((row) => row.criterionType)).toEqual(['Relative Elevation', 'Relative Elevation']);
    expect(rows.map((row) => row.criterionSource)).toEqual(['Default', 'Override']);
    expect(rows[0]!.targetValue).toBe('-10.000 m relative');
    expect(rows[1]!.targetValue).toBe('-12.000 m relative');
    expect(rows[0]!.fixedGrade).toBe('—');
    expect(rows[0]!.cutGrade).toBe('—');
    expect(rows[0]!.fillGrade).toBe('—');
    expect(rows[0]!.gradingArea).toBe('—');
  });
});
