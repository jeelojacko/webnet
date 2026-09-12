/**
 * Phase 12D — deterministic GNSS vector-loop closure QC.
 *
 * Pre-adjustment diagnostics over observed baseline vectors only: no solve
 * is required. For an oriented loop s = sum sign_i b_i with independent
 * baselines, C_s = sum C_i (reversal leaves covariance unchanged) and
 * T_loop = s^T C_s^-1 s.
 *
 * Cycle basis: deterministic union-find spanning forest over the sorted
 * multigraph edge list (parallel edges preserved, never collapsed); each
 * non-tree edge closes one fundamental cycle. Cycle rank per connected
 * component is E - V + 1 by construction. Traversal is canonical: start at
 * the smallest station id, step to the smaller-ID neighbor (ties broken by
 * smaller baseline id). Stored member signs follow that traversal;
 * reversing traversal negates s and preserves C_s and T_loop.
 */
import type { GnssBaselineObservation } from './gnssBaselineTypes';
import type { GnssBaselineCovariance } from './gnssBaselineTypes';
import { invertGnssBaselineCovariance } from './gnssBaselineCovariance';

export interface GnssLoopMember {
  baselineId: number;
  from: string;
  to: string;
  /** +1 traversed FROM->TO, -1 traversed TO->FROM. */
  sign: 1 | -1;
}

export interface GnssLoopClosure {
  readonly id: string;
  readonly members: GnssLoopMember[];
  readonly closure: { x: number; y: number; z: number };
  readonly magnitude: number;
  readonly covariance: GnssBaselineCovariance;
  /** Normalized closure s^T C_s^-1 s; known-scale loop statistic. */
  readonly tLoop?: number;
  readonly status: 'ok' | 'singular-covariance';
}

export interface GnssLoopResult {
  readonly loops: GnssLoopClosure[];
  readonly cycleRank: number;
  readonly edgeCount: number;
  readonly vertexCount: number;
  readonly componentCount: number;
}

interface Edge {
  id: number;
  from: string;
  to: string;
}

const compareStations = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

