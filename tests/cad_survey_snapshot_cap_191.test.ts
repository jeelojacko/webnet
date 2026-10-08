import { describe, expect, it, vi } from 'vitest';
import { createBlankCadDrawingDocument } from '../src/engine/cad/cadDrawingFile';
import {
  backfillCadPointGroups,
  CONTROL_POINTS_GROUP_ID,
  createDefaultCadPointGroups,
  matchingPointGroups,
  resolveSurveyPointDisplay,
} from '../src/engine/cad/cadPointGroups';
import { describeDisplaySource } from '../src/engine/cad/cadSurveyDisplayRefs';
import {
  backfillCadPointLabelStyles,
  createDefaultCadPointLabelStyles,
  DEFAULT_CAD_POINT_LABEL_STYLE_ID,
} from '../src/engine/cad/cadPointLabelStyles';
import {
  backfillCadPointStyles,
  createDefaultCadPointStyles,
  DEFAULT_CAD_POINT_STYLE_ID,
} from '../src/engine/cad/cadPointStyles';
import {
  buildCadSurveySnapshot,
  SURVEY_POINT_TABLE_CAP,
} from '../src/cad-app/shell/cadSurveySnapshot';
import type { CadSurveyPointDisplayInfo, CadSurveySnapshot } from '../src/cad-app/shell/cadShellTypes';
import type {
  CadPointGroup,
  CadProject,
  CadSurveyPointEntity,
} from '../src/engine/cad/cadTypes';

/**
 * PERF-184 (#191): the point-cap fast path must be behavior-identical to the
 * previous "resolve every point then slice/filter" implementation while only
 * materializing the resolver for the table cap plus selected points beyond it.
 *
 * The module is mocked so `resolveSurveyPointDisplay` calls can be counted; the
 * mock delegates to the real resolver, so the parity oracle below stays exact.
 */
vi.mock('../src/engine/cad/cadPointGroups', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/engine/cad/cadPointGroups')>();
  return {
    ...actual,
    resolveSurveyPointDisplay: vi.fn(actual.resolveSurveyPointDisplay),
  };
});

const styleName = (names: Map<string, string>, id: string | undefined): string => {
  if (id == null) return 'Drawing default';
  return names.get(id) ?? `Unknown style (${id})`;
};

/** Exact pre-#191 algorithm, kept as the parity oracle. */
const baselineSnapshot = (
  project: CadProject,
  selectedEntityIds: readonly string[],
): CadSurveySnapshot => {
  const groups = backfillCadPointGroups(project.pointGroups);
  const pointStyles = backfillCadPointStyles(project.pointStyles);
  const labelStyles = backfillCadPointLabelStyles(project.labelStyles);
  const pointNames = new Map(pointStyles.map((style) => [style.id, style.name]));
  const labelNames = new Map(labelStyles.map((style) => [style.id, style.name]));
  const pointIds = pointStyles.map((style) => style.id);
  const labelIds = labelStyles.map((style) => style.id);
  const points = project.entities.filter(
    (entity): entity is CadSurveyPointEntity => entity.type === 'survey-point',
  );
  const memberCounts = new Map<string, number>(groups.map((group) => [group.id, 0]));
  const infos: CadSurveyPointDisplayInfo[] = points.map((point) => {
    const matching = matchingPointGroups(point, groups);
    for (const group of matching) {
      memberCounts.set(group.id, (memberCounts.get(group.id) ?? 0) + 1);
    }
    const resolved = resolveSurveyPointDisplay({
      point,
      groups,
      pointStyles: pointIds.map((id) => ({ id })),
      labelStyles: labelIds.map((id) => ({ id })),
      defaultPointStyleId: DEFAULT_CAD_POINT_STYLE_ID,
      defaultLabelStyleId: DEFAULT_CAD_POINT_LABEL_STYLE_ID,
    });
    return {
      entityId: point.id,
      stationId: point.stationId,
      x: point.x,
      y: point.y,
      z: point.z,
      description: point.description,
      featureCode: point.featureCode,
      layerId: point.layerId,
      pointClass: point.pointClass,
      source: point.source,
      basePointStyleName: styleName(pointNames, point.pointStyleId),
      pointStyleOverrideId: point.pointStyleOverrideId ?? null,
      pointStyleOverrideName:
        point.pointStyleOverrideId == null ? null : (pointNames.get(point.pointStyleOverrideId) ?? `Unknown style (${point.pointStyleOverrideId})`),
      effectivePointStyleName: pointNames.get(resolved.effectivePointStyleId) ?? resolved.effectivePointStyleId,
      pointStyleSourceText: describeDisplaySource(resolved.styleSource, groups),
      baseLabelStyleName: styleName(labelNames, point.pointLabelStyleId),
      pointLabelStyleOverrideId: point.pointLabelStyleOverrideId ?? null,
      labelStyleOverrideName:
        point.pointLabelStyleOverrideId == null ? null : (labelNames.get(point.pointLabelStyleOverrideId) ?? `Unknown style (${point.pointLabelStyleOverrideId})`),
      effectiveLabelStyleName: labelNames.get(resolved.effectivePointLabelStyleId) ?? resolved.effectivePointLabelStyleId,
      labelStyleSourceText: describeDisplaySource(resolved.labelStyleSource, groups),
      matchingGroupNames: matching.map((group) => group.name),
    };
  });
  const selectedIds = new Set(selectedEntityIds);
  return {
    pointCount: points.length,
    allPointIds: points.map((point) => point.id),
    groups: groups.map((group) => ({
      id: group.id,
      name: group.name,
      memberCount: memberCounts.get(group.id) ?? 0,
      priority: group.priority,
    })),
    pointStyles: pointStyles.map((style) => ({ id: style.id, name: style.name })),
    labelStyles: labelStyles.map((style) => ({ id: style.id, name: style.name })),
    table: infos.slice(0, SURVEY_POINT_TABLE_CAP),
    tableTruncated: infos.length > SURVEY_POINT_TABLE_CAP,
    selected: infos.filter((info) => selectedIds.has(info.entityId)),
  };
};

