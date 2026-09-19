import { describe, expect, it } from 'vitest';

import {
  createBlankCadDrawingDocument,
  parseCadDrawingFile,
  serializeCadDrawingFile,
} from '../src/engine/cad/cadDrawingFile';
import { cloneCadProject } from '../src/engine/cad/cadPersistence';
import { backfillCadSectionStyles, seedCadSectionStyles } from '../src/engine/cad/cadSectionTypes';
import { createCadSelectionState } from '../src/engine/cad/cadSelection';
import {
  executeCadCommand,
} from '../src/engine/cad/cadTransactions';
import type { CadCommand, CadWorkspaceSnapshot } from '../src/engine/cad/cadTransactions.types';
import type {
  CadAlignmentElement,
  CadProject,
  CadSampleLineGroup,
  CadSectionView,
} from '../src/engine/cad/cadTypes';

const line = (x0: number, y0: number, x1: number, y1: number): CadAlignmentElement => ({
  kind: 'line',
  start: { x: x0, y: y0 },
  end: { x: x1, y: y1 },
});

const projectWithSections = (): CadProject => {
  const drawing = createBlankCadDrawingDocument({ name: 'Sections', units: 'm' });
  const sampleLineGroups: CadSampleLineGroup[] = [
    {
      id: 'grp-1',
      name: 'Corridor',
      alignmentEntityId: 'align-1',
      layerId: 'general',
      surfaceSources: [
        { surfaceId: 'surf-1', sectionStyleId: 'section-style-existing' },
        { surfaceId: 'surf-2', sectionStyleId: 'section-style-proposed' },
      ],
      sampleLines: [
        { id: 'line-1', rawStation: 2, leftWidth: 5, rightWidth: 5, skewDeg: 0 },
        { id: 'line-2', rawStation: 4, leftWidth: 6, rightWidth: 6, skewDeg: 10, manualName: 'Culvert' },
        { id: 'line-3', rawStation: 6, leftWidth: 5, rightWidth: 5, skewDeg: 0 },
      ],
      areaComparison: { baseSurfaceId: 'surf-1', comparisonSurfaceId: 'surf-2' },
    },
  ];
  const sectionViews: CadSectionView[] = [
    {
      id: 'view-1',
      name: 'Section View 1',
      sampleLineGroupId: 'grp-1',
      sampleLineId: 'line-1',
      sourceSurfaceIds: ['surf-1', 'surf-2'],
      insertionX: 100,
      insertionY: 200,
      horizontalScale: 1,
      verticalExaggeration: 5,
      datumMode: 'auto',
      layerId: 'general',
    },
    {
      id: 'view-2',
      name: 'Section View 2',
      sampleLineGroupId: 'grp-1',
      sampleLineId: 'line-2',
      sourceSurfaceIds: ['surf-1'],
      insertionX: 300,
      insertionY: 0,
      horizontalScale: 2,
      verticalExaggeration: 10,
      datumMode: 'explicit',
      datumElevation: 3,
      showCutFill: true,
      layerId: 'general',
    },
    {
      id: 'view-3',
      name: 'Section View 3',
      sampleLineGroupId: 'grp-1',
      sampleLineId: 'line-3',
      sourceSurfaceIds: ['surf-2'],
      insertionX: 0,
      insertionY: 400,
      horizontalScale: 1,
      verticalExaggeration: 1,
      datumMode: 'auto',
      layerId: 'general',
    },
  ];
  return {
    ...drawing.project,
    entities: [
      {
        id: 'align-1',
        type: 'alignment',
        layerId: 'general',
        visible: true,
        locked: false,
        name: 'CL',
        elements: [line(0, 5, 10, 5)],
        startStation: 0,
      },
    ],
    surfaces: [
      { id: 'surf-1', name: 'Existing', definition: { pointSource: { kind: 'points', pointEntityIds: [] } }, cachedRevision: null },
      { id: 'surf-2', name: 'Design', definition: { pointSource: { kind: 'points', pointEntityIds: [] } }, cachedRevision: null },
    ],
    sampleLineGroups,
    sectionStyles: backfillCadSectionStyles(undefined),
    sectionViews,
  };
};

