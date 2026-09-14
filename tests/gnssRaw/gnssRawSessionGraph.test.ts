/**
 * Phase 12J.9 Track A — session graph tests (synthetic literals only).
 */
import { describe, expect, it } from 'vitest';
import type { GnssBaselineCovariance } from '../../src/engine/gnssBaselineTypes';
import type { RawGnssFileMetadata } from '../../src/engine/gnssRawTypes';
import {
  buildManualGraph,
  buildMstGraph,
  buildStarGraph,
  revalidateGraph,
  reverseSessionEdge,
  validateSessionGraph,
  type SessionGraph,
} from '../../src/engine/gnssRawSessionGraph';
import type { RawOccupationMeta } from '../../src/engine/gnssRawSessionModel';

const meta = (marker: string, approx: [number, number, number], sha: string): RawGnssFileMetadata => ({
  role: 'BASE',
  fileName: `${marker}.06o`,
  sha256: sha,
  rinexVersion: '2.10',
  marker,
  approxXyz: approx,
  antennaModel: 'SYN-GENX00      NONE',
  antennaHeight: 0,
  antennaEast: 0,
  antennaNorth: 0,
  receiverModel: 'SYNTHRCV',
  firstEpoch: '2024-01-01T00:00:00.000Z',
  lastEpoch: '2024-01-01T01:00:00.000Z',
  intervalSeconds: 30,
  constellations: ['G'],
  signals: ['L1', 'L2'],
});

const occ = (marker: string, approx: [number, number, number]): RawOccupationMeta => ({
  meta: meta(marker, approx, `sha-${marker}`),
  epochCount: 120,
});

const three: RawOccupationMeta[] = [
  occ('A', [0, 0, 0]),
  occ('B', [100, 0, 0]),
  occ('C', [1000, 0, 0]),
];

const isTree = (g: SessionGraph): boolean =>
  g.edges.length === g.markers.length - 1 && validateSessionGraph(g).ok === true;

describe('spanning builders', () => {
  it('STAR hubs the operator base with N-1 connected acyclic edges', () => {
    const g = buildStarGraph(three, 'B');
    expect(g.edges.map((e) => `${e.from}->${e.to}`).sort()).toEqual(['B->A', 'B->C']);
    expect(isTree(g)).toBe(true);
  });

  it('STAR defaults to the sorted-marker hub', () => {
    const g = buildStarGraph([...three].reverse());
    expect(g.edges.every((e) => e.from === 'A')).toBe(true);
    expect(isTree(g)).toBe(true);
  });

  it('MST picks minimum total approx-XYZ length', () => {
    const g = buildMstGraph(three);
    expect(g.edges.map((e) => `${e.from}->${e.to}`).sort()).toEqual(['A->B', 'B->C']);
    expect(isTree(g)).toBe(true);
  });

  it('MANUAL keeps caller legs and validates', () => {
    const g = buildManualGraph(three, [{ from: 'A', to: 'B' }, { from: 'B', to: 'C' }]);
    expect(isTree(g)).toBe(true);
  });

  it('rejects invalid graphs: wrong count, cycle, disconnected', () => {
    const star = buildStarGraph(three, 'A');
    expect(validateSessionGraph({ ...star, edges: [] }).ok).toBe(false);
    const cyclic = buildManualGraph(three, [
      { from: 'A', to: 'B' },
      { from: 'B', to: 'C' },
      { from: 'C', to: 'A' },
    ]);
    const cv = validateSessionGraph(cyclic);
    expect(cv.ok).toBe(false);
    const split = buildManualGraph([...three, occ('D', [5000, 0, 0])], [{ from: 'A', to: 'B' }]);
    expect(validateSessionGraph(split).ok).toBe(false);
  });
});

describe('edge reversal and groups', () => {
  it('negates the vector and keeps the symmetric covariance block', () => {
    const g = buildStarGraph(three, 'A');
    const e = { ...g.edges[0]!, deltaX: 1, deltaY: -2, deltaZ: 3 };
    const cov: GnssBaselineCovariance = { xx: 4, xy: -1, xz: 2, yy: 9, yz: -3, zz: 16 };
    const r = reverseSessionEdge({ ...e, covariance: cov });
    expect([r.deltaX, r.deltaY, r.deltaZ]).toEqual([-1, 2, -3]);
    expect(r.covariance).toEqual(cov);
    expect(r.from).toBe(e.to);
  });

  it('assigns shared-input edges to one dependency group', () => {
    const g = buildStarGraph(three, 'A');
    expect(g.edges[0]!.dependencyGroup).not.toBe(g.edges[1]!.dependencyGroup);
    expect(g.edges.every((e) => e.dependencyGroup.startsWith('fnv1a-'))).toBe(true);
  });

  it('revalidation records the repair in provenance', () => {
    const g = buildStarGraph(three, 'A');
    const { graph, validation } = revalidateGraph(g, 'reversed A->B to B->A');
    expect(validation.ok).toBe(true);
    expect(graph.provenance).toContain('reversed A->B to B->A');
    expect(graph.stochastic.status).toBe('FORMAL_UNCALIBRATED');
  });
});
