/**
 * PERF-185.1 — surface source-revision memo contract.
 *
 * `surfaceContentRevision` is the UI wrapper shared by the auto-derive effect,
 * the contour getter, the display layer and the shell snapshot. It memoizes by
 * immutable project identity + surface object identity but MUST remain
 * byte-identical to the canonical engine `computeCadSurfaceSourceRevision`
 * (the source of truth for TIN cache keys, contour CURRENT/STALE and
 * display). This pins:
 *  - byte parity for every definition family (point/group/breakline/boundary/
 *    broken-ref/edits + imported/baked explicit topology);
 *  - one canonical computation per immutable project revision;
 *  - recomputation when the project is replaced or a surface object is
 *    replaced under the same id;
 *  - the documented in-place-mutation boundary (writers replace, never
 *    mutate).
 */
import { describe, expect, it, vi } from 'vitest';
import type {
  CadProject,
  CadSurface,
  CadSurfaceEdit,
  CadSurfaceStyle,
  CadSurveyPointEntity,
} from '../src/engine/cad/cadTypes';
import { computeCadSurfaceSourceRevision as canonical } from '../src/engine/cad/cadSurfaceRevision';

const computeCalls = vi.hoisted(() => ({ count: 0 }));

vi.mock('../src/engine/cad/cadSurfaces', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/engine/cad/cadSurfaces')>();
  return {
    ...actual,
    computeCadSurfaceSourceRevision: (
      ...args: Parameters<typeof actual.computeCadSurfaceSourceRevision>
    ): string => {
      computeCalls.count += 1;
      return actual.computeCadSurfaceSourceRevision(...args);
    },
  };
});

import { resolveSurfaceDisplayOptions, surfaceContentRevision } from '../src/engine/cad/cadSurfaceView';
import {
  findCadSurfaceStyle,
  backfillCadSurfaceStyles,
  indexCadSurfaceStylesById,
} from '../src/engine/cad/cadSurfaceStyles';
import { contourLevelSpecFromStyle } from '../src/engine/cad/cadSurfaceContourView';

const point = (id: string, stationId: string, x: number, y: number, z: number | null): CadSurveyPointEntity => ({
  id,
  type: 'survey-point',
  layerId: 'general',
  visible: true,
  locked: false,
  stationId,
  x,
  y,
  ...(z == null ? {} : { z }),
  pointClass: 'unknown',
  source: 'parsed-input',
});