describe('section wncad persistence', () => {
  it('round-trips 3 lines / 2 sources / 3 views exactly; derived fields never persist', () => {
    const project = projectWithSections();
    const drawing = { ...createBlankCadDrawingDocument({ name: 'x', units: 'm' }), project };
    const serialized = serializeCadDrawingFile(drawing);
    const parsed = parseCadDrawingFile(serialized);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.drawing.project.sampleLineGroups).toEqual(project.sampleLineGroups);
    expect(parsed.drawing.project.sectionStyles).toEqual(project.sectionStyles);
    expect(parsed.drawing.project.sectionViews).toEqual(project.sectionViews);
    expect(parsed.drawing.project.sampleLineGroups![0]!.sampleLines).toHaveLength(3);
    expect(parsed.drawing.project.sampleLineGroups![0]!.surfaceSources).toHaveLength(2);
    expect(parsed.drawing.project.sectionViews).toHaveLength(3);
    // No extracted geometry, revisions, or statuses may leak into the file.
    expect(serialized).not.toContain('coveredWidth');
    expect(serialized).not.toContain('secl1:');
    expect(serialized).not.toContain('secg1:');
  });

  it('legacy files (section tables absent) open with empty collections and seed styles', () => {
    const project = projectWithSections();
    const drawing = { ...createBlankCadDrawingDocument({ name: 'x', units: 'm' }), project };
    const raw = JSON.parse(serializeCadDrawingFile(drawing)) as Record<string, unknown>;
    const rawProject = raw['project'] as Record<string, unknown>;
    delete rawProject['sampleLineGroups'];
    delete rawProject['sectionStyles'];
    delete rawProject['sectionViews'];
    const parsed = parseCadDrawingFile(JSON.stringify(raw));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.drawing.project.sampleLineGroups).toEqual([]);
    expect(parsed.drawing.project.sectionViews).toEqual([]);
    expect(parsed.drawing.project.sectionStyles).toEqual(seedCadSectionStyles());
  });

  it('blank drawings seed empty groups/views with the deterministic styles', () => {
    const drawing = createBlankCadDrawingDocument({ name: 'Blank', units: 'm' });
    expect(drawing.project.sampleLineGroups).toEqual([]);
    expect(drawing.project.sectionViews).toEqual([]);
    expect(drawing.project.sectionStyles?.map((style) => style.id)).toEqual(
      seedCadSectionStyles().map((style) => style.id),
    );
  });

  it('save-as isolation: a cloned project never shares section tables or lines', () => {
    const project = projectWithSections();
    const clone = cloneCadProject(project);
    clone.sampleLineGroups![0]!.name = 'Mutated';
    clone.sampleLineGroups![0]!.sampleLines[0]!.rawStation = 999;
    clone.sectionViews![0]!.name = 'Mutated View';
    expect(project.sampleLineGroups![0]!.name).toBe('Corridor');
    expect(project.sampleLineGroups![0]!.sampleLines[0]!.rawStation).toBe(2);
    expect(project.sectionViews![0]!.name).toBe('Section View 1');
  });
});

