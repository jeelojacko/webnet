/**
 * Phase 20M.2 Wave B — transition persistence / sanitation / revision pins.
 *
 * Old files without a `transitions` key stay byte-identical (exact legacy).
 * Every structurally-object transition entry is RETAINED verbatim as intent
 * (malformed/unknown/stale/inadmissible fails closed at solve, never
 * scrubbed to absence); only structurally non-object entries drop.
 * `>1` transition rejects at selection (CARDINALITY). Transition canonical
 * fields move `ggrev1:`; recorded revision/evidence never hash (no
 * circularity); legacy hashes stay pinned byte-identical.
 */
import { describe, expect, it } from 'vitest';
import { scaleCadGradingGroup } from '../src/engine/cad/cadProjectTransformGrading';
import { selectGroupTransition } from '../src/engine/cad/grading/gradingGroupCompute';
import {
  cloneCadGradingGroup,
  sanitizeCadGradingGroups,
} from '../src/engine/cad/grading/gradingGroupPersistence';
import { buildGroupRevision } from '../src/engine/cad/grading/gradingGroupRevision';
import type {
  CadGradingGroup,
  CadGradingTransition,
} from '../src/engine/cad/grading/gradingGroupTypes';
import type { GradingCriterion, ResolvedGradingSource } from '../src/engine/cad/grading/gradingTypes';

const DIST = (g: number, d: number): GradingCriterion => ({ kind: 'distance', gradeRatio: g, distance: d });

const COURSES = [
  { vertexAId: 'v-a', vertexBId: 'v-b' },
  { vertexAId: 'v-b', vertexBId: 'v-c' },
  { vertexAId: 'v-c', vertexBId: 'v-d' },
];

const trp = (o: Partial<CadGradingTransition> = {}): CadGradingTransition => ({
  policyVersion: 'trp1',
  jointId: 'joint:1',
  memberIds: ['v-a>v-b', 'v-b>v-c'],
  width: 8,
  lawKind: 'TRANSITION_LINEAR_V1',
  lawVersion: 'v1',
  criterionFamily: 'distance',
  side: 'left',
  ...o,
});

const rawGroup = (transitions: unknown): Record<string, unknown> => ({
  id: 'g',
  name: 'g',
  sourceFeatureLineId: 'fl',
  sourceCourses: COURSES.map((c) => ({ ...c })),
  side: 'left',
  criterion: DIST(0.5, 5),
  maxSearchDistance: 50,
  curveChordTolerance: 0.05,
  cornerMode: 'miter',
  ...(transitions !== undefined ? { transitions } : {}),
});

const straight = (
  sx: number,
  sy: number,
  ex: number,
  ey: number,
  sz = 10,
  ez = 10,
): ResolvedGradingSource => ({
  startX: sx,
  startY: sy,
  endX: ex,
  endY: ey,
  startZ: sz,
  endZ: ez,
  length: Math.hypot(ex - sx, ey - sy),
  reoriented: false,
  isArc: false,
});

const revisionOf = (transitions?: CadGradingTransition[]): string =>
  buildGroupRevision({
    sourceFeatureLineId: 'fl-1',
    courses: [
      { vertexAId: 'v-a', vertexBId: 'v-b', resolvedSource: straight(0, 0, 100, 0) },
      { vertexAId: 'v-b', vertexBId: 'v-c', resolvedSource: straight(100, 0, 100, 100) },
      { vertexAId: 'v-c', vertexBId: 'v-d', resolvedSource: straight(100, 100, 0, 100) },
      { vertexAId: 'v-d', vertexBId: 'v-a', resolvedSource: straight(0, 100, 0, 0) },
    ],
    side: 'right',
    criterion: DIST(-0.5, 20),
    courseCriteria: [
      { sourceCourse: { vertexAId: 'v-b', vertexBId: 'v-c' }, criterion: DIST(-0.5, 20) },
    ],
    ...(transitions !== undefined ? { transitions } : {}),
    maxSearchDistance: 30,
    curveChordTolerance: 0.01,
    cornerMode: 'miter',
    closed: true,
  });