/**
 * Overlapping groups with overrides so group priority + source text is
 * exercised: All Points (0), Control Points (1, label override), Veg Override
 * (2, point-style override), Low Elevation (3, label override).
 */
const fixtureGroups = (): CadPointGroup[] => {
  const groups = createDefaultCadPointGroups();
  const control = groups.find((group) => group.id === CONTROL_POINTS_GROUP_ID);
  if (control != null) control.pointLabelStyleOverrideId = 'point-label-point-number-elevation';
  return [
    ...groups,
    {
      id: 'point-group-veg',
      name: 'Veg Override',
      query: { featureCodePattern: 'VEG' },
      priority: 2,
      pointStyleOverrideId: 'point-style-tree',
    },
    {
      id: 'point-group-low',
      name: 'Low Elevation',
      query: { elevationMax: 100 },
      priority: 3,
      pointLabelStyleOverrideId: 'point-label-none',
    },
  ];
};

const makeFixture = (
  count: number,
): { project: CadProject; selected: string[] } => {
  const doc = createBlankCadDrawingDocument({ units: 'm' });
  const layerId = doc.project.layers[0]?.id ?? 'general';
  const entities: CadSurveyPointEntity[] = [];
  for (let index = 0; index < count; index += 1) {
    const overrides: Partial<CadSurveyPointEntity> = {};
    if (index === 0) overrides.pointStyleOverrideId = 'point-style-monument';
    if (index === 500) overrides.pointLabelStyleOverrideId = 'point-label-point-number-description';
    if (count > 1 && index === count - 1) overrides.pointStyleOverrideId = 'point-style-boundary';
    entities.push({
      id: `pt:${index}`,
      type: 'survey-point',
      layerId,
      visible: true,
      locked: false,
      stationId: `${index + 1}`,
      x: index,
      y: index * 2,
      z: index,
      pointClass: index % 7 === 0 ? 'control' : 'free',
      source: 'parsed-input',
      description: `Tree ${index}`,
      featureCode: index % 11 === 0 ? 'VEG' : 'TOPO',
      ...overrides,
    });
  }
  const selected = [0, 1, 250, 499, 500, 501, 2500, 4999]
    .filter((index) => index < count)
    .map((index) => `pt:${index}`);
  return {
    project: {
      ...doc.project,
      pointStyles: createDefaultCadPointStyles(),
      labelStyles: createDefaultCadPointLabelStyles(),
      pointGroups: fixtureGroups(),
      entities,
    },
    selected,
  };
};

const expectedGroupCount = (count: number, predicate: (_index: number) => boolean): number => {
  let total = 0;
  for (let index = 0; index < count; index += 1) if (predicate(index)) total += 1;
  return total;
};

