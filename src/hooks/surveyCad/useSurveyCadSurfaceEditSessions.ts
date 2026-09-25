import { useCallback, useMemo, useState } from 'react';
import type { CadDisplayPrimitive } from '../../engine/cad/cadDisplayTypes';
import type { CadSurfaceCache } from '../../engine/cad/cadSurfaceCache';
import {
  resolveSurfaceDisplayStatus,
  surfaceContentRevision,
} from '../../engine/cad/cadSurfaceView';
import {
  pickSurfaceEdge,
  pickSurfaceVertex,
  surfaceEditPickTolerance,
  type SurfaceEditEdgePick,
  type SurfaceEditVertexPick,
} from '../../engine/cad/cadSurfaceEditPicking';
import type { CadCommand } from '../../engine/cad/cadTransactions.types';
import type { CadProject } from '../../engine/cad/cadTypes';

/**
 * Phase 18S TIN-topology edit sessions (UI state only — no geometry here).
 *
 * Two-step loop: picks STAGE a pending edit (+ temporary overlay preview,
 * never a cache mutation, never a style toggle); Enter commits the staged
 * edit as one undoable SURFACE_ADD_EDIT against the FRESH revision and
 * queues a worker rebuild; Esc ends the loop. Commits always re-read the
 * current revision — picks are never applied against a stale mesh.
 */

export type SurfaceEditSessionMode = 'swap' | 'add-line' | 'delete-line';

interface StagedSwap {
  kind: 'swap-edge';
  edge: SurfaceEditEdgePick['edge'];
  currentDiagonal: [{ x: number; y: number }, { x: number; y: number }];
  proposedDiagonal: [{ x: number; y: number }, { x: number; y: number }];
}

interface StagedAdd {
  kind: 'add-line';
  from: SurfaceEditVertexPick['vertexRef'];
  to: SurfaceEditVertexPick['vertexRef'];
  proposedLine: [{ x: number; y: number }, { x: number; y: number }];
}

interface StagedDelete {
  kind: 'delete-line';
  edge: SurfaceEditEdgePick['edge'];
  edgeLine: [{ x: number; y: number }, { x: number; y: number }];
  affectedOutlines: Array<[{ x: number; y: number }, { x: number; y: number }]>;
}

type StagedEdit = StagedSwap | StagedAdd | StagedDelete;

export interface SurfaceEditSessionState {
  mode: SurfaceEditSessionMode;
  surfaceId: string;
  surfaceName: string;
  /** First add-line vertex (second pick stages the line). */
  firstVertex: { key: string; x: number; y: number } | null;
  staged: StagedEdit | null;
  prompt: string;
}

interface UseSurfaceEditSessionsDeps {
  project: CadProject;
  cache: CadSurfaceCache;
  selectedSurfaceId: string | null;
  buildingSurfaceIds: ReadonlySet<string>;
  runCommand: (_command: CadCommand) => boolean;
  rebuildSurface: (_surfaceId: string) => string;
  notify: (_message: string) => void;
}

export const SURFACE_EDIT_STALE_MESH_MESSAGE = 'Rebuild the surface before editing TIN topology.';

type MeshPoint = { entityId: string; x: number; y: number };

const surfaceKeyOf = (sourceKind: 'native' | 'imported-tin', pointId: string): string => {
  if (sourceKind === 'imported-tin') {
    const match = /^(.*):v(\d+)$/.exec(pointId);
    if (match) return `imported:${match[1]}:${match[2]}`;
  }
  return `source:${pointId}`;
};

const linePrimitive = (
  id: string,
  layerId: string,
  a: { x: number; y: number },
  b: { x: number; y: number },
  stroke: string,
  dashed: boolean,
): CadDisplayPrimitive => ({
  id,
  kind: 'line',
  layerId,
  sourceEntityId: 'surface-edit-overlay',
  points: [{ x: a.x, y: a.y }, { x: b.x, y: b.y }],
  stroke,
  strokeWidth: 2,
  ...(dashed ? { strokeDasharray: '6 4' } : {}),
});

const pointPrimitive = (
  id: string,
  layerId: string,
  at: { x: number; y: number },
  stroke: string,
): CadDisplayPrimitive => ({
  id,
  kind: 'point',
  layerId,
  sourceEntityId: 'surface-edit-overlay',
  point: { x: at.x, y: at.y },
  radius: 5,
  stroke,
});

/**
 * Session edit gate (pure, exported for tests): a CURRENT mesh is required.
 * Anything else (UNBUILT / NEEDS_REBUILD / BUILDING / FAILED /
 * BROKEN_REFERENCE / INSUFFICIENT_DATA, or a missing session mesh) is null —
 * the caller reports SURFACE_EDIT_STALE_MESH_MESSAGE. Status derives through
 * resolveSurfaceDisplayStatus (fresh session mesh = CURRENT, else the engine
 * deriveSurfaceStatus rules), plus the live BUILDING overlay.
 */