describe('20M.2 transition persistence', () => {
  it('round-trips a well-formed transition verbatim (clone + sanitize + JSON)', () => {
    const withEvidence = trp({
      endpoints: { refs: ['v-a>v-b', 'v-b>v-c'], values: [5, 7] },
      provenance: {
        jointId: 'joint:1',
        memberIds: ['v-a>v-b', 'v-b>v-c'],
        width: 8,
        lawKind: 'TRANSITION_LINEAR_V1',
        lawVersion: 'v1',
        criterionFamily: 'distance',
        side: 'left',
        revision: 'ggrev1:pinned',
      },
    });
    const [sanitized] = sanitizeCadGradingGroups([rawGroup([withEvidence])]);
    expect(sanitized!.transitions).toEqual([withEvidence]);
    const cloned = cloneCadGradingGroup(sanitized!);
    expect(cloned.transitions).toEqual([withEvidence]);
    expect(cloned.transitions![0]).not.toBe(sanitized!.transitions![0]);
    expect(JSON.parse(JSON.stringify(cloned)) as CadGradingGroup).toEqual(cloned);
  });

  it('leaves legacy files without the key byte-identical (no key materialized)', () => {
    const raw = rawGroup(undefined);
    const before = JSON.stringify(raw);
    const [sanitized] = sanitizeCadGradingGroups([raw]);
    expect('transitions' in sanitized!).toBe(false);
    expect(JSON.stringify(cloneCadGradingGroup(sanitized!))).toBe(before);
  });

  it('retains malformed/unknown/stale intents; non-objects become fail-closed markers', () => {
    const malformed = [
      trp({ width: NaN }),
      trp({ width: -4 }),
      trp({ policyVersion: 'trp9' }),
      trp({ lawKind: 'SMOOTHSTEP' }),
      trp({ jointId: 'bogus' }),
      trp({ memberIds: ['stale-ref', 'v-b>v-c'] }),
      trp({ memberIds: [] }),
      null,
      42,
      'joint:1',
    ];
    const [sanitized] = sanitizeCadGradingGroups([rawGroup(malformed)]);
    // 7 verbatim + 3 malformed markers (never scrubbed to absence).
    expect(sanitized!.transitions).toHaveLength(10);
    expect(sanitized!.transitions![0]).toMatchObject({ policyVersion: 'trp1', jointId: 'joint:1' });
    expect(sanitized!.transitions![2]).toMatchObject({ policyVersion: 'trp9' });
    expect(sanitized!.transitions!.slice(7)).toEqual([
      expect.objectContaining({ memberIds: [] }),
      expect.objectContaining({ memberIds: [] }),
      expect.objectContaining({ memberIds: [] }),
    ]);
  });

  it('retains a present-but-non-array field as invalid intent (never legacy)', () => {
    const [sanitized] = sanitizeCadGradingGroups([rawGroup('nope')]);
    expect(sanitized!.transitions).toHaveLength(1);
    expect(sanitized!.transitions![0]).toMatchObject({ memberIds: [] });
  });

  it('fails present-but-unreadable intent closed at selection (never legacy)', () => {
    expect(selectGroupTransition(undefined)).toEqual({ kind: 'absent' });
    expect(selectGroupTransition([])).toEqual({ kind: 'absent' });
    for (const unreadable of ['nope', 42, null, [null, 42], [trp(), null]] as const) {
      expect(selectGroupTransition(unreadable)).toEqual({
        kind: 'rejected',
        code: 'TRANSITION_MALFORMED',
        detail: 'GRADING_AGREEMENT_TRANSITION_MALFORMED',
      });
    }
    expect(selectGroupTransition([trp()])).toMatchObject({ kind: 'single' });
    expect(selectGroupTransition([trp(), trp({ jointId: 'joint:2' })])).toEqual({
      kind: 'rejected',
      code: 'TRANSITION_REJECTED',
      detail: 'GRADING_AGREEMENT_TRANSITION_CARDINALITY',
    });
  });
});

