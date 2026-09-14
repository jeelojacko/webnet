/**
 * Phase 12J.10 §§21-23, 26-27 — real-data session proof on the EXACT
 * production path (EVIDENCE ONLY, local corpus, never committed).
 *
 * Runs STAR/MST/MANUAL/six-station sessions in node with the real pinned
 * rnx2rtkp WASM: production occupation parse -> graph builders ->
 * production ANTEX subset (shared cache) -> production edge specs ->
 * runRawBaseline (fresh module per job, PAR=2) -> buildProcessedSession ->
 * export -> semantic-bytes determinism (shuffled input) -> reopen fidelity.
 * Usage: npx tsx scripts/gnss/gnss12j10SessionProof.ts
 */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  buildManualGraph,
  buildMstGraph,
  buildStarGraph,
  validateSessionGraph,
} from '../../src/engine/gnssRawSessionGraph';
import {
  buildProcessedSession,
  buildSessionEdgeSpecs,
  parseManualPairs,
  prepareAntexSubset,
  type OccupationEntry,
} from '../../src/components/gnss/GnssRawSessionPanel.utils';
import { createAntexSubsetCache } from '../../src/engine/gnssAntexSubset';
import {
  detectDuplicates,
  planSessionInterval,
  resolveSessionAntennas,
} from '../../src/engine/gnssRawSessionModel';
import {
  buildRawSessionExport,
  reopenRawSession,
  sessionSemanticBytes,
} from '../../src/engine/gnssRawSessionExport';
import { parseRinexObs } from '../../src/engine/gnssRinexHeader';
import {
  runRawBaseline,
  type GnssRawWasmModule,
} from '../../src/engine/gnssRawRnx2rtkp';
import {
  DEFAULT_RAW_OPTIONS,
  type RawFileEntry,
} from '../../src/hooks/useGnssRawBaseline';

const CORP = `${process.env['HOME']}/Downloads/webnet-gnss-medium/belgian-12j8`;
const W = `${CORP}/work12j10`;
const OUT = `${W}/sessions`;
mkdirSync(OUT, { recursive: true });
mkdirSync(`${W}/slices`, { recursive: true });

const sha = (b: Uint8Array): string => createHash('sha256').update(b).digest('hex');
const entry = (path: string, fileName: string): RawFileEntry => {
  const bytes = new Uint8Array(readFileSync(path));
  return { fileName, bytes, text: '', sha256: sha(bytes) };
};
const textEntry = (path: string, fileName: string): RawFileEntry => {
  const bytes = new Uint8Array(readFileSync(path));
  return { fileName, bytes, text: new TextDecoder().decode(bytes), sha256: sha(bytes) };
};

const STATION_FILE: Record<string, string> = {
  WARE: 'WARE00BEL_R', TGRN: 'TGRN00BEL_S', VOER: 'VOER00BEL_S',
  WERB: 'WERB00BEL_R', EIJS: 'EIJS00NLD_R', TIT2: 'TIT200DEU_R',
};
const obsPath = (m: string, doy: string): string =>
  `${CORP}/rnx/${STATION_FILE[m]}_2026${doy}0000_01D_30S_MO.rnx`;

const loadOccupations = (markers: string[], doy: string, win: string): OccupationEntry[] => {
  const [ws, we] = WIN_ISO[win]!;
  return markers.map((m) => {
    // Frozen 32 MiB intake cap: stage an honest window slice (header kept,
    // slice bytes hashed as staged) instead of the full-day file.
    const slicePath = `${W}/slices/${m}-${doy}-${win}.rnx`;
    try {
      readFileSync(slicePath);
    } catch {
      execFileSync('python3', [
        join(process.cwd(), 'scripts/gnss/gnss12j10Slice.py'),
        obsPath(m, doy), slicePath, ws, we,
      ], { stdio: 'pipe' });
    }
    const p = slicePath;
    const raw = readFileSync(p);
    const parsed = parseRinexObs(new TextDecoder().decode(raw));
    const bytes = new Uint8Array(raw);
    return {
      meta: {
        ...parsed.metadata, role: 'ROVER' as const,
        fileName: p.split('/').pop()!, sha256: sha(bytes),
      },
      epochCount: parsed.epochCount, fileName: p.split('/').pop()!, bytes,
    };
  });
};

