/**
 * Phase 12E0 — GVX evidence audit (manual-only, never CI).
 *
 * Reads ~/Downloads/webnet-gnss-12e/noaa/*.gvx|xml and prints per-file:
 * vectors/marks/graph components/frame/epoch range/covariance validity,
 * diagonal and correlation ranges, near-singular flags, parser timing,
 * and an a-priori spread audit. Run with:
 *
 *   npm run gnss:gvx-evidence
 *
 * The input directory is local-only and MUST NOT be required by any test.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { parseGvx } from '../../src/engine/gnssGvxImport';

const NOAA_DIR = `${process.env['HOME'] ?? ''}/Downloads/webnet-gnss-12e/noaa`;

const main = (): void => {
  if (!existsSync(NOAA_DIR)) {
    console.log(`gvx-evidence: input dir ${NOAA_DIR} not present; nothing to do.`);
    return;
  }
  const files = readdirSync(NOAA_DIR)
    .filter((file) => file.endsWith('.gvx') || (file.endsWith('.xml') && file !== 'schema_gvx.xml'))
    .sort();
  if (files.length === 0) {
    console.log('gvx-evidence: no .gvx/.xml inputs found.');
    return;
  }
  for (const file of files) {
    const text = readFileSync(join(NOAA_DIR, file), 'utf8');
    const t0 = performance.now();
    const parsed = parseGvx(text, file);
    const ms = performance.now() - t0;
    console.log(`== ${file} (${text.length} bytes, parse ${ms.toFixed(1)} ms)`);
    const errors = parsed.diagnostics.filter((d) => d.severity === 'error');
    if (!parsed.network || !parsed.source) {
      console.log(`   PARSE FAILED: ${errors.map((e) => `${e.code}: ${e.message}`).join(' | ')}`);
      continue;
    }
    const { network, source } = parsed;
    // Connected components over the mark graph (deterministic BFS).
    const adjacency = new Map<string, Set<string>>();
    network.baselines.forEach((baseline) => {
      if (!adjacency.has(baseline.from)) adjacency.set(baseline.from, new Set());
      if (!adjacency.has(baseline.to)) adjacency.set(baseline.to, new Set());
      adjacency.get(baseline.from)?.add(baseline.to);
      adjacency.get(baseline.to)?.add(baseline.from);
    });
    const seen = new Set<string>();
    let components = 0;
    for (const mark of Object.keys(network.stations).sort()) {
      if (seen.has(mark)) continue;
      components += 1;
      const queue = [mark];
      seen.add(mark);
      while (queue.length > 0) {
        const current = queue.pop() ?? '';
        adjacency.get(current)?.forEach((next) => {
          if (!seen.has(next)) {
            seen.add(next);
            queue.push(next);
          }
        });
      }
    }
    // Covariance audit: diagonal range, correlation range, near-singular
    // proxy (min Cholesky pivot relative to max variance).
    let minSd = Infinity;
    let maxSd = 0;
    let maxAbsCorr = 0;
    let worstPivotRatio = Infinity;
    let nearSingular = 0;
    network.baselines.forEach((baseline) => {
      const { xx, xy, xz, yy, yz, zz } = baseline.covariance;
      const sdx = Math.sqrt(xx);
      const sdy = Math.sqrt(yy);
      const sdz = Math.sqrt(zz);
      minSd = Math.min(minSd, sdx, sdy, sdz);
      maxSd = Math.max(maxSd, sdx, sdy, sdz);
      maxAbsCorr = Math.max(maxAbsCorr, Math.abs(xy / Math.sqrt(xx * yy)), Math.abs(xz / Math.sqrt(xx * zz)), Math.abs(yz / Math.sqrt(yy * zz)));
      const pivot2 = yy - (xy * xy) / xx;
      const l32 = (yz - (xy * xz) / xx) / pivot2;
      const pivot3 = zz - ((xz / xx) ** 2) * xx - l32 * l32 * pivot2;
      const ratio = Math.min(pivot2, pivot3) / Math.max(xx, yy, zz);
      worstPivotRatio = Math.min(worstPivotRatio, ratio);
      if (ratio < 1e-6) nearSingular += 1;
    });
    // Observation time range from raw text (evidence display only).
    const starts = [...text.matchAll(/<START>([^<]+)<\/START>/g)].map((m) => m[1] ?? '').sort();
    const ends = [...text.matchAll(/<END>([^<]+)<\/END>/g)].map((m) => m[1] ?? '').sort();
    console.log(`   vectors=${source.vectorCount} marks=${source.markCount} components=${components}`);
    console.log(`   pointFrame=${source.pointFrame.id}/${source.pointFrame.name}@${source.pointFrame.epoch ?? '?'} orbit=${source.orbitFrame ? `${source.orbitFrame.id}/${source.orbitFrame.name}` : 'none'}`);
    console.log(`   obsRange=${starts[0] ?? '?'}..${ends[ends.length - 1] ?? '?'} covValid=all errors=${errors.length}`);
    console.log(`   sdRange=[${minSd.toExponential(3)}, ${maxSd.toExponential(3)}] m max|corr|=${maxAbsCorr.toFixed(6)} worstPivotRatio=${worstPivotRatio.toExponential(3)} nearSingular=${nearSingular}`);
    console.log(`   aprioriMaxMisclosure=${source.aprioriMaxMisclosureM.toExponential(3)} m ignored=[${source.ignoredElements.join(', ')}]`);
  }
};

main();