describe('20M.2 transition revision', () => {
  it('keeps the legacy hash byte-identical (existing 20H pin)', () => {
    expect(revisionOf(undefined)).toBe('ggrev1:24615e6f');
    expect(revisionOf([])).toBe('ggrev1:24615e6f');
  });

  it('moves on width/law/ref/member/family/side edits, not on evidence outputs', () => {
    const base = revisionOf([trp()]);
    expect(revisionOf([trp({ width: 9 })])).not.toBe(base);
    // Width participates EXACTLY: 40 vs 40.0000000001 straddle the exact
    // max boundary and must never share a revision (no 1e-9 collapse).
    expect(revisionOf([trp({ width: 40 })])).not.toBe(revisionOf([trp({ width: 40.0000000001 })]));
    expect(revisionOf([trp({ lawKind: 'OTHER', lawVersion: 'v9' })])).not.toBe(base);
    expect(revisionOf([trp({ memberIds: ['v-b>v-c', 'v-c>v-d'], jointId: 'joint:2' })])).not.toBe(base);
    expect(revisionOf([trp({ criterionFamily: 'elevation' })])).not.toBe(base);
    expect(revisionOf([trp({ side: 'right' })])).not.toBe(base);
    // Evidence outputs never hash: no circularity, edits to geometry still move it.
    expect(revisionOf([trp({ endpoints: { refs: ['v-a>v-b', 'v-b>v-c'], values: [5, 7] } })])).toBe(base);
    expect(
      revisionOf([
        trp({ provenance: { jointId: 'joint:1', memberIds: ['a', 'b'], width: 1, lawKind: 'x', lawVersion: 'y', criterionFamily: 'z', side: 'left', revision: 'ggrev1:other' } }),
      ]),
    ).toBe(base);
    expect(
      buildGroupRevision({
        sourceFeatureLineId: 'fl-1',
        courses: [
          { vertexAId: 'v-a', vertexBId: 'v-b', resolvedSource: straight(0, 0, 100, 0) },
          { vertexAId: 'v-b', vertexBId: 'v-c', resolvedSource: straight(100, 0, 100, 100) },
          { vertexAId: 'v-c', vertexBId: 'v-d', resolvedSource: straight(100, 100, 0, 100) },
          { vertexAId: 'v-d', vertexBId: 'v-a', resolvedSource: straight(0, 100, 0, 50) },
        ],
        side: 'right',
        criterion: DIST(-0.5, 20),
        transitions: [trp()],
        maxSearchDistance: 30,
        curveChordTolerance: 0.01,
        cornerMode: 'miter',
        closed: true,
      }),
    ).not.toBe(base);
  });

  it('scales width + distance evidence on transform, drops the stale revision stamp', () => {
    const [sanitized] = sanitizeCadGradingGroups([
      rawGroup([
        trp({
          width: 8,
          endpoints: { refs: ['v-a>v-b', 'v-b>v-c'], values: [5, 7] },
          provenance: {
            jointId: 'joint:1', memberIds: ['v-a>v-b', 'v-b>v-c'], width: 8,
            lawKind: 'TRANSITION_LINEAR_V1', lawVersion: 'v1', criterionFamily: 'distance',
            side: 'left', revision: 'ggrev1:old',
          },
        }),
      ]),
    ]);
    const scaled = scaleCadGradingGroup(sanitized!, 2);
    expect(scaled.transitions![0]!.width).toBe(16);
    expect(scaled.transitions![0]!.endpoints!.values).toEqual([10, 14]);
    expect(scaled.transitions![0]!.provenance!.width).toBe(16);
    expect('revision' in scaled.transitions![0]!.provenance!).toBe(false);
  });
});
