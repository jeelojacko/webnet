import { describe, expect, it } from 'vitest';
import { createBlankCadDrawingDocument } from '../src/engine/cad/cadDrawingFile';
import { createCadHistoryState, runCadCommand, undoCadHistory } from '../src/engine/cad/cadUndoRedo';
import {
  countLabelStyleRefs, countPointStyleRefs, describeDisplaySource, describeStyleDeleteGuard,
} from '../src/engine/cad/cadSurveyDisplayRefs';
import { backfillCadPointGroups } from '../src/engine/cad/cadPointGroups';
import { createDefaultCadPointLabelStyles } from '../src/engine/cad/cadPointLabelStyles';
import { createDefaultCadPointStyles } from '../src/engine/cad/cadPointStyles';
import { buildCadSurveySnapshot } from '../src/cad-app/shell/cadSurveySnapshot';
import type { CadCommand } from '../src/engine/cad/cadTransactions.types';
import type { CadProject, CadSurveyPointEntity } from '../src/engine/cad/cadTypes';

const baseProject = (): CadProject => {
  const doc = createBlankCadDrawingDocument({ units: 'm' });
  const point = (id: string, stationId: string, extra: Partial<CadSurveyPointEntity> = {}): CadSurveyPointEntity => ({
    id,
    type: 'survey-point',
    layerId: doc.project.layers[0]?.id ?? 'general',
    visible: true,
    locked: false,
    stationId,
    x: 10,
    y: 20,
    z: 100,
    pointClass: 'free',
    source: 'parsed-input',
    description: 'Tree',
    featureCode: 'VEG',
    ...extra,
  });
  return {
    ...doc.project,
    pointStyles: createDefaultCadPointStyles(),
    labelStyles: createDefaultCadPointLabelStyles(),
    pointGroups: backfillCadPointGroups(undefined),
    entities: [point('pt:1', '1'), point('pt:2', '2', { pointClass: 'control' })],
  };
};

const run = (project: CadProject, command: CadCommand): CadProject | null => {
  const next = runCadCommand(createCadHistoryState(project), command);
  return next.present.project === project ? null : next.present.project;
};