describe('section transactions', () => {
  const snapshotOf = (project: CadProject): CadWorkspaceSnapshot => ({
    project,
    selection: createCadSelectionState(project),
  });

  const run = (
    snapshot: CadWorkspaceSnapshot,
    command: CadCommand,
  ): { snapshot: CadWorkspaceSnapshot; label: string } => {
    const result = executeCadCommand(snapshot, command);
    expect(result, command.key).not.toBeNull();
    expect(result!.commandState.key).toBe(command.key);
    return { snapshot: result!.nextSnapshot, label: result!.transactionLabel };
  };

  it('group/source/line/view CRUD commits undoable transactions', () => {
    const project = {
      ...projectWithSections(),
      sampleLineGroups: [] as CadSampleLineGroup[],
      sectionViews: [] as CadSectionView[],
    };
    let snapshot = snapshotOf(project);
    snapshot = run(snapshot, { key: 'SAMPLE_GROUP_CREATE', name: 'Road', alignmentEntityId: 'align-1' }).snapshot;
    const groupId = snapshot.project.sampleLineGroups![0]!.id;
    snapshot = run(snapshot, { key: 'SECTION_SOURCE_ADD', groupId, surfaceId: 'surf-1' }).snapshot;
    // No duplicate surface.
    expect(executeCadCommand(snapshot, { key: 'SECTION_SOURCE_ADD', groupId, surfaceId: 'surf-1' })).toBeNull();
    snapshot = run(snapshot, { key: 'SECTION_SOURCE_ADD', groupId, surfaceId: 'surf-2', sectionStyleId: 'section-style-proposed' }).snapshot;
    snapshot = run(snapshot, { key: 'SAMPLE_LINE_ADD', groupId, rawStation: 2, leftWidth: 5, rightWidth: 5 }).snapshot;
    snapshot = run(snapshot, { key: 'SAMPLE_LINE_ADD', groupId, stationText: '0+004', leftWidth: 5, rightWidth: 5 }).snapshot;
    snapshot = run(snapshot, { key: 'SAMPLE_LINE_ADD_INTERVAL', groupId, rawStart: 6, rawEnd: 8, interval: 1, leftWidth: 5, rightWidth: 5 }).snapshot;
    const group = snapshot.project.sampleLineGroups![0]!;
    expect(group.sampleLines).toHaveLength(5);
    // Equivalent raw+params dedupe.
    expect(
      executeCadCommand(snapshot, { key: 'SAMPLE_LINE_ADD', groupId, rawStation: 2, leftWidth: 5, rightWidth: 5 }),
    ).toBeNull();
    const lineId = group.sampleLines[0]!.id;
    snapshot = run(snapshot, { key: 'SAMPLE_LINE_UPDATE', groupId, lineId, patch: { leftWidth: 9 } }).snapshot;
    expect(snapshot.project.sampleLineGroups![0]!.sampleLines[0]!.leftWidth).toBe(9);
    snapshot = run(snapshot, {
      key: 'SECTION_VIEW_CREATE',
      sampleLineGroupId: groupId,
      sampleLineId: lineId,
      layerId: 'general',
    }).snapshot;
    expect(snapshot.project.sectionViews).toHaveLength(1);
    const viewId = snapshot.project.sectionViews![0]!.id;
    snapshot = run(snapshot, { key: 'SECTION_VIEW_UPDATE', viewId, patch: { verticalExaggeration: 10 } }).snapshot;
    expect(snapshot.project.sectionViews![0]!.verticalExaggeration).toBe(10);
    snapshot = run(snapshot, { key: 'SAMPLE_LINE_DELETE', groupId, lineId }).snapshot;
    expect(snapshot.project.sampleLineGroups![0]!.sampleLines).toHaveLength(4);
  });

  it('deleting a group keeps its alignment/surfaces and leaves views reference-safe', () => {
    const snapshot = snapshotOf(projectWithSections());
    const result = executeCadCommand(snapshot, { key: 'SAMPLE_GROUP_DELETE', groupId: 'grp-1' });
    expect(result).not.toBeNull();
    const next = result!.nextSnapshot.project;
    expect(next.sampleLineGroups).toEqual([]);
    expect(next.entities.some((entity) => entity.id === 'align-1')).toBe(true);
    expect(next.surfaces).toHaveLength(2);
    // Views survive with their binding (status derives BROKEN_REFERENCE).
    expect(next.sectionViews).toHaveLength(3);
    expect(next.sectionViews![0]!.sampleLineGroupId).toBe('grp-1');
  });

  it('blocked edits (unknown alignment/surface/style) commit nothing', () => {
    const snapshot = snapshotOf(projectWithSections());
    expect(
      executeCadCommand(snapshot, { key: 'SAMPLE_GROUP_CREATE', name: 'Bad', alignmentEntityId: 'nope' }),
    ).toBeNull();
    expect(
      executeCadCommand(snapshot, {
        key: 'SECTION_SOURCE_ADD',
        groupId: 'grp-1',
        surfaceId: 'missing-surface',
      }),
    ).toBeNull();
    expect(
      executeCadCommand(snapshot, {
        key: 'SECTION_SOURCE_ADD',
        groupId: 'grp-1',
        surfaceId: 'surf-1',
        sectionStyleId: 'missing-style',
      }),
    ).toBeNull();
  });
});