// Windows are explicit 1h UTC slices; ISO form matches panel snapshots.
const WIN_ISO: Record<string, [string, string]> = {
  '124-h12': ['2026-05-04T12:00:00.000Z', '2026-05-04T13:00:00.000Z'],
  '130-h00': ['2026-05-10T00:00:00.000Z', '2026-05-10T01:00:00.000Z'],
  '130-h12': ['2026-05-10T12:00:00.000Z', '2026-05-10T13:00:00.000Z'],
  '137-h18': ['2026-05-17T18:00:00.000Z', '2026-05-17T19:00:00.000Z'],
};

interface SessionPlan {
  readonly id: string;
  readonly markers: string[];
  readonly doy: string;
  readonly win: string;
  readonly policy: 'STAR' | 'MST' | 'MANUAL';
  readonly base?: string;
  readonly manual?: string;
}

const PLANS: SessionPlan[] = [
  { id: 'STAR-130-h12', markers: ['WARE', 'TGRN', 'VOER', 'WERB'], doy: '130', win: '130-h12', policy: 'STAR', base: 'WARE00BEL' },
  { id: 'MST-124-h12', markers: ['WARE', 'TGRN', 'VOER', 'WERB'], doy: '124', win: '124-h12', policy: 'MST' },
  { id: 'MST-130-h12', markers: ['WARE', 'TGRN', 'VOER', 'WERB'], doy: '130', win: '130-h12', policy: 'MST' },
  { id: 'MST-137-h18', markers: ['WARE', 'TGRN', 'VOER', 'WERB'], doy: '137', win: '137-h18', policy: 'MST' },
  { id: 'MANUAL-124-h12', markers: ['WARE', 'TGRN', 'VOER', 'WERB'], doy: '124', win: '124-h12', policy: 'MANUAL', manual: 'WARE00BEL>TGRN00BEL\nTGRN00BEL>VOER00BEL\nVOER00BEL>WERB00BEL' },
  { id: 'MANUAL-130-h00', markers: ['WARE', 'TGRN', 'VOER', 'WERB'], doy: '130', win: '130-h00', policy: 'MANUAL', manual: 'WARE00BEL>TGRN00BEL\nTGRN00BEL>VOER00BEL\nVOER00BEL>WERB00BEL' },
  { id: 'MANUAL-137-h18', markers: ['WARE', 'TGRN', 'VOER', 'WERB'], doy: '137', win: '137-h18', policy: 'MANUAL', manual: 'WARE00BEL>TGRN00BEL\nTGRN00BEL>VOER00BEL\nVOER00BEL>WERB00BEL' },
  { id: 'SIX-130-h12', markers: ['WARE', 'TGRN', 'VOER', 'WERB', 'EIJS', 'TIT2'], doy: '130', win: '130-h12', policy: 'STAR', base: 'WARE00BEL' },
];

const wasmUrl = pathToFileURL(join(process.cwd(), 'cpp/build-wasm/rtklib-rnx2rtkp.js')).href;
const factory = (await import(wasmUrl) as { default: () => Promise<GnssRawWasmModule> }).default;
const freshModule = (): Promise<GnssRawWasmModule> => factory();
const atxSource = readFileSync(`${CORP}/igs20.atx`, 'utf8');
const cache = createAntexSubsetCache();

  const summary: unknown[] = [];
  const edgeId = (e: { from: string; to: string }): string => `${e.from}->${e.to}`;
