/**
 * Phase 20H — mixed-analytic grading-group contract.
 *
 * One group terminates in ONE DOMAIN: `surface` (fixed/cut-fill) or
 * `analytic` (distance/elevation/relative-elevation). This suite pins the
 * domain projection, the same-domain compatibility matrix, the authoring and
 * persistence gates, sparse per-course overrides, the resolve/compute
 * fail-closed gates, revision/hash movement, project-transform scaling,
 * mixed-analytic provenance, and the snapshot/status seam.
 *
 * Numerical oracles live in `cad_grading_mixed_analytic_oracles_20h`.
 */
import { describe, expect, it } from 'vitest';

import { computeGradingGroupFromSnapshots } from '../src/engine/cad/grading/gradingGroupCompute';
import { createGroupDefinition, editGroupCriteria, setCourseCriteriaOverrides, resetCourseCriteriaOverrides } from '../src/engine/cad/grading/gradingGroupAuthoring';
import {
  canonicalCourseCriteria,
  criteriaEqual,
  resolveGroupMemberCriteria,
} from '../src/engine/cad/grading/gradingGroupCourseCriteria';
import {
  canonicalAnalyticKinds,
  groupTerminationFamily,
  validateGroupTermination,
  validateGroupTerminationCriteria,
  validateGroupTerminationDomainCriteria,
} from '../src/engine/cad/grading/gradingGroupTermination';
import { buildGroupRevision } from '../src/engine/cad/grading/gradingGroupRevision';
import { resolveGroupInputs } from '../src/engine/cad/grading/gradingGroupResolve';
import { createCadHistoryState, runCadCommand } from '../src/engine/cad/cadUndoRedo';
import { groupMethodSummary } from '../src/cad-app/shell/cadGradingGroupMethodSummary';
import { buildGroupCsv, buildGroupInquiryReport } from '../src/cad-app/shell/cadGradingGroupReport';
import { validateGradingCriterion } from '../src/engine/cad/grading/gradingAuthoring';
import { parseCadDrawingFile, serializeCadDrawingFile, createBlankCadDrawingDocument } from '../src/engine/cad/cadDrawingFile';
import { normalizeTinProvenance, tinProvenanceRevisionPart } from '../src/engine/cad/cadImportedTin';
import { makeDesignPatchProvenance } from '../src/engine/cad/grading/designPatchBuild';
import { scaleCadGradingGroup } from '../src/engine/cad/cadProjectTransformGrading';
import {
  gradingTerminationDomain,
  gradingTerminationKind,
  type GradingCriterion,
  type ResolvedGradingSource,
} from '../src/engine/cad/grading/gradingTypes';
import type { CadGradingGroup, GradingGroupCourse } from '../src/engine/cad/grading/gradingGroupTypes';
import type { CadFeatureLineEntity, CadProject } from '../src/engine/cad/cadTypes';
import { buildCadGradingGroupSnapshot } from '../src/cad-app/shell/cadGradingGroupSnapshot';

const DIST = (g: number, d: number): GradingCriterion => ({ kind: 'distance', gradeRatio: g, distance: d });
const ELEV = (g: number, e: number): GradingCriterion => ({ kind: 'elevation', gradeRatio: g, targetElevation: e });
const REL = (g: number, dz: number): GradingCriterion => ({ kind: 'relative-elevation', gradeRatio: g, relativeElevation: dz });
const FIXED: GradingCriterion = { kind: 'fixed', gradeRatio: -0.5 };
const CUTFILL: GradingCriterion = { kind: 'cut-fill', cutGradeRatio: 0.5, fillGradeRatio: -0.5 };

const COURSES: GradingGroupCourse[] = [
  { vertexAId: 'a', vertexBId: 'b' },
  { vertexAId: 'b', vertexBId: 'c' },
  { vertexAId: 'c', vertexBId: 'd' },
  { vertexAId: 'd', vertexBId: 'a' },
];

const straight = (sx: number, sy: number, ex: number, ey: number, sz = 10, ez = 10): ResolvedGradingSource => ({
  startX: sx, startY: sy, endX: ex, endY: ey, startZ: sz, endZ: ez,
  length: Math.hypot(ex - sx, ey - sy), reoriented: false, isArc: false,
});

