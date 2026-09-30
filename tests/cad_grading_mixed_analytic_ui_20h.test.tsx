/** @vitest-environment jsdom */
/**
 * Phase 20H UI slice — mixed-analytic groups.
 *
 * Pins the shell contract for same-domain mixing: analytic composers offer
 * the whole analytic method set, the group summary reads `Mixed Analytic`
 * (never a misleading single kind), the wrong-sign diagnosis routes through
 * the shared engine authority, and Manager / Properties / Toolspace /
 * Inquiry / CSV all agree on the mixed label + per-course types.
 */
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';

import {
  allowedMethodsForGroupDomain,
  clampToAllowedMethods,
  defaultGradingCriterionDraft,
  gradingDraftDiagnosis,
  gradingMethodLabel,
} from '../src/cad-app/shell/cadGradingCriterionInput';
import {
  MIXED_ANALYTIC_LABEL,
  summarizeGroupMethods,
  groupMethodSummary,
} from '../src/cad-app/shell/cadGradingGroupMethodSummary';
import { CadGradingCriterionFields } from '../src/cad-app/shell/CadGradingCriterionFields';
import { CadGradingGroupCriteriaPanel } from '../src/cad-app/shell/CadGradingGroupCriteriaPanel';
import { GradingGroupPropertiesBlock } from '../src/cad-app/shell/CadGradingGroupProperties';
import { CadGradingGroupManager } from '../src/cad-app/shell/CadGradingGroupManager';
import { GradingGroupsNode } from '../src/cad-app/shell/CadGradingGroupToolspace';
import type { CadShellActions, CadWorkspaceSnapshot } from '../src/cad-app/shell/cadShellTypes';
import { buildGroupInquiryReport, buildGroupCsv } from '../src/cad-app/shell/cadGradingGroupReport';
import { buildCadGradingGroupSnapshot } from '../src/cad-app/shell/cadGradingGroupSnapshot';
import { buildCourseMemberRows, courseCriterionTypeText } from '../src/cad-app/shell/cadGradingGroupCourseCriteria';
import { createGroupDefinition } from '../src/engine/cad/grading/gradingGroupAuthoring';
import { createBlankCadDrawingDocument } from '../src/engine/cad/cadDrawingFile';
import type { CadGradingGroup, CadGradingGroupResult } from '../src/engine/cad/grading/gradingGroupTypes';
import type { GradingCriterion } from '../src/engine/cad/grading/gradingTypes';
import type { CadFeatureLineEntity, CadProject } from '../src/engine/cad/cadTypes';

const DIST = (g: number, d: number): GradingCriterion => ({ kind: 'distance', gradeRatio: g, distance: d });
const ELEV = (g: number, e: number): GradingCriterion => ({ kind: 'elevation', gradeRatio: g, targetElevation: e });
const REL = (g: number, dz: number): GradingCriterion => ({ kind: 'relative-elevation', gradeRatio: g, relativeElevation: dz });

const COURSES = [
  { vertexAId: 'v0', vertexBId: 'v1' }, { vertexAId: 'v1', vertexBId: 'v2' },
  { vertexAId: 'v2', vertexBId: 'v3' }, { vertexAId: 'v3', vertexBId: 'v0' },
];

const mixedGroup = (): CadGradingGroup => {
  const created = createGroupDefinition({
    id: 'gg', name: 'Pad', sourceFeatureLineId: 'fl-1', sourceCourses: COURSES,
    side: 'right', criterion: DIST(-0.5, 20),
    courseCriteria: [
      { sourceCourse: COURSES[1]!, criterion: REL(-0.25, -10) },
      { sourceCourse: COURSES[2]!, criterion: ELEV(-0.5, 0) },
    ],
    maxSearchDistance: 50, curveChordTolerance: 0.05, cornerMode: 'miter', closed: true,
  });
  if (!created.ok) throw new Error(created.error);
  return created.value;
};

