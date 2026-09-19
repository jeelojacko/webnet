import { describe, expect, it } from 'vitest';

import {
  computeProfileViewRevision,
  computeSurfaceProfileRevision,
} from '../src/engine/cad/cadProfileRevision';
import { deriveSurfaceProfileStatus } from '../src/engine/cad/cadProfileStatus';
import type { CadAlignmentEntity, CadSurfaceProfile } from '../src/engine/cad/cadTypes';

const PROFILE: CadSurfaceProfile = {
  id: 'prof-1',
  name: 'Main',
  alignmentEntityId: 'align-1',
  surfaceId: 'surf-1',
};

const alignment = (): Pick<
  CadAlignmentEntity,
  'id' | 'elements' | 'startStation' | 'stationEquations'
> => ({
  id: 'align-1',
  elements: [
    { kind: 'line', start: { x: 0, y: 0 }, end: { x: 10, y: 0 } },
    {
      kind: 'arc',
      center: { x: 10, y: 10 },
      radius: 10,
      startAngleDeg: -90,
      endAngleDeg: 0,
    },
  ],
  startStation: 0,
  stationEquations: [{ backStation: 6, aheadStation: 56, rawStation: 5 }],
});

describe('profile revision identity', () => {
  it('is deterministic with a prev1: prefix', () => {
    const first = computeSurfaceProfileRevision(PROFILE, alignment(), 'srev1:aaaa');
    expect(first.startsWith('prev1:')).toBe(true);
    expect(computeSurfaceProfileRevision(PROFILE, alignment(), 'srev1:aaaa')).toBe(first);
  });

  it('ignores style and layer changes', () => {
    const before = computeSurfaceProfileRevision(PROFILE, alignment(), 'srev1:aaaa');
    const restyled: CadSurfaceProfile = { ...PROFILE, styleId: 'other-style', name: 'Renamed' };
    expect(computeSurfaceProfileRevision(restyled, alignment(), 'srev1:aaaa')).toBe(before);
  });

  it('moves on alignment geometry change', () => {
    const before = computeSurfaceProfileRevision(PROFILE, alignment(), 'srev1:aaaa');
    const moved = alignment();
    moved.elements = [{ kind: 'line', start: { x: 0, y: 0 }, end: { x: 10, y: 5 } }];
    expect(computeSurfaceProfileRevision(PROFILE, moved, 'srev1:aaaa')).not.toBe(before);
  });

  it('moves on equation, start-station, and surface-revision change', () => {
    const base = alignment();
    const before = computeSurfaceProfileRevision(PROFILE, base, 'srev1:aaaa');
    expect(
      computeSurfaceProfileRevision(PROFILE, { ...base, stationEquations: [] }, 'srev1:aaaa'),
    ).not.toBe(before);
    expect(
      computeSurfaceProfileRevision(PROFILE, { ...base, startStation: 100 }, 'srev1:aaaa'),
    ).not.toBe(before);
    expect(computeSurfaceProfileRevision(PROFILE, base, 'srev1:bbbb')).not.toBe(before);
    expect(computeSurfaceProfileRevision(PROFILE, null, 'srev1:aaaa')).not.toBe(before);
  });

  it('view revision tracks settings only', () => {
    const view = {
      id: 'view-1',
      alignmentEntityId: 'align-1',
      profileIds: ['prof-1'],
      insertionX: 0,
      insertionY: 0,
      horizontalScale: 1,
      verticalExaggeration: 5,
      datumMode: 'auto' as const,
    };
    const first = computeProfileViewRevision(view);
    expect(first.startsWith('pview1:')).toBe(true);
    expect(computeProfileViewRevision({ ...view })).toBe(first);
    expect(
      computeProfileViewRevision({ ...view, verticalExaggeration: 10 }),
    ).not.toBe(first);
    expect(computeProfileViewRevision({ ...view, datumMode: 'explicit' as const, datumElevation: 4 })).not.toBe(
      first,
    );
  });
});

describe('profile status matrix', () => {
  const healthy = {
    profileExists: true,
    alignmentExists: true,
    surfaceStatus: 'CURRENT' as const,
    surfaceRevisionAtBuild: 'srev1:a',
    currentSurfaceRevision: 'srev1:a',
    hasResult: true,
    building: false,
    hasOverlap: true,
  };

  it('derives CURRENT when everything matches', () => {
    expect(deriveSurfaceProfileStatus(healthy)).toBe('CURRENT');
  });

  it('derives BUILDING first', () => {
    expect(deriveSurfaceProfileStatus({ ...healthy, building: true })).toBe('BUILDING');
  });

  it('derives BROKEN_REFERENCE for missing refs', () => {
    expect(deriveSurfaceProfileStatus({ ...healthy, profileExists: false })).toBe(
      'BROKEN_REFERENCE',
    );
    expect(deriveSurfaceProfileStatus({ ...healthy, alignmentExists: false })).toBe(
      'BROKEN_REFERENCE',
    );
    expect(
      deriveSurfaceProfileStatus({ ...healthy, surfaceStatus: 'BROKEN_REFERENCE' }),
    ).toBe('BROKEN_REFERENCE');
    expect(deriveSurfaceProfileStatus({ ...healthy, surfaceStatus: 'MISSING' })).toBe(
      'BROKEN_REFERENCE',
    );
  });

  it('derives SOURCE_NOT_CURRENT while the source TIN is stale', () => {
    for (const surfaceStatus of [
      'UNBUILT',
      'NEEDS_REBUILD',
      'BUILDING',
      'FAILED',
      'INSUFFICIENT_DATA',
    ] as const) {
      expect(deriveSurfaceProfileStatus({ ...healthy, surfaceStatus })).toBe(
        'SOURCE_NOT_CURRENT',
      );
    }
  });

  it('derives UNBUILT vs FAILED without a result', () => {
    expect(deriveSurfaceProfileStatus({ ...healthy, hasResult: false })).toBe('UNBUILT');
    expect(
      deriveSurfaceProfileStatus({ ...healthy, hasResult: false, diagnostic: 'boom' }),
    ).toBe('FAILED');
  });

  it('derives NEEDS_REBUILD when the surface moved under a fresh result', () => {
    expect(
      deriveSurfaceProfileStatus({ ...healthy, currentSurfaceRevision: 'srev1:b' }),
    ).toBe('NEEDS_REBUILD');
  });

  it('derives NO_OVERLAP for gap-only results', () => {
    expect(deriveSurfaceProfileStatus({ ...healthy, hasOverlap: false })).toBe('NO_OVERLAP');
  });
});
