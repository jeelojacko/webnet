/** @vitest-environment jsdom */
/**
 * Phase 20F.1 — per-course criteria editor closeout (Phase 20H: domain-locked
 * composer), truthful 5-way Type labels, analytic target values in rows,
 * report text, and CSV.
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { describe, expect, it } from 'vitest';

import { CadGradingGroupCriteriaPanel } from '../src/cad-app/shell/CadGradingGroupCriteriaPanel';
import type { CadGradingGroupShellCommand } from '../src/cad-app/shell/cadGradingGroupShell';
import {
  buildCourseMemberRows,
  courseCriterionTypeText,
} from '../src/cad-app/shell/cadGradingGroupCourseCriteria';
import {
  buildGroupCsv,
  buildGroupInquiryReport,
} from '../src/cad-app/shell/cadGradingGroupReport';
import {
  createGroupDefinition,
  setCourseCriteriaOverrides,
} from '../src/engine/cad/grading/gradingGroupAuthoring';
import type { CadGradingGroup } from '../src/engine/cad/grading/gradingGroupTypes';

const courses = [
  { vertexAId: 'fl:a', vertexBId: 'fl:b' },
  { vertexAId: 'fl:b', vertexBId: 'fl:c' },
];

const surfaceGroup = (): CadGradingGroup => {
  const created = createGroupDefinition({
    id: 'gg-20f1-surface',
    name: 'Surface Group',
    sourceFeatureLineId: 'fl',
    sourceCourses: courses,
    targetSurfaceId: 'tgt',
    side: 'right',
    criterion: { kind: 'fixed', gradeRatio: -0.02 },
    maxSearchDistance: 20,
    curveChordTolerance: 0.1,
    cornerMode: 'miter',
  });
  if (!created.ok) throw new Error(created.error);
  return created.value;
};

const distanceGroup = (): CadGradingGroup => {
  const created = createGroupDefinition({
    id: 'gg-20f1-distance',
    name: 'Distance Group',
    sourceFeatureLineId: 'fl',
    sourceCourses: courses,
    side: 'right',
    criterion: { kind: 'distance', gradeRatio: -0.02, distance: 20 },
    maxSearchDistance: 40,
    curveChordTolerance: 0.1,
    cornerMode: 'miter',
  });
  if (!created.ok) throw new Error(created.error);
  return created.value;
};

const elevationGroup = (): CadGradingGroup => {
  const created = createGroupDefinition({
    id: 'gg-20f1-elevation',
    name: 'Elevation Group',
    sourceFeatureLineId: 'fl',
    sourceCourses: courses,
    side: 'right',
    criterion: { kind: 'elevation', gradeRatio: -0.02, targetElevation: 98 },
    maxSearchDistance: 40,
    curveChordTolerance: 0.1,
    cornerMode: 'miter',
  });
  if (!created.ok) throw new Error(created.error);
  return created.value;
};

/** Distance group with course 2 overridden to a longer offset. */
const distanceOverrideGroup = (): CadGradingGroup => {
  const applied = setCourseCriteriaOverrides(
    distanceGroup(),
    [{ vertexAId: 'fl:b', vertexBId: 'fl:c' }],
    { kind: 'distance', gradeRatio: -0.02, distance: 25 },
  );
  if (!applied.ok) throw new Error(applied.error);
  return applied.value;
};

const mount = (
  group: CadGradingGroup,
  run: (_command: CadGradingGroupShellCommand) => boolean,
  onNotice: (_message: string) => void = () => {},
) => {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root: Root = createRoot(host);
  act(() => {
    root.render(
      <CadGradingGroupCriteriaPanel group={group} run={run} onNotice={onNotice} />,
    );
  });
  return { host, root };
};

const unmount = (host: HTMLElement, root: Root): void => {
  act(() => {
    root.unmount();
  });
  host.remove();
};

