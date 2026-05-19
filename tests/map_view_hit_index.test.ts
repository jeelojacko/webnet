import { describe, expect, it } from 'vitest';

import { buildMapViewHitIndex } from '../src/components/mapView/mapViewHitIndex';

describe('buildMapViewHitIndex', () => {
  it('returns the same nearby point and line candidates without scanning the full dataset', () => {
    const index = buildMapViewHitIndex({
      points: [
        { id: 'A', fixed: true, x: 0, y: 0, screenX: 10, screenY: 10 },
        { id: 'B', fixed: false, x: 0, y: 0, screenX: 240, screenY: 180 },
      ],
      lines: [
        {
          key: 'A|B',
          observationId: 7,
          pairKey: 'A|B',
          sourceLine: 1,
          fromId: 'A',
          toId: 'B',
          x1: 10,
          y1: 10,
          x2: 50,
          y2: 50,
          screenX1: 10,
          screenY1: 10,
          screenX2: 50,
          screenY2: 50,
        },
        {
          key: 'B|C',
          observationId: 9,
          pairKey: 'B|C',
          sourceLine: 2,
          fromId: 'B',
          toId: 'C',
          x1: 250,
          y1: 180,
          x2: 320,
          y2: 210,
          screenX1: 250,
          screenY1: 180,
          screenX2: 320,
          screenY2: 210,
        },
      ],
    });

    expect(index.pointCandidates(12, 12, 12).map((point) => point.id)).toEqual(['A']);
    expect(index.lineCandidates(18, 18, 12).map((line) => line.observationId)).toEqual([7]);
    expect(index.pointCandidates(245, 181, 16).map((point) => point.id)).toEqual(['B']);
    expect(index.lineCandidates(260, 190, 18).map((line) => line.observationId)).toEqual([9]);
  });
});