export const currentSurfaceEditMesh = (
  project: CadProject,
  cache: CadSurfaceCache,
  surfaceId: string,
  buildingSurfaceIds: ReadonlySet<string>,
) => {
  const surface = (project.surfaces ?? []).find((entry) => entry.id === surfaceId);
  if (!surface) return null;
  const revision = surfaceContentRevision(project, surface);
  const mesh = cache.get(surfaceId, revision);
  const display = resolveSurfaceDisplayStatus(project, surface, mesh != null);
  const status =
    display.status !== 'BROKEN_REFERENCE' && buildingSurfaceIds.has(surfaceId)
      ? 'BUILDING'
      : display.status;
  if (status !== 'CURRENT' || !mesh) return null;
  return { surface, revision, mesh };
};

const meshOf = (deps: UseSurfaceEditSessionsDeps, surfaceId: string) =>
  currentSurfaceEditMesh(deps.project, deps.cache, surfaceId, deps.buildingSurfaceIds);

const findPointIndex = (
  points: readonly MeshPoint[],
  sourceKind: 'native' | 'imported-tin',
  key: string,
): number => points.findIndex((p) => surfaceKeyOf(sourceKind, p.entityId) === key);

/** Opposite vertices of the triangles adjacent to mesh edge (a,b). */
const oppositeOfEdge = (
  triangles: ReadonlyArray<readonly [number, number, number]>,
  a: number,
  b: number,
): number[] => {
  const out: number[] = [];
  for (const tri of triangles) {
    const set = new Set(tri);
    if (!set.has(a) || !set.has(b)) continue;
    const third = tri.find((v) => v !== a && v !== b);
    if (third !== undefined) out.push(third);
  }
  return out;
};

