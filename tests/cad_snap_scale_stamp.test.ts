import { describe, expect, it } from 'vitest';
import type { CadSnapCandidate } from '../src/engine/cad/cadTypes';
import { withCadSnapViewportStamp } from '../src/hooks/surveyCad/useSurveyCadSnapping';

describe('CAD snap viewport stamp', () => {
  it('purely annotates a snap candidate with its computation scale and generation', () => {
    const candidate: CadSnapCandidate = {
      id: 'snap:1',
      kind: 'midpoint',
      sourceEntityId: 'line:1',
      sourceSegmentId: 'line:1#0',
      x: 1,
      y: 2,
      distance: 0.3,
      label: 'P1',
    };
    const stamped = withCadSnapViewportStamp(candidate, 2.5, 7);
    expect(stamped).toEqual({ ...candidate, computedScale: 2.5, viewportGeneration: 7 });
    // The input is never mutated.
    expect(candidate).not.toHaveProperty('computedScale');
    expect(candidate).not.toHaveProperty('viewportGeneration');
  });

  it('preserves every existing field and accepts zero stamps', () => {
    const candidate: CadSnapCandidate = {
      id: 'snap:2',
      kind: 'endpoint',
      sourceEntityId: 'arc:1',
      x: 0,
      y: 0,
      distance: 0,
      label: 'A',
      guideSegments: [[{ x: 0, y: 0 }, { x: 1, y: 1 }]],
      compoundKinds: ['endpoint', 'quadrant'],
    };
    const stamped = withCadSnapViewportStamp(candidate, 0, 0);
    expect(stamped).toMatchObject({
      id: 'snap:2',
      kind: 'endpoint',
      computedScale: 0,
      viewportGeneration: 0,
    });
    expect(stamped.guideSegments).toEqual(candidate.guideSegments);
    expect(stamped.compoundKinds).toEqual(['endpoint', 'quadrant']);
  });
});