const setInput = (el: HTMLInputElement, value: string): void => {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  if (!setter) throw new Error('no input value setter');
  act(() => {
    setter.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
};

describe('hybrid composer (no domain lock)', () => {
  it('surface group offers all five kinds (Surface Fixed/Cut-Fill + analytic)', () => {
    const { host, root } = mount(surfaceGroup(), () => true);
    try {
      const method = host.querySelector('[aria-label="Grading method"]') as HTMLSelectElement | null;
      expect(method).not.toBeNull();
      expect([...(method?.options ?? [])].map((option) => option.value)).toEqual([
        'surface', 'distance', 'elevation', 'relative-elevation',
      ]);
      expect(method?.value).toBe('surface');
      const kind = host.querySelector('[aria-label="Criterion kind"]') as HTMLSelectElement | null;
      expect(kind).not.toBeNull();
      expect([...(kind?.options ?? [])].map((option) => option.value)).toEqual(['fixed', 'cut-fill']);
    } finally {
      unmount(host, root);
    }
  });

  it('analytic group offers all five kinds, with editable grade + target distance', () => {
    const { host, root } = mount(distanceGroup(), () => true);
    try {
      const method = host.querySelector('[aria-label="Grading method"]') as HTMLSelectElement | null;
      expect(method).not.toBeNull();
      expect([...(method?.options ?? [])].map((option) => option.value)).toEqual([
        'surface', 'distance', 'elevation', 'relative-elevation',
      ]);
      expect(method?.value).toBe('distance');
      const distance = host.querySelector('[aria-label="Target distance"]') as HTMLInputElement | null;
      expect(distance).not.toBeNull();
      expect(distance?.value).toBe('20');
      expect(host.querySelector('[aria-label="Target elevation"]')).toBeNull();
    } finally {
      unmount(host, root);
    }
  });

  it('elevation group stays in the analytic domain with editable grade + target elevation', () => {
    const { host, root } = mount(elevationGroup(), () => true);
    try {
      const method = host.querySelector('[aria-label="Grading method"]') as HTMLSelectElement | null;
      expect(method?.value).toBe('elevation');
      const elevation = host.querySelector('[aria-label="Target elevation"]') as HTMLInputElement | null;
      expect(elevation).not.toBeNull();
      expect(elevation?.value).toBe('98');
      expect(host.querySelector('[aria-label="Target distance"]')).toBeNull();
    } finally {
      unmount(host, root);
    }
  });

  it('commits an edited distance override and resets it in one transaction each', () => {
    const calls: CadGradingGroupShellCommand[] = [];
    const { host, root } = mount(distanceOverrideGroup(), (command) => {
      calls.push(command);
      return true;
    });
    try {
      // Edit the target distance, then override course 1 with it.
      const distance = host.querySelector('[aria-label="Target distance"]') as HTMLInputElement;
      setInput(distance, '30');
      act(() => {
        (host.querySelectorAll('input[type="checkbox"]')[0] as HTMLInputElement).click();
      });
      act(() => {
        (host.querySelector('[data-cad-grading-group-criteria-apply-selected]') as HTMLButtonElement).click();
      });
      expect(calls).toHaveLength(1);
      const applied = calls[0];
      expect(applied.key).toBe('GROUP_SET_COURSE_CRITERIA');
      const criterion = applied.key === 'GROUP_SET_COURSE_CRITERIA' ? applied.criterion : null;
      expect(criterion).toEqual({ kind: 'distance', gradeRatio: -0.02, distance: 30 });
    } finally {
      unmount(host, root);
    }
    // Reset the course-2 override (selected) in a single command.
    const resets: CadGradingGroupShellCommand[] = [];
    const second = mount(distanceOverrideGroup(), (command) => {
      resets.push(command);
      return true;
    });
    try {
      act(() => {
        (second.host.querySelectorAll('input[type="checkbox"]')[1] as HTMLInputElement).click();
      });
      act(() => {
        (second.host.querySelector('[data-cad-grading-group-criteria-reset-selected]') as HTMLButtonElement).click();
      });
      expect(resets).toHaveLength(1);
      expect(resets[0]!.key).toBe('GROUP_RESET_COURSE_CRITERIA');
    } finally {
      unmount(second.host, second.root);
    }
  });

  it('commits an elevation override with the shared parser (no local 2-way parse)', () => {
    const calls: CadGradingGroupShellCommand[] = [];
    const { host, root } = mount(elevationGroup(), (command) => {
      calls.push(command);
      return true;
    });
    try {
      const elevation = host.querySelector('[aria-label="Target elevation"]') as HTMLInputElement;
      setInput(elevation, '101.5');
      act(() => {
        (host.querySelectorAll('input[type="checkbox"]')[0] as HTMLInputElement).click();
      });
      act(() => {
        (host.querySelector('[data-cad-grading-group-criteria-apply-selected]') as HTMLButtonElement).click();
      });
      expect(calls).toHaveLength(1);
      const criterion = calls[0]!.key === 'GROUP_SET_COURSE_CRITERIA' ? calls[0]!.criterion : null;
      expect(criterion).toEqual({ kind: 'elevation', gradeRatio: -0.02, targetElevation: 101.5 });
    } finally {
      unmount(host, root);
    }
  });
});

describe('truthful 4-way labels + analytic target values', () => {
  it('labels every criterion kind without fake fixed/cut/fill tags', () => {
    expect(courseCriterionTypeText({ kind: 'fixed', gradeRatio: -0.02 })).toBe('Surface Fixed');
    expect(courseCriterionTypeText({ kind: 'cut-fill', cutGradeRatio: 0.5, fillGradeRatio: -1 / 3 })).toBe(
      'Surface Cut/Fill',
    );
    expect(courseCriterionTypeText({ kind: 'distance', gradeRatio: -0.02, distance: 20 })).toBe('Distance');
    expect(courseCriterionTypeText({ kind: 'elevation', gradeRatio: -0.02, targetElevation: 98 })).toBe(
      'Elevation',
    );
  });

  it('carries the analytic target on member rows and dashes elsewhere', () => {
    const rows = buildCourseMemberRows(distanceOverrideGroup(), null);
    expect(rows[0]).toMatchObject({
      criterionType: 'Distance',
      fixedGrade: '—',
      cutGrade: '—',
      fillGrade: '—',
      targetValue: '20.000 m',
    });
    expect(rows[1]).toMatchObject({
      criterionSource: 'Override',
      criterionType: 'Distance',
      targetValue: '25.000 m',
    });
    const surface = buildCourseMemberRows(surfaceGroup(), null);
    expect(surface[0]).toMatchObject({
      criterionType: 'Surface Fixed',
      targetValue: '—',
    });
    const elevation = buildCourseMemberRows(elevationGroup(), null);
    expect(elevation[0]?.targetValue).toBe('98.000 m');
  });

  it('reports analytic rows with target text (never Cut/Fill wording)', () => {
    const report = buildGroupInquiryReport(
      distanceOverrideGroup(),
      'FL',
      '—',
      'CURRENT',
      'EXACT',
      {
        groupId: 'gg-20f1-distance',
        revision: 'ggrev1:fake',
        accuracy: 'EXACT',
        memberCount: 2,
        cornerCount: 0,
        memberRegions: [],
        corners: [],
        daylightPoints: [],
        gradingMesh: { points: [], triangles: [] },
        sourceLength: 200,
        gradingPlanArea: 100,
        grading3dArea: 101,
        minProjectionDistance: 20,
        maxProjectionDistance: 25,
        meanProjectionDistance: 22.5,
        cutSourceLength: 0,
        fillSourceLength: 0,
        tiedSourceLength: 0,
        candidateTriangleCount: 0,
        intersectionSegmentCount: 0,
        multipleSolutionCount: 0,
        diagnostics: [],
      },
    );
    expect(report).toContain('Default Distance · effective Grade -2.000% → Distance 20.000 m · fixed — · cut — · fill — · target 20.000 m');
    expect(report).toContain('Override Distance · effective Grade -2.000% → Distance 25.000 m · fixed — · cut — · fill — · target 25.000 m');
    expect(report).not.toContain('Cut/Fill');
  });

  it('emits the documented Target Value CSV column', () => {
    const csv = buildGroupCsv(
      distanceOverrideGroup(),
      'CURRENT',
      'EXACT',
      {
        groupId: 'gg-20f1-distance',
        revision: 'ggrev1:fake',
        accuracy: 'EXACT',
        memberCount: 2,
        cornerCount: 0,
        memberRegions: [],
        corners: [],
        daylightPoints: [],
        gradingMesh: { points: [], triangles: [] },
        sourceLength: 200,
        gradingPlanArea: 100,
        grading3dArea: 101,
        minProjectionDistance: 20,
        maxProjectionDistance: 25,
        meanProjectionDistance: 22.5,
        cutSourceLength: 0,
        fillSourceLength: 0,
        tiedSourceLength: 0,
        candidateTriangleCount: 0,
        intersectionSegmentCount: 0,
        multipleSolutionCount: 0,
        diagnostics: [],
      },
    );
    const lines = csv.split('\n');
    const header = lines.findIndex((line) =>
      line.startsWith(
        'Course,From,To,Criterion Source,Criterion Type,Effective,Fixed Grade,Cut Grade,Fill Grade,Target Value,Classification,Source Length,Grading Area',
      ),
    );
    expect(header).toBeGreaterThan(-1);
    expect(lines[header + 1]).toContain('Default,Distance,Grade -2.000% → Distance 20.000 m,—,—,—,20.000 m');
    expect(lines[header + 2]).toContain('Override,Distance,Grade -2.000% → Distance 25.000 m,—,—,—,25.000 m');
  });
});