export const useSurveyCadSurfaceEditSessions = (deps: UseSurfaceEditSessionsDeps) => {
  const [session, setSession] = useState<SurfaceEditSessionState | null>(null);

  const start = useCallback((mode: SurfaceEditSessionMode): boolean => {
    const surface = (deps.project.surfaces ?? []).find((entry) => entry.id === deps.selectedSurfaceId);
    if (!surface) {
      deps.notify('Select a surface first.');
      return false;
    }
    if (!meshOf(deps, surface.id)) {
      deps.notify(SURFACE_EDIT_STALE_MESH_MESSAGE);
      return false;
    }
    const prompts: Record<SurfaceEditSessionMode, string> = {
      swap: `Swap edge on “${surface.name}”: pick an edge, Enter commits, Esc ends.`,
      'add-line': `Add line on “${surface.name}”: pick two vertices, Enter commits, Esc ends.`,
      'delete-line': `Delete line on “${surface.name}”: pick an edge, Enter commits, Esc ends.`,
    };
    setSession({ mode, surfaceId: surface.id, surfaceName: surface.name, firstVertex: null, staged: null, prompt: prompts[mode] });
    deps.notify(prompts[mode]);
    return true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deps.project, deps.cache, deps.selectedSurfaceId, deps.buildingSurfaceIds]);

  const cancel = useCallback((): void => {
    setSession(null);
  }, []);

  const handlePick = useCallback((worldPoint: { x: number; y: number }): void => {
    if (!session) return;
    const live = meshOf(deps, session.surfaceId);
    if (!live) {
      deps.notify(SURFACE_EDIT_STALE_MESH_MESSAGE);
      setSession(null);
      return;
    }
    const sourceKind: 'native' | 'imported-tin' =
      live.surface.definition.sourceKind === 'imported-tin' ? 'imported-tin' : 'native';
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
    if (session.mode === 'add-line') {
      const pick = pickSurfaceVertex(input);
      if (!pick) return;
      if ('blocked' in pick) {
        deps.notify(pick.reason);
        return;
      }
      if (!session.firstVertex) {
        setSession({ ...session, firstVertex: { key: pick.vertexRef.key, x: pick.worldPoint.x, y: pick.worldPoint.y }, staged: null, prompt: `Add line on “${session.surfaceName}”: pick the second vertex, Enter commits, Esc ends.` });
        return;
      }
      if (pick.vertexRef.key === session.firstVertex.key) return;
      const from = { x: session.firstVertex.x, y: session.firstVertex.y };
      const to = { x: pick.worldPoint.x, y: pick.worldPoint.y };
      setSession({
        ...session,
        firstVertex: null,
        staged: { kind: 'add-line', from: { key: session.firstVertex.key }, to: pick.vertexRef, proposedLine: [from, to] },
        prompt: `Add line staged on “${session.surfaceName}”: Enter commits, pick again to restage, Esc ends.`,
      });
      return;
    }
    const pick = pickSurfaceEdge(input);
    if (!pick) return;
    if ('blocked' in pick) {
      deps.notify(pick.reason);
      return;
    }
    const indexA = findPointIndex(live.mesh.points, sourceKind, pick.edge.a.key);
    const indexB = findPointIndex(live.mesh.points, sourceKind, pick.edge.b.key);
    if (indexA < 0 || indexB < 0) return;
    const pa = live.mesh.points[indexA];
    const pb = live.mesh.points[indexB];
    if (session.mode === 'swap') {
      const ends = oppositeOfEdge(live.mesh.triangles, indexA, indexB);
      if (ends.length !== 2) {
        deps.notify('Only interior free edges can be swapped — pick an edge shared by two triangles.');
        return;
      }
      const qa = live.mesh.points[ends[0]];
      const qb = live.mesh.points[ends[1]];
      setSession({
        ...session,
        staged: {
          kind: 'swap-edge',
          edge: pick.edge,
          currentDiagonal: [{ x: pa.x, y: pa.y }, { x: pb.x, y: pb.y }],
          proposedDiagonal: [{ x: qa.x, y: qa.y }, { x: qb.x, y: qb.y }],
        },
        prompt: `Swap staged on “${session.surfaceName}”: Enter commits, pick again to restage, Esc ends.`,
      });
      return;
    }
    const outlines: Array<[{ x: number; y: number }, { x: number; y: number }]> = [];
    for (const tri of live.mesh.triangles) {
      if (!tri.includes(indexA) || !tri.includes(indexB)) continue;
      const [a, b, c] = [live.mesh.points[tri[0]], live.mesh.points[tri[1]], live.mesh.points[tri[2]]];
      outlines.push(
        [{ x: a.x, y: a.y }, { x: b.x, y: b.y }],
        [{ x: b.x, y: b.y }, { x: c.x, y: c.y }],
        [{ x: c.x, y: c.y }, { x: a.x, y: a.y }],
      );
    }
    setSession({
      ...session,
      staged: {
        kind: 'delete-line',
        edge: pick.edge,
        edgeLine: [{ x: pa.x, y: pa.y }, { x: pb.x, y: pb.y }],
        affectedOutlines: outlines,
      },
      prompt: `Delete staged on “${session.surfaceName}”: Enter commits, pick again to restage, Esc ends.`,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, deps.project, deps.cache, deps.buildingSurfaceIds]);

  const handleEnter = useCallback((): boolean => {
    if (!session?.staged) return false;
    const live = meshOf(deps, session.surfaceId);
    if (!live) {
      deps.notify(SURFACE_EDIT_STALE_MESH_MESSAGE);
      setSession({ ...session, staged: null });
      return true;
    }
    const staged = session.staged;
    const command: CadCommand =
      staged.kind === 'swap-edge'
        ? { key: 'SURFACE_ADD_EDIT', surfaceId: session.surfaceId, edit: { kind: 'swap-edge', edge: staged.edge }, expectedRevision: live.revision }
        : staged.kind === 'add-line'
          ? { key: 'SURFACE_ADD_EDIT', surfaceId: session.surfaceId, edit: { kind: 'add-line', from: staged.from, to: staged.to }, expectedRevision: live.revision }
          : { key: 'SURFACE_ADD_EDIT', surfaceId: session.surfaceId, edit: { kind: 'delete-line', edge: staged.edge }, expectedRevision: live.revision };
    if (!deps.runCommand(command)) {
      deps.notify('Edit rejected (locked or stale) — re-pick against the fresh mesh.');
      setSession({ ...session, staged: null });
      return true;
    }
    deps.rebuildSurface(session.surfaceId);
    setSession({ ...session, firstVertex: null, staged: null });
    deps.notify(`Edit committed on “${session.surfaceName}” — rebuilding; pick again or Esc to end.`);
    return true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, deps.project, deps.cache]);

  const previewPrimitives = useMemo<CadDisplayPrimitive[]>(() => {
    const surface = (deps.project.surfaces ?? []).find((entry) => entry.id === session?.surfaceId);
    const layerId = surface?.layerId ?? 'general';
    if (!session) return [];
    if (!session.staged) {
      return session.firstVertex
        ? [pointPrimitive('surface-edit-first', layerId, session.firstVertex, '#22c55e')]
        : [];
    }
    const staged = session.staged;
    if (staged.kind === 'swap-edge') {
      return [
        linePrimitive('surface-edit-current', layerId, staged.currentDiagonal[0], staged.currentDiagonal[1], '#ef4444', true),
        linePrimitive('surface-edit-proposed', layerId, staged.proposedDiagonal[0], staged.proposedDiagonal[1], '#22c55e', false),
      ];
    }
    if (staged.kind === 'add-line') {
      return [linePrimitive('surface-edit-proposed', layerId, staged.proposedLine[0], staged.proposedLine[1], '#22c55e', false)];
    }
    return [
      ...staged.affectedOutlines.map((line, index) =>
        linePrimitive(`surface-edit-affected-${index}`, layerId, line[0], line[1], '#f59e0b', true),
      ),
      linePrimitive('surface-edit-current', layerId, staged.edgeLine[0], staged.edgeLine[1], '#ef4444', false),
    ];
  }, [session, deps.project]);

  return { session, start, cancel, handlePick, handleEnter, previewPrimitives };
};
