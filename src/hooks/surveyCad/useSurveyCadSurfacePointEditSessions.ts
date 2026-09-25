import { useCallback, useMemo, useState } from 'react';
import type { CadDisplayPrimitive } from '../../engine/cad/cadDisplayTypes';
import { queryMeshElevation } from '../../engine/cad/cadSurfaceView';
import {
  pickSurfaceVertex,
  surfaceEditPickTolerance,
} from '../../engine/cad/cadSurfaceEditPicking';
import type { CadCommand } from '../../engine/cad/cadTransactions.types';
import { queueSessionSurfaceRebuild } from './useSurveyCadSurfaceEditSessions';
import {
  baseZOf,
  containingOutline,
  editNumbers,
  entityIdOfKey,
  fmt,
  labelOfKey,
  meshOf,
  pointPrimitive,
  linePrimitive,
  sessionPromptKey,
  stageMoveTarget,
  topologyOf,
  SURFACE_POINT_EDIT_STALE_MESSAGE,
  type Deps,
  type StagedPointEdit,
  type SurfacePointEditSessionMode,
  type SurfacePointEditSessionState,
  type Xy,
} from './surfacePointEditSessionUtils';

export type {
  SurfacePointEditSessionMode,
  SurfacePointEditSessionState,
} from './surfacePointEditSessionUtils';

/**
 * Phase 18T point/elevation edit sessions (UI state only — no geometry here).
 *
 * Pick loops over the CURRENT mesh; picks STAGE a pending edit (+ overlay
 * preview, never a cache mutation); numeric values (elevation Z, delta Z)
 * arrive via the command dock; Enter commits the staged edit as one
 * undoable SURFACE_ADD_EDIT against the FRESH revision and queues a worker
 * rebuild; Esc ends the loop. Commits always re-read the current revision —
 * picks are never applied against a stale mesh. Every prompt names the
 * surface and says Surface-only — survey data is never implied to change.
 */

