/**
 * Phase 12I.2 Worker C — multifile datumMode wiring tests (agent tier).
 *
 * End-to-end plumbing only (options -> input -> result -> JSON export ->
 * persist round-trip), worker-route parity, fail-closed error text via the
 * project route, and no-anchor-leak on project surfaces. No math asserts
 * beyond numeric identity between routes; the engine math corpus owns
 * correctness (see gnssFreeNetwork*.test.ts).
 */
import { describe, expect, it, beforeEach } from 'vitest';
import type { ProjectManifestFileEntry } from '../../src/engine/projectWorkspaceTypes';
import {
  buildGnssReportFromInput,
  renderGnssBaselineTextReport,
} from '../../src/engine/gnssBaselineReport';
import {
  GNSS_FREE_EXTRA_RANK_DEFECT,
  GNSS_FREE_NETWORK_SIZE_LIMIT,
} from '../../src/engine/gnssFreeNetwork';
import { setGnssMultifileEnabled } from '../../src/engine/gnssMultifileFlag';
import {
  buildGnssMultifileJsonExport,
  buildGnssMultifileProvenanceSection,
  deserializeGnssMultifilePersisted,
  emptyGnssMultifilePersisted,
  parseGnssProjectSources,
  runGnssMultifileProjectSolve,
  serializeGnssMultifilePersisted,
  summarizeGnssProjectComposition,
} from '../../src/engine/gnssMultifileProject';
import { runGnssBaselineAdjustment } from '../../src/engine/gnssBaselineAdjust';
import {
  runGnssBaselineWithNativeR2B,
  setGnssNativeR2BRouteEnabled,
} from '../../src/workers/gnssBaselineNativeR2BRoute';

const FRAME = 'ITRF2020@2020.0';
const EPOCH = '2020.0';
const ELLIPSOID = 'GRS80';
const COV = 'COV 0.000025 0 0 0.000025 0 0.000025';

const coordOf = (id: string): [number, number, number] => {
  let hash = 0;
  for (let i = 0; i < id.length; i += 1) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  return [4000000 + (hash % 900) * 100, 1000000 + (hash % 700) * 100, 4800000 + (hash % 500) * 100];
};

const nativeText = (
  stations: Array<{ id: string; fixed?: boolean }>,
  baselines: Array<{ from: string; to: string; noise?: number; id?: string }>,
): string => {
  const lines = [`FRAME ECEF ${FRAME} EPOCH ${EPOCH} ELLIPSOID ${ELLIPSOID}`, 'UNITS M'];
  stations.forEach((s) => {
    const c = coordOf(s.id);
    lines.push(`GX ${s.id} ${c[0]} ${c[1]} ${c[2]} ${s.fixed ? 'FIXED' : 'FREE'}`);
  });
  baselines.forEach((b, i) => {
    const from = coordOf(b.from);
    const to = coordOf(b.to);
    const j = (b.noise ?? 0) * 0.001;
    lines.push(`BL ${b.from} ${b.to} ${to[0] - from[0] + j} ${to[1] - from[1] - j} ${to[2] - from[2] + j} ID ${b.id ?? `B${i + 1}`} SESSION S1`);
    lines.push(COV);
  });
  return `${lines.join('\n')}\n`;
};

const TRI = ['A', 'B', 'C'];
const triBaselines = (noiseBase = 0) => [
  { from: 'A', to: 'B', noise: 1 + noiseBase },
  { from: 'B', to: 'C', noise: 2 + noiseBase },
  { from: 'C', to: 'A', noise: 3 + noiseBase },
];

const entry = (id: string, name: string, order: number): ProjectManifestFileEntry => ({
  id,
  name,
  kind: 'dat',
  path: `data/${id}-${name}`,
  enabled: true,
  order,
});

beforeEach(() => {
  setGnssMultifileEnabled(true);
  setGnssNativeR2BRouteEnabled(false);
});

