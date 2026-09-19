import { describe, expect, it } from 'vitest';

import { createBlankCadDrawingDocument } from '../src/engine/cad/cadDrawingFile';
import { computeCadSurfaceSourceRevision } from '../src/engine/cad/cadSurfaces';
import {
  computeVolumeSurfaceRevision,
  deriveVolumeSurfaceStatus,
} from '../src/engine/cad/cadVolumeSurfaces';
import type { CadProject, CadVolumeResult, CadVolumeSurface } from '../src/engine/cad/cadTypes';

const pointEntity = (id: string, stationId: string, x: number, y: number, z: number) => ({
  id,
  type: 'survey-point' as const,
  layerId: 'points',
  visible: true,
  locked: false,
  stationId,
  x,
  y,
  z,
  pointClass: 'free' as const,
  source: 'parsed-input' as const,
});

const VOLUME: CadVolumeSurface = {
  id: 'vol-1',
  name: 'Earthwork',
  baseSurfaceId: 'base-1',
  comparisonSurfaceId: 'cmp-1',
};

interface Fixture {
  project: CadProject;
  volume: CadVolumeSurface;
  volumeRevision: string;
}

/** Two surfaces with CURRENT (builtRevision stamped) sources + one volume. */
const fixture = (): Fixture => {
  const drawing = createBlankCadDrawingDocument({ name: 'Volumes', units: 'm' });
  const project: CadProject = {
    ...drawing.project,
    entities: [
      pointEntity('b1', 'B1', 0, 0, 0),
      pointEntity('b2', 'B2', 10, 0, 0),
      pointEntity('b3', 'B3', 10, 10, 0),
      pointEntity('c1', 'C1', 0, 0, 2),
      pointEntity('c2', 'C2', 10, 0, 2),
      pointEntity('c3', 'C3', 10, 10, 2),
    ],
    surfaces: [
      { id: 'base-1', name: 'Base', definition: { pointSource: { kind: 'points', pointEntityIds: ['b1', 'b2', 'b3'] } }, cachedRevision: null },
      { id: 'cmp-1', name: 'Comparison', definition: { pointSource: { kind: 'points', pointEntityIds: ['c1', 'c2', 'c3'] } }, cachedRevision: null },
    ],
    volumeSurfaces: [VOLUME],
  };
  const baseRev = computeCadSurfaceSourceRevision(project, project.surfaces![0]!);
  const cmpRev = computeCadSurfaceSourceRevision(project, project.surfaces![1]!);
  const current: CadProject = {
    ...project,
    surfaces: project.surfaces!.map((entry, index) => ({
      ...entry,
      cachedRevision: index === 0 ? baseRev : cmpRev,
    })),
  };
  return {
    project: current,
    volume: VOLUME,
    volumeRevision: computeVolumeSurfaceRevision({
      baseId: 'base-1',
      baseRev,
      cmpId: 'cmp-1',
      cmpRev,
    }),
  };
};

const resultFor = (revision: string, overlapArea: number): CadVolumeResult => ({
  baseSurfaceId: 'base-1',
  comparisonSurfaceId: 'cmp-1',
  revision,
  overlapArea,
  cutArea: overlapArea,
  fillArea: 0,
  cutVolume: overlapArea,
  fillVolume: 0,
  netVolume: -overlapArea,
  averageCutDepth: 1,
  averageFillDepth: 0,
  maxCutDepth: 1,
  maxFillDepth: 0,
  minDelta: -1,
  maxDelta: 0,
  baseArea: 50,
  comparisonArea: 50,
  stats: {},
});

describe('deriveVolumeSurfaceStatus', () => {
  it('UNBUILT before any successful calculation (sources current)', () => {
    const h = fixture();
    expect(deriveVolumeSurfaceStatus(h.project, h.volume, { building: false, result: null })).toBe('UNBUILT');
  });

  it('CURRENT when sources current and cached revision matches', () => {
    const h = fixture();
    expect(
      deriveVolumeSurfaceStatus(h.project, h.volume, { building: false, result: resultFor(h.volumeRevision, 12) }),
    ).toBe('CURRENT');
  });

  it('NEEDS_RECALC when the cached result revision is stale', () => {
    const h = fixture();
    expect(
      deriveVolumeSurfaceStatus(h.project, h.volume, { building: false, result: resultFor('vrev1:stale', 12) }),
    ).toBe('NEEDS_RECALC');
  });

  it('BUILDING while a request is in flight', () => {
    const h = fixture();
    expect(
      deriveVolumeSurfaceStatus(h.project, h.volume, { building: true, result: null }),
    ).toBe('BUILDING');
  });

  it('FAILED with a session diagnostic and no result', () => {
    const h = fixture();
    expect(
      deriveVolumeSurfaceStatus(h.project, h.volume, { building: false, result: null, diagnostic: 'boom' }),
    ).toBe('FAILED');
  });

  it('BROKEN_REFERENCE when a source surface is deleted', () => {
    const h = fixture();
    const deleted: CadProject = { ...h.project, surfaces: h.project.surfaces!.filter((entry) => entry.id !== 'cmp-1') };
    expect(
      deriveVolumeSurfaceStatus(deleted, h.volume, { building: false, result: resultFor(h.volumeRevision, 12) }),
    ).toBe('BROKEN_REFERENCE');
  });

  it('BROKEN_REFERENCE when base and comparison are the same surface', () => {
    const h = fixture();
    const same: CadVolumeSurface = { ...h.volume, comparisonSurfaceId: 'base-1' };
    expect(deriveVolumeSurfaceStatus(h.project, same, { building: false, result: null })).toBe('BROKEN_REFERENCE');
  });

  it('SOURCE_NOT_CURRENT when a source needs rebuild (reopen: no cached revision)', () => {
    const h = fixture();
    const rebuilt: CadProject = {
      ...h.project,
      surfaces: h.project.surfaces!.map((entry) => ({ ...entry, cachedRevision: null })),
    };
    expect(
      deriveVolumeSurfaceStatus(rebuilt, h.volume, { building: false, result: null }),
    ).toBe('SOURCE_NOT_CURRENT');
    // A session-current override (TIN cache hit) lifts it back.
    expect(
      deriveVolumeSurfaceStatus(rebuilt, h.volume, {
        building: false,
        result: resultFor(h.volumeRevision, 12),
        baseCurrent: true,
        comparisonCurrent: true,
      }),
    ).toBe('CURRENT');
  });

  it('NO_OVERLAP when a successful calculation finds zero common area', () => {
    const h = fixture();
    expect(
      deriveVolumeSurfaceStatus(h.project, h.volume, { building: false, result: resultFor(h.volumeRevision, 0) }),
    ).toBe('NO_OVERLAP');
  });

  it('precedence: BUILDING beats BROKEN_REFERENCE, SOURCE_NOT_CURRENT beats UNBUILT', () => {
    const h = fixture();
    const deleted: CadProject = { ...h.project, surfaces: [] };
    expect(deriveVolumeSurfaceStatus(deleted, h.volume, { building: true, result: null })).toBe('BUILDING');
    const unbuilt: CadProject = {
      ...h.project,
      surfaces: h.project.surfaces!.map((entry) => ({ ...entry, cachedRevision: null })),
    };
    expect(deriveVolumeSurfaceStatus(unbuilt, h.volume, { building: false, result: null })).toBe('SOURCE_NOT_CURRENT');
  });
});