const baseProject = (entities: CadProject['entities']): CadProject => ({
  version: 2,
  id: 'revision-memo-project',
  name: 'revision memo',
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

const nativeSurface = (id: string, entityIds: string[]): CadSurface => ({
  id,
  name: `surface-${id}`,
  definition: { pointSource: { kind: 'points', pointEntityIds: entityIds } },
});

const importedSurface = (id: string, sourceKind: 'imported-tin' | 'explicit-tin'): CadSurface => ({
  id,
  name: `surface-${id}`,
  definition: {
    sourceKind,
    pointSource: { kind: 'points', pointEntityIds: [] },
    importedTin: {
      vertices: [0, 0, 0, 10, 0, 0, 0, 10, 0, 10, 10, 1],
      faces: [0, 1, 2, 1, 3, 2],
      provenance: { format: 'LandXML', fileName: `${id}.xml`, surfaceName: id },
    },
  },
});

const fixture = () => {
  const entities: CadSurveyPointEntity[] = [
    point('p0', '100', 0, 0, 0),
    point('p1', '101', 10, 0, 1),
    point('p2', '102', 0, 10, 2),
    point('p3', '103', 10, 10, 3),
    point('p4', '104', 20, 5, 4),
  ];
  const project = baseProject(entities);
  const surfaces: CadSurface[] = [
    nativeSurface('native', ['p0', 'p1', 'p2', 'p3']),
    {
      id: 'grouped',
      name: 'grouped',
      definition: { pointSource: { kind: 'point-group', pointGroupIds: ['g1'] } },
    },
    {
      id: 'breakline',
      name: 'breakline',
      definition: {
        pointSource: { kind: 'points', pointEntityIds: ['p0', 'p1', 'p2'] },
        breaklines: [
          {
            id: 'b1',
            type: 'standard',
            source: { kind: 'point-chain', pointEntityIds: ['p0', 'p1', 'p3'] },
          },
        ],
        boundaries: [{ type: 'outer', sourceEntityId: 'poly1' }],
      },
    },
    nativeSurface('broken', ['p0', 'missing-point', 'p2']),
    nativeSurface('edited', ['p0', 'p1', 'p2', 'p3']),
    importedSurface('imported', 'imported-tin'),
    importedSurface('baked', 'explicit-tin'),
  ];
  const withSurfaces: CadProject = {
    ...project,
    surfaces,
    pointGroups: [
      { id: 'g1', name: 'Ground', query: { pointClass: 'unknown' }, priority: 1 },
    ],
    entities: [
      ...entities,
      {
        id: 'poly1',
        type: 'polyline',
        layerId: 'general',
        visible: true,
        locked: false,
        vertices: [
          { x: -1, y: -1 },
          { x: 21, y: -1 },
          { x: 21, y: 21 },
          { x: -1, y: 21 },
          { x: -1, y: -1 },
        ],
      } as CadProject['entities'][number],
    ],
  };
  withSurfaces.surfaces![4]!.definition.edits = [
    { id: 'e1', kind: 'raise-lower-surface', deltaZ: 0.5 } as CadSurfaceEdit,
  ];
  return withSurfaces;
};

describe('PERF-185 surfaceContentRevision memo contract', () => {
  it('is byte-identical to the canonical engine revision for every definition family', () => {
    const project = fixture();
    for (const surface of project.surfaces!) {
      expect(surfaceContentRevision(project, surface), surface.id).toBe(canonical(project, surface));
    }
  });

  it('computes once per immutable project revision and reuses the hash across reads', () => {
    const project = fixture();
    const surface = project.surfaces![0]!;
    computeCalls.count = 0;
    const first = surfaceContentRevision(project, surface);
    const second = surfaceContentRevision(project, surface);
    const third = surfaceContentRevision(project, surface);
    expect(second).toBe(first);
    expect(third).toBe(first);
    expect(computeCalls.count).toBe(1);
  });

  it('recomputes when the project object is replaced (immutable edit)', () => {
    const project = fixture();
    const surface = project.surfaces![0]!;
    const before = surfaceContentRevision(project, surface);
    const movedProject: CadProject = {
      ...project,
      entities: project.entities.map((entity) =>
        entity.id === 'p0' ? { ...(entity as CadSurveyPointEntity), x: 5 } : entity,
      ),
    };
    const after = surfaceContentRevision(movedProject, surface);
    expect(after).not.toBe(before);
    expect(after).toBe(canonical(movedProject, surface));
  });

  it('recomputes when a surface object is replaced under the same id', () => {
    const project = fixture();
    const surface = project.surfaces![0]!;
    const before = surfaceContentRevision(project, surface);
    const replaced: CadSurface = {
      ...surface,
      definition: {
        ...surface.definition,
        edits: [{ id: 'e-replace', kind: 'raise-lower-surface', deltaZ: 1 } as CadSurfaceEdit],
      },
    };
    const after = surfaceContentRevision(project, replaced);
    expect(after).not.toBe(before);
    expect(after).toBe(canonical(project, replaced));
  });

  it('style-only changes never alter the source revision', () => {
    const project = fixture();
    const surface = project.surfaces![0]!;
    const before = surfaceContentRevision(project, surface);
    const restyled: CadProject = {
      ...project,
      surfaces: project.surfaces!.map((entry) =>
        entry.id === surface.id ? { ...entry, styleId: 'surface-style-none' } : entry,
      ),
    };
    expect(surfaceContentRevision(restyled, restyled.surfaces![0]!)).toBe(before);
  });

  it('documents the in-place mutation boundary: writers replace, never mutate', () => {
    const project = fixture();
    const surface = project.surfaces![0]!;
    const before = surfaceContentRevision(project, surface);
    // OUT OF CONTRACT: mutating the SAME project+surface object in place is not
    // detected (the memo is keyed on object identity). No production path does
    // this — every transaction replaces the project/surface object.
    (surface.definition.pointSource as { pointEntityIds: string[] }).pointEntityIds = [];
    expect(surfaceContentRevision(project, surface)).toBe(before);
    // The canonical function still sees the mutated content, proving the memo
    // (not the engine) is what preserved the old hash.
    expect(canonical(project, surface)).not.toBe(before);
  });

  it('findCadSurfaceStyle is a read-only lookup while backfill clones', () => {
    const styles = backfillCadSurfaceStyles(undefined);
    const stored = styles[0]!;
    expect(findCadSurfaceStyle(styles, stored.id)).toBe(stored);
    const cloned = backfillCadSurfaceStyles(styles);
    expect(cloned[0]).not.toBe(stored);
    expect(cloned[0]).toEqual(stored);
  });

  it('duplicate style ids resolve to FIRST everywhere (auto-derive/getContours/display parity)', () => {
    // Loaded drawings can carry duplicate style ids with different contour
    // specs (clone-on-open preserves order without dedupe). Every read path
    // must match the old `.find()` first-match: a bare
    // `new Map(styles.map((s) => [s.id, s]))` would keep the LAST duplicate.
    const first: CadSurfaceStyle = {
      id: 'dup-style',
      name: 'first',
      color: '#111111',
      showContours: true,
      minorContourInterval: 2,
      majorContourEvery: 5,
      contourBaseElevation: 0,
    };
    const second: CadSurfaceStyle = {
      id: 'dup-style',
      name: 'second',
      color: '#222222',
      showContours: true,
      minorContourInterval: 7,
      majorContourEvery: 5,
      contourBaseElevation: 100,
    };
    const styles: CadSurfaceStyle[] = [first, second];
    // Engine display lookup (cadSurfaceView) — first match.
    expect(findCadSurfaceStyle(styles, 'dup-style')).toBe(first);
    // Sweep/scene index (SurveyCadWorkspace auto-derive + getContours) —
    // first wins, over the same backfilled clone the component builds.
    const index = indexCadSurfaceStylesById(styles);
    expect(index.get('dup-style')).toEqual(first);
    expect(index.get('dup-style')).not.toEqual(second);
    // The contour spec derived from the indexed style is the FIRST spec,
    // so derivation requests and cache keys agree with display.
    expect(contourLevelSpecFromStyle(index.get('dup-style')!)).toEqual(
      contourLevelSpecFromStyle(first),
    );
    expect(contourLevelSpecFromStyle(index.get('dup-style')!)?.minorInterval).toBe(2);
    // Display options resolve appearance from the FIRST duplicate too.
    const project = {
      ...baseProject([]),
      surfaces: [{ ...nativeSurface('s1', []), styleId: 'dup-style' }],
      surfaceStyles: styles,
    };
    expect(resolveSurfaceDisplayOptions(project.surfaces[0]!, project).stroke).toBe('#111111');
  });
});