export const useSurveyCadSurfacePointEditSessions = (deps: Deps) => {
  const [session, setSession] = useState<SurfacePointEditSessionState | null>(null);

  const start = useCallback((mode: SurfacePointEditSessionMode): boolean => {
    const surface = (deps.project.surfaces ?? []).find((entry) => entry.id === deps.selectedSurfaceId);
    if (!surface) {
      deps.notify('Select a surface first.');
      return false;
    }
    if (!meshOf(deps, surface.id)) {
      deps.notify(SURFACE_POINT_EDIT_STALE_MESSAGE);
      return false;
    }
    const name = `“${surface.name}”`;
    const prompts: Record<SurfacePointEditSessionMode, string> = {
      'add-point': `SURFADDPOINT on ${name} (Surface-only — survey data unchanged): pick XY inside the surface, then type Elevation or Enter to accept the interpolated default.`,
      'delete-point': `SURFDELETEPOINT on ${name} (Surface-only — survey data unchanged): pick a vertex, Enter commits the delete.`,
      'move-point': `SURFMOVEPOINT on ${name} (Surface-only, Z unchanged — survey data unchanged): pick a vertex, then pick the target XY.`,
      'set-elevation': `SURFSETELEV on ${name} (Surface-only elevation override — survey data unchanged): pick a vertex, then type the new elevation.`,
      'raise-lower': `SURFRAISELOWER on ${name} (Surface-only — survey data unchanged): type the delta and press Enter twice to confirm.`,
    };
    const staged: StagedPointEdit | null = mode === 'raise-lower'
      ? { kind: 'raise-lower-surface', deltaZ: null }
      : null;
    setSession({ mode, surfaceId: surface.id, surfaceName: surface.name, staged, heldVertex: null, prompt: prompts[mode] });
    deps.notify(prompts[mode]);
    return true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deps.project, deps.cache, deps.selectedSurfaceId, deps.buildingSurfaceIds]);

  const cancel = useCallback((): void => {
    setSession(null);
  }, []);

  const handlePick = useCallback((worldPoint: Xy): void => {
    if (!session) return;
    const live = meshOf(deps, session.surfaceId);
    if (!live) {
      deps.notify(SURFACE_POINT_EDIT_STALE_MESSAGE);
      setSession(null);
      return;
    }
    const name = `“${session.surfaceName}”`;
    const numbers = editNumbers(live.surface.definition.edits ?? []);
    const sourceKind: 'native' | 'imported-tin' =
      live.surface.definition.sourceKind === 'imported-tin' ? 'imported-tin' : 'native';
    if (session.mode === 'add-point') {
      const coincident = live.mesh.points.some((point) => point.x === worldPoint.x && point.y === worldPoint.y);
      if (coincident) {
        deps.notify(`SURFADDPOINT on ${name} rejected (SURFACE_EDIT_POINT_ALREADY_EXISTS) — pick a free XY inside the surface.`);
        return;
      }
      const elevation = queryMeshElevation(live.mesh, worldPoint.x, worldPoint.y);
      if (elevation == null) {
        deps.notify(`SURFADDPOINT on ${name} rejected (SURFACE_EDIT_POINT_OUTSIDE_DOMAIN) — pick XY inside the surface.`);
        return;
      }
      const outline = containingOutline(live.mesh.points, live.mesh.triangles, worldPoint) ?? [];
      setSession({
        ...session,
        staged: { kind: 'add-point', x: worldPoint.x, y: worldPoint.y, z: elevation, customZ: false, outline },
        prompt: `Add point staged on ${name} (Surface-only): XY (${fmt(worldPoint.x)}, ${fmt(worldPoint.y)}), interpolated elevation ${fmt(elevation)} — type Elevation or Enter to commit, Esc ends.`,
      });
      return;
    }
    if (session.mode === 'raise-lower') {
      deps.notify(`SURFRAISELOWER on ${name} needs no selection — type the delta and press Enter twice to confirm.`);
      return;
    }
    if (session.mode === 'move-point' && session.heldVertex) {
      // A held vertex + a second staging = the XY target (raw coords,
      // never vertex-snapped: canvas target clicks land on background by
      // construction, and typed entry is exact). Same-coords = no-op.
      const held = session.heldVertex;
      if (worldPoint.x === held.x && worldPoint.y === held.y) return;
      const heldIndex = live.mesh.points.findIndex((point) => entityIdOfKey(held.key) === point.entityId);
      if (heldIndex < 0) {
        deps.notify(`${sessionPromptKey(session.mode)} on ${name} rejected (SURFACE_EDIT_VERTEX_MISSING) — re-pick.`);
        return;
      }
      stageMoveTarget(deps, session, setSession, live.mesh.points, live.mesh.triangles, live.mesh.edgeKinds, heldIndex, worldPoint);
      return;
    }
    const input = {
      surfaceId: live.surface.id,
      sourceKind,
      revision: live.revision,
      points: live.mesh.points,
      triangles: live.mesh.triangles,
      edgeKinds: live.mesh.edgeKinds,
      worldPoint,
      tolerance: surfaceEditPickTolerance(deps.project.bounds),
    };
    const pick = pickSurfaceVertex(input);
    if (!pick) return;
    if ('blocked' in pick) {
      deps.notify(`${sessionPromptKey(session.mode)} on ${name} blocked (${pick.reason})`);
      return;
    }
    const key = pick.vertexRef.key;
    const label = labelOfKey(deps, key, numbers);
    const index = live.mesh.points.findIndex((point) => entityIdOfKey(key) === point.entityId);
    if (index < 0) {
      deps.notify(`${sessionPromptKey(session.mode)} on ${name} rejected (SURFACE_EDIT_VERTEX_MISSING) — re-pick.`);
      return;
    }
    const at = live.mesh.points[index];
    if (session.mode === 'delete-point') {
      const topo = topologyOf(live.mesh.triangles, live.mesh.edgeKinds, index);
      const blocked = topo.boundary
        ? `SURFDELETEPOINT on ${name} blocked (SURFACE_EDIT_DELETE_POINT_BOUNDARY) — ${label} is on the boundary; boundary vertices cannot be deleted (Surface-only).`
        : topo.constrained
          ? `SURFDELETEPOINT on ${name} blocked (SURFACE_EDIT_DELETE_POINT_CONSTRAINED) — ${label} touches a constrained edge; constrained vertices cannot be deleted (Surface-only).`
          : null;
      const ring = topo.neighbors.map((other) => live.mesh.points[other]);
      setSession({
        ...session,
        staged: { kind: 'delete-point', vertexKey: key, label, ring, blocked },
        prompt: blocked ?? `Delete staged on ${name} (Surface-only): vertex ${label} — Enter commits, pick again to restage, Esc ends.`,
      });
      if (blocked) deps.notify(blocked);
      return;
    }
    if (session.mode === 'move-point') {
      setSession({
        ...session,
        heldVertex: { key, label, x: at.x, y: at.y },
        staged: { kind: 'move-point', vertexKey: key, label, from: { x: at.x, y: at.y }, to: null, issue: null },
        prompt: `SURFMOVEPOINT on ${name} (Surface-only, Z unchanged): vertex ${label} held — pick the target XY.`,
      });
      return;
    }
    // set-elevation
    const baseZ = baseZOf(deps, session.surfaceId, key);
    setSession({
      ...session,
      staged: {
        kind: 'set-elevation',
        vertexKey: key,
        label,
        currentZ: at.z,
        baseZ,
        newZ: null,
      },
      prompt: `SURFSETELEV on ${name} (Surface-only elevation override): vertex ${label}, current ${fmt(at.z)}${baseZ != null ? `, base ${fmt(baseZ)}` : ''} — type the new elevation, Enter commits, Esc ends.`,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, deps.project, deps.cache, deps.buildingSurfaceIds]);

  /** Dock numeric entry: elevation for add/set, delta for raise-lower. */
  const submitValueText = useCallback((text: string): boolean => {
    if (!session?.staged) return false;
    const value = Number(text.trim());
    if (text.trim().length === 0 || !Number.isFinite(value)) return false;
    const name = `“${session.surfaceName}”`;
    const staged = session.staged;
    if (staged.kind === 'add-point') {
      setSession({
        ...session,
        staged: { ...staged, z: value, customZ: true },
        prompt: `Add point staged on ${name} (Surface-only): XY (${fmt(staged.x)}, ${fmt(staged.y)}), elevation ${fmt(value)} — Enter commits, Esc ends.`,
      });
      return true;
    }
    if (staged.kind === 'set-elevation') {
      setSession({
        ...session,
        staged: { ...staged, newZ: value },
        prompt: `SURFSETELEV on ${name} (Surface-only elevation override): vertex ${staged.label} ${fmt(staged.currentZ)} → ${fmt(value)} — Enter commits, Esc ends.`,
      });
      return true;
    }
    if (staged.kind === 'raise-lower-surface') {
      setSession({
        ...session,
        staged: { ...staged, deltaZ: value },
        prompt: `SURFRAISELOWER on ${name} (Surface-only): shift every vertex by ${fmt(value)} — press Enter again to confirm, Esc ends.`,
      });
      return true;
    }
    return false;
  }, [session]);

  const handleEnter = useCallback((): boolean => {
    if (!session) return false;
    // Raise-lower needs an explicit two-step confirm: first Enter arms.
    if (session.mode === 'raise-lower' && session.staged?.kind === 'raise-lower-surface' && session.staged.deltaZ == null) {
      return false;
    }
    const staged = session.staged;
    if (!staged) return false;
    if (staged.kind === 'delete-point' && staged.blocked) {
      deps.notify(staged.blocked);
      return true;
    }
    if (staged.kind === 'move-point' && (!staged.to || staged.issue)) {
      if (staged.issue) deps.notify(staged.issue);
      return staged.issue != null;
    }
    if (staged.kind === 'set-elevation' && staged.newZ == null) return false;
    if (staged.kind === 'raise-lower-surface' && staged.deltaZ == null) return false;
    const live = meshOf(deps, session.surfaceId);
    if (!live) {
      deps.notify(SURFACE_POINT_EDIT_STALE_MESSAGE);
      setSession({ ...session, staged: null, heldVertex: null });
      return true;
    }
    const command: CadCommand =
      staged.kind === 'add-point'
        ? { key: 'SURFACE_ADD_EDIT', surfaceId: session.surfaceId, edit: { kind: 'add-point', x: staged.x, y: staged.y, z: staged.z }, expectedRevision: live.revision }
        : staged.kind === 'delete-point'
          ? { key: 'SURFACE_ADD_EDIT', surfaceId: session.surfaceId, edit: { kind: 'delete-point', vertex: { key: staged.vertexKey } }, expectedRevision: live.revision }
          : staged.kind === 'move-point'
            ? { key: 'SURFACE_ADD_EDIT', surfaceId: session.surfaceId, edit: { kind: 'move-point', vertex: { key: staged.vertexKey }, x: staged.to!.x, y: staged.to!.y }, expectedRevision: live.revision }
            : staged.kind === 'set-elevation'
              ? { key: 'SURFACE_ADD_EDIT', surfaceId: session.surfaceId, edit: { kind: 'set-elevation', vertex: { key: staged.vertexKey }, z: staged.newZ! }, expectedRevision: live.revision }
              : { key: 'SURFACE_ADD_EDIT', surfaceId: session.surfaceId, edit: { kind: 'raise-lower-surface', deltaZ: staged.deltaZ! }, expectedRevision: live.revision };
    if (!deps.runCommand(command)) {
      deps.notify('Edit rejected (locked or stale SURFACE_EDIT_STALE_REVISION) — re-pick against the fresh mesh.');
      setSession({ ...session, staged: null, heldVertex: null });
      return true;
    }
    queueSessionSurfaceRebuild(deps.rebuildSurface, session.surfaceId);
    const keep = session.mode === 'raise-lower' ? null : { ...session, staged: null, heldVertex: null };
    if (keep) setSession(keep);
    else setSession(null);
    deps.notify(`Edit committed on “${session.surfaceName}” (Surface-only) — rebuilding; ${session.mode === 'raise-lower' ? 'session ended.' : 'pick again or Esc to end.'}`);
    return true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, deps.project, deps.cache]);

  const previewPrimitives = useMemo<CadDisplayPrimitive[]>(() => {
    const surface = (deps.project.surfaces ?? []).find((entry) => entry.id === session?.surfaceId);
    const layerId = surface?.layerId ?? 'general';
    if (!session?.staged) {
      return session?.heldVertex
        ? [pointPrimitive('surface-edit-held', layerId, session.heldVertex, '#22c55e')]
        : [];
    }
    const staged = session.staged;
    if (staged.kind === 'add-point') {
      const outline: CadDisplayPrimitive[] = [];
      for (let i = 0; i + 2 < staged.outline.length; i += 3) {
        const [a, b, c] = [staged.outline[i], staged.outline[i + 1], staged.outline[i + 2]];
        outline.push(
          linePrimitive('surface-edit-aff-0', layerId, a, b, '#f59e0b', true),
          linePrimitive('surface-edit-aff-1', layerId, b, c, '#f59e0b', true),
          linePrimitive('surface-edit-aff-2', layerId, c, a, '#f59e0b', true),
        );
      }
      return [...outline, pointPrimitive('surface-edit-new', layerId, staged, '#22c55e')];
    }
    if (staged.kind === 'delete-point') {
      const color = staged.blocked ? '#ef4444' : '#f59e0b';
      return staged.ring.map((point, index) =>
        linePrimitive(`surface-edit-ring-${index}`, layerId, point, staged.ring[(index + 1) % staged.ring.length], color, true),
      );
    }
    if (staged.kind === 'move-point') {
      if (!staged.to) return [pointPrimitive('surface-edit-held', layerId, staged.from, '#22c55e')];
      return [
        linePrimitive('surface-edit-move', layerId, staged.from, staged.to, staged.issue ? '#ef4444' : '#22c55e', false),
        pointPrimitive('surface-edit-target', layerId, staged.to, staged.issue ? '#ef4444' : '#22c55e'),
      ];
    }
    return [];
  }, [session, deps.project]);

  return { session, start, cancel, handlePick, handleEnter, submitValueText, previewPrimitives };
};

