import { describe, expect, it } from 'vitest';

import { createBlankCadDrawingDocument } from '../src/engine/cad/cadDrawingFile';
import { computeCadSurfaceSourceRevision } from '../src/engine/cad/cadSurfaces';
import { computeVolumeSurfaceRevision } from '../src/engine/cad/cadVolumeSurfaces';
import type { CadProject, CadSurface } from '../src/engine/cad/cadTypes';

const surface = (
  id: string,
  name: string,
  pointIds: string[],
): CadSurface => ({
  id,
  name,
  definition: { pointSource: { kind: 'points', pointEntityIds: pointIds } },
  cachedRevision: null,
});

const projectFor = (baseZ: number): CadProject => {
  const drawing = createBlankCadDrawingDocument({ name: 'Volumes', units: 'm' });
  return {
    ...drawing.project,
    entities: [
      { id: 'b1', type: 'survey-point', layerId: 'points', visible: true, locked: false, stationId: 'B1', x: 0, y: 0, z: baseZ, pointClass: 'free', source: 'parsed-input' },
      { id: 'b2', type: 'survey-point', layerId: 'points', visible: true, locked: false, stationId: 'B2', x: 10, y: 0, z: baseZ, pointClass: 'free', source: 'parsed-input' },
      { id: 'b3', type: 'survey-point', layerId: 'points', visible: true, locked: false, stationId: 'B3', x: 10, y: 10, z: baseZ, pointClass: 'free', source: 'parsed-input' },
      { id: 'c1', type: 'survey-point', layerId: 'points', visible: true, locked: false, stationId: 'C1', x: 0, y: 0, z: baseZ + 1, pointClass: 'free', source: 'parsed-input' },
      { id: 'c2', type: 'survey-point', layerId: 'points', visible: true, locked: false, stationId: 'C2', x: 10, y: 0, z: baseZ + 1, pointClass: 'free', source: 'parsed-input' },
      { id: 'c3', type: 'survey-point', layerId: 'points', visible: true, locked: false, stationId: 'C3', x: 10, y: 10, z: baseZ + 1, pointClass: 'free', source: 'parsed-input' },
    ],
    surfaces: [surface('base-1', 'Base', ['b1', 'b2', 'b3']), surface('cmp-1', 'Comparison', ['c1', 'c2', 'c3'])],
  };
};

const revisions = (project: CadProject): { baseRev: string; cmpRev: string } => ({
  baseRev: computeCadSurfaceSourceRevision(project, project.surfaces![0]!),
  cmpRev: computeCadSurfaceSourceRevision(project, project.surfaces![1]!),
});

describe('volume surface revision identity', () => {
  it('is deterministic with a vrev1: prefix', () => {
    const input = { baseId: 'base-1', baseRev: 'srev1:aaaa', cmpId: 'cmp-1', cmpRev: 'srev1:bbbb' };
    const first = computeVolumeSurfaceRevision(input);
    expect(first.startsWith('vrev1:')).toBe(true);
    expect(computeVolumeSurfaceRevision({ ...input })).toBe(first);
  });

  it('moves when either source content revision moves (geometry change is stale)', () => {
    const a = projectFor(0);
    const b = projectFor(5);
    const withA = computeVolumeSurfaceRevision({
      baseId: 'base-1',
      baseRev: revisions(a).baseRev,
      cmpId: 'cmp-1',
      cmpRev: revisions(a).cmpRev,
    });
    const withB = computeVolumeSurfaceRevision({
      baseId: 'base-1',
      baseRev: revisions(b).baseRev,
      cmpId: 'cmp-1',
      cmpRev: revisions(b).cmpRev,
    });
    expect(revisions(a).baseRev).not.toBe(revisions(b).baseRev);
    expect(withA).not.toBe(withB);
  });

  it('is insensitive to style/layer changes (display never recalculates)', () => {
    const project = projectFor(0);
    const { baseRev, cmpRev } = revisions(project);
    const before = computeVolumeSurfaceRevision({ baseId: 'base-1', baseRev, cmpId: 'cmp-1', cmpRev });
    const restyled: CadProject = {
      ...project,
      surfaces: project.surfaces!.map((entry) => ({ ...entry, styleId: 'surface-style-none', layerId: 'parcels' })),
      volumeSurfaces: [
        { id: 'vol-1', name: 'Earthwork', baseSurfaceId: 'base-1', comparisonSurfaceId: 'cmp-1', styleId: 'volume-style-none', layerId: 'general' },
      ],
      volumeSurfaceStyles: [],
    };
    const after = computeVolumeSurfaceRevision({
      baseId: 'base-1',
      baseRev: computeCadSurfaceSourceRevision(restyled, restyled.surfaces![0]!),
      cmpId: 'cmp-1',
      cmpRev: computeCadSurfaceSourceRevision(restyled, restyled.surfaces![1]!),
    });
    expect(after).toBe(before);
  });

  it('distinguishes base/comparison order (signed earthwork)', () => {
    const forward = computeVolumeSurfaceRevision({ baseId: 'a', baseRev: 'r1', cmpId: 'b', cmpRev: 'r2' });
    const swapped = computeVolumeSurfaceRevision({ baseId: 'b', baseRev: 'r2', cmpId: 'a', cmpRev: 'r1' });
    expect(forward).not.toBe(swapped);
  });

  it('treats unbuilt sources (null revisions) as stable identity, distinct from built', () => {
    const unbuilt = computeVolumeSurfaceRevision({ baseId: 'a', baseRev: null, cmpId: 'b', cmpRev: null });
    expect(computeVolumeSurfaceRevision({ baseId: 'a', baseRev: null, cmpId: 'b', cmpRev: null })).toBe(unbuilt);
    expect(computeVolumeSurfaceRevision({ baseId: 'a', baseRev: 'srev1:x', cmpId: 'b', cmpRev: null })).not.toBe(unbuilt);
  });
});
