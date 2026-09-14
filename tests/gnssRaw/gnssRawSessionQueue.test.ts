/**
 * Phase 12J.9 Track C — session pool + session JSON tests (synthetic only).
 *
 * Uses a mock SessionJobDriver (manual resolve/reject handles); no real
 * WASM is spawned in the agent tier. Covers: PAR bound, PARTIAL with the
 * failed edge named, cancel (queued never launch, late message ignored),
 * replacement-edge revalidation, export round-trip + reopen-no-reprocess
 * + upload-order determinism, and project isolation (no adjustment/store
 * imports in the Track C sources).
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { GnssRawRnx2rtkpJob } from '../../src/engine/gnssRawRnx2rtkp';
import {
  buildRawSession,
  buildRawSessionExport,
  parseRawSessionExport,
  reopenRawSession,
  serializeRawSessionExport,
  sessionBaselineDocs,
  sessionSemanticBytes,
  RAW_SESSION_EXPORT_KIND,
  type BuildRawSessionInput,
} from '../../src/engine/gnssRawSessionExport';
import type { ProcessedRawGnssBaseline, RawGnssFileMetadata } from '../../src/engine/gnssRawTypes';
import { buildStarGraph } from '../../src/engine/gnssRawSessionGraph';
import type { RawOccupationMeta } from '../../src/engine/gnssRawSessionModel';
import {
  checkStationBound,
  RawSessionPool,
  replaceSessionEdge,
  SESSION_MAX_QUEUED_JOBS,
  type SessionEdgeSpec,
  type SessionJobDriver,
} from '../../src/hooks/useGnssRawSession';

const job = (from: string, to: string): GnssRawRnx2rtkpJob => ({
  baseObs: new Uint8Array([1]),
  roverObs: new Uint8Array([2]),
  nav: [new Uint8Array([3])],
  baseXyz: [0, 0, 0],
  from,
  to,
  baseAntenna: { marker: from, antennaModel: '', height: 0, east: 0, north: 0 },
  roverAntenna: { marker: to, antennaModel: '', height: 0, east: 0, north: 0 },
  hashes: { baseObsSha256: `sha-${from}`, roverObsSha256: `sha-${to}`, navSha256: ['nav'], sp3Sha256: null },
});

const spec = (from: string, to: string): SessionEdgeSpec => ({
  edgeId: `${from}->${to}`,
  from,
  to,
  job: job(from, to),
});

const fixedResult = (from: string, to: string): ProcessedRawGnssBaseline => ({
  status: 'FIXED',
  acceptance: 'PROCESSING_ACCEPTED',
  acceptanceNotes: [],
  from,
  to,
  deltaX: 1,
  deltaY: 2,
  deltaZ: 3,
  baselineLength: Math.hypot(1, 2, 3),
  covariance: { xx: 1e-6, xy: 0, xz: 0, yy: 1e-6, yz: 0, zz: 1e-6 },
  covarianceAssessment: { model: 'RTKLIB_FORMAL', calibration: 'UNCALIBRATED', status: 'FORMAL_UNCALIBRATED', finite: true, spd: true },
  coordinateReference: 'MARKER_TO_MARKER_ECEF',
  referenceFrame: 'WGS84(G1150)-class/broadcast',
  start: '2024/01/01 00:00:00',
  stop: '2024/01/01 00:06:00',
  solutionQuality: { ratio: 9, fixedEpochs: 5, usedEpochs: 5, satellites: 6 },
  antennaAssessment: {
    base: { marker: from, model: '', calibration: 'CALIBRATION_UNAVAILABLE', height: 0, east: 0, north: 0 },
    rover: { marker: to, model: '', calibration: 'CALIBRATION_UNAVAILABLE', height: 0, east: 0, north: 0 },
    overall: 'NONE',
    warning: null,
  },
  provenance: {
    processor: 'rnx2rtkp 2.5.1 @62d4677',
    emccVersion: 'emcc-test',
    compileFlags: [],
    baseObsSha256: `sha-${from}`,
    roverObsSha256: `sha-${to}`,
    navSha256: ['nav'],
    sp3Sha256: null,
    optionsHash: 'fnv1a-0',
    intervalRequested: 'AUTO',
    intervalResolved: 30,
    elevationMaskResolved: 10,
    ephemerisRequested: 'BROADCAST',
    ephemerisUsed: 'BROADCAST',
    processedAt: '2024-01-01T00:07:00.000Z',
  },
  diagnostics: [],
});

type Pending = {
  spec: SessionEdgeSpec;
  succeed: (_r: ProcessedRawGnssBaseline) => void;
  fail: (_e: { code: 'PROCESSOR_FAILURE'; message: string }) => void;
};

/** Manual driver: records launches, resolves only when the test says so. */
const manualDriver = (launched: Pending[]): SessionJobDriver => ({
  start: (s, events) => {
    const p: Pending = {
      spec: s,
      succeed: (r) => events.onSuccess(r),
      fail: (e) => events.onFailure(e),
    };
    launched.push(p);
    return () => {};
  },
});

