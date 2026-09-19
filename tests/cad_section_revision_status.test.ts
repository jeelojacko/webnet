import { describe, expect, it } from 'vitest';

import {
  computeCadSampleLineGroupRevision,
  computeCadSampleLineRevision,
  computeCadSectionViewRevision,
} from '../src/engine/cad/cadSectionRevision';
import { deriveCadSectionStatus } from '../src/engine/cad/cadSectionStatus';
import type {
  CadAlignmentEntity,
  CadSampleLine,
  CadSampleLineGroup,
} from '../src/engine/cad/cadTypes';

const group = (): CadSampleLineGroup => ({
  id: 'grp-1',
  name: 'Corridor',
  alignmentEntityId: 'align-1',
  surfaceSources: [
    { surfaceId: 'surf-1', sectionStyleId: 'section-style-existing' },
    { surfaceId: 'surf-2', sectionStyleId: 'section-style-proposed' },
  ],
  sampleLines: [
    { id: 'line-1', rawStation: 10, leftWidth: 5, rightWidth: 5, skewDeg: 0 },
    { id: 'line-2', rawStation: 20, leftWidth: 5, rightWidth: 5, skewDeg: 0 },
  ],
});

const alignment = (): Pick<CadAlignmentEntity, 'id' | 'elements' | 'startStation' | 'stationEquations'> => ({
  id: 'align-1',
  elements: [{ kind: 'line', start: { x: 0, y: 0 }, end: { x: 100, y: 0 } }],
  startStation: 0,
  stationEquations: [{ backStation: 50, aheadStation: 150, rawStation: 50 }],
});

const surfaceRevisions = { 'surf-1': 'srev1:aaaa', 'surf-2': 'srev1:bbbb' };

describe('section revision identity', () => {
  it('is deterministic with secg1:/secl1: prefixes', () => {
    const g = computeCadSampleLineGroupRevision(group(), alignment(), surfaceRevisions);
    expect(g.startsWith('secg1:')).toBe(true);
    expect(computeCadSampleLineGroupRevision(group(), alignment(), surfaceRevisions)).toBe(g);
    const line = computeCadSampleLineRevision(group().sampleLines[0]!, alignment(), 'align-1');
    expect(line.startsWith('secl1:')).toBe(true);
  });

  it('ignores display intent (group/line names, styles, layer, manual label)', () => {
    const before = computeCadSampleLineGroupRevision(group(), alignment(), surfaceRevisions);
    const restyled: CadSampleLineGroup = {
      ...group(),
      name: 'Renamed',
      layerId: 'other',
      surfaceSources: [
        { surfaceId: 'surf-1', sectionStyleId: 'other-style' },
        { surfaceId: 'surf-2' },
      ],
      sampleLines: [{ ...group().sampleLines[0]!, manualName: 'STA 0+010' }, group().sampleLines[1]!],
    };
    expect(computeCadSampleLineGroupRevision(restyled, alignment(), surfaceRevisions)).toBe(before);
  });

  it('excludes station-equation display mapping (equation-only edit keeps identity)', () => {
    const before = computeCadSampleLineGroupRevision(group(), alignment(), surfaceRevisions);
    const lineBefore = computeCadSampleLineRevision(group().sampleLines[0]!, alignment(), 'align-1');
    const equationChanged = {
      ...alignment(),
      stationEquations: [{ backStation: 50, aheadStation: 200, rawStation: 50 }],
    };
    expect(computeCadSampleLineGroupRevision(group(), equationChanged, surfaceRevisions)).toBe(before);
    expect(
      computeCadSampleLineRevision(group().sampleLines[0]!, equationChanged, 'align-1'),
    ).toBe(lineBefore);
  });

  it('moves on alignment XY geometry and start-station change', () => {
    const before = computeCadSampleLineGroupRevision(group(), alignment(), surfaceRevisions);
    const moved = { ...alignment(), elements: [{ kind: 'line' as const, start: { x: 0, y: 0 }, end: { x: 100, y: 5 } }] };
    expect(computeCadSampleLineGroupRevision(group(), moved, surfaceRevisions)).not.toBe(before);
    expect(
      computeCadSampleLineGroupRevision(group(), { ...alignment(), startStation: 100 }, surfaceRevisions),
    ).not.toBe(before);
  });

  it('moves on raw station, width, skew, and source surface revision change', () => {
    const before = computeCadSampleLineGroupRevision(group(), alignment(), surfaceRevisions);
    const movedStation: CadSampleLine = { ...group().sampleLines[0]!, rawStation: 11 };
    expect(
      computeCadSampleLineGroupRevision(
        { ...group(), sampleLines: [movedStation, group().sampleLines[1]!] },
        alignment(),
        surfaceRevisions,
      ),
    ).not.toBe(before);
    const widened: CadSampleLine = { ...group().sampleLines[0]!, leftWidth: 8 };
    expect(
      computeCadSampleLineRevision(widened, alignment(), 'align-1'),
    ).not.toBe(computeCadSampleLineRevision(group().sampleLines[0]!, alignment(), 'align-1'));
    const skewed: CadSampleLine = { ...group().sampleLines[0]!, skewDeg: 15 };
    expect(
      computeCadSampleLineRevision(skewed, alignment(), 'align-1'),
    ).not.toBe(computeCadSampleLineRevision(group().sampleLines[0]!, alignment(), 'align-1'));
    expect(
      computeCadSampleLineGroupRevision(group(), alignment(), { ...surfaceRevisions, 'surf-1': 'srev1:cccc' }),
    ).not.toBe(before);
  });

  it('view revision tracks settings only', () => {
    const view = {
      id: 'sview-1',
      sampleLineGroupId: 'grp-1',
      sampleLineId: 'line-1',
      sourceSurfaceIds: ['surf-1'],
      insertionX: 0,
      insertionY: 0,
      horizontalScale: 1,
      verticalExaggeration: 5,
      datumMode: 'auto' as const,
    };
    const first = computeCadSectionViewRevision(view);
    expect(first.startsWith('sview1:')).toBe(true);
    expect(computeCadSectionViewRevision({ ...view })).toBe(first);
    expect(computeCadSectionViewRevision({ ...view, verticalExaggeration: 10 })).not.toBe(first);
    expect(
      computeCadSectionViewRevision({ ...view, datumMode: 'explicit', datumElevation: 4 }),
    ).not.toBe(first);
  });
});

