/** @vitest-environment jsdom */
/**
 * Phase 20J Wave C2 — hybrid grading-group UI shell.
 *
 * Pins the shell contract for surface + analytic mixes (effective criteria
 * only): the shared summary reads `Hybrid` with an exact
 * `Hybrid — Surface + …` detail, target need derives from the effective set
 * (an analytic default with a Surface override still needs its target), the
 * course/default editors offer all five kinds with the exact common-tie
 * warning (never a calculability claim), Manager / Properties / Toolspace /
 * Inquiry / CSV agree on Hybrid labels + the actual shared target, and the
 * command registry gains no new command.
 */
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';

import {
  HYBRID_CORNER_WARNING,
  HYBRID_LABEL,
  groupMethodSummary,
  summarizeGroupMethods,
} from '../src/cad-app/shell/cadGradingGroupMethodSummary';
import { CadGradingGroupCriteriaPanel } from '../src/cad-app/shell/CadGradingGroupCriteriaPanel';
import { CadGradingGroupManager } from '../src/cad-app/shell/CadGradingGroupManager';
import { GradingGroupPropertiesBlock } from '../src/cad-app/shell/CadGradingGroupProperties';
import { GradingGroupsNode } from '../src/cad-app/shell/CadGradingGroupToolspace';
import type { CadShellActions, CadWorkspaceSnapshot } from '../src/cad-app/shell/cadShellTypes';
import { buildGroupCsv, buildGroupInquiryReport } from '../src/cad-app/shell/cadGradingGroupReport';
import { buildCadGradingGroupSnapshot } from '../src/cad-app/shell/cadGradingGroupSnapshot';
import { buildCourseMemberRows } from '../src/cad-app/shell/cadGradingGroupCourseCriteria';
import {
  GRADINGGROUP_SHELL_KEYS,
} from '../src/cad-app/shell/cadGradingGroupShell';
import { CAD_SHELL_COMMANDS } from '../src/cad-app/shell/cadCommandRegistry';
import { groupTerminationRequiresTarget } from '../src/engine/cad/grading/gradingGroupTermination';
import { resolveGroupMemberCriteria } from '../src/engine/cad/grading/gradingGroupCourseCriteria';
import { createBlankCadDrawingDocument } from '../src/engine/cad/cadDrawingFile';
import type { CadGradingGroup, CadGradingGroupResult } from '../src/engine/cad/grading/gradingGroupTypes';
import type { GradingCriterion } from '../src/engine/cad/grading/gradingTypes';
import type { CadFeatureLineEntity, CadProject } from '../src/engine/cad/cadTypes';

const FIXED = (g: number): GradingCriterion => ({ kind: 'fixed', gradeRatio: g });
const DIST = (g: number, d: number): GradingCriterion => ({ kind: 'distance', gradeRatio: g, distance: d });

const COURSES = [
  { vertexAId: 'v0', vertexBId: 'v1' }, { vertexAId: 'v1', vertexBId: 'v2' },
  { vertexAId: 'v2', vertexBId: 'v3' }, { vertexAId: 'v3', vertexBId: 'v0' },
];

/** Analytic default + one Surface override: hybrid through the effective set. */
const hybridGroup = (): CadGradingGroup => ({
  id: 'gg-hybrid',
  name: 'Hybrid Pad',
  sourceFeatureLineId: 'fl-1',
  sourceCourses: COURSES.map((course) => ({ ...course })),
  targetSurfaceId: 's1',
  side: 'right',
  criterion: DIST(-0.5, 20),
  courseCriteria: [{ sourceCourse: { ...COURSES[0]! }, criterion: FIXED(-0.02) }],
  maxSearchDistance: 50,
  curveChordTolerance: 0.05,
  cornerMode: 'miter',
  closed: true,
});

const featureLine = (): CadFeatureLineEntity => ({
  id: 'fl-1', type: 'feature-line', layerId: 'general', visible: true, locked: false, name: 'Pad FL',
  vertices: [
    { id: 'v0', x: 0, y: 0, z: 10 }, { id: 'v1', x: 100, y: 0, z: 10 },
    { id: 'v2', x: 100, y: 100, z: 10 }, { id: 'v3', x: 0, y: 100, z: 10 },
  ],
  closed: true,
});

