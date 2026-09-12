/**
 * Phase 12E — TBC GVX intake helper (manual-only, never CI).
 *
 * Given a .gvx path, prints inventory (vectors/stations/frame/epoch/
 * components/a-priori), covariance validation, whether explicit fixed
 * control is still required, and a canonical JSON summary.
 *
 * Adjustment runs ONLY when a control file is supplied separately via
 * --control <path> (JSON: { "fixed": ["STATION-ID", ...] }, fixed at
 * a-priori coordinates). Control is never auto-chosen: without
 * --control the script reports intake only and states that fixed
 * control is still required (endpoints import FREE).
 *
 * Usage:
 *   npx tsx scripts/gnss/gvxTbcIntake.ts <file.gvx> [--control control.json]
 *   npx tsx scripts/gnss/gvxTbcIntake.ts   (lists ~/Downloads/webnet-gnss-12e/tbc-intake/)
 *
 * The tbc-intake directory is local-only and may not exist; the script
 * exits 0 with guidance instead of failing (CI-safe by construction,
 * and never referenced from any test tier).
 */
import { existsSync, readFileSync } from 'node:fs';
import { readdirSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';
import { parseGvx } from '../../src/engine/gnssGvxImport';
import { runGnssBaselineAdjustment } from '../../src/engine/gnssBaselineAdjust';
import type { StationMap } from '../../src/types';

const INTAKE_DIR = `${process.env['HOME'] ?? ''}/Downloads/webnet-gnss-12e/tbc-intake`;

interface ControlFile {
  fixed?: string[];
}

const countComponents = (baselines: { from: string; to: string }[], marks: string[]): number => {
  const adjacency = new Map<string, Set<string>>();
  baselines.forEach((baseline) => {
    if (!adjacency.has(baseline.from)) adjacency.set(baseline.from, new Set());
    if (!adjacency.has(baseline.to)) adjacency.set(baseline.to, new Set());
    adjacency.get(baseline.from)?.add(baseline.to);
    adjacency.get(baseline.to)?.add(baseline.from);
  });
  const seen = new Set<string>();
  let components = 0;
  for (const mark of [...marks].sort()) {
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
  return components;
};

const intakeOne = (path: string, control: ControlFile | null): void => {
  const text = readFileSync(path, 'utf8');
  const parsed = parseGvx(text, basename(path));
  const errors = parsed.diagnostics.filter((d) => d.severity === 'error');
  const warnings = parsed.diagnostics.filter((d) => d.severity === 'warning');
  if (!parsed.network || !parsed.source) {
    console.log(`== ${path}: PARSE FAILED`);
    errors.forEach((e) => console.log(`   error ${e.code}: ${e.message}`));
    console.log(JSON.stringify({ file: basename(path), ok: false, errors: errors.map((e) => e.code) }));
    return;
  }
  const { network, source } = parsed;
  const marks = Object.keys(network.stations).sort();
  const components = countComponents(network.baselines, marks);
  const covValid = errors.filter((e) => e.code === 'GNSS_GVX_BAD_COVARIANCE');
  console.log(`== ${path} (${text.length} bytes)`);
  console.log(`   vectors=${source.vectorCount} marks=${source.markCount} components=${components}`);
  console.log(`   pointFrame=${source.pointFrame.id}/${source.pointFrame.name}@${source.pointFrame.epoch ?? '?'}` +
    ` orbit=${source.orbitFrame ? `${source.orbitFrame.id}/${source.orbitFrame.name}` : 'none'}`);
  console.log(`   covValid=${covValid.length === 0 ? `all(${source.vectorCount}/${source.vectorCount})` : 'FAILED'} errors=${errors.length} warnings=${warnings.length}`);
  console.log(`   aprioriMaxMisclosure=${source.aprioriMaxMisclosureM.toExponential(3)} m`);
  console.log(`   ignored=[${source.ignoredElements.join(', ')}]`);
  warnings.forEach((w) => console.log(`   warn ${w.code}: ${w.message}`));

  const fixedIds = control?.fixed ?? [];
  if (fixedIds.length === 0) {
    console.log('   control: NONE — endpoints are FREE; explicit fixed control still REQUIRED before adjustment.');
  } else {
    const unknown = fixedIds.filter((id) => !network.stations[id]);
    if (unknown.length > 0) {
      console.log(`   control: REJECTED — unknown station(s): ${unknown.join(', ')}; adjustment skipped.`);
    } else {
      const stations: StationMap = {};
      Object.entries(network.stations).forEach(([id, station]) => {
        const isDatum = fixedIds.includes(id);
        stations[id] = { ...station!, fixed: isDatum, fixedX: isDatum, fixedY: isDatum, fixedH: isDatum };
      });
      const result = (() => {
        try {
          return runGnssBaselineAdjustment({ stations, baselines: network.baselines });
        } catch (error) {
          console.log(`   adjustment: NOT RUN — ${error instanceof Error ? error.message : String(error)}`);
          return null;
        }
      })();
      if (result) {
        console.log(`   control: fixed=[${[...fixedIds].sort().join(', ')}] (operator-supplied, never auto-chosen)`);
        console.log(`   adjustment: route=${result.routeProvenance} converged=${result.converged} dof=${result.dof} varianceFactor=${result.varianceFactor.toExponential(6)} maxCorrection=${result.maxCorrectionM.toExponential(3)} m`);
      }
    }
  }
  console.log(JSON.stringify({
    file: basename(path),
    ok: true,
    vectors: source.vectorCount,
    marks: source.markCount,
    components,
    pointFrame: source.pointFrame,
    orbitFrame: source.orbitFrame,
    covValid: covValid.length === 0,
    aprioriMaxMisclosureM: source.aprioriMaxMisclosureM,
    controlRequired: fixedIds.length === 0,
    controlFixed: [...fixedIds].sort(),
  }));
};

const main = (): void => {
  const args = process.argv.slice(2);
  const controlIndex = args.indexOf('--control');
  let control: ControlFile | null = null;
  if (controlIndex !== -1) {
    const controlPath = args[controlIndex + 1];
    if (!controlPath || !existsSync(controlPath)) {
      console.log(`gvx-tbc-intake: --control path '${controlPath ?? ''}' not found; adjustment skipped (control never auto-chosen).`);
      process.exit(0);
    }
    control = JSON.parse(readFileSync(controlPath, 'utf8')) as ControlFile;
  }
  const inputs = args.filter((arg, index) => arg !== '--control' && args[index - 1] !== '--control' && !arg.startsWith('--'));
  if (inputs.length === 0) {
    if (!existsSync(INTAKE_DIR)) {
      console.log(`gvx-tbc-intake: ${INTAKE_DIR} not present; drop TBC .gvx files there or pass a path explicitly. Nothing to do.`);
      return;
    }
    const files = readdirSync(INTAKE_DIR)
      .filter((file) => file.endsWith('.gvx') || file.endsWith('.xml'))
      .sort()
      .filter((file) => {
        try {
          return statSync(join(INTAKE_DIR, file)).isFile();
        } catch {
          return false;
        }
      });
    if (files.length === 0) {
      console.log(`gvx-tbc-intake: no .gvx/.xml inputs in ${INTAKE_DIR}; nothing to do.`);
      return;
    }
    files.forEach((file) => intakeOne(join(INTAKE_DIR, file), control));
    return;
  }
  inputs.forEach((input) => {
    if (!existsSync(input)) {
      console.log(`gvx-tbc-intake: '${input}' not found; skipped.`);
      return;
    }
    intakeOne(input, control);
  });
};

main();
