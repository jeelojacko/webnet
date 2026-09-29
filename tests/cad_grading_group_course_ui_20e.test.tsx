/** @vitest-environment jsdom */
/**
 * Phase 20E Wave-2A UI slice — per-course criteria editor + reporting pins.
 *
 * Registry (GRADINGGROUPCRITERIA/GGCRITERIA) routing, snapshot override
 * counts, criteria-panel table + one-transaction apply + default preview,
 * report/CSV member table (no misleading values in irrelevant columns),
 * inquiry course/corner detail, Toolspace criteria line, Properties
 * default/override/member rows, and the Design Patch interior badge.
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { describe, expect, it } from 'vitest';

import {
  CAD_SHELL_COMMANDS,
  resolveShellCommandText,
} from '../src/cad-app/shell/cadCommandRegistry';
import {
  GRADINGGROUP_SHELL_KEYS,
  executeGradingGroupShellCommand,
} from '../src/cad-app/shell/cadGradingGroupShell';
import { buildCadGradingGroupSnapshot } from '../src/cad-app/shell/cadGradingGroupSnapshot';
import {
  buildGroupCsv,
  buildGroupInquiryReport,
} from '../src/cad-app/shell/cadGradingGroupReport';
import { CadGradingGroupManager } from '../src/cad-app/shell/CadGradingGroupManager';
import { CadGradingGroupCriteriaPanel } from '../src/cad-app/shell/CadGradingGroupCriteriaPanel';
import type { CadGradingGroupShellCommand } from '../src/cad-app/shell/cadGradingGroupShell';
import { GradingGroupsNode } from '../src/cad-app/shell/CadGradingGroupToolspace';
import { GradingGroupPropertiesBlock } from '../src/cad-app/shell/CadGradingGroupProperties';
import { designPatchInteriorText } from '../src/cad-app/shell/cadDesignPatchInterior';
import { createGroupDefinition, setCourseCriteriaOverrides } from '../src/engine/cad/grading/gradingGroupAuthoring';
import type { CadGradingGroup, CadGradingGroupResult } from '../src/engine/cad/grading/gradingGroupTypes';
import type { CadShellActions, CadWorkspaceSnapshot } from '../src/cad-app/shell/cadShellTypes';

const courses = [
  { vertexAId: 'fl:a', vertexBId: 'fl:b' },
  { vertexAId: 'fl:b', vertexBId: 'fl:c' },
  { vertexAId: 'fl:c', vertexBId: 'fl:d' },
];

const baseGroup = (): CadGradingGroup => {
  const created = createGroupDefinition({
    id: 'gg-20e-ui',
    name: 'UI Group',
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

/** Group with course 2 overridden to cut/fill. */
const mixedGroup = (): CadGradingGroup => {
  const applied = setCourseCriteriaOverrides(baseGroup(), [{ vertexAId: 'fl:b', vertexBId: 'fl:c' }], {
    kind: 'cut-fill',
    cutGradeRatio: 0.5,
    fillGradeRatio: -1 / 3,
  });
  if (!applied.ok) throw new Error(applied.error);
  return applied.value;
};

const fakeResult = (): CadGradingGroupResult => ({
  groupId: 'gg-20e-ui',
  revision: 'ggrev1:fake',
  accuracy: 'EXACT',
  memberCount: 3,
  cornerCount: 2,
  memberRegions: [
    { memberIndex: 0, classification: 'FILL', stationSpan: [0, 100] },
    { memberIndex: 1, classification: 'CUT', stationSpan: [0, 100] },
    { memberIndex: 2, classification: 'FILL', stationSpan: [0, 50] },
  ],
  corners: [
    { cornerIndex: 0, vertexId: 'fl:b', classification: 'OVERLAP', miterExtent: 28.284, diagnostics: [] },
    { cornerIndex: 1, vertexId: 'fl:c', classification: 'GAP', diagnostics: [] },
  ],
  daylightPoints: [],
  gradingMesh: { points: [], triangles: [] },
  sourceLength: 250,
  gradingPlanArea: 1000,
  grading3dArea: 1001,
  minProjectionDistance: 1,
  maxProjectionDistance: 2,
  meanProjectionDistance: 1.5,
  cutSourceLength: 100,
  fillSourceLength: 150,
  tiedSourceLength: 0,
  candidateTriangleCount: 0,
  intersectionSegmentCount: 0,
  multipleSolutionCount: 0,
  diagnostics: [],
});