const occ = (marker: string): RawOccupationMeta => ({
  meta: {
    role: 'BASE', fileName: `${marker}.06o`, sha256: `sha-${marker}`, rinexVersion: '2.10',
    marker, approxXyz: [0, 0, 0], antennaModel: '', antennaHeight: 0, antennaEast: 0,
    antennaNorth: 0, receiverModel: null, firstEpoch: '2024-01-01T00:00:00.000Z',
    lastEpoch: '2024-01-01T01:00:00.000Z', intervalSeconds: 30,
    constellations: ['G'], signals: ['L1', 'L2'],
  },
  epochCount: 120,
});

const stationFile = (marker: string): RawGnssFileMetadata => ({
  role: 'BASE', fileName: `${marker}.06o`, sha256: `sha-${marker}`, rinexVersion: '2.10',
  marker, approxXyz: [0, 0, 0], antennaModel: '', antennaHeight: 0, antennaEast: 0,
  antennaNorth: 0, receiverModel: null, firstEpoch: '2024-01-01T00:00:00.000Z',
  lastEpoch: '2024-01-01T01:00:00.000Z', intervalSeconds: 30,
  constellations: ['G'], signals: ['L1', 'L2'],
});

const sessionInput = (markers: string[], status: BuildRawSessionInput['status'] = 'COMPLETE'): BuildRawSessionInput => {
  const occupations = markers.map(occ);
  // Fixed hub: upload order must not move the tree root.
  const graph = buildStarGraph(occupations, 'A');
  return {
    sessionId: 'sess-1',
    stations: [...markers].reverse(),
    commonWindow: { start: '2024-01-01T00:00:00.000Z', stop: '2024-01-01T01:00:00.000Z' },
    options: { elevationMaskDegrees: 10, intervalRequested: 'AUTO', ephemerisRequested: 'BROADCAST', windowStart: null, windowStop: null },
    graph,
    baselines: graph.edges.map((e) => fixedResult(e.from, e.to)),
    dependencyGroups: graph.edges.map((e) => ({ edge: `${e.from}->${e.to}`, group: e.dependencyGroup })),
    antennaAssessment: { stations: [], overall: 'NONE', baselineNotes: [], stochastic: { covarianceModel: 'RTKLIB_FORMAL', calibration: 'UNCALIBRATED', status: 'FORMAL_UNCALIBRATED' } },
    ephemerisAssessment: { requested: 'BROADCAST', used: 'BROADCAST', sp3Label: null },
    stationFiles: markers.map(stationFile),
    status,
    provenance: {
      obsSha256: markers.map((m) => `sha-${m}`),
      navSha256: ['nav'],
      sp3Sha256: null,
      antexSourceSha256: null,
      antexSubsetSha256: null,
      processor: 'rnx2rtkp 2.5.1 @62d4677',
      optionsHash: 'fnv1a-0',
      treePolicy: 'STAR',
      base: 'A',
      windowStart: '2024-01-01T00:00:00.000Z',
      windowStop: '2024-01-01T01:00:00.000Z',
      intervalResolved: 30,
    },
  };
};

describe('session pool concurrency', () => {
  it('respects PAR=2: third edge waits for a slot', () => {
    const launched: Pending[] = [];
    const pool = new RawSessionPool(manualDriver(launched), 2);
    pool.enqueue([spec('A', 'B'), spec('A', 'C'), spec('A', 'D')]);
    expect(launched).toHaveLength(2);
    launched[0]!.succeed(fixedResult('A', 'B'));
    expect(launched).toHaveLength(3);
    expect(launched[2]!.spec.edgeId).toBe('A->D');
  });

  it('queue bound rejects beyond max queued jobs', () => {
    const launched: Pending[] = [];
    const pool = new RawSessionPool(manualDriver(launched), 2);
    const many = Array.from({ length: SESSION_MAX_QUEUED_JOBS + 3 }, (_, i) => spec('A', `S${i}`));
    expect(() => pool.enqueue(many)).toThrow(/queue bound/);
  });
});

describe('session pool failures', () => {
  it('one edge failing => PARTIAL naming the exact edge; sibling untouched', () => {
    const launched: Pending[] = [];
    const pool = new RawSessionPool(manualDriver(launched), 2);
    pool.enqueue([spec('A', 'B'), spec('A', 'C')]);
    launched[0]!.fail({ code: 'PROCESSOR_FAILURE', message: 'boom' });
    launched[1]!.succeed(fixedResult('A', 'C'));
    expect(pool.failedEdges()).toEqual(['A->B']);
    expect(pool.edgeError('A->B')?.message).toBe('boom');
    expect(pool.edgeResult('A->C')?.status).toBe('FIXED');
    expect(pool.sessionStatus()).toBe('PARTIAL');
  });
});

describe('session pool cancel', () => {
  it('queued never launch, late message ignored, status CANCELLED', () => {
    const launched: Pending[] = [];
    const pool = new RawSessionPool(manualDriver(launched), 2);
    pool.enqueue([spec('A', 'B'), spec('A', 'C'), spec('A', 'D')]);
    expect(launched).toHaveLength(2);
    const late = launched[0]!;
    pool.cancel();
    expect(launched).toHaveLength(2);
    late.succeed(fixedResult('A', 'B'));
    expect(pool.edgeResult('A->B')).toBeNull();
    expect(pool.snapshot()['A->B']).toBe('cancelled');
    expect(pool.sessionStatus()).toBe('CANCELLED');
    expect(pool.completedResults()).toEqual([]);
  });
});