describe('PERF-184 #191 survey snapshot cap parity', () => {
  for (const count of [0, 1, 499, 500, 501, 5000]) {
    it(`is byte-for-byte identical to the pre-cap implementation at ${count} points`, () => {
      const { project, selected } = makeFixture(count);
      const snapshot = buildCadSurveySnapshot(project, selected);
      const baseline = baselineSnapshot(project, selected);

      expect(snapshot).toEqual(baseline);
      // Key insertion order + array ordering, not just deep equality.
      expect(JSON.stringify(snapshot)).toBe(JSON.stringify(baseline));

      expect(snapshot.pointCount).toBe(count);
      expect(snapshot.allPointIds).toHaveLength(count);
      expect(snapshot.table).toHaveLength(Math.min(count, SURVEY_POINT_TABLE_CAP));
      expect(snapshot.tableTruncated).toBe(count > SURVEY_POINT_TABLE_CAP);
      expect(snapshot.table.map((info) => info.entityId)).toEqual(
        snapshot.allPointIds.slice(0, SURVEY_POINT_TABLE_CAP),
      );
      expect(snapshot.selected.map((info) => info.entityId)).toEqual(selected);
    });
  }

  it('counts groups across ALL points, not just the capped table', () => {
    const count = 5000;
    const { project } = makeFixture(count);
    const snapshot = buildCadSurveySnapshot(project, []);
    const all = snapshot.groups.find((group) => group.name === 'All Points');
    const control = snapshot.groups.find((group) => group.name === 'Control Points');
    const veg = snapshot.groups.find((group) => group.name === 'Veg Override');
    expect(all?.memberCount).toBe(count);
    expect(control?.memberCount).toBe(expectedGroupCount(count, (index) => index % 7 === 0));
    expect(veg?.memberCount).toBe(expectedGroupCount(count, (index) => index % 11 === 0));
    // The capped table must not truncate the group counts.
    expect(control!.memberCount).toBeGreaterThan(SURVEY_POINT_TABLE_CAP);
  });

  it('keeps selected points beyond the cap and preserves overrides/source text', () => {
    const count = 20;
    const { project, selected } = makeFixture(count);
    const snapshot = buildCadSurveySnapshot(project, [...selected, 'pt:11', 'pt:3']);

    // Selected points beyond the cap are present (20 < cap here, so add a
    // synthetic cap-crossing case below).
    const beyond = makeFixture(600);
    const beyondSnapshot = buildCadSurveySnapshot(beyond.project, ['pt:0', 'pt:599']);
    expect(beyondSnapshot.selected.map((info) => info.entityId)).toEqual(['pt:0', 'pt:599']);
    expect(beyondSnapshot.table.some((info) => info.entityId === 'pt:599')).toBe(false);

    const manual = snapshot.selected.find((info) => info.entityId === 'pt:0')!;
    expect(manual.pointStyleSourceText).toBe('Manual override');
    expect(manual.effectivePointStyleName).toBe('Monument');
    // Control group (priority 1) label override wins for pt:0.
    expect(manual.labelStyleSourceText).toBe('Point Group "Control Points"');
    expect(manual.effectiveLabelStyleName).toBe('Point Number + Elevation');

    const veg = snapshot.selected.find((info) => info.entityId === 'pt:11')!;
    expect(veg.pointStyleSourceText).toBe('Point Group "Veg Override"');
    expect(veg.effectivePointStyleName).toBe('Tree');

    const low = snapshot.selected.find((info) => info.entityId === 'pt:3')!;
    expect(low.labelStyleSourceText).toBe('Point Group "Low Elevation"');
    expect(low.effectiveLabelStyleName).toBe('No Label');

    const last = makeFixture(501);
    const lastSnapshot = buildCadSurveySnapshot(last.project, ['pt:500']);
    expect(lastSnapshot.selected.map((info) => info.entityId)).toEqual(['pt:500']);
    expect(lastSnapshot.selected[0]!.labelStyleSourceText).toBe('Manual override');
  });

  it('shares one materialized info for a selected point inside the cap', () => {
    const { project } = makeFixture(600);
    const snapshot = buildCadSurveySnapshot(project, ['pt:10', 'pt:499', 'pt:599']);
    expect(snapshot.table[10]).toBe(snapshot.selected[0]);
    expect(snapshot.table[499]).toBe(snapshot.selected[1]);
    expect(snapshot.table.some((info) => info.entityId === 'pt:599')).toBe(false);
  });
});

describe('PERF-184 #191 resolver work bound', () => {
  it('materializes only cap + selected-beyond-cap at every fixture size', () => {
    const resolveSpy = vi.mocked(resolveSurveyPointDisplay);
    for (const count of [0, 1, 499, 500, 501, 5000]) {
      const { project, selected } = makeFixture(count);
      resolveSpy.mockClear();
      const snapshot = buildCadSurveySnapshot(project, selected);
      const selectedBeyondCap = selected.filter(
        (id) => Number(id.slice('pt:'.length)) >= SURVEY_POINT_TABLE_CAP,
      ).length;
      const expected = Math.min(count, SURVEY_POINT_TABLE_CAP) + selectedBeyondCap;
      expect(resolveSpy).toHaveBeenCalledTimes(expected);
      // Bounded strictly by cap + selected, independent of table.length alone.
      expect(resolveSpy.mock.calls.length).toBe(expected);
      expect(snapshot.table.length + selectedBeyondCap).toBe(
        Math.min(count, SURVEY_POINT_TABLE_CAP) + selectedBeyondCap,
      );
    }
  });

  it('never resolves more than cap + selected for a 5000-point drawing', () => {
    const resolveSpy = vi.mocked(resolveSurveyPointDisplay);
    const { project } = makeFixture(5000);
    resolveSpy.mockClear();
    buildCadSurveySnapshot(project, []);
    expect(resolveSpy).toHaveBeenCalledTimes(SURVEY_POINT_TABLE_CAP);
    resolveSpy.mockClear();
    buildCadSurveySnapshot(project, ['pt:4999']);
    expect(resolveSpy).toHaveBeenCalledTimes(SURVEY_POINT_TABLE_CAP + 1);
  });
});