describe('end-to-end datumMode chain (options -> input -> result -> export -> persist)', () => {
  const part1 = nativeText(TRI.map((id) => ({ id })), triBaselines(0));
  const part2 = nativeText(
    ['D', 'E', 'F'].map((id) => ({ id })),
    [
      { from: 'D', to: 'E', noise: 4 },
      { from: 'E', to: 'F', noise: 5 },
      { from: 'F', to: 'D', noise: 6 },
    ],
  );
  const files = [entry('f1', 'p1.dat', 0), entry('f2', 'p2.dat', 1)];
  const texts = { f1: part1, f2: part2 };

  it('allow-free links every stage with matching datum identity', () => {
    const output = runGnssMultifileProjectSolve(files, texts, { datumMode: 'allow-free' });
    // options -> input
    expect(output.input.datumMode).toBe('allow-free');
    // input -> result
    expect(output.result.datumSummary?.modeRequested).toBe('allow-free');
    expect(output.result.datumSummary?.kind).toBe('free');
    expect(output.result.datumSummary?.totalDatumDefect).toBe(6);
    // result -> JSON export
    const exported = buildGnssMultifileJsonExport(output) as Record<string, unknown>;
    expect(exported['datumMode']).toBe('allow-free');
    expect(exported['datumSummary']).toEqual(output.result.datumSummary);
    // persist round-trip reopens as allow-free
    const persisted = { ...emptyGnssMultifilePersisted(), datumMode: 'allow-free' as const };
    const reloaded = deserializeGnssMultifilePersisted(serializeGnssMultifilePersisted(persisted));
    expect(reloaded.datumMode).toBe('allow-free');
    const reopened = runGnssMultifileProjectSolve(files, texts, { datumMode: reloaded.datumMode });
    expect(JSON.stringify(reopened.result.stations)).toBe(JSON.stringify(output.result.stations));
    expect(reopened.result.varianceFactor).toBe(output.result.varianceFactor);
  });

  it('default chain stays constrained with no datum keys anywhere', () => {
    const text = nativeText(
      [{ id: 'A', fixed: true }, { id: 'B' }, { id: 'C' }],
      triBaselines(0),
    );
    const single = [entry('f1', 'p1.dat', 0)];
    const output = runGnssMultifileProjectSolve(single, { f1: text });
    expect(output.input.datumMode).toBe('constrained');
    expect(output.result.datumSummary).toBeUndefined();
    expect(output.summary.datumMode).toBe('constrained');
    expect(output.summary.datumComponents).toHaveLength(1);
    expect(output.summary.datumComponents[0]?.kind).toBe('constrained');
    const exported = buildGnssMultifileJsonExport(output) as Record<string, unknown>;
    expect('datumMode' in exported).toBe(false);
    expect('datumSummary' in exported).toBe(false);
    // Absent persisted datumMode reopens as constrained.
    expect(deserializeGnssMultifilePersisted({ gnssMultifile: {} }).datumMode).toBe('constrained');
  });
});

describe('summary datum classification for UI (recompute per run options)', () => {
  const part1 = nativeText(TRI.map((id) => ({ id })), triBaselines(0));
  const part2 = nativeText(
    ['D', 'E', 'F'].map((id) => ({ id })),
    [
      { from: 'D', to: 'E', noise: 4 },
      { from: 'E', to: 'F', noise: 5 },
      { from: 'F', to: 'D', noise: 6 },
    ],
  );
  const files = [entry('f1', 'p1.dat', 0), entry('f2', 'p2.dat', 1)];
  const texts = { f1: part1, f2: part2 };

  it('classifies both components free by default; overrides flip kinds without anchors', () => {
    const parsed = parseGnssProjectSources(files, texts, { datumMode: 'allow-free' });
    const free = summarizeGnssProjectComposition(parsed, 2, { datumMode: 'allow-free' });
    expect(free.datumMode).toBe('allow-free');
    expect(free.datumComponents.map((c) => c.kind)).toEqual(['free', 'free']);
    const mixed = summarizeGnssProjectComposition(parsed, 2, {
      datumMode: 'allow-free',
      controlOverrides: { A: true },
    });
    expect(mixed.datumComponents.map((c) => c.kind)).toEqual(['constrained', 'free']);
    // No anchor working state in summary state.
    expect(JSON.stringify(mixed.datumComponents)).not.toMatch(/anchor/i);
    // Solve summary agrees with the standalone summary for the same options.
    const solved = runGnssMultifileProjectSolve(files, texts, {
      datumMode: 'allow-free',
      controlOverrides: { A: true },
    });
    expect(solved.summary.datumComponents).toEqual(mixed.datumComponents);
    expect(solved.result.datumSummary?.kind).toBe('mixed');
  });
});

describe('worker datumMode wiring + direct-vs-worker parity', () => {
  it('same project input+datumMode solves numerically identical direct vs worker', async () => {
    const text = nativeText(TRI.map((id) => ({ id })), triBaselines(0));
    const output = runGnssMultifileProjectSolve([entry('f1', 'p1.dat', 0)], { f1: text }, {
      datumMode: 'allow-free',
    });
    const direct = runGnssBaselineAdjustment(output.input);
    const viaWorker = await runGnssBaselineWithNativeR2B(output.input, { isWorker: true });
    expect(viaWorker.route).toBe('typescript');
    expect(viaWorker.reasons.join(' ')).toMatch(/free-network/);
    expect(JSON.stringify(viaWorker.result.stations)).toBe(JSON.stringify(direct.stations));
    expect(viaWorker.result.varianceFactor).toBe(direct.varianceFactor);
    expect(viaWorker.result.datumSummary).toEqual(direct.datumSummary);
  });

  it('R2B distinction: free allow-free stays TS with a free reason; controlled has none', async () => {
    setGnssNativeR2BRouteEnabled(true);
    const freeText = nativeText(TRI.map((id) => ({ id })), triBaselines(0));
    const free = runGnssMultifileProjectSolve([entry('f1', 'p1.dat', 0)], { f1: freeText }, {
      datumMode: 'allow-free',
    });
    const freeAttempt = await runGnssBaselineWithNativeR2B(free.input, { isWorker: true, minParams: 1 });
    expect(freeAttempt.route).toBe('typescript');
    expect(freeAttempt.reasons.join(' ')).toMatch(/free-network/);
    const heldText = nativeText(
      [{ id: 'A', fixed: true }, { id: 'B' }, { id: 'C' }],
      triBaselines(0),
    );
    const held = runGnssMultifileProjectSolve([entry('f1', 'p1.dat', 0)], { f1: heldText }, {
      datumMode: 'allow-free',
    });
    expect(held.result.datumSummary).toBeUndefined();
    const heldAttempt = await runGnssBaselineWithNativeR2B(held.input, { isWorker: true, minParams: 1 });
    expect(heldAttempt.reasons.join(' ')).not.toMatch(/free-network/);
  });
});

