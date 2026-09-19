import { describe, expect, it } from 'vitest';
import {
  createBlankCadDrawingDocument,
  parseCadDrawingFile,
  serializeCadDrawingFile,
} from '../src/engine/cad/cadDrawingFile';
import { cloneCadProject } from '../src/engine/cad/cadPersistence';
import { buildCadProjectSignature } from '../src/engine/cad/cadProjectState';
import {
  ALL_POINTS_GROUP_ID,
  backfillCadPointGroups,
  canDeletePointGroup,
  cloneCadPointGroups,
  CONTROL_POINTS_GROUP_ID,
  createDefaultCadPointGroups,
  evaluatePointGroupMembership,
  matchingPointGroups,
  migrateLegacyPointGroups,
  resolveSurveyPointDisplay,
  validatePointGroupQuery,
} from '../src/engine/cad/cadPointGroups';
import { DEFAULT_CAD_POINT_LABEL_STYLE_ID } from '../src/engine/cad/cadPointLabelStyles';
import { DEFAULT_CAD_POINT_STYLE_ID } from '../src/engine/cad/cadPointStyles';
import type { CadPointGroup, CadSurveyPointEntity } from '../src/engine/cad/cadTypes';

const point = (overrides: Partial<CadSurveyPointEntity> = {}): CadSurveyPointEntity => ({
  id: 'pt:1',
  type: 'survey-point',
  layerId: 'points',
  visible: true,
  locked: false,
  stationId: '1',
  x: 0,
  y: 0,
  z: 100,
  pointClass: 'free',
  source: 'parsed-input',
  description: 'Tree Oak',
  featureCode: 'VEG',
  ...overrides,
});

const group = (overrides: Partial<CadPointGroup> = {}): CadPointGroup => ({
  id: 'g1',
  name: 'G1',
  query: {},
  priority: 0,
  ...overrides,
});

const displayInput = (overrides: Partial<Parameters<typeof resolveSurveyPointDisplay>[0]> = {}) => ({
  point: point(),
  groups: createDefaultCadPointGroups(),
  pointStyles: [{ id: DEFAULT_CAD_POINT_STYLE_ID }, { id: 'point-style-control' }],
  labelStyles: [{ id: DEFAULT_CAD_POINT_LABEL_STYLE_ID }, { id: 'point-label-none' }],
  defaultPointStyleId: DEFAULT_CAD_POINT_STYLE_ID,
  defaultLabelStyleId: DEFAULT_CAD_POINT_LABEL_STYLE_ID,
  ...overrides,
});