const project = (group: CadGradingGroup): CadProject => ({
  ...createBlankCadDrawingDocument({ name: '20j-hybrid-ui', units: 'm' }).project,
  entities: [featureLine()],
  surfaces: [
    {
      id: 's1',
      name: 'Pond',
      definition: {
        sourceKind: 'explicit-tin',
        pointSource: { kind: 'points', pointEntityIds: [] },
        importedTin: {
          vertices: [-60, -60, 0, 260, -60, 0, 260, 160, 0, -60, 160, 0],
          faces: [0, 1, 2, 0, 2, 3],
          provenance: { kind: 'webnet-bake', sourceSurfaceId: 'seed', sourceSurfaceName: 'seed', sourceRevision: 'srev1:seed' },
        },
      },
      cachedRevision: null,
    } as never,
  ],
  gradingGroups: [group],
});

const fakeResult = (groupId: string): CadGradingGroupResult => ({
  groupId, revision: 'ggrev1:fake', accuracy: 'EXACT', memberCount: 4, cornerCount: 4,
  memberRegions: [],
  corners: [
    { cornerIndex: 0, vertexId: 'joint:0', classification: 'GAP', miterExtent: 1.5, tiePointXyz: [100, 0, 9], daylightPoints: [], diagnostics: [] },
  ],
  daylightPoints: [100, -20, 9, 120, -20, 9],
  gradingMesh: { points: [0, 0, 10, 100, 0, 10], triangles: [0, 1, 2] },
  sourceLength: 400, gradingPlanArea: 9600, grading3dArea: 9600,
  minProjectionDistance: 20, maxProjectionDistance: 20, meanProjectionDistance: 20,
  cutSourceLength: 10, fillSourceLength: 20, tiedSourceLength: 30,
  candidateTriangleCount: 0, intersectionSegmentCount: 0, multipleSolutionCount: 0,
  diagnostics: [],
});