for (const plan of PLANS) {
  const t0 = Date.now();
  const occupations = loadOccupations(plan.markers, plan.doy, plan.win);
  const dups = detectDuplicates(occupations);
  if (dups.length > 0) throw new Error(`duplicates in ${plan.id}`);
  const graph = plan.policy === 'STAR'
    ? buildStarGraph(occupations, plan.base)
    : plan.policy === 'MST'
      ? buildMstGraph(occupations)
      : buildManualGraph(occupations, parseManualPairs(plan.manual ?? ''));
  const v = validateSessionGraph(graph);
  if (!v.ok) throw new Error(`invalid graph ${plan.id}: ${v.errors.join(';')}`);
  const antennas = resolveSessionAntennas(occupations, graph.edges);
  if (!antennas) throw new Error(`no antennas ${plan.id}`);
  const interval = planSessionInterval(occupations, 'AUTO');
  if (interval.resolved == null) throw new Error(`no interval ${plan.id}`);
  const [ws, we] = WIN_ISO[plan.win]!;
  const nav = [textEntry(`${W}/nav/BRDC00IGS_R_2026${plan.doy}0000_01D_MN.rnx`, 'nav')];
  const sp3 = entry(`${W}/sp3/${plan.doy}.sp3`, `${plan.doy}.sp3`);
  const { result: antex, warning } = await prepareAntexSubset({
    sourceText: atxSource, occupations, validAt: ws, cache,
  });
  const options = { ...DEFAULT_RAW_OPTIONS, ephemeris: 'PRECISE' as const };
  const specs = buildSessionEdgeSpecs({
    graph, occupations, nav, sp3, options,
    windowStart: ws, windowStop: we, resolvedInterval: interval.resolved, antex,
  });
  // PAR=2: at most two live WASM jobs, fresh module per job (isolation).
  const baselines = [];
  for (let i = 0; i < specs.length; i += 2) {
    const batch = specs.slice(i, i + 2);
    const mods = await Promise.all(batch.map(() => freshModule()));
    const done = await Promise.all(batch.map((s, k) => runRawBaseline(mods[k]!, s.job)));
    baselines.push(...done);
    await Promise.all(mods.map((m) => (m as { close?: () => void }).close?.()));
  }
  const failed = graph.edges.length - baselines.filter((b) =>
    graph.edges.some((e) => e.from === b.from && e.to === b.to)).length;
  const processed = buildProcessedSession({
    graph, occupations, markers: plan.markers,
    stationFiles: occupations.map((o) => o.meta), baselines,
    options, windowStart: ws, windowStop: we, windowExplicit: true,
    intervalResolved: interval.resolved, treePolicy: plan.policy,
    antennaAssessment: antennas, base: plan.base ?? '',
    obsSha256: occupations.map((o) => o.meta.sha256),
    navSha256: nav.map((e) => e.sha256), sp3, failedCount: failed, antex,
  });
  if (!processed) throw new Error(`no processed session ${plan.id}`);
  const doc = buildRawSessionExport(processed);
  const bytesA = sessionSemanticBytes(doc);
  // Determinism: rebuild from shuffled edge order -> identical bytes.
  const reordered = buildRawSessionExport(buildProcessedSession({
    graph, occupations, markers: [...plan.markers].reverse(),
    stationFiles: occupations.map((o) => o.meta), baselines: [...baselines].reverse(),
    options, windowStart: ws, windowStop: we, windowExplicit: true,
    intervalResolved: interval.resolved, treePolicy: plan.policy,
    antennaAssessment: antennas, base: plan.base ?? '',
    obsSha256: occupations.map((o) => o.meta.sha256),
    navSha256: nav.map((e) => e.sha256), sp3, failedCount: failed, antex,
  })!);
  const bytesB = sessionSemanticBytes(reordered);
  const reopened = reopenRawSession(JSON.stringify(doc));
  const fidelity = reopened.sessionId === processed.sessionId
    && reopened.baselines.length === processed.baselines.length
    && reopened.provenance.antexSubsetSha256 === processed.provenance.antexSubsetSha256
    && reopened.graph.edges.length === processed.graph.edges.length;
  writeFileSync(`${OUT}/${plan.id}.json`, `${bytesA}\n`);
  const statuses = baselines.map((b) => `${b.from}->${b.to}:${b.status}`).join(',');
  summary.push({
    id: plan.id, edges: graph.edges.map(edgeId),
    statuses, failed, warning, deterministic: bytesA === bytesB,
    reopenFidelity: fidelity, ms: Date.now() - t0,
  });
  console.log(`${plan.id}: ${statuses} failed=${failed} determinism=${bytesA === bytesB} reopen=${fidelity} ${(Date.now() - t0) / 1000}s`);
}
writeFileSync(`${W}/session-proof.json`, `${JSON.stringify(summary, null, 2)}\n`);
console.log(`cache size=${cache.size} (shared across sessions)`);
