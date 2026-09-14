/**
 * Phase 12J.9 Track A — raw session baseline graph (REVIEW_ONLY, no math).
 *
 * Deterministic STAR / MST / MANUAL spanning-tree builders over session
 * occupations, plus a validator (N-1 edges, connected, acyclic), an edge
 * reversal helper, and dependency groups via the existing
 * assignDependencyGroup. Repair actions are revalidated and recorded in
 * graph provenance. Stochastic handling stays frozen (formal only).
 */

import type { GnssBaselineCovariance } from './gnssBaselineTypes';
import { assignDependencyGroup } from './gnssRawSession';
import type { RawOccupationMeta } from './gnssRawSessionModel';
import { SESSION_STOCHASTIC_FREEZE } from './gnssRawSessionModel';

export type SessionGraphKind = 'STAR' | 'MST' | 'MANUAL';

/** A planned baseline leg between two occupation markers. */
export interface SessionGraphEdge {
  readonly from: string;
  readonly to: string;
  readonly deltaX: number;
  readonly deltaY: number;
  readonly deltaZ: number;
  readonly covariance: GnssBaselineCovariance;
  readonly baseObsSha: string;
  readonly roverObsSha: string;
  readonly dependencyGroup: string;
  readonly stochastic: typeof SESSION_STOCHASTIC_FREEZE;
}

export interface SessionGraph {
  readonly kind: SessionGraphKind;
  readonly markers: readonly string[];
  readonly edges: readonly SessionGraphEdge[];
  readonly provenance: readonly string[];
  readonly stochastic: typeof SESSION_STOCHASTIC_FREEZE;
}

export type GraphValidation =
  | { readonly ok: true }
  | { readonly ok: false; readonly errors: string[] };

const shaFor = (occupations: readonly RawOccupationMeta[], marker: string): string => {
  const found = occupations.filter((o) => (o.meta.marker ?? o.meta.fileName) === marker)
    .sort((a, b) => (a.meta.sha256 < b.meta.sha256 ? -1 : 1));
  return found[0]?.meta.sha256 ?? `missing:${marker}`;
};

const ZERO_COVARIANCE: GnssBaselineCovariance = { xx: 0, xy: 0, xz: 0, yy: 0, yz: 0, zz: 0 };

const plannedEdge = (
  occupations: readonly RawOccupationMeta[],
  from: string,
  to: string,
): SessionGraphEdge => {
  const baseObsSha = shaFor(occupations, from);
  const roverObsSha = shaFor(occupations, to);
  return {
    from,
    to,
    deltaX: 0,
    deltaY: 0,
    deltaZ: 0,
    covariance: ZERO_COVARIANCE,
    baseObsSha,
    roverObsSha,
    dependencyGroup: assignDependencyGroup({ baseObsSha, roverObsSha }),
    stochastic: SESSION_STOCHASTIC_FREEZE,
  };
};

const sortedMarkers = (occupations: readonly RawOccupationMeta[]): string[] => {
  const names = occupations.map((o) => o.meta.marker ?? o.meta.fileName);
  return [...new Set(names)].sort();
};

/**
 * Deterministic STAR: hub is the operator base when it names an occupied
 * marker, else the alphabetically first marker. Spokes go hub->other in
 * sorted order, so the edge set is fully determined by the marker set.
 */
export const buildStarGraph = (
  occupations: readonly RawOccupationMeta[],
  operatorBase?: string,
): SessionGraph => {
  const markers = sortedMarkers(occupations);
  const hub = operatorBase != null && markers.includes(operatorBase) ? operatorBase : markers[0]!;
  const edges = markers.filter((m) => m !== hub).map((m) => plannedEdge(occupations, hub, m));
  return {
    kind: 'STAR',
    markers,
    edges,
    provenance: [`STAR hub=${hub}`],
    stochastic: SESSION_STOCHASTIC_FREEZE,
  };
};

const approxDistance = (a: RawOccupationMeta, b: RawOccupationMeta): number | null => {
  const pa = a.meta.approxXyz;
  const pb = b.meta.approxXyz;
  if (pa == null || pb == null) return null;
  return Math.hypot(pa[0] - pb[0], pa[1] - pb[1], pa[2] - pb[2]);
};

/**
 * Deterministic MST (Kruskal) minimizing total approximate-XYZ length.
 * Ties break lexicographically on the marker pair. Fail-closed note in
 * provenance when an approximate position is missing — the edge length
 * is then unmeasurable and the pair sorts last instead of guessing.
 */
