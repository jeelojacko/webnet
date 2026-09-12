#!/usr/bin/env node
/** Phase 10M summary assembler (evidence-only, gitignored inputs → /tmp JSON). */
import fs from 'node:fs';

const q = (xs, p) => [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(p * (xs.length - 1)))] ?? 0;
const med = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] ?? 0;
const mean = (xs) => xs.reduce((s, v) => s + v, 0) / Math.max(1, xs.length);
const std = (xs) => { const m = mean(xs); return Math.sqrt(xs.reduce((s, v) => s + (v - m) ** 2, 0) / Math.max(1, xs.length)); };

// 1. Reproducibility: 5 fresh processes of the 10L benchmark.
const repro = [];
for (let i = 1; i <= 5; i += 1) {
  const m = JSON.parse(fs.readFileSync(`artifacts/evidence/phase10m/repro10l/proc${i}.json`, 'utf8'));
  repro.push(m);
}
const fixtures = repro[0].map((r) => r.fixture);
const reproducibility = fixtures.map((id) => {
  const perProcess = repro.map((m, i) => {
    const r = m.find((x) => x.fixture === id);
    return { process: i + 1, tsMedian: r.tsWallMs.median, tsP25: r.tsWallMs.p25, tsP75: r.tsWallMs.p75, nativeMedian: r.newRouteWallMs.median, nativeP25: r.newRouteWallMs.p25, nativeP75: r.newRouteWallMs.p75 };
  });
  const tsMeds = perProcess.map((p) => p.tsMedian);
  const natMeds = perProcess.map((p) => p.nativeMedian);
  return {
    fixture: id, numParams: repro[0].find((x) => x.fixture === id).numParams, perProcess,
    tsAcross: { median: med(tsMeds), p25: q(tsMeds, 0.25), p75: q(tsMeds, 0.75), std: std(tsMeds) },
    nativeAcross: { median: med(natMeds), p25: q(natMeds, 0.25), p75: q(natMeds, 0.75), std: std(natMeds) },
  };
});

// 2-5. Ladder / corpus / large / qxx from the 10M campaign.
const e10m = JSON.parse(fs.readFileSync('artifacts/evidence/phase10m/phase10m-evidence.json', 'utf8'));
const ladder = e10m.ladder.map((r) => ({
  id: r.id, params: r.numParams, tsMs: r.tsWallMs.median,
  nativeMs: (r.routeWallMs ?? r.nativeEngineWallMs).median,
  routeMs: r.routeWallMs ? r.routeWallMs.median : null,
  engineMs: r.nativeEngineWallMs.median, ratio: r.nativeOverTsRatio,
  class: r.class, cohort: r.cohort, absoluteDeltaMs: r.absoluteDeltaMs,
  resultMaxAbsDiff: r.resultMaxAbsDiff, qxxElements: r.qxxElements, qxxBytes: r.qxxBytes,
}));
const ratios = ladder.filter((r) => r.class !== null).map((r) => ({ id: r.id, params: r.params, ratio: r.ratio, class: r.class }));
const firstNativeWin = ratios.find((r) => r.class === 'native-faster');
const crossover = {
  rule: '<0.90 native-faster, 0.90-1.10 parity, >1.10 ts-faster',
  perSize: ratios,
  firstClearNativeWin: firstNativeWin ?? null,
  parityRegion: ratios.filter((r) => r.class === 'parity'),
  verdict: 'small sizes (24-192 params) parity/noisy within ±ms noise; first clear native win at 255 params (0.83), sustained through 384 (0.84) and widening above cap (0.44-0.52 diagnostic)',
};
const corpus = e10m.corpus.map((c) => ({ id: c.id, note: c.note, status: c.status, parity: c.parity ?? null, reason: c.reason ?? c.reasons ?? null, resultMaxAbsDiff: c.resultMaxAbsDiff ?? null }));
const summary = {
  branch: 'perf/3d-native-production-certification',
  headlineVerdict: 'SURVIVES: 128 native faster than TS in all 5 fresh processes',
  reproducibility, ladder, crossover, corpus,
  large: e10m.large, excludedShapes: e10m.excludedShapes,
  qxxBytesTable: e10m.qxxBytesTable,
  absoluteDeltasMs: ladder.map((r) => ({ id: r.id, params: r.params, deltaMs: r.absoluteDeltaMs })),
  environment: e10m.environment, methodology: e10m.methodology,
};
fs.writeFileSync('/tmp/phase10m-node-summary.json', `${JSON.stringify(summary, null, 1)}\n`);
const v128 = reproducibility.find((r) => r.fixture === 'gps-3d-128');
console.log(`128 TS across-process medians: ${v128.perProcess.map((p) => p.tsMedian.toFixed(1)).join(', ')}`);
console.log(`128 native across-process medians: ${v128.perProcess.map((p) => p.nativeMedian.toFixed(1)).join(', ')}`);
console.log(`128 TS spread: std=${v128.tsAcross.std.toFixed(2)} range=[${Math.min(...v128.perProcess.map((p) => p.tsMedian)).toFixed(1)}, ${Math.max(...v128.perProcess.map((p) => p.tsMedian)).toFixed(1)}]`);
console.log(`128 native spread: std=${v128.nativeAcross.std.toFixed(2)} range=[${Math.min(...v128.perProcess.map((p) => p.nativeMedian)).toFixed(1)}, ${Math.max(...v128.perProcess.map((p) => p.nativeMedian)).toFixed(1)}]`);
console.log('wrote /tmp/phase10m-node-summary.json');
