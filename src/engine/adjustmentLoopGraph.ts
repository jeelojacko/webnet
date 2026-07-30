import type { StationId } from '../types';

export type LoopGraphEdgeBase = {
  idx: number;
  from: StationId;
  to: StationId;
  sourceLine?: number;
};

type ParentInfo = {
  parent?: StationId;
  edgeIdx?: number;
  dirFromParent?: 1 | -1;
  depth: number;
  component: number;
};

type AdjacencyRow = {
  edgeIdx: number;
  neighbor: StationId;
  dir: 1 | -1;
};

export const buildLoopGraphTraversal = <TEdge extends LoopGraphEdgeBase>(edges: TEdge[]) => {
  const stations = [...new Set(edges.flatMap((edge) => [edge.from, edge.to]))].sort((a, b) =>
    a.localeCompare(b, undefined, { numeric: true }),
  );
  const adjacency = new Map<StationId, AdjacencyRow[]>();
  edges.forEach((edge) => {
    const fromList = adjacency.get(edge.from) ?? [];
    fromList.push({ edgeIdx: edge.idx, neighbor: edge.to, dir: 1 });
    adjacency.set(edge.from, fromList);
    const toList = adjacency.get(edge.to) ?? [];
    toList.push({ edgeIdx: edge.idx, neighbor: edge.from, dir: -1 });
    adjacency.set(edge.to, toList);
  });
  adjacency.forEach((rows) => {
    rows.sort(
      (a, b) =>
        a.neighbor.localeCompare(b.neighbor, undefined, { numeric: true }) || a.edgeIdx - b.edgeIdx,
    );
  });

  const parentInfo = new Map<StationId, ParentInfo>();
  const treeEdgeIdx = new Set<number>();
  let componentId = 0;

  stations.forEach((start) => {
    if (parentInfo.has(start)) return;
    componentId += 1;
    parentInfo.set(start, { depth: 0, component: componentId });
    const queue: StationId[] = [start];
    for (let q = 0; q < queue.length; q += 1) {
      const current = queue[q];
      const currentInfo = parentInfo.get(current);
      if (!currentInfo) continue;
      (adjacency.get(current) ?? []).forEach((row) => {
        if (!parentInfo.has(row.neighbor)) {
          parentInfo.set(row.neighbor, {
            parent: current,
            edgeIdx: row.edgeIdx,
            dirFromParent: row.dir,
            depth: currentInfo.depth + 1,
            component: componentId,
          });
          treeEdgeIdx.add(row.edgeIdx);
          queue.push(row.neighbor);
        }
      });
    }
  });

  const buildPath = (
    from: StationId,
    to: StationId,
  ): { stations: StationId[]; segments: { edgeIdx: number; dir: number }[] } | null => {
    const fromInfo = parentInfo.get(from);
    const toInfo = parentInfo.get(to);
    if (!fromInfo || !toInfo || fromInfo.component !== toInfo.component) return null;

    let a = from;
    let b = to;
    const upSegments: { edgeIdx: number; dir: number }[] = [];
    const downSegments: { edgeIdx: number; dir: number }[] = [];

    while ((parentInfo.get(a)?.depth ?? 0) > (parentInfo.get(b)?.depth ?? 0)) {
      const info = parentInfo.get(a);
      if (!info || info.parent == null || info.edgeIdx == null || info.dirFromParent == null) return null;
      upSegments.push({ edgeIdx: info.edgeIdx, dir: -info.dirFromParent });
      a = info.parent;
    }
    while ((parentInfo.get(b)?.depth ?? 0) > (parentInfo.get(a)?.depth ?? 0)) {
      const info = parentInfo.get(b);
      if (!info || info.parent == null || info.edgeIdx == null || info.dirFromParent == null) return null;
      downSegments.push({ edgeIdx: info.edgeIdx, dir: info.dirFromParent });
      b = info.parent;
    }
    while (a !== b) {
      const infoA = parentInfo.get(a);
      const infoB = parentInfo.get(b);
      if (
        !infoA ||
        !infoB ||
        infoA.parent == null ||
        infoB.parent == null ||
        infoA.edgeIdx == null ||
        infoB.edgeIdx == null ||
        infoA.dirFromParent == null ||
        infoB.dirFromParent == null
      ) {
        return null;
      }
      upSegments.push({ edgeIdx: infoA.edgeIdx, dir: -infoA.dirFromParent });
      downSegments.push({ edgeIdx: infoB.edgeIdx, dir: infoB.dirFromParent });
      a = infoA.parent;
      b = infoB.parent;
    }

    const segments = [...upSegments, ...downSegments.reverse()];
    const stationPath: StationId[] = [from];
    let cursor = from;
    segments.forEach((seg) => {
      const edge = edges[seg.edgeIdx];
      if (!edge) return;
      const next = seg.dir >= 0 ? edge.to : edge.from;
      if (cursor === next) {
        const alt = seg.dir >= 0 ? edge.from : edge.to;
        stationPath.push(alt);
        cursor = alt;
        return;
      }
      stationPath.push(next);
      cursor = next;
    });
    if (stationPath[stationPath.length - 1] !== to) stationPath.push(to);
    return { stations: stationPath, segments };
  };

  return { treeEdgeIdx, buildPath };
};
