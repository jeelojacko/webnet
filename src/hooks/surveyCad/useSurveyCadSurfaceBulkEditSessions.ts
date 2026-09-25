import { useCallback, useMemo, useState } from 'react';
import type { CadDisplayPrimitive } from '../../engine/cad/cadDisplayTypes';
import type { CadCommand } from '../../engine/cad/cadTransactions.types';
import {
  bulkValuePrompt,
  fmt,
  linePrimitive,
  movePrompt,
  pointPrimitive,
  pointsOfRefs,
  selectedPointPrimitives,
  validateMoveProposal,
  type SurfaceBulkCommandSession,
  type SurfaceBulkMoveSession,
  type SurfaceBulkValueSession,
} from './surfaceBulkEditSessionUtils';
import {
  canonicalRefs,
  checkSelectionForCommit,
  SURFACE_SELECTION_EMPTY_MESSAGE,
  SURFACE_SELECTION_STALE_MESSAGE,
  type SurfaceBulkEditMode,
  type SurfaceVertexSelection,
  type Xy,
} from './surfaceBulkSelectionUtils';
import { meshOf, SURFACE_POINT_EDIT_STALE_MESSAGE, type Deps } from './surfacePointEditSessionUtils';
import { queueSessionSurfaceRebuild } from './useSurveyCadSurfaceEditSessions';

export type { SurfaceBulkEditMode, SurfaceVertexSelection } from './surfaceBulkSelectionUtils';

/**
 * Phase 18V bulk-edit sessions (UI state only): SURFSETELEVMULTI,
 * SURFRAISELOWERSELECTED, SURFMOVEPOINTS. Each stages a value or a
 * base+destination against the CURRENT selection and commits as ONE
 * undoable SURFACE_ADD_EDIT against the FRESH revision. The move ghost
 * preview validates proposed coordinates read-only through the engine
 * replay, so the blocking class is authoritative and all-or-nothing.
 * Zero refs ⇒ no edit, no undo entry.
 */

export interface SurfaceBulkEditDeps extends Deps {
  selection: SurfaceVertexSelection | null;
  clearSelection: () => void;
}