// ---------------------------------------------------------------------------
// 1. Shared summary: Hybrid from effective criteria only
// ---------------------------------------------------------------------------
describe('(1) hybrid summary', () => {
  it('reads Hybrid with an exact Hybrid — Surface + Distance detail', () => {
    const summary = summarizeGroupMethods([FIXED(-0.02), DIST(-0.5, 20)]);
    expect(summary.label).toBe(HYBRID_LABEL);
    expect(summary.label).toBe('Hybrid');
    expect(summary.hybrid).toBe(true);
    expect(summary.mixedAnalytic).toBe(false);
    expect(summary.requiresTarget).toBe(true);
    expect(summary.detail).toBe('Hybrid — Surface + Distance');
    expect(summary.methodList).toBe('Surface + Distance');
    expect(summary.kinds).toEqual(['surface', 'distance']);
  });

  it('groupMethodSummary derives Hybrid from the effective set (analytic default + Surface override)', () => {
    const summary = groupMethodSummary(hybridGroup());
    expect(summary.label).toBe('Hybrid');
    expect(summary.hybrid).toBe(true);
    expect(summary.detail).toBe('Hybrid — Surface + Distance');
  });

  it('a fully-overridden default never leaks into the label', () => {
    // Stored surface default, every course rides an analytic override:
    // effective-only means Distance, never Hybrid.
    const group: CadGradingGroup = {
      ...hybridGroup(),
      criterion: FIXED(-0.02),
      courseCriteria: COURSES.map((sourceCourse) => ({ sourceCourse: { ...sourceCourse }, criterion: DIST(-0.5, 20) })),
    };
    const summary = groupMethodSummary(group);
    expect(summary.label).toBe('Distance');
    expect(summary.hybrid).toBe(false);
    expect(summary.requiresTarget).toBe(false);
  });

  it('target need derives from effective criteria, never the stored default alone', () => {
    const group = hybridGroup();
    expect(groupTerminationRequiresTarget(group.criterion, resolveGroupMemberCriteria(group))).toBe(true);
    expect(groupMethodSummary(group).requiresTarget).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 2. Editors: all five kinds + exact warning, no calculability claim
// ---------------------------------------------------------------------------
describe('(2) criteria panel', () => {
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

  it('offers all five kinds with no domain lock', () => {
    const html = mount(
      <CadGradingGroupCriteriaPanel group={hybridGroup()} run={() => true} onNotice={() => {}} />,
    );
    const select = html.querySelector<HTMLSelectElement>('[data-cad-grading-field="cad-grading-group-criteria-method"]');
    expect(select).not.toBeNull();
    expect(Array.from(select!.options).map((option) => option.textContent)).toEqual([
      'Surface', 'Distance', 'Elevation', 'Relative Elevation',
    ]);
    expect(html.querySelector('[data-cad-grading-field="cad-grading-group-criteria-method-locked"]')).toBeNull();
  });

  it('warns the exact common-tie wording on a hybrid group (no calculability claim)', () => {
    const html = mount(
      <CadGradingGroupCriteriaPanel group={hybridGroup()} run={() => true} onNotice={() => {}} />,
    );
    const warning = html.querySelector('[data-cad-grading-group-hybrid-warning]')?.textContent ?? '';
    expect(warning).toBe(HYBRID_CORNER_WARNING);
    expect(warning).toContain('one exact common tie');
    expect(warning).toContain('fails closed');
    expect(html.textContent).not.toMatch(/calculab|can be calculated|will calculate/i);
  });

  it('asks for an explicit CURRENT target when a Surface edit needs one', () => {
    const targetFree: CadGradingGroup = { ...hybridGroup(), targetSurfaceId: undefined };
    const html = mount(
      <CadGradingGroupCriteriaPanel
        group={targetFree}
        run={() => true}
        onNotice={() => {}}
        currentSurfaces={[{ id: 's1', name: 'Pond' }]}
      />,
    );
    // Default rides Distance; switch the composer to Surface to force the need.
    const select = html.querySelector<HTMLSelectElement>('[data-cad-grading-field="cad-grading-group-criteria-method"]');
    expect(select).not.toBeNull();
    act(() => {
      select!.value = 'surface';
      select!.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(html.querySelector('[data-cad-grading-group-criteria-target]')).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 3. Manager / Properties / Toolspace labels
// ---------------------------------------------------------------------------
describe('(3) manager + properties + toolspace', () => {
  let host: HTMLDivElement | null = null;
  let root: Root | null = null;

  afterEach(() => {
    if (root && host) {
      act(() => root!.unmount());
      host!.remove();
    }
    root = null;
    host = null;
  });

  const mount = (node: ReactNode): HTMLDivElement => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    const mounted = createRoot(el);
    act(() => mounted.render(node));
    host = el;
    root = mounted;
    return el;
  };

  const rowOf = () =>
    buildCadGradingGroupSnapshot(project(hybridGroup()), null, null, null).groups[0]!;

  it('snapshot carries Hybrid + shared target + Grading Boundary', () => {
    const row = rowOf();
    expect(row.methodSummary.label).toBe('Hybrid');
    expect(row.methodSummary.detail).toBe('Hybrid — Surface + Distance');
    expect(row.hybrid).toBe(true);
    expect(row.analytic).toBe(false);
    // Never "Not applicable" for hybrid: the shared surface target applies.
    expect(row.targetName).toBe('Pond');
    expect(row.boundaryLabel).toBe('Grading Boundary');
    expect(row.cutFillApplicable).toBe(true);
  });

  it('Manager row shows Hybrid, the actual target, default + overrides, and tolerance', () => {
    const snapshot = {
      units: 'm',
      gradingGroups: buildCadGradingGroupSnapshot(project(hybridGroup()), null, null, null),
    } as unknown as CadWorkspaceSnapshot;
    const actions = {} as unknown as CadShellActions;
    const html = mount(<CadGradingGroupManager snapshot={snapshot} actions={actions} onClose={() => {}} />);
    const row = html.querySelector('[data-cad-grading-group-row]')?.textContent ?? '';
    expect(row).toContain('Hybrid');
    expect(row).toContain('Pond');
    expect(row).not.toContain('Not applicable');
    expect(row).toContain('Overrides:1');
    // Search + tolerance both listed.
    expect(row).toContain('50.00');
    expect(row).toContain('0.050');
    // Per-course pseudo-status and fake singular targets stay out.
    expect(html.textContent).not.toContain('Target: Not applicable');
  });

  it('Properties shows Hybrid domain + Methods + actual target', () => {
    const html = mount(<GradingGroupPropertiesBlock row={rowOf()} />);
    expect(html.querySelector('[data-cad-grading-group-properties-method]')?.textContent).toBe('Hybrid');
    expect(html.querySelector('[data-cad-grading-group-properties-methods]')?.textContent)
      .toBe('Hybrid — Surface + Distance');
    expect(html.textContent).toContain('Hybrid');
    expect(html.textContent).toContain('Target: Pond');
    expect(html.textContent).not.toContain('Not applicable');
  });

  it('Toolspace stays compact with Hybrid + actual target', () => {
    const snapshot = {
      gradingGroups: buildCadGradingGroupSnapshot(project(hybridGroup()), null, null, null),
    } as unknown as CadWorkspaceSnapshot;
    const html = mount(<GradingGroupsNode snapshot={snapshot} actions={null} />);
    const definition = html.querySelector('[data-cad-grading-group-definition]')?.textContent ?? '';
    expect(definition).toContain('Method Hybrid (Hybrid — Surface + Distance)');
    expect(definition).toContain('Target: Pond');
    expect(definition).not.toContain('Not applicable');
  });
});

// ---------------------------------------------------------------------------
// 4. Inquiry / CSV alignment
// ---------------------------------------------------------------------------
describe('(4) inquiry + CSV', () => {
  const group = hybridGroup();

  it('member rows carry per-course Effective text and the surface target name', () => {
    const rows = buildCourseMemberRows(group, null, 'Pond');
    expect(rows.map((row) => row.criterionType)).toEqual([
      'Surface Fixed', 'Distance', 'Distance', 'Distance',
    ]);
    expect(rows.map((row) => row.criterionSource)).toEqual(['Override', 'Default', 'Default', 'Default']);
    expect(rows[0]!.targetValue).toBe('Pond');
    expect(rows[1]!.targetValue).toBe('20.000 m');
    expect(rows[0]!.effective).toContain('Fixed');
  });

  it('on-screen report reads Hybrid + actual target + Grading Boundary + default/overrides', () => {
    const report = buildGroupInquiryReport(group, 'Pad FL', 'Pond', 'CURRENT', 'EXACT', fakeResult('gg-hybrid'), 'm');
    expect(report).toContain('Termination: Hybrid · Methods: Surface + Distance');
    expect(report).toContain('Target: Pond');
    expect(report).not.toContain('Target: Not applicable');
    expect(report).toContain('Grading Boundary vertices:');
    expect(report).toContain('Default:');
    expect(report).toContain('Overrides: 1');
    // Per-course table: surface course names the shared target, analytic
    // courses carry their horizontal distance; no singular hybrid target value.
    expect(report).toContain('Override Surface Fixed');
    expect(report).toContain('target Pond');
    expect(report).toContain('target 20.000 m');
  });

  it('CSV matches the on-screen report', () => {
    const csv = buildGroupCsv(group, 'CURRENT', 'EXACT', fakeResult('gg-hybrid'), 'Pond');
    expect(csv).toContain('Termination,Hybrid');
    expect(csv).toContain('Methods,Hybrid — Surface + Distance');
    expect(csv).toContain('Target,Pond');
    expect(csv).toContain('Default Criterion,');
    expect(csv).toContain('Overrides,1');
    expect(csv).toContain('Grading Boundary E,Grading Boundary N,Grading Boundary Z');
    const lines = csv.split('\n');
    const header = lines.findIndex((line) =>
      line.startsWith('Course,From,To,Criterion Source,Criterion Type,Effective,'),
    );
    expect(header).toBeGreaterThan(-1);
    expect(lines[header + 1]).toContain('Override,Surface Fixed');
    expect(lines[header + 1]).toContain('Pond');
    expect(lines[header + 2]).toContain('Default,Distance');
    expect(lines[header + 2]).toContain('20.000 m');
    // Hybrid keeps real tied lengths (surface courses tie): no analytic dash-out.
    expect(csv).toContain('Tied Length,30.000');
  });
});

// ---------------------------------------------------------------------------
// 5. Registry: no new command
// ---------------------------------------------------------------------------
describe('(5) registry unchanged', () => {
  it('grading-group shell keys are exactly the seven existing entries', () => {
    expect([...GRADINGGROUP_SHELL_KEYS].sort()).toEqual([
      'GRADEGROUP',
      'GRADINGGROUP',
      'GRADINGGROUPBAKE',
      'GRADINGGROUPCALC',
      'GRADINGGROUPCRITERIA',
      'GRADINGGROUPEXTRACTDAYLIGHT',
      'GRADINGGROUPINQUIRY',
    ]);
  });

  it('the command registry carries no hybrid-specific command', () => {
    const keys = CAD_SHELL_COMMANDS.map((def) => def.key);
    expect(keys).not.toContain('GRADINGGROUPHYBRID');
    expect(keys).not.toContain('GRADEGROUPHYBRID');
    expect(keys.filter((key) => key.includes('GROUP'))).toEqual([
      'GRADEGROUP',
      'GRADINGGROUP',
      'GRADINGGROUPCALC',
      'GRADINGGROUPINQUIRY',
      'GRADINGGROUPCRITERIA',
      'GRADINGGROUPEXTRACTDAYLIGHT',
      'GRADINGGROUPBAKE',
    ]);
  });
});