const featureLine = (): CadFeatureLineEntity => ({
  id: 'fl-1', type: 'feature-line', layerId: 'general', visible: true, locked: false, name: 'Pad FL',
  vertices: [
    { id: 'v0', x: 0, y: 0, z: 10 }, { id: 'v1', x: 100, y: 0, z: 10 },
    { id: 'v2', x: 100, y: 100, z: 10 }, { id: 'v3', x: 0, y: 100, z: 10 },
  ],
  closed: true,
});

const project = (group: CadGradingGroup): CadProject => ({
  ...createBlankCadDrawingDocument({ name: '20h-ui', units: 'm' }).project,
  entities: [featureLine()],
  gradingGroups: [group],
});

const result = (groupId: string, revision: string): CadGradingGroupResult => ({
  groupId, revision, accuracy: 'EXACT', memberCount: 4, cornerCount: 4,
  memberRegions: [],
  corners: [
    { cornerIndex: 0, vertexId: 'joint:0', classification: 'GAP', miterExtent: 28.284271247461902, tiePointXyz: [120, -20, 0], daylightPoints: [], diagnostics: [] },
  ],
  daylightPoints: [0, -20, 0, 100, -20, 0, 120, -20, 0],
  gradingMesh: { points: [0, 0, 10, 100, 0, 10, 100, -20, 0, 0, -20, 0], triangles: [0, 1, 2, 0, 2, 3] },
  sourceLength: 400, gradingPlanArea: 9600, grading3dArea: 9600,
  minProjectionDistance: 20, maxProjectionDistance: 20, meanProjectionDistance: 20,
  cutSourceLength: 0, fillSourceLength: 0, tiedSourceLength: 0,
  candidateTriangleCount: 0, intersectionSegmentCount: 0, multipleSolutionCount: 0,
  diagnostics: [],
});

// ---------------------------------------------------------------------------
// 1. Domain method sets + summary helper
// ---------------------------------------------------------------------------
describe('(1) domain method sets + summary', () => {
  it('offers the whole analytic domain but locks surface', () => {
    expect(allowedMethodsForGroupDomain('analytic')).toEqual(['distance', 'elevation', 'relative-elevation']);
    expect(allowedMethodsForGroupDomain('surface')).toEqual(['surface']);
  });

  it('clamps a stale draft method into the offered set', () => {
    const draft = defaultGradingCriterionDraft('surface');
    const analytic = allowedMethodsForGroupDomain('analytic');
    expect(clampToAllowedMethods(draft, analytic).method).toBe('distance');
    expect(clampToAllowedMethods(defaultGradingCriterionDraft('elevation'), analytic).method).toBe('elevation');
    expect(clampToAllowedMethods(defaultGradingCriterionDraft('distance'), [])).toEqual(defaultGradingCriterionDraft('distance'));
  });

  it('summarizes a mixed analytic group as Mixed Analytic with a canonical detail', () => {
    const summary = summarizeGroupMethods([DIST(-0.5, 20), REL(-0.25, -10), ELEV(-0.5, 0)]);
    expect(summary.label).toBe(MIXED_ANALYTIC_LABEL);
    expect(summary.label).toBe('Mixed Analytic');
    expect(summary.mixedAnalytic).toBe(true);
    expect(summary.detail).toBe('Distance + Elevation + Relative Elevation');
    expect(summary.kinds).toEqual(['distance', 'elevation', 'relative-elevation']);
  });

  it('never says Mixed Analytic for homogeneous groups', () => {
    expect(summarizeGroupMethods([DIST(-0.5, 20)]).label).toBe('Distance');
    expect(summarizeGroupMethods([DIST(-0.5, 20), DIST(-0.25, 10)]).mixedAnalytic).toBe(false);
    expect(summarizeGroupMethods([REL(-0.5, -10), REL(-0.5, -12)]).label).toBe('Relative Elevation');
  });

  it('groupMethodSummary reads the default + effective course criteria', () => {
    const summary = groupMethodSummary(mixedGroup());
    expect(summary.label).toBe('Mixed Analytic');
    expect(summary.detail).toBe('Distance + Elevation + Relative Elevation');
  });

  it('labels each method truthfully', () => {
    expect(gradingMethodLabel('distance')).toBe('Distance');
    expect(gradingMethodLabel('elevation')).toBe('Elevation');
    expect(gradingMethodLabel('relative-elevation')).toBe('Relative Elevation');
    expect(gradingMethodLabel('surface')).toBe('Surface');
  });
});