describe('session pool reset (StrictMode remount / re-run after settle)', () => {
  it('reset releases a latched cancel so the pool accepts new work', () => {
    const launched: Pending[] = [];
    const pool = new RawSessionPool(manualDriver(launched), 2);
    pool.cancel();
    pool.enqueue([spec('A', 'B')]);
    expect(launched).toHaveLength(0);
    pool.reset();
    pool.enqueue([spec('A', 'B')]);
    expect(launched).toHaveLength(1);
    launched[0]!.succeed(fixedResult('A', 'B'));
    expect(pool.sessionStatus()).toBe('COMPLETE');
  });

  it('reset drops every record once settled, so a re-run starts clean', () => {
    const launched: Pending[] = [];
    const pool = new RawSessionPool(manualDriver(launched), 2);
    pool.enqueue([spec('A', 'B'), spec('A', 'C')]);
    launched[0]!.succeed(fixedResult('A', 'B'));
    launched[1]!.fail({ code: 'PROCESSOR_FAILURE', message: 'boom' });
    expect(pool.sessionStatus()).toBe('PARTIAL');
    pool.reset();
    expect(pool.snapshot()).toEqual({});
    expect(pool.completedResults()).toEqual([]);
    expect(pool.failedEdges()).toEqual([]);
  });

  it('settle COMPLETE then start() same specs: no Duplicate, old results cleared', () => {
    const launched: Pending[] = [];
    const pool = new RawSessionPool(manualDriver(launched), 2);
    const specs = [spec('A', 'B'), spec('A', 'C')];
    pool.enqueue(specs);
    launched[0]!.succeed(fixedResult('A', 'B'));
    launched[1]!.succeed(fixedResult('A', 'C'));
    expect(pool.sessionStatus()).toBe('COMPLETE');
    expect(pool.completedResults()).toHaveLength(2);
    // start() shape: reset at new-run start, then enqueue the same specs.
    pool.reset();
    expect(() => pool.enqueue(specs)).not.toThrow();
    expect(Object.values(pool.snapshot()).sort()).toEqual(['active', 'active']);
    expect(pool.completedResults()).toEqual([]);
  });
});

describe('replacement edge', () => {
  it('revalidates the tree and records provenance', () => {
    const graph = buildStarGraph([occ('A'), occ('B'), occ('C')], 'A');
    const out = replaceSessionEdge(graph, { from: 'A', to: 'B' }, { from: 'B', to: 'C' });
    expect(out.ok).toBe(true);
    expect(out.graph.provenance.some((p) => p.includes('replace A->B with B->C'))).toBe(true);
  });

  it('station bound rejects >20 stations', () => {
    const stations = Array.from({ length: 21 }, (_, i) => `S${i}`);
    expect(() => checkStationBound(stations)).toThrow(/max 20/);
  });
});

describe('session export contract', () => {
  it('round-trips, reopens without reprocessing, per-baseline docs reuse baseline kind', () => {
    const session = buildRawSession(sessionInput(['A', 'B', 'C']));
    const doc = buildRawSessionExport(session);
    expect(doc.kind).toBe(RAW_SESSION_EXPORT_KIND);
    const back = parseRawSessionExport(serializeRawSessionExport(doc));
    expect(back.session).toEqual(session);
    const reopened = reopenRawSession(serializeRawSessionExport(doc));
    expect(reopened).toEqual(session);
    const docs = sessionBaselineDocs(session);
    expect(docs).toHaveLength(2);
    for (const d of docs) expect(d.kind).toBe('webnet-raw-static-baseline/1');
  });

  it('reordered uploads give identical semantic bytes even as processedAt varies', () => {
    const withClock = (markers: string[]): BuildRawSessionInput => {
      const input = sessionInput(markers);
      return {
        ...input,
        baselines: input.baselines.map((b, i) => ({
          ...b,
          provenance: { ...b.provenance, processedAt: `2024-05-0${i + 1}T00:00:00.000Z` },
        })),
      };
    };
    const a = buildRawSessionExport(buildRawSession(withClock(['A', 'B', 'C'])));
    const b = buildRawSessionExport(buildRawSession(withClock(['C', 'B', 'A'])));
    expect(sessionSemanticBytes(a)).toBe(sessionSemanticBytes(b));
  });

  it('rejects wrong-kind payloads fail-closed', () => {
    expect(() => parseRawSessionExport('{"kind":"other"}')).toThrow();
  });
});

describe('track C project isolation', () => {
  it('imports no adjustment/store modules', () => {
    const sources = [
      'src/engine/gnssRawSessionExport.ts',
      'src/hooks/useGnssRawSession.ts',
    ].map((f) => readFileSync(f, 'utf8'));
    for (const text of sources) {
      expect(text).not.toMatch(/gnssBaselineAdjust|adjustment|store\//);
    }
  });
});
