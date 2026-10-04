import { type CadSurfaceGrid } from '../engine/cad/cadSurfaces';
import { getSurfaceElevationAt, getSurfacePlaneAt } from '../engine/cad/cadSurfaceInterpolation';
import type { CadSurfaceCache as CadTinCache } from '../engine/cad/cadSurfaceCache';
import type { CadProject } from '../engine/cad/cadTypes';
import type { CadGradingCache } from '../engine/cad/grading/gradingCache';
import {
  createCadGradingGroupCache,
  type CadGradingGroupCache,
} from '../engine/cad/grading/gradingGroupCache';
import {
  resolveGroupInputs,
  type ResolvedGroupInputs,
} from '../engine/cad/grading/gradingGroupResolve';
import { deriveGroupStatus } from '../engine/cad/grading/gradingGroupStatus';
import { transitionEvidenceMatchesIntent } from '../engine/cad/grading/gradingTransitionProvenance';
import type { CadGradingGroupResult, CadGradingTransition, GroupDiagnosticCode, GroupStatus } from '../engine/cad/grading/gradingGroupTypes';
import { resolveGradingInputs, type ResolvedGradingInputs } from '../engine/cad/grading/gradingResolve';
import { deriveGradingStatus, deriveFailedEffectiveStatus } from '../engine/cad/grading/gradingStatus';
import type { CadGradingResult, GradingCriterion, GradingStatus, ResolvedGradingSource } from '../engine/cad/grading/gradingTypes';
import {
  admitGradingTransition,
  computeJointStations,
  selectGroupTransitions,
  transitionRejectGroupCode,
  type TransitionMemberGeometry,
} from '../engine/cad/grading/gradingTransitionPolicy';
import {
  validateDaylightAgainstTarget,
  validateGradingResultAgainstTarget,
  validateGradingSourceBoundary,
  type GradingComputeSource,
  type GradingSourceBoundaryCheck,
  type GradingTargetQuery,
  type GroupTransitionMemberView,
  type GroupTransitionPlan,
} from './surfaceGradingCompute';
import type { GradingGroupComputeRequest, SurfaceGradingRequest } from './surfaceWorkerHandler';
import type { PendingSurfaceGrading, PendingSurfaceGroupGrading } from './surfaceWorkerClient';

/**
 * Phase 20B — grade-to-surface derivation control plane (one per session).
 *
 * Mirrors SurfaceVolumeService ownership: request identity is
 * {drawingId, gradingId, revision, requestId}; late, foreign, or stale
 * results NEVER become CURRENT. Manual calculation only (a source/target
 * change never auto-starts grading work): notify* cancels in-flight work
 * for affected gradings and lets status re-derive.
 *
 * Never touches history: Calculate and worker results produce no history
 * entries. Cut/fill coverage blocking and the daylight/target agreement
 * gate both fail closed here (SOURCE_NOT_CURRENT / reject, never CURRENT).
 */

const DIAGNOSTIC_LIMIT = 300;

export interface SurfaceGradingSessionDiagnostic {
  revision: string;
  error: string;
}

/** Minimal transport surface (SurfaceWorkerClient satisfies this). */
export interface SurfaceGradingTransport {
  readonly alive: boolean;
  deriveGrading: (_request: SurfaceGradingRequest) => PendingSurfaceGrading;
  /** Phase 20C: present on transports that support batched group grading. */
  deriveGroupGrading?: (
    _request: GradingGroupComputeRequest,
  ) => PendingSurfaceGroupGrading;
  cancel: (_requestId: string) => void;
  dispose: () => void;
}

export interface SurfaceGradingServiceDeps {
  drawingId: string;
  getProject: () => CadProject;
  getDrawingId: () => string;
  tinCache: CadTinCache;
  gradingCache: CadGradingCache;
  /** Phase 20C: group result cache; defaults to a session cache for `drawingId`. */
  groupCache?: CadGradingGroupCache;
  createTransport: () => SurfaceGradingTransport | null;
  notify: (_message: string) => void;
  onStateChange: () => void;
}

interface GradingPendingEntry {
  requestId: string;
  revision: string;
  resolvedSource: GradingComputeSource;
}

interface GroupGradingPendingEntry {
  requestId: string;
  revision: string;
}

const truncateDiagnostic = (error: string): string =>
  error.length > DIAGNOSTIC_LIMIT ? `${error.slice(0, DIAGNOSTIC_LIMIT)}…` : error;


/** Flatten a cached TIN mesh to the worker's structured-clone flat arrays. */
const toTargetSnapshot = (
  points: ReadonlyArray<{ x: number; y: number; z: number }>,
  triangles: ReadonlyArray<readonly [number, number, number]>,
): { points: number[]; triangles: number[] } => {
  const flatPoints: number[] = [];
  for (const point of points) flatPoints.push(point.x, point.y, point.z);
  const flatTriangles: number[] = [];
  for (const triangle of triangles) flatTriangles.push(triangle[0], triangle[1], triangle[2]);
  return { points: flatPoints, triangles: flatTriangles };
};