// ---------------------------------------------------------------------------
// 2. Criterion fields + composer (React)
// ---------------------------------------------------------------------------
describe('(2) composer offers the analytic domain', () => {
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

  it('renders all three analytic methods (no Surface) when locked to the analytic domain', () => {
    const html = mount(
      <CadGradingCriterionFields
        draft={defaultGradingCriterionDraft('distance')}
        onChange={() => {}}
        lengthUnit="m"
        methods={allowedMethodsForGroupDomain('analytic')}
      />,
    );
    const select = html.querySelector<HTMLSelectElement>('[data-cad-grading-field="cad-grading-method"]');
    expect(select).not.toBeNull();
    expect(Array.from(select!.options).map((option) => option.textContent)).toEqual([
      'Distance', 'Elevation', 'Relative Elevation',
    ]);
    expect(html.querySelector('[data-cad-grading-field="cad-grading-method-locked"]')).toBeNull();
  });

  it('still locks the surface domain (Fixed/Cut-Fill only)', () => {
    const html = mount(
      <CadGradingCriterionFields
        draft={defaultGradingCriterionDraft('surface')}
        onChange={() => {}}
        lengthUnit="m"
        methods={allowedMethodsForGroupDomain('surface')}
      />,
    );
    expect(html.querySelector('[data-cad-grading-field="cad-grading-method"]')).toBeNull();
    expect(html.textContent).toContain('Method: Surface (locked to group family)');
  });

  it('routes the wrong-sign diagnosis through the shared engine authority', () => {
    expect(gradingDraftDiagnosis({
      ...defaultGradingCriterionDraft('relative-elevation'),
      magnitude: '50', direction: 'up', relativeElevation: '-10',
    })).toBe('Criterion: invalid — grade and relative elevation point in opposite directions');
  });

  it('the group criteria panel offers all five kinds (no domain lock)', () => {
    const html = mount(
      <CadGradingGroupCriteriaPanel group={mixedGroup()} run={() => true} onNotice={() => {}} />,
    );
    const select = html.querySelector<HTMLSelectElement>('[data-cad-grading-field="cad-grading-group-criteria-method"]');
    expect(select).not.toBeNull();
    expect(Array.from(select!.options).map((option) => option.textContent)).toEqual([
      'Surface', 'Distance', 'Elevation', 'Relative Elevation',
    ]);
    expect(html.querySelector('[data-cad-grading-field="cad-grading-group-criteria-method-locked"]')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 3. Snapshot + Properties
// ---------------------------------------------------------------------------
describe('(3) snapshot + properties', () => {
  it('carries the mixed-analytic summary and never a fake target', () => {
    const row = buildCadGradingGroupSnapshot(project(mixedGroup()), null, null, null).groups[0]!;
    expect(row.methodSummary.label).toBe('Mixed Analytic');
    expect(row.methodSummary.detail).toBe('Distance + Elevation + Relative Elevation');
    expect(row.analytic).toBe(true);
    expect(row.targetName).toBe('—');
    expect(row.boundaryLabel).toBe('Grading Limit');
  });

  it('Properties shows Mixed Analytic + Methods + Analytic domain + Not applicable target', () => {
    const row = buildCadGradingGroupSnapshot(project(mixedGroup()), null, null, null).groups[0]!;
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    act(() => root.render(<GradingGroupPropertiesBlock row={row} />));
    expect(host.querySelector('[data-cad-grading-group-properties-method]')?.textContent).toBe('Mixed Analytic');
    expect(host.querySelector('[data-cad-grading-group-properties-methods]')?.textContent)
      .toBe('Distance + Elevation + Relative Elevation');
    expect(host.textContent).toContain('Analytic');
    expect(host.textContent).toContain('Not applicable');
    act(() => root.unmount());
    host.remove();
  });
});

// ---------------------------------------------------------------------------
// 5. Fully-overridden Target displays (reviewer follow-up)
// ---------------------------------------------------------------------------
describe('(5) fully-overridden target displays', () => {
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

  const overriddenGroup = (): CadGradingGroup => {
    const created = createGroupDefinition({
      id: 'gg', name: 'Pad', sourceFeatureLineId: 'fl-1', sourceCourses: COURSES,
      side: 'right', criterion: DIST(-0.5, 20),
      courseCriteria: COURSES.map((sourceCourse) => ({ sourceCourse, criterion: REL(-0.5, -10) })),
      maxSearchDistance: 50, curveChordTolerance: 0.05, cornerMode: 'miter', closed: true,
    });
    if (!created.ok) throw new Error(created.error);
    return created.value;
  };

  const rowOf = () =>
    buildCadGradingGroupSnapshot(project(overriddenGroup()), null, null, null).groups[0]!;

  it('Properties Target follows the representative criterion, not the stored default', () => {
    const host = mount(<GradingGroupPropertiesBlock row={rowOf()} />);
    expect(host.textContent).toContain('TargetTarget: Relative Elevation -10.000 m relative');
    // The stored default stays visible exactly once, honestly labeled.
    expect(host.textContent).toContain('Default CriterionGrade -50.000% → Distance 20.000 m');
  });

  it('Manager Target follows the representative criterion', () => {
    const snapshot = {
      units: 'm',
      gradingGroups: buildCadGradingGroupSnapshot(project(overriddenGroup()), null, null, null),
    } as unknown as CadWorkspaceSnapshot;
    const actions = {} as unknown as CadShellActions;
    const host = mount(<CadGradingGroupManager snapshot={snapshot} actions={actions} onClose={() => {}} />);
    const target = host.querySelector('[data-cad-grading-group-target-static]')?.textContent ?? '';
    expect(target).toContain('Relative Elevation -10.000 m');
    expect(target).not.toContain('Distance 20.000 m');
  });

  it('Toolspace Target + grade spans follow the representative criterion', () => {
    const snapshot = {
      gradingGroups: buildCadGradingGroupSnapshot(project(overriddenGroup()), null, null, null),
    } as unknown as CadWorkspaceSnapshot;
    const host = mount(<GradingGroupsNode snapshot={snapshot} actions={null} />);
    const definition = host.querySelector('[data-cad-grading-group-definition]')?.textContent ?? '';
    expect(definition).toContain('Target: Relative Elevation -10.000 m');
    expect(definition).not.toContain('Distance 20.000 m');
    expect(host.querySelector('[data-cad-grading-group-relative-elevation]')?.textContent)
      .toContain('-10.000');
  });
});

// ---------------------------------------------------------------------------
// 4. Inquiry + CSV + member rows
// ---------------------------------------------------------------------------
describe('(4) inquiry + CSV + member table', () => {
  const group = mixedGroup();

  it('member rows label each analytic kind truthfully', () => {
    const rows = buildCourseMemberRows(group, null);
    expect(rows.map((row) => row.criterionType)).toEqual([
      'Distance', 'Relative Elevation', 'Elevation', 'Distance',
    ]);
    expect(rows.map((row) => row.criterionSource)).toEqual(['Default', 'Override', 'Override', 'Default']);
    expect(courseCriterionTypeText(REL(-0.5, -10))).toBe('Relative Elevation');
    expect(courseCriterionTypeText(ELEV(-0.5, 0))).toBe('Elevation');
  });

  it('inquiry report says Mixed Analytic + Methods and a Not applicable target', () => {
    const report = buildGroupInquiryReport(group, 'Pad FL', '—', 'UNBUILT', null, null, 'm');
    expect(report).toContain('Termination: Mixed Analytic · Methods: Distance + Elevation + Relative Elevation');
    expect(report).toContain('Target: Not applicable');
  });

  it('group CSV carries Termination/Methods rows and the target Not applicable', () => {
    const csv = buildGroupCsv(group, 'CURRENT', 'EXACT', result('gg', 'ggrev1:x'));
    expect(csv).toContain('Termination,Mixed Analytic');
    expect(csv).toContain('Methods,Distance + Elevation + Relative Elevation');
    expect(csv).toContain('Target,Not applicable');
    expect(csv).toContain('Relative Elevation');
  });
});