describe('criteria command registration', () => {
  it('registers GRADINGGROUPCRITERIA with the GGCRITERIA alias and routes to the criteria editor', () => {
    const def = CAD_SHELL_COMMANDS.find((entry) => entry.key === 'GRADINGGROUPCRITERIA');
    expect(def).toBeDefined();
    expect(def?.aliases).toContain('GGCRITERIA');
    expect(resolveShellCommandText('GGCRITERIA')?.key).toBe('GRADINGGROUPCRITERIA');
    expect(resolveShellCommandText('GRADINGGROUPCRITERIA')?.key).toBe('GRADINGGROUPCRITERIA');
    expect(GRADINGGROUP_SHELL_KEYS.has('GRADINGGROUPCRITERIA')).toBe(true);
    const opened: Array<string | undefined> = [];
    const actions = {
      openGradingGroupManager: (_id?: string, tab?: 'definition' | 'criteria' | 'inquiry') => {
        opened.push(tab);
      },
    } as unknown as CadShellActions;
    expect(executeGradingGroupShellCommand('GRADINGGROUPCRITERIA', actions, null, { groupId: 'g' })).toBe(true);
    expect(opened).toEqual(['criteria']);
  });
});

describe('criteria panel dispatch', () => {
  const mockRun = () => {
    const calls: CadGradingGroupShellCommand[] = [];
    const run = (command: CadGradingGroupShellCommand): boolean => {
      calls.push(command);
      return true;
    };
    return { run, calls };
  };
  const mount = (group: CadGradingGroup, run: (_command: CadGradingGroupShellCommand) => boolean) => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root: Root = createRoot(host);
    act(() => {
      root.render(
        <CadGradingGroupCriteriaPanel group={group} run={run} onNotice={() => {}} />,
      );
    });
    return { host, root };
  };

  it('renders the course table with effective criterion + Default/Override source', () => {
    const { run } = mockRun();
    const { host, root } = mount(mixedGroup(), run);
    try {
      const rows = host.querySelectorAll('[data-cad-grading-group-criteria-row]');
      expect(rows).toHaveLength(3);
      expect(rows[0]?.textContent).toContain('Course 1');
      expect(rows[0]?.textContent).toContain('Default');
      expect(rows[1]?.textContent).toContain('Course 2');
      expect(rows[1]?.textContent).toContain('Override');
      expect(rows[1]?.textContent).toContain('Surface Cut/Fill');
      expect(host.querySelector('[data-cad-grading-group-criteria-default]')?.textContent).toContain('Overrides: 1');
    } finally {
      act(() => { root.unmount(); });
      host.remove();
    }
  });

  it('applies one criterion to every selected course in a single command (one undo)', () => {
    const { run, calls } = mockRun();
    const { host, root } = mount(baseGroup(), run);
    try {
      const boxes = host.querySelectorAll('input[type="checkbox"]');
      expect(boxes).toHaveLength(3);
      act(() => {
        (boxes[0] as HTMLInputElement).click();
        (boxes[2] as HTMLInputElement).click();
      });
      act(() => {
        (host.querySelector('[data-cad-grading-group-criteria-apply-selected]') as HTMLButtonElement).click();
      });
      expect(calls).toHaveLength(1);
      const command = calls[0]!;
      expect(command.key).toBe('GROUP_SET_COURSE_CRITERIA');
      expect(command.key === 'GROUP_SET_COURSE_CRITERIA' ? command.courses : []).toHaveLength(2);
    } finally {
      act(() => { root.unmount(); });
      host.remove();
    }
  });

  it('previews the default change as affected followers with overrides remaining', () => {
    const { run, calls } = mockRun();
    const { host, root } = mount(mixedGroup(), run);
    try {
      // 2 default followers will change; the 1 override remains.
      expect(host.querySelector('[data-cad-grading-group-criteria-default-preview]')?.textContent).toContain(
        'New default affects 2 courses; 1 override remain.',
      );
      act(() => {
        (host.querySelector('[data-cad-grading-group-criteria-set-default]') as HTMLButtonElement).click();
      });
      expect(calls).toHaveLength(1);
      expect(calls[0]!.key).toBe('GROUP_EDIT_CRITERIA');
    } finally {
      act(() => { root.unmount(); });
      host.remove();
    }
  });
});