/**
 * Phase 20M.2 WAVE I (plural in 20N.1 Wave F) — service-side transition
 * request assembly (pure). Every retained intent goes through the ONE
 * plural authority (`selectGroupTransitions`); each plan carries its
 * per-joint jointStation in traversal order. Absent = exact legacy
 * request. One invalid intent rejects the whole group with the bounded
 * TRANSITION_* diagnostic — Calculate fails closed without dispatching.
 */
export type GroupTransitionRequestPlan =
  | { kind: 'absent' }
  | {
      kind: 'plan';
      /** Per-joint plans in canonical joint order. */
      transitions: GroupTransitionPlan[];
      /** Per-joint member-view pairs, concatenated in canonical joint order. */
      transitionMembers: GroupTransitionMemberView[];
      transitionMemberKeys: string[];
    }
  | { kind: 'rejected'; code: GroupDiagnosticCode; detail: string };

const gradeRatioOf = (criterion: GradingCriterion): number | null =>
  criterion.kind === 'distance' ||
  criterion.kind === 'elevation' ||
  criterion.kind === 'relative-elevation'
    ? criterion.gradeRatio
    : null;

interface PlannedJointTransition {
  plan: GroupTransitionPlan;
  members: [GroupTransitionMemberView, GroupTransitionMemberView];
}

/** Admit ONE retained intent against live traversal geometry (pure). */
const planSingleTransitionIntent = (
  inputs: ResolvedGroupInputs,
  intent: CadGradingTransition,
  stations?: readonly number[],
):
  | { ok: true; value: PlannedJointTransition }
  | { ok: false; code: GroupDiagnosticCode; detail: string } => {
  const keys = inputs.memberKeys;
  const jointed = /^joint:(\d+)$/.exec(typeof intent.jointId === 'string' ? intent.jointId : '');
  const joint = jointed !== null && jointed[1] === String(Number(jointed[1])) ? Number(jointed[1]) : -1;
  const left = joint;
  const right = joint + 1;
  // Malformed retained memberIds fail closed with the bounded STALE
  // diagnostic — never dereferenced (a non-array field would throw).
  if (!Array.isArray(intent.memberIds) || intent.memberIds.length !== 2) {
    return {
      ok: false,
      code: 'TRANSITION_STALE',
      detail: 'GRADING_AGREEMENT_TRANSITION_STALE: memberIds do not resolve to adjacent members',
    };
  }
  // Present-but-malformed evidence fails closed too: the spreads below
  // would dereference null, and omitting it would admit malformed
  // presence as absent optionals.
  if (intent.endpoints !== undefined && (intent.endpoints === null || typeof intent.endpoints !== 'object' || Array.isArray(intent.endpoints))) {
    return {
      ok: false,
      code: 'TRANSITION_STALE',
      detail: 'GRADING_AGREEMENT_TRANSITION_STALE: endpoint evidence malformed',
    };
  }
  if (!transitionEvidenceMatchesIntent(intent, inputs.revision)) {
    return {
      ok: false,
      code: 'TRANSITION_STALE',
      detail: 'GRADING_AGREEMENT_TRANSITION_STALE: provenance malformed',
    };
  }
  if (
    !(joint >= 0) ||
    keys[right] === undefined ||
    keys[left] !== intent.memberIds[0] ||
    keys[right] !== intent.memberIds[1]
  ) {
    return {
      ok: false,
      code: 'TRANSITION_STALE',
      detail: 'GRADING_AGREEMENT_TRANSITION_STALE: memberIds do not resolve to adjacent members',
    };
  }
  const sourceL = inputs.memberSources[left]!;
  const sourceR = inputs.memberSources[right]!;
  const criterionL = inputs.memberCriteria[left]!;
  const criterionR = inputs.memberCriteria[right]!;
  const geometry = (
    memberId: string,
    criterion: GradingCriterion,
    source: ResolvedGradingSource,
  ): TransitionMemberGeometry => ({
    memberId,
    criterion,
    length: source.length,
    dirX: source.endX - source.startX,
    dirY: source.endY - source.startY,
    startZ: source.startZ,
    endZ: source.endZ,
    isArc: source.isArc,
    maxSearchDistance: inputs.group.maxSearchDistance,
  });
  const members = [
    geometry(keys[left]!, criterionL, sourceL),
    geometry(keys[right]!, criterionR, sourceR),
  ] as [TransitionMemberGeometry, TransitionMemberGeometry];
  const isOpen = inputs.group.closed !== true;
  const admitted = admitGradingTransition({
    policyVersion: intent.policyVersion,
    lawKind: intent.lawKind,
    lawVersion: intent.lawVersion,
    criterionFamily: intent.criterionFamily,
    jointId: intent.jointId,
    memberIds: [keys[left]!, keys[right]!],
    width: intent.width,
    side: intent.side,
    groupSide: inputs.group.side,
    isOpen,
    transitionCount: 1,
    jointZ: sourceL.endZ,
    members,
  });
  if (!admitted.ok) {
    return {
      ok: false,
      code: transitionRejectGroupCode(admitted.code),
      detail: `GRADING_AGREEMENT_TRANSITION: ${admitted.detail}`,
    };
  }
  const gL = gradeRatioOf(criterionL);
  const gR = gradeRatioOf(criterionR);
  if (gL === null || gR === null) {
    return {
      ok: false,
      code: 'TRANSITION_STALE',
      detail: 'GRADING_AGREEMENT_TRANSITION_STALE: admitted members carry no gradeRatio',
    };
  }
  // Single station authority (computeJointStations): cumulative end-stations,
  // one left-to-right pass shared by the whole request — identical addition
  // order to the former per-intent manual loop.
  const jointStation = (stations ?? computeJointStations(inputs.memberSources.map((source) => source.length)))[joint]!;
  const transitionMembers: [GroupTransitionMemberView, GroupTransitionMemberView] = members.map((member) => ({
    memberId: member.memberId,
    criterion: member.criterion,
    length: member.length,
    dirX: member.dirX,
    dirY: member.dirY,
    startZ: member.startZ,
    endZ: member.endZ,
    isArc: member.isArc,
    maxSearchDistance: member.maxSearchDistance,
  })) as [GroupTransitionMemberView, GroupTransitionMemberView];
  return {
    ok: true,
    value: {
      plan: {
        policyVersion: intent.policyVersion,
        jointId: intent.jointId,
        memberIds: [keys[left]!, keys[right]!],
        width: intent.width,
        lawKind: intent.lawKind,
        lawVersion: intent.lawVersion,
        criterionFamily: intent.criterionFamily,
        side: intent.side,
        // Persisted endpoint evidence + provenance ride verbatim so the
        // worker→engine stale-evidence checks run on the normal path.
        ...(intent.endpoints !== undefined
          ? { endpoints: { refs: [...intent.endpoints.refs], values: [...intent.endpoints.values] } }
          : {}),
        ...(intent.provenance !== undefined
          ? { provenance: { ...intent.provenance, memberIds: [...intent.provenance.memberIds] } }
          : {}),
        groupSide: inputs.group.side,
        isOpen,
        transitionCount: 1,
        jointZ: sourceL.endZ,
        endpointEvidence: { vL: admitted.vL, vR: admitted.vR, gL, gR },
        jointStation,
        recordedRevision: inputs.revision,
      },
      members: transitionMembers,
    },
  };
};

