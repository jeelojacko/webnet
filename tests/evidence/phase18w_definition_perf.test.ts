/**
 * Phase 18W definition-edit performance campaign — EVIDENCE tier.
 *
 * MANUAL ONLY (tests/evidence/, evidence tier via scripts/testTiers.ts).
 * Bounded, record-only: NO millisecond assertions. Correctness is asserted
 * lightly (clean validation verdicts, ok builds, stable revisions) so a
 * broken run cannot masquerade as fast. Numbers are recorded in
 * docs/evidence/phase18w-performance.md.
 *
 * Envelope (§123-125):
 * - breakline chain validation (duplicate-ref + self-intersection seams) at
 *   10 / 100 / 1000 points;
 * - ring candidate validation (outer + multi-void) at 100 / 1000 / 5000
 *   vertices;
 * - source-revision compute on 10k / 50k / 100k-point native surfaces
 *   (revision only — never a full rebuild at this scale per pointer);
 * - one engine rebuild timing at 10k + 50k points with a breakline + voids,
 *   split into definition-edit overhead (commit + revision) vs full rebuild
 *   vs edit-stack replay (stacked build minus bare build).
 * - 100k rebuilds are out of scope: if the 50k rebuild exceeds ~120 s the
 *   run records the bound and stops (no burnt sessions).
 */
import { describe, expect, it } from 'vitest';

import {
  buildCadSurface,
  computeCadSurfaceSourceRevision,
} from '../../src/engine/cad/cadSurfaces';
import {
  breaklineChainSelfIntersects,
  validateBreaklineChainRefs,
} from '../../src/engine/cad/cadBreaklineChainValidation';
import { validateSurfaceBoundaryCandidate } from '../../src/engine/cad/cadBoundaryCandidateValidation';
import { createBlankCadDrawingDocument } from '../../src/engine/cad/cadDrawingFile';
import { createCadHistoryState, runCadCommand } from '../../src/engine/cad/cadUndoRedo';
import type {
  CadEntity,
  CadPolygonEntity,
  CadProject,
  CadSurveyPointEntity,
} from '../../src/engine/cad/cadTypes';

const ms = (value: number): string => `${value.toFixed(1)}ms`;

const time = <T>(fn: () => T): { value: T; elapsedMs: number } => {
  const start = performance.now();
  const value = fn();
  return { value, elapsedMs: performance.now() - start };
};

const report = (label: string, elapsedMs: number, extra = ''): void => {
  console.log(`[18W-PERF] ${label}: ${ms(elapsedMs)}${extra ? ` ${extra}` : ''}`);
};

// ---------------------------------------------------------------------------
// Chain + ring validation scaling (pure geometry, no builds)
// ---------------------------------------------------------------------------

describe('18W perf chain validation', () => {
  it('duplicate-ref + self-intersection seams at 10/100/1000 points', () => {
    for (const n of [10, 100, 1000]) {
      const ids = Array.from({ length: n }, (_, i) => `pt-${i}`);
      const refCheck = time(() => validateBreaklineChainRefs(ids));
      expect(refCheck.value).toBeNull();
      // Gentle winding chain (never self-intersects).
      const xy = ids.map((_, i) => ({ x: i * 10, y: Math.sin(i / 7) * 40 + i }));
      const crossCheck = time(() => breaklineChainSelfIntersects(xy));
      expect(crossCheck.value).toBe(false);
      report(`chain-refs n=${n}`, refCheck.elapsedMs);
      report(`chain-selfintersect n=${n}`, crossCheck.elapsedMs);
    }
  });
});