describe('member reporting', () => {
  it('lists per-course source/type/grades with dashes in irrelevant columns', () => {
    const report = buildGroupInquiryReport(mixedGroup(), 'FL', 'Target', 'CURRENT', 'EXACT', fakeResult());
    expect(report).toContain('Course 1');
    expect(report).toContain('Default Surface Fixed');
    expect(report).toContain('Course 2');
    expect(report).toContain('Override Surface Cut/Fill');
    // Fixed member: cut/fill columns carry no misleading values.
    expect(report).toContain('fixed -2.000% · cut — · fill —');
    // Cut/fill member: fixed column carries no misleading value.
    expect(report).toContain('fixed — · cut +50.000% · fill -33.333%');
    expect(report).toContain('FILL · source 100.000 m');
  });

  it('emits the CSV member table between corners and daylight stations', () => {
    const csv = buildGroupCsv(mixedGroup(), 'CURRENT', 'EXACT', fakeResult());
    const lines = csv.split('\n');
    const header = lines.findIndex((line) =>
      line.startsWith('Course,From,To,Criterion Source,Criterion Type,Fixed Grade,Cut Grade,Fill Grade,Target Value,Classification,Source Length,Grading Area'),
    );
    expect(header).toBeGreaterThan(-1);
    expect(lines[header + 1]).toContain('Course 1,');
    expect(lines[header + 1]).toContain('Default,Surface Fixed');
    expect(lines[header + 2]).toContain('Override,Surface Cut/Fill');
    // Grading area is group-level: never a per-member value.
    expect(lines[header + 1]?.split(',').pop()).toBe('—');
    expect(lines[header + 3]).toContain('Course 3,');
  });
});

describe('toolspace + properties + manager criteria surface', () => {
  const snapshotOf = (group: CadGradingGroup) => {
    const groups = buildCadGradingGroupSnapshot(
      { gradingGroups: [group], entities: [], surfaces: [] } as never,
      null,
      null,
      group.id,
    );
    return { gradingGroups: groups } as unknown as CadWorkspaceSnapshot;
  };

  it('pins override counts in the snapshot row, toolspace, properties, and manager row', () => {
    const snapshot = snapshotOf(mixedGroup());
    const row = snapshot.gradingGroups!.groups[0]!;
    expect(row.overrideCount).toBe(1);
    expect(snapshotOf(baseGroup()).gradingGroups!.groups[0]!.overrideCount).toBe(0);

    const host = document.createElement('div');
    document.body.appendChild(host);
    const root: Root = createRoot(host);
    act(() => {
      root.render(
        <>
          <GradingGroupsNode snapshot={snapshot} actions={null} />
          <GradingGroupPropertiesBlock row={row} />
        </>,
      );
    });
    try {
      expect(host.querySelector('[data-cad-grading-group-criteria-summary]')?.textContent).toContain('Overrides:1');
      const props = host.querySelector('[data-cad-grading-group-properties]')?.textContent ?? '';
      expect(props).toContain('Override Count');
      expect(props).toContain('Member Effective');
      expect(props).toContain('Member Source');
    } finally {
      act(() => { root.unmount(); });
      host.remove();
    }
  });

  it('mounts the criteria editor in the manager criteria tab with course/corner inquiry detail', () => {
    const snapshot = snapshotOf(mixedGroup());
    const actions = { runGradingGroupCommand: () => true } as unknown as CadShellActions;
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root: Root = createRoot(host);
    act(() => {
      root.render(
        <CadGradingGroupManager snapshot={snapshot} actions={actions} initialTab="criteria" onClose={() => {}} />,
      );
    });
    try {
      expect(host.querySelector('[data-cad-grading-group-criteria]')).not.toBeNull();
      // Manager row shows the group default + override count only.
      expect(host.querySelector('[data-cad-grading-group-table]')?.textContent).toContain('Overrides:1');
    } finally {
      act(() => { root.unmount(); });
      host.remove();
    }
    // Inquiry tab: course detail shows Default/Override + effective slope.
    const host2 = document.createElement('div');
    document.body.appendChild(host2);
    const root2: Root = createRoot(host2);
    act(() => {
      root2.render(
        <CadGradingGroupManager snapshot={snapshot} actions={actions} initialTab="inquiry" onClose={() => {}} />,
      );
    });
    try {
      const detail = host2.querySelector('[data-cad-grading-group-inquiry-course-detail]')?.textContent ?? '';
      expect(detail).toContain('Course 1');
      expect(detail).toContain('Default');
    } finally {
      act(() => { root2.unmount(); });
      host2.remove();
    }
  });
});

describe('design patch interior badge', () => {
  it('reports Flat / Planar / Undefined / missing without persisting anything', () => {
    expect(designPatchInteriorText(undefined)).toContain('Calculate the group first');
    expect(designPatchInteriorText([0, 0, 10, 20, 0, 10, 20, 20, 10, 0, 20, 10])).toBe('Flat (z = 10.000 m)');
    const planar = designPatchInteriorText([0, 0, 10, 20, 0, 10, 20, 20, 11, 0, 20, 11]);
    expect(planar.startsWith('Planar (slope')).toBe(true);
    expect(planar).toContain('aspect');
    expect(designPatchInteriorText([0, 0, 10, 20, 0, 10, 20, 20, 11, 0, 20, 10.1])).toContain(
      'Undefined — blocked (DESIGN_PATCH_NON_PLANAR_INTERIOR_UNDEFINED)',
    );
  });
});