export const planGroupTransitionRequest = (inputs: ResolvedGroupInputs): GroupTransitionRequestPlan => {
  const selection = selectGroupTransitions(inputs.transitions);
  if (selection.kind === 'absent') return { kind: 'absent' };
  if (selection.kind === 'rejected') {
    return { kind: 'rejected', code: selection.code, detail: selection.detail };
  }
  const intents = selection.kind === 'single' ? [selection.transition] : selection.transitions;
  const transitions: GroupTransitionPlan[] = [];
  const transitionMembers: GroupTransitionMemberView[] = [];
  // One stations pass for the whole set (never a repeated prefix sum per intent).
  const stations = computeJointStations(inputs.memberSources.map((source) => source.length));
  for (const intent of intents) {
    const planned = planSingleTransitionIntent(inputs, intent, stations);
    if (!planned.ok) return { kind: 'rejected', code: planned.code, detail: planned.detail };
    transitions.push(planned.value.plan);
    transitionMembers.push(...planned.value.members);
  }
  return {
    kind: 'plan',
    transitions,
    transitionMembers,
    transitionMemberKeys: [...inputs.memberKeys],
  };
};


export class SurfaceGradingService {
  private readonly deps: SurfaceGradingServiceDeps;
  private readonly drawingId: string;
  private transport: SurfaceGradingTransport | null = null;
  private transportFailed = false;
  private readonly pending = new Map<string, GradingPendingEntry>();
  private readonly pendingGroups = new Map<string, GroupGradingPendingEntry>();
  private readonly diagnostics = new Map<string, SurfaceGradingSessionDiagnostic>();
  private readonly groupDiagnostics = new Map<string, SurfaceGradingSessionDiagnostic>();
  private readonly groupCache: CadGradingGroupCache;
  private disposed = false;