const square = (): ResolvedGradingSource[] => [
  straight(0, 0, 100, 0), straight(100, 0, 100, 100),
  straight(100, 100, 0, 100), straight(0, 100, 0, 0),
];

const groupInput = (criterion: GradingCriterion, courseCriteria?: CadGradingGroup['courseCriteria']) => ({
  id: 'gg', name: 'gg', sourceFeatureLineId: 'fl', sourceCourses: COURSES,
  side: 'right' as const, criterion, maxSearchDistance: 50, curveChordTolerance: 0.05,
  cornerMode: 'miter' as const, closed: true,
  ...(courseCriteria !== undefined ? { courseCriteria } : {}),
});

// ---------------------------------------------------------------------------
// 1. Domain projection
// ---------------------------------------------------------------------------
describe('(1) domain projection', () => {
  it('maps surface kinds to surface and analytic kinds to analytic', () => {
    expect(gradingTerminationDomain(FIXED)).toBe('surface');
    expect(gradingTerminationDomain(CUTFILL)).toBe('surface');
    expect(gradingTerminationDomain(DIST(-0.5, 20))).toBe('analytic');
    expect(gradingTerminationDomain(ELEV(-0.5, 0))).toBe('analytic');
    expect(gradingTerminationDomain(REL(-0.5, -10))).toBe('analytic');
    // The kind projection is unchanged (still 4-way).
    expect(gradingTerminationKind(FIXED)).toBe('surface');
    expect(gradingTerminationKind(REL(-0.5, -10))).toBe('relative-elevation');
    expect(groupTerminationFamily(DIST(-0.5, 20))).toBe('distance');
  });

  it('canonicalAnalyticKinds orders distance → elevation → relative and drops surface', () => {
    const kinds = [
      REL(-0.5, -10), ELEV(-0.5, 0), DIST(-0.5, 20), DIST(-0.25, 10), FIXED,
    ];
    expect(canonicalAnalyticKinds(kinds)).toEqual(['distance', 'elevation', 'relative-elevation']);
    expect(canonicalAnalyticKinds([DIST(-0.5, 20)])).toEqual(['distance']);
    expect(canonicalAnalyticKinds([FIXED, CUTFILL])).toEqual([]);
    expect(canonicalAnalyticKinds([])).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 2. Same-domain compatibility matrix
// ---------------------------------------------------------------------------
describe('(2) same-domain compatibility matrix', () => {
  it('accepts every analytic pairing (default + overrides)', () => {
    const analytic = [DIST(-0.5, 20), ELEV(-0.5, 0), REL(-0.5, -10)];
    for (const base of analytic) {
      for (const other of analytic) {
        expect(validateGroupTerminationDomainCriteria(base, [other])).toBeNull();
        expect(validateGroupTerminationCriteria(base, [other])).toBeNull();
      }
    }
    expect(validateGroupTerminationCriteria(DIST(-0.5, 20), analytic)).toBeNull();
  });

  it('accepts surface fixed/cut-fill mixing (unchanged legacy domain)', () => {
    expect(validateGroupTerminationDomainCriteria(FIXED, [CUTFILL])).toBeNull();
    expect(validateGroupTerminationCriteria(CUTFILL, [FIXED])).toBeNull();
  });

  it('rejects surface+analytic in BOTH directions with the domain message', () => {
    expect(validateGroupTerminationDomainCriteria(FIXED, [DIST(-0.5, 20)])).toContain('termination');
    expect(validateGroupTerminationDomainCriteria(DIST(-0.5, 20), [FIXED])).toContain('termination');
    expect(validateGroupTerminationCriteria(FIXED, [ELEV(-0.5, 0)])).toContain('termination');
    expect(validateGroupTerminationCriteria(REL(-0.5, -10), [CUTFILL])).toContain('termination');
  });
});

// ---------------------------------------------------------------------------
// 3. Authoring + default switch
// ---------------------------------------------------------------------------
describe('(3) authoring + default switch', () => {
  it('creates a mixed-analytic group (analytic default + different analytic override)', () => {
    const created = createGroupDefinition(groupInput(DIST(-0.5, 20), [
      { sourceCourse: COURSES[1]!, criterion: REL(-0.25, -10) },
      { sourceCourse: COURSES[2]!, criterion: ELEV(-0.5, 0) },
    ]));
    if (!created.ok) throw new Error(created.error);
    expect(created.value.courseCriteria).toHaveLength(2);
    expect(resolveGroupMemberCriteria(created.value)).toEqual([
      DIST(-0.5, 20), REL(-0.25, -10), ELEV(-0.5, 0), DIST(-0.5, 20),
    ]);
  });

  it('rejects a cross-domain override in both directions', () => {
    const surfaceGroup = createGroupDefinition(groupInput(FIXED, [
      { sourceCourse: COURSES[1]!, criterion: DIST(-0.5, 20) },
    ]));
    expect(surfaceGroup.ok).toBe(false);
    const analyticGroup = createGroupDefinition(groupInput(DIST(-0.5, 20), [
      { sourceCourse: COURSES[1]!, criterion: FIXED },
    ]));
    expect(analyticGroup.ok).toBe(false);
  });

  it('switches the default freely within the analytic domain and blocks cross-domain switches', () => {
    const created = createGroupDefinition(groupInput(DIST(-0.5, 20), [
      { sourceCourse: COURSES[1]!, criterion: REL(-0.25, -10) },
    ]));
    if (!created.ok) throw new Error(created.error);

    const toElevation = editGroupCriteria(created.value, ELEV(-0.5, 0));
    if (!toElevation.ok) throw new Error(toElevation.error);
    expect(toElevation.value.criterion).toEqual(ELEV(-0.5, 0));
    expect(toElevation.value.courseCriteria).toHaveLength(1);

    const toSurface = editGroupCriteria(created.value, FIXED);
    expect(toSurface.ok).toBe(false);
  });

  it('validates each analytic criterion in the mix independently', () => {
    expect(validateGradingCriterion(DIST(-0.5, 20))).toBeNull();
    expect(validateGradingCriterion(ELEV(-0.5, 0))).toBeNull();
    expect(validateGradingCriterion(REL(-0.5, -10))).toBeNull();
    // Wrong-sign Relative Elevation is rejected by authoring (single authority).
    expect(validateGradingCriterion(REL(0.5, -10))).toContain('opposite direction');
  });
});

// ---------------------------------------------------------------------------
// 4. Sparse per-course overrides
// ---------------------------------------------------------------------------
describe('(4) sparse per-course overrides', () => {
  const withMixed = (): CadGradingGroup => {
    const created = createGroupDefinition(groupInput(DIST(-0.5, 20), [
      { sourceCourse: COURSES[1]!, criterion: REL(-0.25, -10) },
    ]));
    if (!created.ok) throw new Error(created.error);
    return created.value;
  };

  it('keeps differing analytic overrides and drops exact-equal ones', () => {
    expect(canonicalCourseCriteria(withMixed())).toHaveLength(1);
    const created = createGroupDefinition(groupInput(DIST(-0.5, 20), [
      { sourceCourse: COURSES[1]!, criterion: DIST(-0.5, 20) },
    ]));
    if (!created.ok) throw new Error(created.error);
    expect(canonicalCourseCriteria(created.value)).toEqual([]);
  });

  it('structural equality is exact across analytic kinds', () => {
    expect(criteriaEqual(REL(-0.5, -10), REL(-0.5, -10))).toBe(true);
    expect(criteriaEqual(REL(-0.5, -10), REL(-0.25, -10))).toBe(false);
    expect(criteriaEqual(REL(-0.5, -10), DIST(-0.5, 20))).toBe(false);
    expect(criteriaEqual(ELEV(-0.5, 0), REL(-0.5, 0))).toBe(false);
  });

  it('set/reset overrides through the authoring seam keeps the analytic mix', () => {
    const created = createGroupDefinition(groupInput(DIST(-0.5, 20)));
    if (!created.ok) throw new Error(created.error);
    const applied = setCourseCriteriaOverrides(created.value, [COURSES[1]!], REL(-0.25, -10));
    if (!applied.ok) throw new Error(applied.error);
    expect(applied.value.courseCriteria).toHaveLength(1);
    const reset = resetCourseCriteriaOverrides(applied.value, [COURSES[1]!]);
    if (!reset.ok) throw new Error(reset.error);
    expect(reset.value.courseCriteria ?? []).toHaveLength(0);
    expect(validateGroupTermination(reset.value)).toBeNull();
  });

  it('never materializes defaults: absent courseCriteria stays absent', () => {
    const created = createGroupDefinition(groupInput(DIST(-0.5, 20)));
    if (!created.ok) throw new Error(created.error);
    expect(created.value).not.toHaveProperty('courseCriteria');
    expect(resolveGroupMemberCriteria(created.value)).toEqual([DIST(-0.5, 20), DIST(-0.5, 20), DIST(-0.5, 20), DIST(-0.5, 20)]);
  });
});

// ---------------------------------------------------------------------------
// 5. Resolve + compute fail-closed gates
// ---------------------------------------------------------------------------
describe('(5) resolve + compute gates', () => {
  it('compute admits a surface+analytic mix as hybrid (20J), still fail-closed without a target', () => {
    // Flat-90 grid: surface strips tie at d=20, analytic limits match it.
    const xs: number[] = [];
    for (let v = -60; v <= 160 + 1e-9; v += 20) xs.push(v);
    const points: number[] = [];
    const idx = (ix: number, iy: number): number => iy * xs.length + ix;
    for (const y of xs) for (const x of xs) points.push(x, y, 0);
    const triangles: number[] = [];
    for (let ix = 0; ix + 1 < xs.length; ix += 1) {
      for (let iy = 0; iy + 1 < xs.length; iy += 1) {
        const a = idx(ix, iy);
        const b = idx(ix + 1, iy);
        const c = idx(ix + 1, iy + 1);
        const d = idx(ix, iy + 1);
        triangles.push(a, b, c, a, c, d);
      }
    }
    const target = { points, triangles };
    for (const memberCriteria of [
      [FIXED, DIST(-0.5, 20)],
      [DIST(-0.5, 20), FIXED],
      [CUTFILL, REL(-0.5, -10)],
    ]) {
      const admitted = computeGradingGroupFromSnapshots({
        groupId: 'gg', revision: 'r', members: square(), side: 'right',
        criterion: memberCriteria[0]!, memberCriteria,
        maxSearchDistance: 50, curveChordTolerance: 0.05, closed: true,
        target,
      });
      expect(admitted.ok).toBe(true);
    }
    // No target with a surface member: fail closed before any partial
    // solve (never a crash, never a half-solved mesh).
    const noTarget = computeGradingGroupFromSnapshots({
      groupId: 'gg', revision: 'r', members: square(), side: 'right',
      criterion: FIXED, memberCriteria: [FIXED, DIST(-0.5, 20)],
      maxSearchDistance: 50, curveChordTolerance: 0.05, closed: true,
    });
    expect(noTarget.ok).toBe(false);
    if (noTarget.ok) throw new Error('expected MEMBER_NO_SOLUTION');
    expect(noTarget.code).toBe('MEMBER_NO_SOLUTION');
    expect(noTarget.detail).toBe('GRADING_BAD_TARGET_MESH');
  });

  it('compute still solves an all-analytic mixed group (control)', () => {
    const out = computeGradingGroupFromSnapshots({
      groupId: 'gg', revision: 'r', members: square(), side: 'right',
      criterion: DIST(-0.5, 20),
      memberCriteria: [DIST(-0.5, 20), ELEV(-0.5, 0), REL(-0.5, -10), DIST(-0.5, 20)],
      maxSearchDistance: 50, curveChordTolerance: 0.05, closed: true,
    });
    expect(out.ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 6. Revisions
// ---------------------------------------------------------------------------
describe('(6) revisions', () => {
  const revisionInput = (criterion: GradingCriterion, override?: CadGradingGroup['courseCriteria']) => ({
    sourceFeatureLineId: 'fl-1',
    courses: [
      { vertexAId: 'v-a', vertexBId: 'v-b', resolvedSource: straight(0, 0, 100, 0) },
      { vertexAId: 'v-b', vertexBId: 'v-c', resolvedSource: straight(100, 0, 100, 100) },
    ],
    side: 'right' as const,
    criterion,
    ...(override !== undefined ? { courseCriteria: override } : {}),
    maxSearchDistance: 30, curveChordTolerance: 0.01, cornerMode: 'miter' as const, closed: false,
  });

  it('a mixed-analytic override moves the hash and a kind change moves it further', () => {
    const base = buildGroupRevision(revisionInput(DIST(-0.5, 20)));
    const mixed = buildGroupRevision(revisionInput(DIST(-0.5, 20), [
      { sourceCourse: { vertexAId: 'v-b', vertexBId: 'v-c' }, criterion: REL(-0.25, -10) },
    ]));
    const otherKind = buildGroupRevision(revisionInput(DIST(-0.5, 20), [
      { sourceCourse: { vertexAId: 'v-b', vertexBId: 'v-c' }, criterion: ELEV(-0.5, 0) },
    ]));
    expect(mixed).not.toBe(base);
    expect(otherKind).not.toBe(base);
    expect(mixed).not.toBe(otherKind);
  });

  it('pins the mixed-analytic ggrev1 hashes (separate from the 40 legacy pins)', () => {
    // 4-course closed chain; the pins are the landed Phase 20H hash values.
    const probe = (criterion: GradingCriterion, courseCriteria?: CadGradingGroup['courseCriteria']) =>
      buildGroupRevision({
        sourceFeatureLineId: 'fl-1',
        courses: [
          { vertexAId: 'v-a', vertexBId: 'v-b', resolvedSource: straight(0, 0, 100, 0) },
          { vertexAId: 'v-b', vertexBId: 'v-c', resolvedSource: straight(100, 0, 100, 100) },
          { vertexAId: 'v-c', vertexBId: 'v-d', resolvedSource: straight(100, 100, 0, 100) },
          { vertexAId: 'v-d', vertexBId: 'v-a', resolvedSource: straight(0, 100, 0, 0) },
        ],
        side: 'right', criterion, ...(courseCriteria !== undefined ? { courseCriteria } : {}),
        maxSearchDistance: 30, curveChordTolerance: 0.01, cornerMode: 'miter', closed: true,
      });
    expect(probe(DIST(-0.5, 20), [
      { sourceCourse: { vertexAId: 'v-b', vertexBId: 'v-c' }, criterion: DIST(-0.5, 20) },
    ])).toBe('ggrev1:24615e6f');
    expect(probe(DIST(-0.5, 20), [
      { sourceCourse: { vertexAId: 'v-b', vertexBId: 'v-c' }, criterion: REL(-0.5, -10) },
      { sourceCourse: { vertexAId: 'v-c', vertexBId: 'v-d' }, criterion: ELEV(-0.5, 0) },
    ])).toBe('ggrev1:fcdf630e');
    expect(probe(REL(-0.5, -10), [
      { sourceCourse: { vertexAId: 'v-b', vertexBId: 'v-c' }, criterion: ELEV(-0.5, 0) },
    ])).toBe('ggrev1:798e3626');
  });
});

// ---------------------------------------------------------------------------
// 7. Project transform
// ---------------------------------------------------------------------------
describe('(7) project transform', () => {
  it('scales the Distance default but never the vertical analytic inputs', () => {
    const created = createGroupDefinition(groupInput(DIST(-0.5, 20), [
      { sourceCourse: COURSES[1]!, criterion: REL(-0.25, -10) },
      { sourceCourse: COURSES[2]!, criterion: ELEV(-0.5, 0) },
    ]));
    if (!created.ok) throw new Error(created.error);
    const scaled = scaleCadGradingGroup(created.value, 2);
    expect(scaled.criterion).toEqual(DIST(-0.5, 40));
    expect(scaled.courseCriteria![0]!.criterion).toEqual(REL(-0.25, -10));
    expect(scaled.courseCriteria![1]!.criterion).toEqual(ELEV(-0.5, 0));
    expect(scaled.maxSearchDistance).toBe(100);
    expect(scaled.curveChordTolerance).toBe(0.1);
  });
});

// ---------------------------------------------------------------------------
// 8. Mixed-analytic provenance
// ---------------------------------------------------------------------------
describe('(8) mixed-analytic provenance', () => {
  it('design-patch provenance records mixed-analytic + canonical kinds', () => {
    const provenance = makeDesignPatchProvenance({
      groupId: 'gg', groupName: 'gg', groupRevision: 'ggrev1:x', sourceFeatureLineId: 'fl',
      sourceCourseRefs: ['a>b', 'b>c', 'c>d'],
      criterion: DIST(-0.5, 20),
      memberCriteria: [DIST(-0.5, 20), REL(-0.25, -10), ELEV(-0.5, 0)],
      accuracy: 'EXACT', interiorPolicy: 'flat-source',
    });
    expect(provenance.targetKind).toBe('mixed-analytic');
    expect(provenance.analyticKinds).toEqual(['distance', 'elevation', 'relative-elevation']);
    expect(provenance).not.toHaveProperty('targetSurfaceId');
    expect(tinProvenanceRevisionPart(normalizeTinProvenance(provenance)!))
      .toContain('mixed-analytic:distance+elevation+relative-elevation');
  });

  it('homogeneous analytic provenance is unchanged (no mixed-analytic leg)', () => {
    const single = makeDesignPatchProvenance({
      groupId: 'gg', groupName: 'gg', groupRevision: 'ggrev1:x', sourceFeatureLineId: 'fl',
      sourceCourseRefs: ['a>b'], criterion: REL(-0.5, -10),
      memberCriteria: [REL(-0.5, -10), REL(-0.5, -12)],
      accuracy: 'EXACT', interiorPolicy: 'flat-source',
    });
    expect(single.targetKind).toBe('relative-elevation');
    expect(single).not.toHaveProperty('analyticKinds');
  });

  it('group-bake provenance carries mixed-analytic and normalizes canonical kinds', () => {
    const normalized = normalizeTinProvenance({
      kind: 'webnet-grading-group-bake',
      groupId: 'gg', groupName: 'gg', groupRevision: 'ggrev1:x', sourceFeatureLineId: 'fl',
      sourceCourseRefs: ['a>b', 'b>c'],
      targetKind: 'mixed-analytic',
      analyticKinds: ['relative-elevation', 'distance', 'elevation', 'relative-elevation'],
      side: 'right', accuracy: 'EXACT', cornerMode: 'miter',
    });
    if (normalized == null || normalized.kind !== 'webnet-grading-group-bake') throw new Error('not normalized');
    expect(normalized.targetKind).toBe('mixed-analytic');
    expect(normalized.analyticKinds).toEqual(['distance', 'elevation', 'relative-elevation']);
  });

  it('a standalone single-grading bake never carries mixed-analytic (reads as surface)', () => {
    const normalized = normalizeTinProvenance({
      kind: 'webnet-grading-bake', gradingId: 'g', gradingName: 'g', gradingRevision: 'grev1:x',
      sourceFeatureLineId: 'fl', sourceVertexAId: 'a', sourceVertexBId: 'b',
      // Stray hand-edited value must not survive as mixed-analytic.
      targetKind: 'mixed-analytic' as never, accuracy: 'EXACT',
    });
    expect((normalized as { targetKind?: string }).targetKind).toBe('surface');
    expect(normalized).not.toHaveProperty('analyticKinds');
  });
});

// ---------------------------------------------------------------------------
// 8b. A fully-overridden default names no effective method (reviewer major)
// ---------------------------------------------------------------------------
describe('(8b) fully-overridden default is invisible to summary + provenance', () => {
  const overriddenGroup = (): CadGradingGroup => {
    const courses: GradingGroupCourse[] = [
      { vertexAId: 'v0', vertexBId: 'v1' }, { vertexAId: 'v1', vertexBId: 'v2' },
      { vertexAId: 'v2', vertexBId: 'v3' }, { vertexAId: 'v3', vertexBId: 'v0' },
    ];
    const created = createGroupDefinition({
      ...groupInput(DIST(-0.5, 20), courses.map((sourceCourse) => ({
        sourceCourse, criterion: REL(-0.5, -10),
      }))),
      sourceFeatureLineId: 'fl-1',
      sourceCourses: courses,
    });
    if (!created.ok) throw new Error(created.error);
    return { ...created.value, id: 'gg-overridden' };
  };

  const overriddenProject = (): CadProject => ({
    ...createBlankCadDrawingDocument({ name: '20h-overridden', units: 'm' }).project,
    entities: [{
      id: 'fl-1', type: 'feature-line', layerId: 'general', visible: true, locked: false, name: 'Pad FL',
      vertices: [
        { id: 'v0', x: 0, y: 0, z: 10 }, { id: 'v1', x: 100, y: 0, z: 10 },
        { id: 'v2', x: 100, y: 100, z: 10 }, { id: 'v3', x: 0, y: 100, z: 10 },
      ],
      closed: true,
    }],
    gradingGroups: [overriddenGroup()],
  });

  it('groupMethodSummary reads only effective courses, not the stored default', () => {
    const summary = groupMethodSummary(overriddenGroup());
    expect(summary.label).toBe('Relative Elevation');
    expect(summary.mixedAnalytic).toBe(false);
    expect(summary.kinds).toEqual(['relative-elevation']);
    expect(summary.detail).toBe('Relative Elevation');
  });

  it('design-patch provenance drops the unused Distance default', () => {
    const provenance = makeDesignPatchProvenance({
      groupId: 'gg-overridden', groupName: 'gg', groupRevision: 'ggrev1:x', sourceFeatureLineId: 'fl-1',
      sourceCourseRefs: ['v0>v1', 'v1>v2', 'v2>v3', 'v3>v0'],
      criterion: DIST(-0.5, 20),
      memberCriteria: [REL(-0.5, -10), REL(-0.5, -10), REL(-0.5, -10), REL(-0.5, -10)],
      accuracy: 'EXACT', interiorPolicy: 'flat-source',
    });
    expect(provenance.targetKind).toBe('relative-elevation');
    expect(provenance).not.toHaveProperty('analyticKinds');
    expect(provenance).toMatchObject({ relativeElevation: -10 });
    expect(provenance).not.toHaveProperty('criterionDistance');
  });

  it('GROUPBAKE carries the effective Relative Elevation provenance end to end', () => {
    const project = overriddenProject();
    const inputs = resolveGroupInputs(project, 'gg-overridden');
    if (!inputs) throw new Error('group inputs did not resolve');
    const outcome = computeGradingGroupFromSnapshots({
      groupId: 'gg-overridden', revision: inputs.revision,
      members: inputs.memberSources, side: inputs.group.side,
      criterion: inputs.group.criterion, memberCriteria: inputs.memberCriteria,
      maxSearchDistance: inputs.group.maxSearchDistance,
      curveChordTolerance: inputs.group.curveChordTolerance,
      closed: inputs.group.closed ?? true,
    });
    if (!outcome.ok) throw new Error('overridden group did not solve');
    const baked = runCadCommand(createCadHistoryState(project), {
      key: 'GROUPBAKE', groupId: 'gg-overridden',
      result: outcome.result, expectedRevision: inputs.revision, sessionCurrent: true,
    });
    const surface = baked.present.project.surfaces!.find((entry) => entry.name === 'gg - Baked')!;
    const provenance = surface.definition.sourceKind === 'explicit-tin' &&
      surface.definition.importedTin != null
      ? surface.definition.importedTin.provenance
      : null;
    expect(provenance).toMatchObject({
      kind: 'webnet-grading-group-bake',
      groupId: 'gg-overridden',
      targetKind: 'relative-elevation',
      relativeElevation: -10,
    });
    expect(provenance).not.toHaveProperty('criterionDistance');
    expect(provenance).not.toHaveProperty('analyticKinds');
  });

  it('inquiry and CSV value rows follow the representative criterion', () => {
    const group = overriddenGroup();
    const report = buildGroupInquiryReport(group, 'Pad FL', '—', 'CURRENT', 'EXACT', null);
    expect(report).toContain('Termination: Relative Elevation');
    expect(report).not.toContain('Mixed Analytic');
  });

  it('homogeneous CSV keeps the uniform Termination/Methods shape (intentional)', () => {
    const created = createGroupDefinition({ ...groupInput(DIST(-0.5, 20)), sourceFeatureLineId: 'fl' });
    if (!created.ok) throw new Error(created.error);
    const outcome = computeGradingGroupFromSnapshots({
      groupId: 'gg', revision: 'ggrev1:csv',
      members: square(), side: 'right',
      criterion: DIST(-0.5, 20),
      memberCriteria: [DIST(-0.5, 20), DIST(-0.5, 20), DIST(-0.5, 20), DIST(-0.5, 20)],
      maxSearchDistance: 50, curveChordTolerance: 0.05, closed: true,
    });
    if (!outcome.ok) throw new Error('homogeneous group did not solve');
    const csv = buildGroupCsv(created.value, 'CURRENT', 'EXACT', outcome.result);
    expect(csv).toContain('Termination,Distance');
    expect(csv).toContain('Methods,Distance');
    expect(csv).toContain('Criterion,Grade -50.000%');
  });
});

// ---------------------------------------------------------------------------
// 9. Snapshot / status / export gate
// ---------------------------------------------------------------------------
describe('(9) snapshot status + export gate', () => {
  const featureLine = (): CadFeatureLineEntity => ({
    id: 'fl-1', type: 'feature-line', layerId: 'general', visible: true, locked: false, name: 'Pad FL',
    vertices: [
      { id: 'v0', x: 0, y: 0, z: 10 }, { id: 'v1', x: 100, y: 0, z: 10 },
      { id: 'v2', x: 100, y: 100, z: 10 }, { id: 'v3', x: 0, y: 100, z: 10 },
    ],
    closed: true,
  });

  const group = (): CadGradingGroup => {
    const courses: GradingGroupCourse[] = [
      { vertexAId: 'v0', vertexBId: 'v1' }, { vertexAId: 'v1', vertexBId: 'v2' },
      { vertexAId: 'v2', vertexBId: 'v3' }, { vertexAId: 'v3', vertexBId: 'v0' },
    ];
    const created = createGroupDefinition({
      ...groupInput(DIST(-0.5, 20), [
        { sourceCourse: courses[1]!, criterion: REL(-0.25, -10) },
        { sourceCourse: courses[2]!, criterion: ELEV(-0.5, 0) },
      ]),
      sourceFeatureLineId: 'fl-1',
      sourceCourses: courses,
    });
    if (!created.ok) throw new Error(created.error);
    return created.value;
  };

  const project = (): CadProject => ({
    ...createBlankCadDrawingDocument({ name: '20h', units: 'm' }).project,
    entities: [featureLine()],
    gradingGroups: [group()],
  });

  it('resolves a mixed-analytic group as calculable, analytic, UNBUILT, non-exportable', () => {
    const row = buildCadGradingGroupSnapshot(project(), null, null, null).groups[0]!;
    expect(row.analytic).toBe(true);
    expect(row.calculable).toBe(true);
    expect(row.exportable).toBe(false);
    expect(row.status).toBe('UNBUILT');
    expect(row.targetName).toBe('—');
    expect(row.boundaryLabel).toBe('Grading Limit');
  });

  it('WNCAD round-trip keeps a mixed-analytic override and stays schema v2', () => {
    const drawing = createBlankCadDrawingDocument({ name: '20h-save', units: 'm' });
    const withGroup = { ...drawing, project: project() };
    const text = serializeCadDrawingFile(withGroup);
    expect(text).toContain('relativeElevation');
    const parsed = parseCadDrawingFile(text);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.drawing.schemaVersion).toBe(drawing.schemaVersion);
    const reopened = parsed.drawing.project.gradingGroups ?? [];
    expect(reopened).toHaveLength(1);
    expect(resolveGroupMemberCriteria(reopened[0]!)).toEqual([
      DIST(-0.5, 20), REL(-0.25, -10), ELEV(-0.5, 0), DIST(-0.5, 20),
    ]);
  });
});
