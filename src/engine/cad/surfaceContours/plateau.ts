/**
 * Plateau regions: connected flat triangles at one elevation emit only their
 * outer perimeter (no internal edges). Connected = sharing an edge.
 * Multi-loop regions (pinched contacts, holes) keep the longest loop only.
 */

export interface ContourVertex {
  x: number;
  y: number;
  z: number;
}

export interface PlateauRegion {
  triangles: number[];
  outerRing: ContourVertex[];
}

export const canonicalEdgeKey = (a: number, b: number): string =>
  a < b ? `${a}:${b}` : `${b}:${a}`;

const compareRings = (a: ContourVertex[], b: ContourVertex[]): number => {
  if (a.length !== b.length) return a.length - b.length;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i].x !== b[i].x) return a[i].x - b[i].x;
    if (a[i].y !== b[i].y) return a[i].y - b[i].y;
  }
  return 0;
};

/** Union-find grouping of flat triangles that share an edge. */
const groupFlatTriangles = (
  triangles: Array<[number, number, number]>,
  flat: number[],
): number[][] => {
  const parent = new Map<number, number>();
  const find = (t: number): number => {
    const p = parent.get(t) ?? t;
    if (p === t) return t;
    const root = find(p);
    parent.set(t, root);
    return root;
  };
  const union = (a: number, b: number): void => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra < rb ? rb : ra, ra < rb ? ra : rb);
  };
  const edgeOwner = new Map<string, number>();
  for (const t of flat) {
    parent.set(t, t);
    const [a, b, c] = triangles[t];
    for (const key of [canonicalEdgeKey(a, b), canonicalEdgeKey(b, c), canonicalEdgeKey(c, a)]) {
      const owner = edgeOwner.get(key);
      if (owner === undefined) edgeOwner.set(key, t);
      else union(owner, t);
    }
  }
  const groups = new Map<number, number[]>();
  for (const t of flat) {
    const root = find(t);
    const list = groups.get(root) ?? [];
    list.push(t);
    groups.set(root, list);
  }
  return [...groups.values()]
    .map((list) => list.sort((x, y) => x - y))
    .sort((x, y) => x[0] - y[0]);
};

/** Boundary edges of one group (used exactly once), then walk every loop. */
const groupBoundaryLoops = (
  points: ContourVertex[],
  triangles: Array<[number, number, number]>,
  group: number[],
): ContourVertex[][] => {
  const counts = new Map<string, number>();
  const edgeEnds = new Map<string, [number, number]>();
  for (const t of group) {
    const [a, b, c] = triangles[t];
    for (const [u, v] of [[a, b], [b, c], [c, a]] as Array<[number, number]>) {
      const key = canonicalEdgeKey(u, v);
      counts.set(key, (counts.get(key) ?? 0) + 1);
      if (!edgeEnds.has(key)) edgeEnds.set(key, [u, v]);
    }
  }
  const adj = new Map<number, number[]>();
  const boundaryKeys = [...counts.entries()]
    .filter(([, n]) => n === 1)
    .map(([key]) => key)
    .sort();
  for (const key of boundaryKeys) {
    const [u, v] = edgeEnds.get(key) as [number, number];
    const lu = adj.get(u) ?? [];
    const lv = adj.get(v) ?? [];
    lu.push(v);
    lv.push(u);
    adj.set(u, lu);
    adj.set(v, lv);
  }
  for (const list of adj.values()) list.sort((x, y) => x - y);
  const used = new Set<string>();
  const loops: number[][] = [];
  for (const start of [...adj.keys()].sort((x, y) => x - y)) {
    for (const next of adj.get(start) ?? []) {
      const key = canonicalEdgeKey(start, next);
      if (used.has(key)) continue;
      // Walk one loop from this directed edge.
      const loop = [start];
      let prev = start;
      let cur = next;
      used.add(key);
      while (cur !== start) {
        loop.push(cur);
        const nxt = (adj.get(cur) ?? []).find(
          (w) => w !== prev && !used.has(canonicalEdgeKey(cur, w)),
        );
        if (nxt === undefined) break; // pinched contact: open chain, drop
        used.add(canonicalEdgeKey(cur, nxt));
        prev = cur;
        cur = nxt;
      }
      if (cur === start && loop.length >= 3) loops.push(loop);
    }
  }
  return loops.map((loop) => loop.map((i) => points[i]));
};

export const findPlateauRegions = (
  points: ContourVertex[],
  triangles: Array<[number, number, number]>,
  flat: number[],
): PlateauRegion[] => {
  if (flat.length === 0) return [];
  return groupFlatTriangles(triangles, flat).map((group) => {
    const loops = groupBoundaryLoops(points, triangles, group);
    const sorted = loops.sort(compareRings);
    const outerRing = sorted.length > 0 ? sorted[sorted.length - 1] : [];
    return { triangles: group, outerRing };
  });
};