  constructor(deps: SurfaceGradingServiceDeps) {
    this.deps = deps;
    this.drawingId = deps.drawingId;
    this.groupCache = deps.groupCache ?? createCadGradingGroupCache(deps.drawingId);
  }

  /** Session BUILDING set (grading derivation only — never definition status). */
  buildingGradingIds(): ReadonlySet<string> {
    return new Set(this.pending.keys());
  }

  /** Phase 20C: group-side session BUILDING set. */
  buildingGroupIds(): ReadonlySet<string> {
    return new Set(this.pendingGroups.keys());
  }

  gradingDiagnostics(): ReadonlyMap<string, SurfaceGradingSessionDiagnostic> {
    return new Map(this.diagnostics);
  }

  groupGradingDiagnostics(): ReadonlyMap<string, SurfaceGradingSessionDiagnostic> {
    return new Map(this.groupDiagnostics);
  }

  statusOf(gradingId: string): { status: GradingStatus; stale: boolean } {
    const project = this.deps.getProject();
    const inputs = resolveGradingInputs(project, gradingId);
    if (!inputs) return { status: 'BROKEN_REFERENCE', stale: false };
    // Phase 20F: analytic gradings carry no target — always target-current.
    const targetMesh = inputs.target
      ? this.deps.tinCache.get(inputs.target.id, inputs.targetRevision!)
      : undefined;
    const retained = this.deps.gradingCache.retained(gradingId);
    const result = this.deps.gradingCache.get(gradingId, inputs.revision) ?? null;
    // A retained stale result (another revision) proves a prior calculation:
    // target/current mismatch then reads NEEDS_RECALC, never false UNBUILT.
    const effective = result ?? (retained.length > 0 ? retained[retained.length - 1]! : null);
    const building = this.pending.has(gradingId);
    const status = deriveFailedEffectiveStatus(
      deriveGradingStatus({
        courseResolved: true,
        targetCurrent: inputs.target === undefined || targetMesh != null,
        targetExists: true,
        sourceExists: true,
        hasResult: effective != null,
        resultRevision: effective?.revision ?? null,
        currentRevision: inputs.revision,
        building,
      }),
      this.diagnostics.get(gradingId),
      inputs.revision,
    );
    return { status, stale: retained.length > 0 && result == null };
  }

  /**
   * Phase 20C: group status mirroring `statusOf` (same precedence; FAILED set
   * only by the group build path).
   */
  groupStatusOf(groupId: string): { status: GroupStatus; stale: boolean } {
    const inputs = resolveGroupInputs(this.deps.getProject(), groupId);
    if (!inputs) return { status: 'BROKEN_REFERENCE', stale: false };
    // Analytic families carry no target: target currency never gates them and
    // a dormant legacy target id cannot drive SOURCE_NOT_CURRENT.
    const surfaceTarget = inputs.target !== undefined && inputs.targetRevision !== undefined;
    const targetMesh = surfaceTarget
      ? this.deps.tinCache.get(inputs.target!.id, inputs.targetRevision!)
      : null;
    const retained = this.groupCache.retained(groupId);
    const result = this.groupCache.get(groupId, inputs.revision) ?? null;
    const effective = result ?? (retained.length > 0 ? retained[retained.length - 1]! : null);
    const building = this.pendingGroups.has(groupId);
    const status = deriveFailedEffectiveStatus(
      deriveGroupStatus({
        brokenRef: false,
        building,
        hasResult: effective != null,
        sourceCurrent: surfaceTarget ? targetMesh != null : true,
        needsRecalc: effective != null && effective.revision !== inputs.revision,
      }),
      this.groupDiagnostics.get(groupId),
      inputs.revision,
    );
    return { status, stale: retained.length > 0 && result == null };
  }