export const computeGnssLoopClosures = (
  baselines: readonly GnssBaselineObservation[],
): GnssLoopResult => {
  const byId = new Map<number, GnssBaselineObservation>(
    baselines.map((baseline) => [baseline.id, baseline]),
  );
  const vertices = new Set<string>();
  baselines.forEach((baseline) => {
    vertices.add(baseline.from);
    vertices.add(baseline.to);
  });
  // Deterministic multigraph edge order: parallel edges stay distinct.
  const edgeKey = (edge: Edge): [string, string] =>
    compareStations(edge.from, edge.to) <= 0 ? [edge.from, edge.to] : [edge.to, edge.from];
  const edges: Edge[] = [...baselines]
    .map((baseline) => ({ id: baseline.id, from: baseline.from, to: baseline.to }))
    .sort((a, b) => {
      const [aMin, aMax] = edgeKey(a);
      const [bMin, bMax] = edgeKey(b);
      return compareStations(aMin, bMin) || compareStations(aMax, bMax) || a.id - b.id;
    });
  // Union-find spanning forest (deterministic: union by smaller root id).
  const parent = new Map<string, string>();
  const find = (node: string): string => {
    let root = parent.get(node) ?? node;
    const path: string[] = [node];
    while ((parent.get(root) ?? root) !== root) {
      path.push(root);
      root = parent.get(root) ?? root;
    }
    path.forEach((entry) => parent.set(entry, root));
    return root;
  };
  const treeAdjacency = new Map<string, { neighbor: string; edgeId: number }[]>();
  const link = (node: string, neighbor: string, edgeId: number): void => {
    const entries = treeAdjacency.get(node) ?? [];
    entries.push({ neighbor, edgeId });
    treeAdjacency.set(node, entries);
  };
  const treeEdgeIds = new Set<number>();
  const nonTreeEdges: Edge[] = [];
  edges.forEach((edge) => {
    if (edge.from === edge.to) return; // self-baselines never reach here (preflight rejects)
    const rootFrom = find(edge.from);
    const rootTo = find(edge.to);
    if (rootFrom !== rootTo) {
      parent.set(rootFrom < rootTo ? rootFrom : rootTo, rootFrom < rootTo ? rootTo : rootFrom);
      treeEdgeIds.add(edge.id);
      link(edge.from, edge.to, edge.id);
      link(edge.to, edge.from, edge.id);
    } else {
      nonTreeEdges.push(edge);
    }
  });
  // Tree path between two vertices via BFS over sorted adjacency.
  const treePath = (start: string, goal: string): { neighbor: string; edgeId: number }[] | null => {
    if (start === goal) return [];
    const previous = new Map<string, { node: string; edgeId: number }>();
    const queue = [start];
    const seen = new Set([start]);
    while (queue.length > 0) {
      const current = queue.shift() as string;
      const neighbors = [...(treeAdjacency.get(current) ?? [])].sort(
        (a, b) => compareStations(a.neighbor, b.neighbor) || a.edgeId - b.edgeId,
      );
      for (const { neighbor, edgeId } of neighbors) {
        if (seen.has(neighbor)) continue;
        seen.add(neighbor);
        previous.set(neighbor, { node: current, edgeId });
        if (neighbor === goal) {
          const path: { neighbor: string; edgeId: number }[] = [];
          let cursor = goal;
          while (cursor !== start) {
            const step = previous.get(cursor);
            if (!step) return null;
            path.unshift({ neighbor: cursor, edgeId: step.edgeId });
            cursor = step.node;
          }
          return path;
        }
        queue.push(neighbor);
      }
    }
    return null;
  };
  // Fundamental cycles: tree path plus the closing non-tree edge.
  interface RawCycle {
    members: GnssLoopMember[];
    trailStart: string;
  }
  const rawCycles: RawCycle[] = [];
  nonTreeEdges.forEach((edge) => {
    const path = treePath(edge.from, edge.to);
    if (!path) return;
    const members: GnssLoopMember[] = path.map((step, index) => {
      const previousNode = index === 0 ? edge.from : path[index - 1]?.neighbor as string;
      const baseline = byId.get(step.edgeId);
      const forward = baseline?.from === previousNode && baseline?.to === step.neighbor;
      return {
        baselineId: step.edgeId,
        from: baseline?.from ?? '',
        to: baseline?.to ?? '',
        sign: forward ? 1 : -1,
      };
    });
    const closing = byId.get(edge.id);
    members.push({
      baselineId: edge.id,
      from: closing?.from ?? edge.from,
      to: closing?.to ?? edge.to,
      sign: -1, // traversed TO->FROM closing the loop back to the start
    });
    rawCycles.push({ members, trailStart: edge.from });
  });
  // Canonical traversal: rotate so the smallest station starts; orient
  // toward the smaller-ID neighbor (baseline-id tiebreak).
  const canonicalize = (members: GnssLoopMember[], trailStart: string): GnssLoopMember[] => {
    const stationsInCycle: string[] = [];
    members.forEach((member) => {
      if (!stationsInCycle.includes(member.from)) stationsInCycle.push(member.from);
      if (!stationsInCycle.includes(member.to)) stationsInCycle.push(member.to);
    });
    const start = [...stationsInCycle].sort(compareStations)[0] as string;
    // Rebuild node sequence from the true trail start, validating the chain.
    const nodes: string[] = [trailStart];
    members.forEach((member) => {
      const cursor = nodes[nodes.length - 1] as string;
      if (member.sign === 1 && member.from === cursor) nodes.push(member.to);
      else if (member.sign === -1 && member.to === cursor) nodes.push(member.from);
      else {
        throw new Error('GNSS loop members do not chain consecutively.');
      }
    });
    const begin = nodes.indexOf(start);
    // nodes is a closed trail (first == last); rotate to start, keeping closure.
    const rotated = [...nodes.slice(begin), ...nodes.slice(1, begin + 1)];
    // Neighbor choice at start: rotated[1] vs rotated[rotated.length - 1].
    const forwardNeighbor = rotated[1] as string;
    const backwardNeighbor = rotated[rotated.length - 1] as string;
    const useForward = compareStations(forwardNeighbor, backwardNeighbor) <= 0;
    const ordered = useForward ? rotated : [...rotated].reverse();
    // Map node steps back to (baselineId, sign).
    const edgeByPair = new Map<string, { baselineId: number; from: string; to: string }[]>();
    members.forEach((member) => {
      const key = [member.from, member.to].sort(compareStations).join('|');
      const entries = edgeByPair.get(key) ?? [];
      entries.push({ baselineId: member.baselineId, from: member.from, to: member.to });
      edgeByPair.set(key, entries);
    });
    const result: GnssLoopMember[] = [];
    for (let i = 0; i < ordered.length - 1; i += 1) {
      const a = ordered[i] as string;
      const b = ordered[i + 1] as string;
      const key = [a, b].sort(compareStations).join('|');
      const candidates = (edgeByPair.get(key) ?? []).filter(
        (entry) => !result.some((used) => used.baselineId === entry.baselineId),
      );
      const chosen = candidates.sort((x, y) => x.baselineId - y.baselineId)[0];
      if (!chosen) {
        throw new Error('GNSS loop canonicalization lost a member edge.');
      }
      result.push({
        baselineId: chosen.baselineId,
        from: chosen.from,
        to: chosen.to,
        sign: chosen.from === a && chosen.to === b ? 1 : -1,
      });
    }
    return result;
  };
  const loops: GnssLoopClosure[] = rawCycles
    .map((cycle) => ({ members: canonicalize(cycle.members, cycle.trailStart) }))
    .sort((a, b) => cycleKey(a.members).localeCompare(cycleKey(b.members)))
    .map((cycle, index) => closeLoop(`LOOP-${String(index + 1).padStart(3, '0')}`, cycle.members, byId));
  // Component count from the forest roots.
  const roots = new Set<string>();
  vertices.forEach((vertex) => roots.add(find(vertex)));
  return {
    loops,
    cycleRank: edges.length - vertices.size + roots.size,
    edgeCount: edges.length,
    vertexCount: vertices.size,
    componentCount: roots.size,
  };
};