describe('phase 18D point groups', () => {
  it('validates queries and fails closed on malformed patterns', () => {
    expect(validatePointGroupQuery({})).toEqual([]);
    expect(validatePointGroupQuery({ descriptionPattern: '' })).toHaveLength(1);
    expect(validatePointGroupQuery({ descriptionPattern: 'TREE[' })).toHaveLength(1);
    expect(validatePointGroupQuery({ featureCodePattern: 'A\\B' })).toHaveLength(1);
    expect(validatePointGroupQuery({ elevationMin: 5, elevationMax: 2 })).toHaveLength(1);
    expect(validatePointGroupQuery({ elevationMin: NaN })).toHaveLength(1);
    // Malformed = matches nothing, even on an otherwise matching point.
    expect(evaluatePointGroupMembership(point(), group({ query: { descriptionPattern: 'TREE[' } }))).toBe(false);
  });

  it('matches wildcards *, ? case-insensitively on description and feature code', () => {
    const cases: Array<[string | undefined, string, boolean]> = [
      ['Tree Oak', 'tree*', true],
      ['Tree Oak', 'TREE*', true],
      ['Tree Oak', '*oak', true],
      ['Tree Oak', 'Tree?Oak', true],
      ['Tree Oak', 'Tree?Oa', false],
      ['Tree Oak', 'bush*', false],
      [undefined, '*', true],
      [undefined, 'tree*', false],
    ];
    for (const [description, pattern, expected] of cases) {
      expect(
        evaluatePointGroupMembership(point({ description }), group({ query: { descriptionPattern: pattern } })),
        `${description} vs ${pattern}`,
      ).toBe(expected);
    }
    expect(evaluatePointGroupMembership(point(), group({ query: { featureCodePattern: 'veg' } }))).toBe(true);
    expect(evaluatePointGroupMembership(point(), group({ query: { featureCodePattern: 'veg?' } }))).toBe(false);
    // Literal dots/brackets-free specials stay literal: '.' does not act as regex any.
    expect(evaluatePointGroupMembership(point({ description: 'A.C' }), group({ query: { descriptionPattern: 'A?C' } }))).toBe(true);
    expect(evaluatePointGroupMembership(point({ description: 'ABC' }), group({ query: { descriptionPattern: 'A.C' } }))).toBe(false);
  });

  it('applies scalar and range constraints conjunctively', () => {
    const g = group({
      query: { pointClass: 'control', layerId: 'control-points', source: 'parsed-input', elevationMin: 90, elevationMax: 110 },
    });
    expect(evaluatePointGroupMembership(point({ pointClass: 'control', layerId: 'control-points' }), g)).toBe(true);
    expect(evaluatePointGroupMembership(point({ pointClass: 'free', layerId: 'control-points' }), g)).toBe(false);
    expect(evaluatePointGroupMembership(point({ pointClass: 'control', layerId: 'control-points', z: 200 }), g)).toBe(false);
    expect(evaluatePointGroupMembership(point({ pointClass: 'control', layerId: 'control-points', z: undefined }), g)).toBe(false);
  });

  it('lets exclude win over include and query', () => {
    const g = group({ query: { includePointIds: ['pt:1'], excludePointIds: ['pt:1'], descriptionPattern: 'Tree*' } });
    expect(evaluatePointGroupMembership(point(), g)).toBe(false);
    const included = group({ query: { includePointIds: ['pt:1'], descriptionPattern: 'Bush*' } });
    expect(evaluatePointGroupMembership(point(), included)).toBe(true);
    const excluded = group({ query: { excludePointIds: ['pt:1'], descriptionPattern: 'Tree*' } });
    expect(evaluatePointGroupMembership(point(), excluded)).toBe(false);
  });

  it('orders matching groups by priority then list order', () => {
    const groups = [
      group({ id: 'low', priority: 10 }),
      group({ id: 'high', priority: -1 }),
      group({ id: 'tie-b', priority: 5 }),
      group({ id: 'tie-a', priority: 5 }),
      group({ id: 'miss', priority: -100, query: { descriptionPattern: 'Bush*' } }),
    ];
    expect(matchingPointGroups(point(), groups).map((entry) => entry.id)).toEqual([
      'high',
      'tie-b',
      'tie-a',
      'low',
    ]);
  });

  it('resolves manual > group > base > default independently per property', () => {
    const groups: CadPointGroup[] = [
      { id: ALL_POINTS_GROUP_ID, name: 'All Points', query: {}, priority: 0, pointLabelStyleOverrideId: 'point-label-none' },
      { id: CONTROL_POINTS_GROUP_ID, name: 'Control', query: { pointClass: 'control' }, priority: 1, pointStyleOverrideId: 'point-style-control' },
    ];
    // Composition case: control point gets Control style + All-Points label.
    const control = point({
      pointClass: 'control',
      pointStyleId: 'point-style-no-such',
      pointLabelStyleId: 'point-label-no-such',
    });
    const resolved = resolveSurveyPointDisplay(displayInput({ point: control, groups }));
    expect(resolved.effectivePointStyleId).toBe('point-style-control');
    expect(resolved.styleSource).toBe('point-group:point-group-control');
    expect(resolved.effectivePointLabelStyleId).toBe('point-label-none');
    expect(resolved.labelStyleSource).toBe('point-group:point-group-all');
    expect(resolved.matchingGroupIds).toEqual([ALL_POINTS_GROUP_ID, CONTROL_POINTS_GROUP_ID]);

    // Full chain for the marker: manual beats group beats base beats default.
    const controlBase = point({ pointClass: 'control', pointStyleId: 'point-style-control' });
    expect(resolveSurveyPointDisplay(displayInput({ point: controlBase, groups })).styleSource).toBe('point-group:point-group-control');
    expect(resolveSurveyPointDisplay(displayInput({ point: point(), groups: [] })).styleSource).toBe('drawing-default');
    expect(
      resolveSurveyPointDisplay(displayInput({ point: point({ pointStyleOverrideId: 'point-style-control' }), groups: [] })).styleSource,
    ).toBe('manual-override');
    // Same chain for the label property.
    expect(
      resolveSurveyPointDisplay(displayInput({ point: point({ pointLabelStyleOverrideId: 'point-label-none' }), groups })).labelStyleSource,
    ).toBe('manual-override');
    expect(
      resolveSurveyPointDisplay(displayInput({ point: point({ pointLabelStyleId: 'point-label-none' }), groups: [] })).labelStyleSource,
    ).toBe('base');
  });

  it('falls back deterministically on unknown ids without crashing', () => {
    const resolved = resolveSurveyPointDisplay(
      displayInput({
        point: point({ pointStyleOverrideId: 'missing', pointStyleId: 'also-missing', pointLabelStyleOverrideId: 'missing' }),
        defaultPointStyleId: 'missing-default',
        defaultLabelStyleId: 'missing-label-default',
      }),
    );
    expect(resolved.effectivePointStyleId).toBe(DEFAULT_CAD_POINT_STYLE_ID);
    expect(resolved.styleSource).toBe('drawing-default');
    expect(resolved.effectivePointLabelStyleId).toBe(DEFAULT_CAD_POINT_LABEL_STYLE_ID);
    expect(resolved.labelStyleSource).toBe('drawing-default');
    // Empty tables: returns the requested default verbatim, still no crash.
    const empty = resolveSurveyPointDisplay(displayInput({ pointStyles: [], labelStyles: [] }));
    expect(empty.effectivePointStyleId).toBe(DEFAULT_CAD_POINT_STYLE_ID);
  });

  it('seeds All Points (matches all) and Control Points with empty overrides', () => {
    const seeds = createDefaultCadPointGroups();
    expect(seeds.map((entry) => entry.id)).toEqual([ALL_POINTS_GROUP_ID, CONTROL_POINTS_GROUP_ID]);
    for (const seed of seeds) {
      expect(seed.pointStyleOverrideId).toBeUndefined();
      expect(seed.pointLabelStyleOverrideId).toBeUndefined();
    }
    expect(evaluatePointGroupMembership(point(), seeds[0]!)).toBe(true);
    expect(evaluatePointGroupMembership(point({ pointClass: 'control' }), seeds[1]!)).toBe(true);
    expect(evaluatePointGroupMembership(point(), seeds[1]!)).toBe(false);
    // No visual change: seed groups never win a property.
    const resolved = resolveSurveyPointDisplay(displayInput({ point: point({ pointStyleId: 'point-style-control' }) }));
    expect(resolved.styleSource).toBe('base');
    expect(backfillCadPointGroups(undefined).map((entry) => entry.id)).toEqual(seeds.map((entry) => entry.id));
    expect(backfillCadPointGroups(undefined)).not.toBe(seeds);
    expect(cloneCadPointGroups(seeds)).toEqual(seeds);
    // Deletion is appearance-neutral, so every group is deletable.
    expect(canDeletePointGroup(ALL_POINTS_GROUP_ID)).toEqual({ allowed: true, reason: expect.any(String) });
    expect(canDeletePointGroup(CONTROL_POINTS_GROUP_ID).allowed).toBe(true);
  });

  it('migrates legacy drawings with the empty-override seeds', () => {
    const drawing = createBlankCadDrawingDocument({ name: 'Blank', units: 'm' });
    expect(drawing.project.pointGroups).toHaveLength(2);
    const legacy = { ...drawing.project, pointGroups: undefined };
    const migrated = migrateLegacyPointGroups(legacy);
    expect(legacy.pointGroups).toBeUndefined();
    expect(migrated.pointGroups).toHaveLength(2);
    expect(migrated.pointGroups?.every((entry) => entry.pointStyleOverrideId == null)).toBe(true);
    // Idempotent.
    expect(migrateLegacyPointGroups(migrated)).toEqual(migrated);
  });

  it('round-trips point groups plus order through WNCAD at schema v2', () => {
    const drawing = createBlankCadDrawingDocument({ name: 'Round trip', units: 'm' });
    drawing.project.pointGroups = [
      { id: 'custom-trees', name: 'Trees', query: { descriptionPattern: 'Tree*' }, pointStyleOverrideId: 'point-style-tree', priority: 0 },
      { id: ALL_POINTS_GROUP_ID, name: 'All Points', query: {}, priority: 5 },
      { id: CONTROL_POINTS_GROUP_ID, name: 'Control Points', query: { pointClass: 'control' }, priority: 9 },
    ];
    const parsed = parseCadDrawingFile(serializeCadDrawingFile(drawing));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.drawing.schemaVersion).toBe(2);
    expect(parsed.drawing.project.pointGroups?.map((entry) => entry.id)).toEqual([
      'custom-trees',
      ALL_POINTS_GROUP_ID,
      CONTROL_POINTS_GROUP_ID,
    ]);
    // Legacy file without the table opens with the seeds.
    const legacy = { ...drawing, project: { ...drawing.project, pointGroups: undefined } };
    const reopened = parseCadDrawingFile(JSON.stringify(legacy));
    expect(reopened.ok).toBe(true);
    if (!reopened.ok) return;
    expect(reopened.drawing.project.pointGroups).toHaveLength(2);
  });

  it('keeps project key order stable across clone/parse round-trips', () => {
    // JSON.stringify project signatures are key-order-sensitive and drive
    // the workspace persistence sync guard: clone must not move the table
    // or identical content never compares equal.
    const drawing = createBlankCadDrawingDocument({ name: 'Order', units: 'm' });
    const reparsed = parseCadDrawingFile(serializeCadDrawingFile(drawing));
    expect(reparsed.ok).toBe(true);
    if (!reparsed.ok) return;
    expect(buildCadProjectSignature(cloneCadProject(reparsed.drawing.project))).toBe(
      buildCadProjectSignature(reparsed.drawing.project),
    );
    expect(Object.keys(reparsed.drawing.project).at(-1)).toBe('annotationSettings');
    // 18E appended drawing-owned F2F catalog + settings trailing (after
    // pointGroups); 18F appended surfaces + surfaceStyles; 18I appends
    // volume relationships + styles trailing after those; 18J appends
    // profile definitions + views + styles; 18K appends sample-line groups +
    // section styles + section views trailing after those; 18N appends the
    // block library trailing after those; 18O appends dimension/leader/
    // bearing/curve style tables + annotationSettings last.
    // The invariant is clone/parse stability, asserted above.
  });

  it('resolves 10k points x 50 groups in reasonable time', () => {
    const groups: CadPointGroup[] = Array.from({ length: 50 }, (_, index) =>
      group({
        id: `g${index}`,
        priority: index,
        query: index % 2 === 0 ? { descriptionPattern: `Tree*${index}?` } : { pointClass: 'control' },
        pointStyleOverrideId: 'point-style-control',
      }),
    );
    const points = Array.from({ length: 10_000 }, (_, index) =>
      point({ id: `pt:${index}`, description: `Tree ${index}`, pointClass: index % 3 === 0 ? 'control' : 'free' }),
    );
    const input = displayInput({ groups });
    console.time('point-groups-10k x 50');
    const started = Date.now();
    let resolved = 0;
    for (const candidate of points) {
      resolved += resolveSurveyPointDisplay({ ...input, point: candidate }).matchingGroupIds.length;
    }
    const elapsedMs = Date.now() - started;
    console.timeEnd('point-groups-10k x 50');
    console.log(`point-groups perf: 10k points x 50 groups in ${elapsedMs}ms (${resolved} matches)`);
    expect(resolved).toBeGreaterThan(0);
    expect(elapsedMs).toBeLessThan(5000);
  });
});