  /**
   * Explicit Calculate dispatch (NO history entry). Requires a CURRENT
   * target TIN (else SOURCE_NOT_CURRENT fail-closed); cut/fill source
   * coverage is enforced in the worker (TARGET_GAP fail-closed).
   */
  requestGrading(gradingId: string): string {
    if (this.disposed) return 'Grading not found.';
    const project = this.deps.getProject();
    const inputs = resolveGradingInputs(project, gradingId);
    if (!inputs) return `Grading calculation blocked: grading “${gradingId}” has a broken source or target reference.`;
    const { grading, resolvedSource, target, targetRevision, revision } = inputs;
    // Target currency gates even the already-current shortcut: a lost
    // session mesh reads SOURCE_NOT_CURRENT, never false CURRENT.
    // Phase 20F: analytic gradings skip the mesh gate (no target).
    const targetMesh = target ? this.deps.tinCache.get(target.id, targetRevision!) : undefined;
    if (!targetMesh && target) {
      this.diagnostics.delete(gradingId);
      this.deps.onStateChange();
      return `Grading calculation blocked: target TIN for “${target.name}” is not CURRENT (SOURCE_NOT_CURRENT) — rebuild it first.`;
    }
    if (this.deps.gradingCache.get(gradingId, revision)) {
      return `Grading “${grading.name}” is already current.`;
    }
    this.diagnostics.delete(gradingId);
    const transport = this.transportFor();
    if (!transport) {
      this.diagnostics.set(gradingId, {
        revision,
        error: truncateDiagnostic('Surface grading worker unavailable.'),
      });
      this.deps.onStateChange();
      return `Grading calculation blocked: worker unavailable for “${grading.name}”.`;
    }
    this.supersede(gradingId);
    const pendingGrading = transport.deriveGrading({
      gradingId,
      revision,
      drawingId: this.drawingId,
      source: resolvedSource,
      side: grading.side,
      criterion: grading.criterion,
      maxSearchDistance: grading.maxSearchDistance,
      curveChordTolerance: grading.curveChordTolerance,
      ...(targetMesh ? { target: toTargetSnapshot(targetMesh.points, targetMesh.triangles) } : {}),
    });
    this.pending.set(gradingId, { requestId: pendingGrading.requestId, revision, resolvedSource });
    this.deps.onStateChange();
    void pendingGrading.done.then(
      (result) => this.complete(gradingId, pendingGrading.requestId, result, null),
      (error) => this.complete(gradingId, pendingGrading.requestId, null, error),
    );
    return `Computing grading for “${grading.name}”…`;
  }

  /**
   * Phase 20C: explicit group Calculate dispatch (NO history entry). One
   * target snapshot is sent per group request; requires a CURRENT target TIN
   * (else SOURCE_NOT_CURRENT fail-closed). Late/stale results are discarded by
   * (groupId, revision, requestId) — a foreign or superseded arrival never
   * becomes CURRENT.
   */
  requestGroupGrading(groupId: string): string {
    if (this.disposed) return 'Grading group not found.';
    const project = this.deps.getProject();
    const inputs = resolveGroupInputs(project, groupId);
    if (!inputs) {
      return `Group grading calculation blocked: group “${groupId}” has a broken source or target reference.`;
    }
    const { group, memberSources, target, targetRevision, revision } = inputs;
    const requiresSurface = target !== undefined && targetRevision !== undefined;
    const targetMesh = requiresSurface
      ? this.deps.tinCache.get(target!.id, targetRevision!)
      : undefined;
    if (requiresSurface && !targetMesh) {
      this.groupDiagnostics.delete(groupId);
      this.deps.onStateChange();
      return `Group grading blocked: target TIN for “${target!.name}” is not CURRENT (SOURCE_NOT_CURRENT) — rebuild it first.`;
    }
    if (this.groupCache.get(groupId, revision)) {
      return `Grading group “${group.name}” is already current.`;
    }
    this.groupDiagnostics.delete(groupId);
    const transport = this.transportFor();
    if (!transport || !transport.deriveGroupGrading) {
      this.groupDiagnostics.set(groupId, {
        revision,
        error: truncateDiagnostic('Surface grading-group worker unavailable.'),
      });
      this.deps.onStateChange();
      return `Group grading calculation blocked: worker unavailable for “${group.name}”.`;
    }
    // Phase 20M.2 WAVE I — retained transition intent rides the worker
    // request (plan + member views + full traversal keys); any reject fails
    // closed here with the bounded TRANSITION_* code, never dispatched.
    const planned = planGroupTransitionRequest(inputs);
    if (planned.kind === 'rejected') {
      this.groupDiagnostics.set(groupId, {
        revision,
        error: truncateDiagnostic(`${planned.code}: transition for “${group.name}” rejected (${planned.detail}).`),
      });
      this.deps.onStateChange();
      return `Group grading calculation blocked: transition for “${group.name}” rejected (${planned.code}) — fix or remove the intent, then recalculate.`;
    }
    this.supersedeGroup(groupId);
    const pending = transport.deriveGroupGrading({
      groupId,
      revision,
      drawingId: this.drawingId,
      memberSources,
      side: group.side,
      criterion: group.criterion,
      memberCriteria: inputs.memberCriteria,
      maxSearchDistance: group.maxSearchDistance,
      curveChordTolerance: group.curveChordTolerance,
      closed: group.closed === true,
      // Phase 20M.2 WAVE I (plural in 20N.1 Wave F) — admitted transition
      // plans in canonical joint order (absent = legacy).
      ...(planned.kind === 'plan'
        ? {
            transitions: planned.transitions,
            transitionMembers: planned.transitionMembers,
            transitionMemberKeys: planned.transitionMemberKeys,
          }
        : {}),
      // Analytic groups send no target snapshot; surface groups send it once.
      ...(requiresSurface && targetMesh !== undefined
        ? { target: toTargetSnapshot(targetMesh.points, targetMesh.triangles) }
        : {}),
    });
    this.pendingGroups.set(groupId, { requestId: pending.requestId, revision });
    this.deps.onStateChange();
    void pending.done.then(
      (result) => this.completeGroup(groupId, pending.requestId, result, null),
      (error) => this.completeGroup(groupId, pending.requestId, null, error),
    );
    return `Computing grading group for “${group.name}”…`;
  }

