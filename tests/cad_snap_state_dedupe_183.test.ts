import { describe, expect, it } from 'vitest';
import type { CadSnapCandidate, CadSnapLock } from '../src/engine/cad/cadTypes';
import {
  cadSnapCandidateEqual,
  cadSnapListEqual,
  cadSnapLockEqual,
} from '../src/hooks/surveyCad/cadSnapEquality';

const candidate = (over: Partial<CadSnapCandidate> = {}): CadSnapCandidate => ({
  id: 'snap:line:1#0:endpoint:0',
  kind: 'endpoint',
  sourceEntityId: 'line:1',
  sourceSegmentId: 'line:1#0',
  x: 10,
  y: 20,
  distance: 0.25,
  label: 'A',
  computedScale: 1.5,
  viewportGeneration: 3,
  ...over,
});

describe('PERF-183.1 snap semantic equality', () => {
  it('treats structurally identical candidates as equal', () => {
    expect(cadSnapCandidateEqual(candidate(), candidate())).toBe(true);
    expect(cadSnapCandidateEqual(null, null)).toBe(true);
  });

  it('distinguishes every consumed field (never id alone)', () => {
    const base = candidate();
    expect(cadSnapCandidateEqual(base, candidate({ id: 'other' }))).toBe(false);
    expect(cadSnapCandidateEqual(base, candidate({ kind: 'midpoint' }))).toBe(false);
    expect(cadSnapCandidateEqual(base, candidate({ sourceEntityId: 'line:2' }))).toBe(false);
    expect(cadSnapCandidateEqual(base, candidate({ sourceSegmentId: undefined }))).toBe(false);
    expect(cadSnapCandidateEqual(base, candidate({ x: 10.0000001 }))).toBe(false);
    expect(cadSnapCandidateEqual(base, candidate({ y: 20.0000001 }))).toBe(false);
    expect(cadSnapCandidateEqual(base, candidate({ distance: 0.5 }))).toBe(false);
    expect(cadSnapCandidateEqual(base, candidate({ label: 'B' }))).toBe(false);
    expect(cadSnapCandidateEqual(base, candidate({ computedScale: 2 }))).toBe(false);
    expect(cadSnapCandidateEqual(base, candidate({ viewportGeneration: 4 }))).toBe(false);
    expect(cadSnapCandidateEqual(base, candidate({ lockGuidePoint: { x: 1, y: 1 } }))).toBe(false);
  });

  it('compares optional guide geometry and compound kinds deeply', () => {
    const withGuides = candidate({
      guideSegments: [[{ x: 0, y: 0 }, { x: 1, y: 1 }]],
      compoundKinds: ['endpoint', 'quadrant'],
    });
    expect(cadSnapCandidateEqual(withGuides, candidate({
      guideSegments: [[{ x: 0, y: 0 }, { x: 1, y: 1 }]],
      compoundKinds: ['endpoint', 'quadrant'],
    }))).toBe(true);
    expect(cadSnapCandidateEqual(withGuides, candidate({
      guideSegments: [[{ x: 0, y: 0 }, { x: 1, y: 2 }]],
      compoundKinds: ['endpoint', 'quadrant'],
    }))).toBe(false);
    expect(cadSnapCandidateEqual(withGuides, candidate({
      guideSegments: [[{ x: 0, y: 0 }, { x: 1, y: 1 }]],
      compoundKinds: ['quadrant', 'endpoint'],
    }))).toBe(false);
  });

  it('compares lists positionally without depending on object identity', () => {
    const first = candidate();
    const second = candidate({ id: 'snap:2', x: 5 });
    expect(cadSnapListEqual([first, second], [candidate(), candidate({ id: 'snap:2', x: 5 })])).toBe(true);
    expect(cadSnapListEqual([first, second], [second, first])).toBe(false);
    expect(cadSnapListEqual([first], [first, second])).toBe(false);
  });

  it('compares construction locks field-by-field', () => {
    const lock: CadSnapLock = {
      kind: 'perpendicular',
      sourceEntityId: 'line:1',
      sourceSegmentId: 'line:1#0',
      guidePoint: { x: 10, y: 20 },
    };
    expect(cadSnapLockEqual(lock, { ...lock, guidePoint: { x: 10, y: 20 } })).toBe(true);
    expect(cadSnapLockEqual(lock, { ...lock, sourceSegmentId: 'line:1#1' })).toBe(false);
    expect(cadSnapLockEqual(lock, { ...lock, kind: 'tangent' })).toBe(false);
    expect(cadSnapLockEqual(lock, { ...lock, guidePoint: { x: 10, y: 21 } })).toBe(false);
    expect(cadSnapLockEqual(null, null)).toBe(true);
    expect(cadSnapLockEqual(lock, null)).toBe(false);
  });
});