describe('18W perf ring validation', () => {
  const circle = (n: number, cx: number, cy: number, r: number) =>
    Array.from({ length: n }, (_, i) => {
      const a = (i / n) * Math.PI * 2;
      return { x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r };
    });

  const projectWithSurface = (voidCount: number): { project: CadProject; surfaceId: string } => {
    const drawing = createBlankCadDrawingDocument({ name: 'Perf 18W', units: 'm' });
    const entities: CadEntity[] = [
      { id: 'p1', type: 'survey-point', layerId: 'points', visible: true, locked: false, stationId: 'A', x: 0, y: 0, z: 1, pointClass: 'free', source: 'parsed-input' },
      { id: 'p2', type: 'survey-point', layerId: 'points', visible: true, locked: false, stationId: 'B', x: 100, y: 0, z: 1, pointClass: 'free', source: 'parsed-input' },
      { id: 'p3', type: 'survey-point', layerId: 'points', visible: true, locked: false, stationId: 'C', x: 50, y: 80, z: 1, pointClass: 'free', source: 'parsed-input' },
    ] as CadSurveyPointEntity[];
    // Voids sit inside the validation circle (center 500,500): a void outside
    // the candidate outer is itself invalid.
    for (let v = 0; v < voidCount; v += 1) {
      const ox = 480 + v * 12;
      entities.push({
        id: `void-${v}`, type: 'polygon', layerId: 'general', visible: true, locked: false,
        vertices: [{ x: ox, y: 480 }, { x: ox + 5, y: 480 }, { x: ox + 5, y: 485 }, { x: ox, y: 485 }],
        vertexLabels: ['', '', '', ''],
      } as CadPolygonEntity as unknown as CadEntity);
    }
    const project: CadProject = { ...drawing.project, entities };
    let history = createCadHistoryState(project);
    history = runCadCommand(history, {
      key: 'SURFACE_CREATE', name: 'S',
      pointSource: { kind: 'points', pointEntityIds: ['p1', 'p2', 'p3'] },
    });
    const surfaceId = history.present.project.surfaces![0]!.id;
    for (let v = 0; v < voidCount; v += 1) {
      history = runCadCommand(history, {
        key: 'SURFACE_ADD_BOUNDARY', surfaceId, kind: 'void', sourceEntityId: `void-${v}`,
      });
    }
    return { project: history.present.project, surfaceId };
  };

  it('outer + multi-void candidate validation at 100/1000/5000 vertices', () => {
    for (const n of [100, 1000, 5000]) {
      const { project, surfaceId } = projectWithSurface(3);
      const surface = project.surfaces!.find((s) => s.id === surfaceId)!;
      const outer = circle(n, 500, 500, 400);
      const outerCheck = time(() => validateSurfaceBoundaryCandidate(project, surface, 'outer', outer));
      expect(outerCheck.value).toBeNull();
      report(`ring-outer n=${n} (3 voids attached)`, outerCheck.elapsedMs);
      // Candidate void parked clear of the attached voids (overlap is illegal).
      const voidRing = circle(Math.max(4, n >> 2), 620, 620, 40);
      const voidCheck = time(() => validateSurfaceBoundaryCandidate(project, surface, 'void', voidRing));
      expect(voidCheck.value).toBeNull();
      report(`ring-void n=${voidRing.length} (3 voids attached)`, voidCheck.elapsedMs);
    }
  });
});

// ---------------------------------------------------------------------------
// Source-revision scaling (revision only — never a full rebuild per pointer)
// ---------------------------------------------------------------------------

describe('18W perf source revision', () => {
  const bigGrid = (side: number): { project: CadProject; surfaceId: string } => {
    const drawing = createBlankCadDrawingDocument({ name: 'PerfRev 18W', units: 'm' });
    const entities: CadEntity[] = [];
    const ids: string[] = [];
    for (let row = 0; row < side; row += 1) {
      for (let col = 0; col < side; col += 1) {
        const id = `g-${row}-${col}`;
        ids.push(id);
        entities.push({
          id, type: 'survey-point', layerId: 'points', visible: true, locked: false,
          stationId: id, x: col * 10, y: row * 10,
          z: 100 + 0.1 * col * 10 + 0.2 * row * 10, pointClass: 'free', source: 'parsed-input',
        } as CadSurveyPointEntity);
      }
    }
    const project: CadProject = { ...drawing.project, entities };
    let history = createCadHistoryState(project);
    history = runCadCommand(history, {
      key: 'SURFACE_CREATE', name: 'S', pointSource: { kind: 'points', pointEntityIds: ids },
    });
    return { project: history.present.project, surfaceId: history.present.project.surfaces![0]!.id };
  };

  it('revision compute at 10k/50k/100k points', () => {
    for (const [side, label] of [[100, '10k'], [224, '50k'], [317, '100k']] as const) {
      const { project, surfaceId } = bigGrid(side);
      const surface = project.surfaces!.find((s) => s.id === surfaceId)!;
      const first = time(() => computeCadSurfaceSourceRevision(project, surface));
      const second = time(() => computeCadSurfaceSourceRevision(project, surface));
      expect(second.value).toBe(first.value);
      report(`revision ${label} (n=${side * side})`, first.elapsedMs, 'first');
      report(`revision ${label} (n=${side * side})`, second.elapsedMs, 'repeat');
    }
  }, 300000);
});

// ---------------------------------------------------------------------------
// Rebuild split: commit overhead vs full rebuild vs edit-stack replay
// ---------------------------------------------------------------------------