describe('section status matrix', () => {
  const healthy = {
    groupExists: true,
    lineExists: true,
    alignmentExists: true,
    surfaceExists: true,
    surfaceStatus: 'CURRENT' as const,
    surfaceRevisionAtBuild: 'srev1:a',
    currentSurfaceRevision: 'srev1:a',
    hasResult: true,
    building: false,
    outOfRange: false,
    hasCoverage: true,
  };

  it('derives CURRENT when everything matches', () => {
    expect(deriveCadSectionStatus(healthy)).toBe('CURRENT');
  });

  it('derives BUILDING first', () => {
    expect(deriveCadSectionStatus({ ...healthy, building: true })).toBe('BUILDING');
  });

  it('derives BROKEN_REFERENCE for missing refs', () => {
    for (const field of ['groupExists', 'lineExists', 'alignmentExists', 'surfaceExists'] as const) {
      expect(deriveCadSectionStatus({ ...healthy, [field]: false })).toBe('BROKEN_REFERENCE');
    }
    expect(deriveCadSectionStatus({ ...healthy, surfaceStatus: 'MISSING' })).toBe(
      'BROKEN_REFERENCE',
    );
    expect(deriveCadSectionStatus({ ...healthy, surfaceStatus: 'BROKEN_REFERENCE' })).toBe(
      'BROKEN_REFERENCE',
    );
  });

  it('derives OUT_OF_RANGE ahead of build currency', () => {
    expect(deriveCadSectionStatus({ ...healthy, outOfRange: true })).toBe('OUT_OF_RANGE');
    expect(
      deriveCadSectionStatus({ ...healthy, outOfRange: true, surfaceStatus: 'NEEDS_REBUILD' }),
    ).toBe('OUT_OF_RANGE');
  });

  it('derives SOURCE_NOT_CURRENT while the source TIN is stale', () => {
    for (const surfaceStatus of [
      'UNBUILT',
      'NEEDS_REBUILD',
      'BUILDING',
      'FAILED',
      'INSUFFICIENT_DATA',
    ] as const) {
      expect(deriveCadSectionStatus({ ...healthy, surfaceStatus })).toBe('SOURCE_NOT_CURRENT');
    }
  });

  it('derives UNBUILT vs FAILED without a result', () => {
    expect(deriveCadSectionStatus({ ...healthy, hasResult: false })).toBe('UNBUILT');
    expect(
      deriveCadSectionStatus({ ...healthy, hasResult: false, diagnostic: 'boom' }),
    ).toBe('FAILED');
  });

  it('derives NEEDS_REBUILD when the source moved under a fresh result', () => {
    expect(deriveCadSectionStatus({ ...healthy, currentSurfaceRevision: 'srev1:b' })).toBe(
      'NEEDS_REBUILD',
    );
  });

  it('derives NO_COVERAGE for gap-only results', () => {
    expect(deriveCadSectionStatus({ ...healthy, hasCoverage: false })).toBe('NO_COVERAGE');
  });
});