export const useSurveyCadSurfaceBulkEditSessions = (deps: SurfaceBulkEditDeps) => {
  const [session, setSession] = useState<SurfaceBulkCommandSession | null>(null);

  const cancel = useCallback((): void => setSession(null), []);

  const startBulk = useCallback((mode: SurfaceBulkEditMode): boolean => {
    const selectedId = deps.selectedSurfaceId;
    const live = selectedId ? meshOf(deps, selectedId) : null;
    if (!live || !live.surface) {
      deps.notify(SURFACE_POINT_EDIT_STALE_MESSAGE);
      return false;
    }
    const selection = deps.selection;
    if (!selection || selection.surfaceId !== live.surface.id) {
      deps.notify(SURFACE_SELECTION_EMPTY_MESSAGE);
      return false;
    }
    const check = checkSelectionForCommit(selection, live.revision);
    if (check === 'empty') {
      deps.notify(SURFACE_SELECTION_EMPTY_MESSAGE);
      return false;
    }
    if (check === 'stale') {
      deps.notify(SURFACE_SELECTION_STALE_MESSAGE);
      deps.clearSelection();
      return false;
    }
    const name = `“${live.surface.name}”`;
    const refs = canonicalRefs(selection.refs);
    const next: SurfaceBulkCommandSession = mode === 'move'
      ? {
        kind: 'move',
        surfaceId: live.surface.id,
        surfaceName: live.surface.name,
        revision: live.revision,
        refs,
        base: null,
        dest: null,
        delta: null,
        proposed: null,
        issue: null,
        prompt: movePrompt(name, refs.length, null),
      }
      : mode === 'set-elevation'
        ? {
          kind: 'set-elevation',
          surfaceId: live.surface.id,
          surfaceName: live.surface.name,
          revision: live.revision,
          refs,
          value: null,
          prompt: bulkValuePrompt(mode, name, refs.length),
        }
        : {
          kind: 'raise-lower',
          surfaceId: live.surface.id,
          surfaceName: live.surface.name,
          revision: live.revision,
          refs,
          value: null,
          prompt: bulkValuePrompt(mode, name, refs.length),
        };
    setSession(next);
    deps.notify(next.prompt);
    return true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deps.selection, deps.project, deps.cache, deps.selectedSurfaceId, deps.buildingSurfaceIds]);

  const commitBulk = useCallback((staged: SurfaceBulkValueSession | SurfaceBulkMoveSession): boolean => {
    const live = meshOf(deps, staged.surfaceId);
    if (!live) {
      deps.notify(SURFACE_POINT_EDIT_STALE_MESSAGE);
      setSession(null);
      deps.clearSelection();
      return true;
    }
    if (live.revision !== staged.revision) {
      deps.notify(SURFACE_SELECTION_STALE_MESSAGE);
      setSession(null);
      deps.clearSelection();
      return true;
    }
    const refs = staged.refs;
    if (refs.length === 0) {
      deps.notify(SURFACE_SELECTION_EMPTY_MESSAGE);
      setSession(null);
      return true;
    }
    const command: CadCommand & { key: 'SURFACE_ADD_EDIT' } = staged.kind === 'set-elevation'
      ? { key: 'SURFACE_ADD_EDIT', surfaceId: staged.surfaceId, edit: { kind: 'set-elevation-many', vertices: refs, z: staged.value! }, expectedRevision: live.revision }
      : staged.kind === 'raise-lower'
        ? { key: 'SURFACE_ADD_EDIT', surfaceId: staged.surfaceId, edit: { kind: 'raise-lower-points', vertices: refs, deltaZ: staged.value! }, expectedRevision: live.revision }
        : { key: 'SURFACE_ADD_EDIT', surfaceId: staged.surfaceId, edit: { kind: 'move-points', vertices: refs, deltaX: staged.delta!.dx, deltaY: staged.delta!.dy }, expectedRevision: live.revision };
    if (!deps.runCommand(command)) {
      deps.notify(`Bulk edit rejected on “${staged.surfaceName}” (locked or stale SURFACE_EDIT_STALE_REVISION) — reselect and retry.`);
      setSession(null);
      deps.clearSelection();
      return true;
    }
    queueSessionSurfaceRebuild(deps.rebuildSurface, staged.surfaceId);
    setSession(null);
    deps.clearSelection();
    deps.notify(`Bulk edit committed on “${staged.surfaceName}” (${refs.length} vertices, one undo step) — rebuilding.`);
    return true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deps.project, deps.cache, deps.buildingSurfaceIds, deps.clearSelection]);

  const handlePick = useCallback((worldPoint: Xy): void => {
    if (!session || session.kind !== 'move') return;
    const live = meshOf(deps, session.surfaceId);
    if (!live) {
      deps.notify(SURFACE_POINT_EDIT_STALE_MESSAGE);
      setSession(null);
      return;
    }
    if (!session.base) {
      setSession({ ...session, base: worldPoint, prompt: movePrompt(`“${session.surfaceName}”`, session.refs.length, worldPoint) });
      return;
    }
    const delta = { dx: worldPoint.x - session.base.x, dy: worldPoint.y - session.base.y };
    if (delta.dx === 0 && delta.dy === 0) {
      deps.notify(`Move Selected Points on “${session.surfaceName}” rejected — zero displacement; pick a different destination.`);
      return;
    }
    const proposal = validateMoveProposal(session.surfaceId, live.mesh, session.refs, delta.dx, delta.dy);
    setSession({
      ...session,
      dest: worldPoint,
      delta,
      proposed: proposal.proposed,
      issue: proposal.reason,
      prompt: proposal.reason == null
        ? `Move staged on “${session.surfaceName}” (${session.refs.length} vertices, Δ ${fmt(delta.dx)}, ${fmt(delta.dy)}) — Enter commits, pick again to restage, Esc ends.`
        : `Move Selected Points on “${session.surfaceName}” blocked (${proposal.reason}) — all-or-nothing; pick another destination or Esc.`,
    });
    if (proposal.reason) deps.notify(`Move Selected Points on “${session.surfaceName}” blocked (${proposal.reason}).`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, deps.project, deps.cache, deps.buildingSurfaceIds]);

  const handleEnter = useCallback((): boolean => {
    if (!session) return false;
    if (session.kind === 'move' && session.issue) {
      deps.notify(`Move Selected Points blocked (${session.issue}) — all-or-nothing; pick another destination.`);
      return true;
    }
    if (session.kind !== 'move' && session.value == null) return false;
    if (session.kind === 'move' && !session.delta) return false;
    return commitBulk(session);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, commitBulk]);

  const submitValueText = useCallback((text: string): boolean => {
    const staged = session;
    if (!staged || (staged.kind !== 'set-elevation' && staged.kind !== 'raise-lower')) return false;
    const value = Number(text.trim());
    if (text.trim().length === 0 || !Number.isFinite(value)) return false;
    const label = staged.kind === 'set-elevation' ? 'target Z' : 'ΔZ';
    setSession({
      ...staged,
      value,
      prompt: `${staged.kind === 'set-elevation' ? 'SURFSETELEVMULTI' : 'SURFRAISELOWERSELECTED'} on “${staged.surfaceName}” (${staged.refs.length} vertices): ${label} ${fmt(value)} — Enter commits, Esc ends.`,
    });
    return true;
  }, [session]);

  const previewPrimitives = useMemo<CadDisplayPrimitive[]>(() => {
    const surface = (deps.project.surfaces ?? []).find((entry) => entry.id === session?.surfaceId);
    const layerId = surface?.layerId ?? 'general';
    if (!session) return [];
    const live = meshOf(deps, session.surfaceId);
    if (!live) return [];
    const out = selectedPointPrimitives(layerId, live.mesh, session.refs, '#f59e0b', 'surface-bulk-session-selected');
    if (session.kind === 'move') {
      // Ghost of the proposed positions: original → proposed displacement
      // line plus the proposed marker (validated read-only against the mesh).
      const from = pointsOfRefs(live.mesh, session.refs);
      (session.proposed ?? []).forEach((target, index) => {
        const origin = from[index];
        if (!origin) return;
        out.push(linePrimitive(`surface-bulk-ghost-${index}`, layerId, origin, target, session.issue ? '#ef4444' : '#22c55e', true));
        out.push(pointPrimitive(`surface-bulk-ghost-pt-${index}`, layerId, target, session.issue ? '#ef4444' : '#22c55e'));
      });
      if (session.base) out.push(pointPrimitive('surface-bulk-base', layerId, session.base, '#38bdf8'));
      if (session.dest) out.push(pointPrimitive('surface-bulk-dest', layerId, session.dest, '#38bdf8'));
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, deps.project, deps.cache]);

  return { session, startBulk, cancel, handlePick, handleEnter, submitValueText, previewPrimitives };
};