  /**
   * Phase 20F.2 §§8-12 — authoritative pending-request reconciliation seam.
   *
   * ONE bounded sweep over in-flight work: each standalone pending is
   * re-resolved against the CURRENT project with `resolveGradingInputs`, and
   * each group pending with `resolveGroupInputs`. A pending run survives only
   * while the `grev1:`/`ggrev1:` revision it was requested for is
   * byte-identical to what the definition resolves to now. A missing reference
   * (deleted grading/group, broken source/target) or a moved revision
   * (Feature Line geometry, course endpoints, criterion/override, span/search,
   * target reassignment, Project Transform, Grid/Ground, undo/redo) retires
   * the run.
   *
   * Never auto-calculates and never promotes/transforms a stale result: prior
   * results stay in the grading caches as stale evidence and status re-derives
   * NEEDS_RECALC/SOURCE_NOT_CURRENT/BROKEN_REFERENCE from the revision. Fires
   * `onStateChange` only when the pending set actually changed, so a no-op
   * sweep cannot loop or churn renders.
   *
   * The event-specific `notify*` hooks below delegate here so revision
   * identity — never the event label — decides cancellation.
   */
  reconcilePendingWithProject(): void {
    if (this.disposed) return;
    const project = this.deps.getProject();
    let changed = false;
    for (const [gradingId, entry] of [...this.pending]) {
      const inputs = resolveGradingInputs(project, gradingId);
      if (!inputs || inputs.revision !== entry.revision) {
        changed = this.dropPending(gradingId) || changed;
      }
    }
    for (const [groupId, entry] of [...this.pendingGroups]) {
      const inputs = resolveGroupInputs(project, groupId);
      if (!inputs || inputs.revision !== entry.revision) {
        changed = this.dropPendingGroup(groupId) || changed;
      }
    }
    if (changed) this.deps.onStateChange();
  }

  /**
   * §11 target-rebuild policy. A rebuilt target TIN republishes immediately
   * (`onStateChange`) so status re-derives CURRENT/SOURCE_NOT_CURRENT. The
   * reconciliation sweep is revision-driven, so a rebuild of the SAME
   * deterministic surface revision leaves in-flight work running and mints no
   * new grading revision; cancellation happens only when the target actually
   * moved (target reassignment, or a rebuild after the definition edit that
   * moved `grev1:`). Analytic Distance/Elevation gradings carry no target
   * (`tgt:none`) and are unaffected by surface cache rebuilds — a dormant
   * retained target id on an analytic grading can never wake it. No
   * auto-calculation.
   */
  notifyTargetBuilt(_surfaceId: string): void {
    if (this.disposed) return;
    this.reconcilePendingWithProject();
    this.deps.onStateChange();
  }

  /**
   * §12 source Feature-Line policy. A source edit moves the
   * `grev1:`/`ggrev1:` revision, so staleness follows from the definition
   * revision and the reconciliation sweep cancels affected in-flight work —
   * standalone AND groups. It never auto-starts Calculate and never promotes
   * the prior result. An edit to an unrelated Feature Line leaves every
   * affected revision unchanged and cancels nothing; the `featureLineId`
   * label is kept for diagnostics only, because revision identity decides.
   */
  notifySourceChanged(_featureLineId: string): void {
    if (this.disposed) return;
    this.reconcilePendingWithProject();
  }

  cancelGrading(gradingId: string): void {
    this.supersede(gradingId);
  }

  handleGradingDeleted(gradingId: string): void {
    this.supersede(gradingId);
    this.deps.gradingCache.invalidate(gradingId);
    this.diagnostics.delete(gradingId);
    this.deps.onStateChange();
  }

