import type {
  AdjustmentResult,
  GpsObservation,
  LevelObservation,
  LevelingLoopSegmentSuspectRow,
  StationId,
} from '../types';

type GraphEdgeBase = {
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

const buildGraphTraversal = <TEdge extends GraphEdgeBase>(edges: TEdge[]) => {
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

export const buildGpsLoopDiagnostics = ({
  gpsObservations,
  observedVector,
  baseToleranceM,
  ppmTolerance,
  eps,
}: {
  gpsObservations: GpsObservation[];
  observedVector: (_obs: GpsObservation) => { dE: number; dN: number };
  baseToleranceM: number;
  ppmTolerance: number;
  eps: number;
}): NonNullable<AdjustmentResult['gpsLoopDiagnostics']> => {
  type LoopEdge = GraphEdgeBase & {
    obsId: number;
    dE: number;
    dN: number;
    distance: number;
  };

  const edges: LoopEdge[] = gpsObservations.map((obs, idx) => {
    const vec = observedVector(obs);
    return {
      idx,
      obsId: obs.id,
      from: obs.from,
      to: obs.to,
      dE: vec.dE,
      dN: vec.dN,
      distance: Math.hypot(vec.dE, vec.dN),
      sourceLine: obs.sourceLine,
    };
  });

  const { treeEdgeIdx, buildPath } = buildGraphTraversal(edges);
  const nonTreeEdges = edges
    .filter((edge) => !treeEdgeIdx.has(edge.idx))
    .sort((a, b) => {
      const la = a.sourceLine ?? Number.MAX_SAFE_INTEGER;
      const lb = b.sourceLine ?? Number.MAX_SAFE_INTEGER;
      if (la !== lb) return la - lb;
      if (a.obsId !== b.obsId) return a.obsId - b.obsId;
      return a.idx - b.idx;
    });

  const loops = nonTreeEdges
    .map((edge, idx) => {
      const treePath = buildPath(edge.from, edge.to);
      if (!treePath) return null;
      let sumE = 0;
      let sumN = 0;
      const lineSet = new Set<number>();
      treePath.segments.forEach((segment) => {
        const segEdge = edges[segment.edgeIdx];
        if (!segEdge) return;
        sumE += segment.dir * segEdge.dE;
        sumN += segment.dir * segEdge.dN;
        if (segEdge.sourceLine != null) lineSet.add(segEdge.sourceLine);
      });
      const closureE = sumE - edge.dE;
      const closureN = sumN - edge.dN;
      const closureMag = Math.hypot(closureE, closureN);
      const loopDistance =
        treePath.segments.reduce((acc, seg) => {
          const segEdge = edges[seg.edgeIdx];
          if (!segEdge) return acc;
          return acc + segEdge.distance;
        }, 0) + edge.distance;
      const closureRatio = closureMag > eps ? loopDistance / closureMag : undefined;
      const linearPpm = loopDistance > eps ? (closureMag / loopDistance) * 1e6 : undefined;
      const toleranceM = baseToleranceM + ppmTolerance * 1e-6 * loopDistance;
      const pass = closureMag <= toleranceM + eps;
      const severity = toleranceM > eps ? closureMag / toleranceM : closureMag > eps ? Infinity : 0;
      if (edge.sourceLine != null) lineSet.add(edge.sourceLine);
      return {
        rank: 0,
        key: `GL-${idx + 1}-${edge.from}`,
        stationPath: [...treePath.stations, edge.from],
        edgeCount: treePath.segments.length + 1,
        sourceLines: [...lineSet].sort((a, b) => a - b),
        closureE,
        closureN,
        closureMag,
        loopDistance,
        closureRatio,
        linearPpm,
        toleranceM,
        severity,
        pass,
      };
    })
    .filter((loop): loop is NonNullable<typeof loop> => loop != null);

  const rankedLoops = loops
    .sort((a, b) => {
      if (b.severity !== a.severity) return b.severity - a.severity;
      if (b.closureMag !== a.closureMag) return b.closureMag - a.closureMag;
      return a.key.localeCompare(b.key, undefined, { numeric: true });
    })
    .map((loop, idx) => ({ ...loop, rank: idx + 1 }));

  return {
    enabled: true,
    vectorCount: edges.length,
    loopCount: rankedLoops.length,
    passCount: rankedLoops.filter((loop) => loop.pass).length,
    warnCount: rankedLoops.filter((loop) => !loop.pass).length,
    thresholds: {
      baseToleranceM,
      ppmTolerance,
    },
    loops: rankedLoops,
  };
};

export const buildLevelingLoopDiagnostics = ({
  levelingObservations,
  baseMm,
  perSqrtKmMm,
  eps,
}: {
  levelingObservations: LevelObservation[];
  baseMm: number;
  perSqrtKmMm: number;
  eps: number;
}): NonNullable<AdjustmentResult['levelingLoopDiagnostics']> => {
  type LoopEdge = GraphEdgeBase & {
    obsId: number;
    dH: number;
    lengthKm: number;
  };

  const edges: LoopEdge[] = levelingObservations.map((obs, idx) => ({
    idx,
    obsId: obs.id,
    from: obs.from,
    to: obs.to,
    dH: obs.obs,
    lengthKm: obs.lenKm,
    sourceLine: obs.sourceLine,
  }));
  const totalLengthKm = edges.reduce((acc, edge) => acc + edge.lengthKm, 0);
  const { treeEdgeIdx, buildPath } = buildGraphTraversal(edges);

  const nonTreeEdges = edges
    .filter((edge) => !treeEdgeIdx.has(edge.idx))
    .sort((a, b) => {
      const la = a.sourceLine ?? Number.MAX_SAFE_INTEGER;
      const lb = b.sourceLine ?? Number.MAX_SAFE_INTEGER;
      if (la !== lb) return la - lb;
      if (a.obsId !== b.obsId) return a.obsId - b.obsId;
      return a.idx - b.idx;
    });

  const loops = nonTreeEdges
    .map((edge, idx) => {
      const treePath = buildPath(edge.from, edge.to);
      if (!treePath) return null;
      let closure = 0;
      const lineSet = new Set<number>();
      const segments = treePath.segments
        .map((segment) => {
          const segEdge = edges[segment.edgeIdx];
          if (!segEdge) return null;
          const observedDh = segment.dir * segEdge.dH;
          closure += observedDh;
          if (segEdge.sourceLine != null) lineSet.add(segEdge.sourceLine);
          return {
            from: segment.dir >= 0 ? segEdge.from : segEdge.to,
            to: segment.dir >= 0 ? segEdge.to : segEdge.from,
            observedDh,
            lengthKm: segEdge.lengthKm,
            sourceLine: segEdge.sourceLine,
            closureLeg: false,
          };
        })
        .filter((segment): segment is NonNullable<typeof segment> => segment != null);
      closure -= edge.dH;
      if (edge.sourceLine != null) lineSet.add(edge.sourceLine);
      segments.push({
        from: edge.to,
        to: edge.from,
        observedDh: -edge.dH,
        lengthKm: edge.lengthKm,
        sourceLine: edge.sourceLine,
        closureLeg: true,
      });
      const loopLengthKm =
        treePath.segments.reduce((acc, segment) => {
          const segEdge = edges[segment.edgeIdx];
          if (!segEdge) return acc;
          return acc + segEdge.lengthKm;
        }, 0) + edge.lengthKm;
      const absClosure = Math.abs(closure);
      const toleranceMm = baseMm + perSqrtKmMm * Math.sqrt(Math.max(loopLengthKm, 0));
      const toleranceM = toleranceMm / 1000;
      const closurePerSqrtKmMm =
        loopLengthKm > eps ? (absClosure * 1000) / Math.sqrt(loopLengthKm) : absClosure * 1000;
      const pass = absClosure <= toleranceM + eps;
      return {
        rank: 0,
        key: `LL-${idx + 1}-${edge.from}`,
        stationPath: [...treePath.stations, edge.from],
        edgeCount: treePath.segments.length + 1,
        sourceLines: [...lineSet].sort((a, b) => a - b),
        closure,
        absClosure,
        loopLengthKm,
        toleranceMm,
        toleranceM,
        closurePerSqrtKmMm,
        severity: toleranceMm > eps ? (absClosure * 1000) / toleranceMm : closurePerSqrtKmMm,
        pass,
        segments,
      };
    })
    .filter((loop): loop is NonNullable<typeof loop> => loop != null);

  const rankedLoops = loops
    .sort((a, b) => {
      if (b.severity !== a.severity) return b.severity - a.severity;
      if (b.absClosure !== a.absClosure) return b.absClosure - a.absClosure;
      return a.key.localeCompare(b.key, undefined, { numeric: true });
    })
    .map((loop, idx) => ({ ...loop, rank: idx + 1 }));

  const warnLoops = rankedLoops.filter((loop) => !loop.pass);
  const suspectSegments = (() => {
    const segmentMap = new Map<string, Omit<LevelingLoopSegmentSuspectRow, 'rank'>>();
    warnLoops.forEach((loop) => {
      loop.segments.forEach((segment) => {
        const key =
          segment.sourceLine != null
            ? `L${segment.sourceLine}`
            : `${segment.from}->${segment.to}-${segment.closureLeg ? 'closure' : 'traverse'}`;
        const existing = segmentMap.get(key);
        if (existing) {
          existing.occurrenceCount += 1;
          existing.warnLoopCount += 1;
          existing.totalLengthKm += segment.lengthKm;
          existing.maxAbsDh = Math.max(existing.maxAbsDh, Math.abs(segment.observedDh));
          existing.suspectScore += loop.severity;
          existing.closureLegCount += segment.closureLeg ? 1 : 0;
          if (loop.severity > existing.worstLoopSeverity) {
            existing.worstLoopSeverity = loop.severity;
            existing.worstLoopKey = loop.key;
          }
          return;
        }
        segmentMap.set(key, {
          key,
          from: segment.from,
          to: segment.to,
          sourceLine: segment.sourceLine,
          occurrenceCount: 1,
          warnLoopCount: 1,
          totalLengthKm: segment.lengthKm,
          maxAbsDh: Math.abs(segment.observedDh),
          suspectScore: loop.severity,
          worstLoopKey: loop.key,
          worstLoopSeverity: loop.severity,
          closureLegCount: segment.closureLeg ? 1 : 0,
        });
      });
    });
    return [...segmentMap.values()]
      .sort((a, b) => {
        if (b.suspectScore !== a.suspectScore) return b.suspectScore - a.suspectScore;
        if (b.warnLoopCount !== a.warnLoopCount) return b.warnLoopCount - a.warnLoopCount;
        if (b.maxAbsDh !== a.maxAbsDh) return b.maxAbsDh - a.maxAbsDh;
        const la = a.sourceLine ?? Number.MAX_SAFE_INTEGER;
        const lb = b.sourceLine ?? Number.MAX_SAFE_INTEGER;
        if (la !== lb) return la - lb;
        return a.key.localeCompare(b.key, undefined, { numeric: true });
      })
      .map((segment, idx) => ({ ...segment, rank: idx + 1 }));
  })();

  return {
    enabled: true,
    observationCount: edges.length,
    loopCount: rankedLoops.length,
    passCount: rankedLoops.filter((loop) => loop.pass).length,
    warnCount: warnLoops.length,
    totalLengthKm,
    warnTotalLengthKm: warnLoops.reduce((acc, loop) => acc + loop.loopLengthKm, 0),
    thresholds: {
      baseMm,
      perSqrtKmMm,
    },
    worstLoopKey: rankedLoops[0]?.key,
    worstClosure: rankedLoops[0]?.absClosure,
    worstClosurePerSqrtKmMm: rankedLoops[0]?.closurePerSqrtKmMm,
    loops: rankedLoops,
    suspectSegments,
  };
};