describe('18W perf rebuild split', () => {
  const builtFixture = (side: number) => {
    const drawing = createBlankCadDrawingDocument({ name: 'PerfBuild 18W', units: 'm' });
    const entities: CadEntity[] = [];
    const ids: string[] = [];
    for (let row = 0; row < side; row += 1) {
      for (let col = 0; col < side; col += 1) {
        const id = `g-${row}-${col}`;
        ids.push(id);
        entities.push({
          id, type: 'survey-point', layerId: 'points', visible: true, locked: false,
          stationId: id, x: col * 10, y: row * 10,
          z: 100 + 0.05 * col * 10 + 0.11 * row * 10 + Math.sin(row * 0.7) * Math.cos(col * 0.6),
          pointClass: 'free', source: 'parsed-input',
        } as CadSurveyPointEntity);
      }
    }
    const max = (side - 1) * 10;
    entities.push({
      id: 'outer', type: 'polygon', layerId: 'general', visible: true, locked: false,
      vertices: [{ x: -5, y: -5 }, { x: max + 5, y: -5 }, { x: max + 5, y: max + 5 }, { x: -5, y: max + 5 }],
      vertexLabels: ['', '', '', ''],
    } as unknown as CadEntity);
    const mid = Math.floor(side / 2);
    const q = Math.floor(side / 4);
    // Void parked off the main diagonal so the diagonal breakline never
    // crosses it (a crossing is correctly illegal).
    const vx = q * 10;
    const vy = (side - q - 3) * 10;
    entities.push({
      id: 'void-1', type: 'polygon', layerId: 'general', visible: true, locked: false,
      vertices: [
        { x: vx, y: vy }, { x: vx + 20, y: vy },
        { x: vx + 20, y: vy + 20 }, { x: vx, y: vy + 20 },
      ],
      vertexLabels: ['', '', '', ''],
    } as unknown as CadEntity);
    let history = createCadHistoryState({ ...drawing.project, entities });
    history = runCadCommand(history, {
      key: 'SURFACE_CREATE', name: 'S', pointSource: { kind: 'points', pointEntityIds: ids },
    });
    const surfaceId = history.present.project.surfaces![0]!.id;
    const diagChain = Array.from({ length: mid }, (_, i) => `g-${i}-${i}`);
    history = runCadCommand(history, {
      key: 'SURFACE_ADD_BREAKLINE', surfaceId, pointIds: diagChain, name: 'diag',
    });
    history = runCadCommand(history, {
      key: 'SURFACE_ADD_BOUNDARY', surfaceId, kind: 'outer', sourceEntityId: 'outer',
    });
    history = runCadCommand(history, {
      key: 'SURFACE_ADD_BOUNDARY', surfaceId, kind: 'void', sourceEntityId: 'void-1',
    });
    return { history, surfaceId, ids };
  };

  it('commit vs rebuild vs replay at 10k + 50k (bound 120 s)', () => {
    for (const [side, label] of [[100, '10k'], [224, '50k']] as const) {
      const { history, surfaceId } = builtFixture(side);
      const blId = history.present.project.surfaces!.find((s) => s.id === surfaceId)!
        .definition.breaklines![0]!.id;
      // (a) definition-edit overhead: one insert commit + revision recompute.
      // Local detour point (triangulation-friendly; a 500-unit crossing
      // segment would fail recovery — correctly, but that is not being timed).
      const commit = time(() => {
        const next = runCadCommand(history, {
          key: 'SURFACE_BREAKLINE_INSERT_POINT', surfaceId, breaklineId: blId,
          pointEntityId: 'g-1-0', insertIndex: 1,
        });
        if (next === history) throw new Error('insert rejected');
        const surface = next.present.project.surfaces!.find((s) => s.id === surfaceId)!;
        computeCadSurfaceSourceRevision(next.present.project, surface);
        return next;
      });
      report(`commit+revision ${label}`, commit.elapsedMs);
      // (b) full engine rebuild of the edited definition.
      const edited = commit.value.present.project;
      const editedSurface = edited.surfaces!.find((s) => s.id === surfaceId)!;
      const build = time(() => buildCadSurface(edited, editedSurface));
      expect(build.value.outcome).toBe('ok');
      report(`full rebuild ${label} breakline+voids`, build.elapsedMs,
        `tri=${build.value.outcome === 'ok' ? build.value.triangles.length : 0}`);
      if (build.elapsedMs > 120000) {
        report(`BOUND EXCEEDED at ${label}; stopping (no larger rebuild attempted)`, 0);
        break;
      }
      // (c) edit-stack replay cost ≈ stacked build minus bare build.
      const stacked: CadProject = {
        ...edited,
        surfaces: edited.surfaces!.map((s) => (s.id === surfaceId ? {
          ...s,
          definition: {
            ...s.definition,
            edits: [
              { id: 'p-raise', kind: 'raise-lower-surface', deltaZ: 0.5 },
              { id: 'p-add', kind: 'add-point', x: 15, y: side * 5, z: 150 },
            ],
          },
        } : s)),
      };
      const stackedSurface = stacked.surfaces!.find((s) => s.id === surfaceId)!;
      const replay = time(() => buildCadSurface(stacked, stackedSurface));
      expect(replay.value.outcome).toBe('ok');
      report(`stacked rebuild ${label} (2 edits)`, replay.elapsedMs,
        `replay-delta=${ms(replay.elapsedMs - build.elapsedMs)}`);
    }
  }, 300000);
});