describe('phase 18D survey display commands', () => {
  it('batch-sets and clears manual overrides, leaving coordinates alone', () => {
    const before = baseProject();
    const set = run(before, {
      key: 'SURVEY_POINT_OVERRIDE',
      entityIds: ['pt:1', 'pt:2'],
      pointStyleOverrideId: 'point-style-control',
      pointLabelStyleOverrideId: 'point-label-none',
    });
    expect(set).not.toBeNull();
    for (const id of ['pt:1', 'pt:2']) {
      const point = set!.entities.find((entry) => entry.id === id) as CadSurveyPointEntity;
      expect(point.pointStyleOverrideId).toBe('point-style-control');
      expect(point.pointLabelStyleOverrideId).toBe('point-label-none');
      expect(point.x).toBe(10);
      expect(point.y).toBe(20);
    }
    const cleared = run(set!, {
      key: 'SURVEY_POINT_OVERRIDE',
      entityIds: ['pt:1', 'pt:2'],
      pointStyleOverrideId: null,
    });
    expect(cleared).not.toBeNull();
    const point = cleared!.entities.find((entry) => entry.id === 'pt:1') as CadSurveyPointEntity;
    expect(point.pointStyleOverrideId).toBeUndefined();
    // Label override untouched by a point-only clear (undefined = leave).
    expect(point.pointLabelStyleOverrideId).toBe('point-label-none');
  });

  it('rejects unknown override ids and empty batches', () => {
    const before = baseProject();
    expect(
      run(before, { key: 'SURVEY_POINT_OVERRIDE', entityIds: ['pt:1'], pointStyleOverrideId: 'nope' }),
    ).toBeNull();
    expect(run(before, { key: 'SURVEY_POINT_OVERRIDE', entityIds: [] })).toBeNull();
  });

  it('blocks style delete while referenced; rewire deletes cleanly', () => {
    const before = baseProject();
    const refs = countPointStyleRefs(before, undefined, 'point-style-standard');
    void refs;
    // Reference the style from a point override first.
    const referenced = run(before, {
      key: 'SURVEY_POINT_OVERRIDE',
      entityIds: ['pt:1'],
      pointStyleOverrideId: 'point-style-control',
    })!;
    expect(
      run(referenced, { key: 'SURVEY_STYLE_TABLE', table: 'point', op: 'delete', styleId: 'point-style-control' }),
    ).toBeNull();
    const rewired = run(referenced, {
      key: 'SURVEY_STYLE_TABLE',
      table: 'point',
      op: 'delete',
      styleId: 'point-style-control',
      replacementId: 'point-style-standard',
    });
    expect(rewired).not.toBeNull();
    expect(rewired!.pointStyles?.some((style) => style.id === 'point-style-control')).toBe(false);
    const point = rewired!.entities.find((entry) => entry.id === 'pt:1') as CadSurveyPointEntity;
    expect(point.pointStyleOverrideId).toBe('point-style-standard');
  });

  it('rejects deleting the last style in a table', () => {
    const before: CadProject = {
      ...baseProject(),
      pointStyles: [{ id: 'only', name: 'Only', markerSymbolId: 'x', displayMarker: true }],
    };
    expect(
      run(before, { key: 'SURVEY_STYLE_TABLE', table: 'point', op: 'delete', styleId: 'only' }),
    ).toBeNull();
  });

  it('creates/renames styles with unique-name enforcement', () => {
    const before = baseProject();
    const symbolId = before.styleLibrary.pointSymbols[0]!.id;
    const created = run(before, {
      key: 'SURVEY_STYLE_TABLE',
      table: 'point',
      op: 'create',
      style: { id: 'point-style-x', name: 'X', markerSymbolId: symbolId, displayMarker: true },
    });
    expect(created?.pointStyles?.some((style) => style.id === 'point-style-x')).toBe(true);
    // Duplicate name (case-insensitive) is rejected.
    expect(
      run(created!, {
        key: 'SURVEY_STYLE_TABLE',
        table: 'point',
        op: 'rename',
        styleId: 'point-style-x',
        name: 'control point',
      }),
    ).toBeNull();
    // Unknown marker symbol is rejected.
    expect(
      run(created!, {
        key: 'SURVEY_STYLE_TABLE',
        table: 'point',
        op: 'create',
        style: { id: 'point-style-y', name: 'Y', markerSymbolId: 'nope', displayMarker: true },
      }),
    ).toBeNull();
  });

  it('rejects invalid group queries and reorders by priority move', () => {
    const before = baseProject();
    expect(
      run(before, {
        key: 'SURVEY_GROUP_TABLE',
        op: 'create',
        group: { id: 'g-bad', name: 'Bad', query: { descriptionPattern: 'a[b' }, priority: 5 },
      }),
    ).toBeNull();
    const withGroup = run(before, {
      key: 'SURVEY_GROUP_TABLE',
      op: 'create',
      group: { id: 'g-veg', name: 'Veg', query: { featureCodePattern: 'VEG' }, priority: 5 },
    })!;
    const movedOnce = run(withGroup, { key: 'SURVEY_GROUP_TABLE', op: 'move', groupId: 'g-veg', direction: 'up' })!;
    const onceOrder = [...(movedOnce.pointGroups ?? [])].sort((a, b) => a.priority - b.priority).map((group) => group.id);
    expect(onceOrder[1]).toBe('g-veg');
    const moved = run(movedOnce, { key: 'SURVEY_GROUP_TABLE', op: 'move', groupId: 'g-veg', direction: 'up' })!;
    const order = [...(moved.pointGroups ?? [])].sort((a, b) => a.priority - b.priority).map((group) => group.id);
    expect(order[0]).toBe('g-veg');
    // Group delete is always allowed (display-only rules).
    const deleted = run(moved, { key: 'SURVEY_GROUP_TABLE', op: 'delete', groupId: 'g-veg' })!;
    expect(deleted.pointGroups?.some((group) => group.id === 'g-veg')).toBe(false);
  });

  it('undoes a survey override through the shared history', () => {
    const before = baseProject();
    const state = runCadCommand(createCadHistoryState(before), {
      key: 'SURVEY_POINT_OVERRIDE',
      entityIds: ['pt:1'],
      pointStyleOverrideId: 'point-style-control',
    });
    expect(state).not.toBe(createCadHistoryState(before));
    const undone = undoCadHistory(state);
    const point = undone.present.project.entities.find((entry) => entry.id === 'pt:1') as CadSurveyPointEntity;
    expect(point.pointStyleOverrideId).toBeUndefined();
  });

  it('describes sources and delete guards for the UI', () => {
    const groups = backfillCadPointGroups(undefined);
    expect(describeDisplaySource('manual-override', groups)).toBe('Manual override');
    expect(describeDisplaySource('base', groups)).toBe('Base style');
    expect(describeDisplaySource('drawing-default', groups)).toBe('Drawing default');
    expect(describeDisplaySource(`point-group:${groups[0]!.id}`, groups)).toBe(`Point Group "${groups[0]!.name}"`);
    const blocked = describeStyleDeleteGuard('point', 'Control Point', { points: 2, groups: 1, catalogDefinitions: 0, total: 3 }, 9, undefined);
    expect(blocked.blocked).toBe(true);
    expect(blocked.message).toContain('2 points');
    expect(describeStyleDeleteGuard('point', 'Control Point', { points: 0, groups: 0, catalogDefinitions: 0, total: 0 }, 1, undefined).blocked).toBe(true);
    expect(describeStyleDeleteGuard('point', 'X', { points: 0, groups: 0, catalogDefinitions: 0, total: 0 }, 9, undefined).blocked).toBe(false);
  });

  it('counts label refs across points, groups, and catalog defs', () => {
    const before = baseProject();
    expect(countLabelStyleRefs(before, undefined, 'point-label-point-number').points).toBe(0);
    const catalog = {
      id: 'c',
      name: 'C',
      version: '1',
      definitions: [{ id: 'd1', code: 'VEG', pointStyleId: 'point-style-control', labelStyleId: 'point-label-point-number' }],
      aliases: [],
    };
    expect(countLabelStyleRefs(before, catalog as never, 'point-label-point-number').catalogDefinitions).toBe(1);
    expect(countPointStyleRefs(before, catalog as never, 'point-style-control').catalogDefinitions).toBe(1);
  });

  it('builds snapshot display facts with effective names and source lines', () => {
    const withOverride = run(baseProject(), {
      key: 'SURVEY_POINT_OVERRIDE',
      entityIds: ['pt:1'],
      pointStyleOverrideId: 'point-style-control',
    })!;
    const snapshot = buildCadSurveySnapshot(withOverride, ['pt:1']);
    expect(snapshot.pointCount).toBe(2);
    expect(snapshot.groups.find((group) => group.name === 'All Points')?.memberCount).toBe(2);
    const info = snapshot.selected[0]!;
    expect(info.effectivePointStyleName).toBe('Control Point');
    expect(info.pointStyleSourceText).toBe('Manual override');
    expect(info.matchingGroupNames).toContain('All Points');
    expect(snapshot.table).toHaveLength(2);
    expect(snapshot.tableTruncated).toBe(false);
  });
});