export const buildMstGraph = (
  occupations: readonly RawOccupationMeta[],
): SessionGraph => {
  const markers = sortedMarkers(occupations);
  const byMarker = new Map<string, RawOccupationMeta>();
  for (const o of occupations) {
    const key = o.meta.marker ?? o.meta.fileName;
    if (!byMarker.has(key)) byMarker.set(key, o);
  }
  type Link = { a: string; b: string; len: number; missing: boolean };
  const links: Link[] = [];
  for (let i = 0; i < markers.length; i += 1) {
    for (let j = i + 1; j < markers.length; j += 1) {
      const a = byMarker.get(markers[i]!)!;
      const b = byMarker.get(markers[j]!)!;
      const d = approxDistance(a, b);
      links.push({
        a: markers[i]!,
        b: markers[j]!,
        len: d ?? Number.POSITIVE_INFINITY,
        missing: d == null,
      });
    }
  }
  links.sort((x, y) => x.len - y.len || (x.a < y.a ? -1 : 1) || (x.b < y.b ? -1 : 1));
  const parent = new Map(markers.map((m) => [m, m]));
  const find = (m: string): string => {
    let r = m;
    while (parent.get(r) !== r) r = parent.get(r)!;
    return r;
  };
  const edges: SessionGraphEdge[] = [];
  const provenance = ['MST kruskal approx-xyz'];
  for (const l of links) {
    if (edges.length === markers.length - 1) break;
    const ra = find(l.a);
    const rb = find(l.b);
    if (ra === rb) continue;
    if (l.a < l.b) parent.set(rb, ra);
    else parent.set(ra, rb);
    if (l.missing) provenance.push(`unmeasurable length ${l.a}-${l.b}: no approx position`);
    edges.push(plannedEdge(occupations, l.a < l.b ? l.a : l.b, l.a < l.b ? l.b : l.a));
  }
  edges.sort((x, y) => (x.from < y.from ? -1 : 1) || (x.to < y.to ? -1 : 1));
  return { kind: 'MST', markers, edges, provenance, stochastic: SESSION_STOCHASTIC_FREEZE };
};

/** MANUAL tree: caller-supplied pairs, oriented from->to as given. */
export const buildManualGraph = (
  occupations: readonly RawOccupationMeta[],
  pairs: ReadonlyArray<{ readonly from: string; readonly to: string }>,
): SessionGraph => ({
  kind: 'MANUAL',
  markers: sortedMarkers(occupations),
  edges: pairs.map((p) => plannedEdge(occupations, p.from, p.to)),
  provenance: [`MANUAL ${pairs.length} legs as given`],
  stochastic: SESSION_STOCHASTIC_FREEZE,
});

/**
 * Validator: exactly N-1 edges over N markers, every endpoint occupied,
 * connected (union-find) and acyclic (union rejects a second path).
 */
export const validateSessionGraph = (graph: SessionGraph): GraphValidation => {
  const errors: string[] = [];
  const n = graph.markers.length;
  if (graph.edges.length !== Math.max(0, n - 1)) {
    errors.push(`expected ${Math.max(0, n - 1)} edges for ${n} markers, got ${graph.edges.length}`);
  }
  const known = new Set(graph.markers);
  for (const e of graph.edges) {
    if (!known.has(e.from)) errors.push(`unknown endpoint ${e.from}`);
    if (!known.has(e.to)) errors.push(`unknown endpoint ${e.to}`);
    if (e.from === e.to) errors.push(`self loop ${e.from}`);
  }
  const parent = new Map(graph.markers.map((m) => [m, m]));
  const find = (m: string): string => {
    let r = m;
    while (parent.get(r) !== r) r = parent.get(r)!;
    return r;
  };
  let cycles = 0;
  for (const e of graph.edges) {
    if (!known.has(e.from) || !known.has(e.to) || e.from === e.to) continue;
    const ra = find(e.from);
    const rb = find(e.to);
    if (ra === rb) {
      cycles += 1;
    } else if (ra < rb) {
      parent.set(rb, ra);
    } else {
      parent.set(ra, rb);
    }
  }
  if (cycles > 0) errors.push(`${cycles} cycle(s): edges are not acyclic`);
  const roots = new Set(graph.markers.map(find));
  if (graph.markers.length > 0 && roots.size > 1) {
    errors.push(`disconnected: ${roots.size} components`);
  }
  return errors.length === 0 ? { ok: true } : { ok: false, errors };
};

/**
 * Edge reversal: swap from/to and negate the ECEF vector; the covariance
 * block is symmetric (xx,yy,zz diagonals plus sign-preserving xy,yz,xz —
 * the verified 12J.1 order in posLineToCovariance, gnssRawRnx2rtkp.ts —
 * describes the same baseline uncertainty viewed from the other end),
 * so it is carried over unchanged, as is the dependency group (the
 * underlying input pair is identical).
 */
export const reverseSessionEdge = (edge: SessionGraphEdge): SessionGraphEdge => ({
  ...edge,
  from: edge.to,
  to: edge.from,
  deltaX: -edge.deltaX,
  deltaY: -edge.deltaY,
  deltaZ: -edge.deltaZ,
  covariance: edge.covariance,
});

/** Revalidate after a repair; the modification is appended to provenance. */
export const revalidateGraph = (
  graph: SessionGraph,
  modification: string,
): { readonly graph: SessionGraph; readonly validation: GraphValidation } => {
  const next: SessionGraph = {
    ...graph,
    provenance: [...graph.provenance, modification],
  };
  return { graph: next, validation: validateSessionGraph(next) };
};