  /** Definition edits move the revision: drop the pending run, keep history. */
  handleGradingChanged(gradingId: string): void {
    this.supersede(gradingId);
    this.deps.onStateChange();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const [gradingId, entry] of this.pending) {
      try {
        this.transport?.cancel(entry.requestId);
      } catch {
        // Superseded computations settle silently regardless.
      }
      this.pending.delete(gradingId);
    }
    for (const [groupId, entry] of this.pendingGroups) {
      try {
        this.transport?.cancel(entry.requestId);
      } catch {
        // Superseded computations settle silently regardless.
      }
      this.pendingGroups.delete(groupId);
    }
    this.diagnostics.clear();
    this.groupDiagnostics.clear();
    try {
      this.transport?.dispose();
    } catch {
      // Disposal never throws.
    }
    this.transport = null;
    this.deps.gradingCache.clear();
    this.groupCache.clear();
  }

  private transportFor(): SurfaceGradingTransport | null {
    if (this.disposed) return null;
    if (this.transport) return this.transport.alive ? this.transport : null;
    if (this.transportFailed) return null;
    try {
      const created = this.deps.createTransport();
      if (!created || !created.alive) return null;
      this.transport = created;
      return created;
    } catch {
      this.transportFailed = true;
      return null;
    }
  }

  private supersede(gradingId: string): void {
    if (this.dropPending(gradingId)) this.deps.onStateChange();
  }

  private supersedeGroup(groupId: string): void {
    if (this.dropPendingGroup(groupId)) this.deps.onStateChange();
  }

  /** Drop a pending run (cancelling its transport); true when it existed. */
  private dropPending(gradingId: string): boolean {
    const entry = this.pending.get(gradingId);
    if (!entry) return false;
    this.pending.delete(gradingId);
    try {
      this.transport?.cancel(entry.requestId);
    } catch {
      // Superseded computations settle silently regardless.
    }
    return true;
  }

  private dropPendingGroup(groupId: string): boolean {
    const entry = this.pendingGroups.get(groupId);
    if (!entry) return false;
    this.pendingGroups.delete(groupId);
    try {
      this.transport?.cancel(entry.requestId);
    } catch {
      // Superseded computations settle silently regardless.
    }
    return true;
  }

  private complete(
    gradingId: string,
    requestId: string,
    result: CadGradingResult | null,
    error: unknown,
  ): void {
    const entry = this.pending.get(gradingId);
    // Superseded, cancelled, or disposed: a late arrival never applies.
    if (!entry || entry.requestId !== requestId) return;
    this.pending.delete(gradingId);
    if (result == null && error == null) {
      this.deps.onStateChange();
      return;
    }
    const project = this.deps.getProject();
    const inputs = resolveGradingInputs(project, gradingId);
    // Cross-drawing, deleted, or source-changed: discard, never CURRENT.
    if (this.disposed || this.deps.getDrawingId() !== this.drawingId || !inputs) {
      this.deps.onStateChange();
      return;
    }
    if (inputs.revision !== entry.revision) {
      this.deps.onStateChange();
      return;
    }
    if (error != null || result == null) {
      const raw = error instanceof Error ? error.message : String(error ?? 'Grading computation failed.');
      this.diagnostics.set(gradingId, { revision: entry.revision, error: truncateDiagnostic(raw) });
      this.deps.onStateChange();
      return;
    }
    // Stale-mesh gating: only the requested revision wins.
    if (result.revision !== entry.revision || result.gradingId !== gradingId) {
      this.deps.onStateChange();
      return;
    }
    // Daylight/target agreement gate: reject tampered or drifted geometry.
    const gateReject = this.agreementReject(inputs, entry, result);
    if (gateReject) {
      this.diagnostics.set(gradingId, { revision: entry.revision, error: truncateDiagnostic(gateReject) });
      this.deps.onStateChange();
      return;
    }
    this.deps.gradingCache.set(gradingId, result);
    this.diagnostics.delete(gradingId);
    this.deps.onStateChange();
  }

  /** GO-gate: daylight ↔ CURRENT target agreement + source boundary equality. */
  private agreementReject(
    inputs: ResolvedGradingInputs,
    entry: GradingPendingEntry,
    result: CadGradingResult,
  ): string | null {
    if (result.daylightPoints.length % 3 !== 0) return 'GRADING_AGREEMENT_MALFORMED_DAYLIGHT';
    const sourceCheck = this.sourceBoundaryCheck(entry.resolvedSource, result);
    // Phase 20F: analytic results gate on the source boundary only.
    if (!inputs.target || !inputs.targetRevision) {
      return validateGradingSourceBoundary(sourceCheck);
    }
    const query = this.targetMeshQuery(inputs.target.id, inputs.targetRevision);
    if (!query) return 'Grading agreement rejected: target TIN is not CURRENT.';
    return validateGradingResultAgainstTarget(result.daylightPoints, query, sourceCheck);
  }

  /**
   * Source-boundary agreement via the result's OWN captured boundary
   * (`sourceBoundaryPoints`) compared with the persisted resolved endpoints —
   * authoritative real-arc evaluation at station 0 / `source.length`, never a
   * chord-direction × arc-length reconstruction (which overshoots an arc
   * endpoint by `arcLength − chord`). Falls back to the persisted endpoints
   * when no boundary was captured.
   */
  private sourceBoundaryCheck(
    source: GradingComputeSource,
    result: CadGradingResult,
  ): GradingSourceBoundaryCheck {
    const expectedFirst = { x: source.startX, y: source.startY, z: source.startZ };
    const expectedLast = { x: source.endX, y: source.endY, z: source.endZ };
    // Arc linearization rounds at the centre/radius magnitude, so the shared
    // coordinate agreement must use that scale (an arc endpoint can sit near
    // the origin while its evaluation carries ~eps·radius error).
    const coordinateScale =
      source.isArc && source.arc
        ? Math.max(Math.abs(source.arc.centerX), Math.abs(source.arc.centerY), source.arc.radius)
        : 0;
    const boundary = result.sourceBoundaryPoints;
    const count = boundary?.length ?? 0;
    if (boundary && count >= 6 && count % 3 === 0) {
      return {
        first: { x: boundary[0]!, y: boundary[1]!, z: boundary[2]! },
        last: { x: boundary[count - 3]!, y: boundary[count - 2]!, z: boundary[count - 1]! },
        expectedFirst,
        expectedLast,
        coordinateScale,
      };
    }
    return { first: { ...expectedFirst }, last: { ...expectedLast }, expectedFirst, expectedLast, coordinateScale };
  }

  /**
   * Phase 20C group GO-gate: the retained CURRENT TIN mesh is re-queried at
   * every merged group daylight vertex (the source-boundary half of the single
   * gate is member-specific and enforced by the group kernel's join checks).
   */
  private groupAgreementReject(
    inputs: ResolvedGroupInputs,
    result: CadGradingGroupResult,
  ): string | null {
    // Analytic (target-free) groups have no TIN agreement gate; their
    // daylight/limit vertices are closed-form and verified in the kernel.
    if (inputs.target === undefined || inputs.targetRevision === undefined) return null;
    const query = this.targetMeshQuery(inputs.target.id, inputs.targetRevision);
    if (!query) return 'Grading group agreement rejected: target TIN is not CURRENT.';
    return validateDaylightAgainstTarget(result.daylightPoints, query);
  }

  /** Elevation sampler over the retained TIN mesh, or null when not CURRENT. */
  private targetMeshQuery(surfaceId: string, revision: string): GradingTargetQuery | null {
    const targetMesh = this.deps.tinCache.get(surfaceId, revision);
    if (!targetMesh) return null;
    const build = {
      outcome: 'ok' as const,
      points: targetMesh.points,
      triangles: targetMesh.triangles,
      grid: targetMesh.grid as CadSurfaceGrid,
    };
    return {
      elevationAt: (x: number, y: number) =>
        getSurfaceElevationAt(
          build as unknown as Parameters<typeof getSurfaceElevationAt>[0],
          x,
          y,
        ),
      planeAt: (x: number, y: number) =>
        getSurfacePlaneAt(
          build as unknown as Parameters<typeof getSurfacePlaneAt>[0],
          x,
          y,
        ),
    };
  }

  private completeGroup(
    groupId: string,
    requestId: string,
    result: CadGradingGroupResult | null,
    error: unknown,
  ): void {
    const entry = this.pendingGroups.get(groupId);
    // Superseded, cancelled, or disposed: a late arrival never applies.
    if (!entry || entry.requestId !== requestId) return;
    this.pendingGroups.delete(groupId);
    if (result == null && error == null) {
      this.deps.onStateChange();
      return;
    }
    const inputs = resolveGroupInputs(this.deps.getProject(), groupId);
    // Cross-drawing, deleted, or source/target-changed: discard, never CURRENT.
    if (this.disposed || this.deps.getDrawingId() !== this.drawingId || !inputs) {
      this.deps.onStateChange();
      return;
    }
    if (inputs.revision !== entry.revision) {
      this.deps.onStateChange();
      return;
    }
    if (error != null || result == null) {
      const raw =
        error instanceof Error ? error.message : String(error ?? 'Group grading computation failed.');
      this.groupDiagnostics.set(groupId, { revision: entry.revision, error: truncateDiagnostic(raw) });
      this.deps.onStateChange();
      return;
    }
    // Stale-mesh gating: only the requested group revision wins.
    if (result.revision !== entry.revision || result.groupId !== groupId) {
      this.deps.onStateChange();
      return;
    }
    const gateReject = this.groupAgreementReject(inputs, result);
    if (gateReject) {
      this.groupDiagnostics.set(groupId, {
        revision: entry.revision,
        error: truncateDiagnostic(gateReject),
      });
      this.deps.onStateChange();
      return;
    }
    this.groupCache.set(groupId, result);
    this.groupDiagnostics.delete(groupId);
    this.deps.onStateChange();
  }
}