describe('fail-closed error text via the project route', () => {
  it('251-station free project throws the size limit without solving', () => {
    const names = Array.from({ length: 251 }, (_, i) => `S${String(i).padStart(4, '0')}`);
    const text = nativeText(
      names.map((id) => ({ id })),
      names.map((from, i) => ({ from, to: names[(i + 1) % names.length] as string, noise: i % 7 })),
    );
    expect(() =>
      runGnssMultifileProjectSolve([entry('f1', 'ring.dat', 0)], { f1: text }, { datumMode: 'allow-free' }),
    ).toThrow(GNSS_FREE_NETWORK_SIZE_LIMIT);
  });

  it('isolated free station via the project route throws the extra-rank defect', () => {
    const text = nativeText(
      [...TRI.map((id) => ({ id })), { id: 'GHOST' }],
      triBaselines(0),
    );
    expect(() =>
      runGnssMultifileProjectSolve([entry('f1', 'p1.dat', 0)], { f1: text }, { datumMode: 'allow-free' }),
    ).toThrow(GNSS_FREE_EXTRA_RANK_DEFECT);
  });
});

describe('no anchor leak on project surfaces', () => {
  const text = nativeText(TRI.map((id) => ({ id })), triBaselines(0));
  const files = [entry('f1', 'p1.dat', 0)];

  it('anchor is released in stations, absent from control/provenance, debug-only in logs', () => {
    const output = runGnssMultifileProjectSolve(files, { f1: text }, { datumMode: 'allow-free' });
    const anchor = output.result.datumSummary?.components.find((c) => c.kind === 'free')?.anchor;
    expect(anchor).toBe('A');
    // Released: not fixed in the solved stations.
    const solved = output.result.stations[anchor as string];
    expect(solved?.fixedX ?? false).toBe(false);
    expect(solved?.fixed ?? false).toBe(false);
    // Absent from every control surface (external + JSON export).
    expect(output.summary.controlBySource.join('\n')).not.toContain(anchor as string);
    const exported = buildGnssMultifileJsonExport(output) as Record<string, unknown>;
    expect(JSON.stringify(exported['stationProvenance'])).not.toContain(`'${anchor}'`);
    // Provenance names file origins, never control/anchors-as-control.
    const section = buildGnssMultifileProvenanceSection(
      output.provenance,
      output.input.baselines,
      output.mergeNotes,
      output.summary.blockingErrors,
    );
    expect(section.join('\n')).not.toMatch(/FIXED|CONTROL|anchor/i);
    // Logs carry the anchor only on the explicitly debug gauge line.
    const result = output.result;
    const anchorLines = 'logs' in result
      ? (result.logs as string[]).filter((line) => line.includes(anchor as string))
      : [];
    expect(anchorLines.length).toBeGreaterThan(0);
    expect(anchorLines.every((line) => /debug only|computational gauge/i.test(line))).toBe(true);
    // Constrained components carry no anchor field at all.
    const mixed = runGnssMultifileProjectSolve(files, { f1: text }, {
      datumMode: 'allow-free',
      controlOverrides: { A: true, B: true, C: true },
    });
    expect(mixed.result.datumSummary).toBeUndefined();
  });

  it('report text states datum + inner-constraint precision, never anchor-as-control', () => {
    const output = runGnssMultifileProjectSolve(files, { f1: text }, { datumMode: 'allow-free' });
    const { report } = buildGnssReportFromInput(output.input);
    const rendered = renderGnssBaselineTextReport(report);
    expect(rendered).toMatch(/datum: free \(requested allow-free\) defect=3/);
    expect(rendered).toMatch(/inner-constrained \(Q_free = S Q_gauge/);
    expect(rendered).not.toMatch(/FIXED|CONTROL/);
  });
});

describe('datumMode is a RUN/PROJECT option, never per-source', () => {
  it('parsed entries and JSON export sources carry no datum keys', () => {
    const text = nativeText(TRI.map((id) => ({ id })), triBaselines(0));
    const files = [entry('f1', 'p1.dat', 0)];
    const parsed = parseGnssProjectSources(files, { f1: text }, { datumMode: 'allow-free' });
    parsed.forEach((source) => {
      expect('datumMode' in source).toBe(false);
      expect('datumSummary' in source).toBe(false);
    });
    const output = runGnssMultifileProjectSolve(files, { f1: text }, { datumMode: 'allow-free' });
    const exported = buildGnssMultifileJsonExport(output) as { sources: Array<Record<string, unknown>> };
    exported.sources.forEach((source) => {
      expect('datumMode' in source).toBe(false);
    });
  });
});