const cycleKey = (members: GnssLoopMember[]): string =>
  members.map((member) => `${member.baselineId}:${member.sign}`).sort().join(',');

const closeLoop = (
  id: string,
  members: GnssLoopMember[],
  byId: Map<number, GnssBaselineObservation>,
): GnssLoopClosure => {
  let x = 0;
  let y = 0;
  let z = 0;
  const covariance: GnssBaselineCovariance = { xx: 0, xy: 0, xz: 0, yy: 0, yz: 0, zz: 0 };
  members.forEach((member) => {
    const baseline = byId.get(member.baselineId);
    if (!baseline) {
      throw new Error(`GNSS loop ${id}: baseline ${member.baselineId} missing.`);
    }
    x += member.sign * baseline.vector.x;
    y += member.sign * baseline.vector.y;
    z += member.sign * baseline.vector.z;
    covariance.xx += baseline.covariance.xx;
    covariance.xy += baseline.covariance.xy;
    covariance.xz += baseline.covariance.xz;
    covariance.yy += baseline.covariance.yy;
    covariance.yz += baseline.covariance.yz;
    covariance.zz += baseline.covariance.zz;
  });
  for (const value of [covariance.xx, covariance.xy, covariance.xz, covariance.yy, covariance.yz, covariance.zz]) {
    if (!Number.isFinite(value)) {
      throw new Error(`GNSS loop ${id}: non-finite closure covariance.`);
    }
  }
  let tLoop: number | undefined;
  let status: GnssLoopClosure['status'] = 'ok';
  try {
    const inverse = invertGnssBaselineCovariance(covariance, `loop ${id}`);
    tLoop =
      x * (inverse[0][0] * x + inverse[0][1] * y + inverse[0][2] * z) +
      y * (inverse[1][0] * x + inverse[1][1] * y + inverse[1][2] * z) +
      z * (inverse[2][0] * x + inverse[2][1] * y + inverse[2][2] * z);
    if (!Number.isFinite(tLoop)) {
      throw new Error('non-finite loop statistic');
    }
  } catch {
    status = 'singular-covariance';
    tLoop = undefined;
  }
  return {
    id,
    members,
    closure: { x, y, z },
    magnitude: Math.sqrt(x * x + y * y + z * z),
    covariance,
    tLoop,
    status,
  };
};

/** Reverse a loop traversal (test/invariance helper): s -> -s, C and T kept. */
export const reverseGnssLoopTraversal = (
  loop: GnssLoopClosure,
  byId: Map<number, GnssBaselineObservation>,
): GnssLoopClosure =>
  closeLoop(
    loop.id,
    [...loop.members].reverse().map((member) => ({
      ...member,
      sign: (member.sign === 1 ? -1 : 1) as 1 | -1,
    })),
    byId,
  );
