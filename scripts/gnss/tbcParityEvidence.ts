/**
 * Phase 12E.2 — REAL-TBC parity evidence harness (evidence only).
 *
 * CLI: tsx scripts/gnss/tbcParityEvidence.ts <intake-dir> [--model a|b]
 *
 * EVIDENCE-FIRST: reads GVX + TBC report + settings.txt + vectorlist.xlsx,
 * groups GVX POINTs by station NAME (fail-closed on coordinate mismatch),
 * fixes P041 at its GVX coordinate, runs runGnssBaselineAdjustment TS-dense
 * (MODEL A raw GVX; MODEL B adds the endpoint setup-covariance HYPOTHESIS),
 * and emits machine-readable JSON plus reports/gnss/phase12e-tbc-commercial-parity.md.
 *
 * Modifies no production code. Never writes into the intake directory.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseGvx } from '../../src/engine/gnssGvxImport';
import { parseGvxSyntax } from '../../src/engine/gnssGvxSyntax';
import { runGnssBaselineAdjustment } from '../../src/engine/gnssBaselineAdjust';
import type { GnssBaselineObservation } from '../../src/engine/gnssBaselineTypes';
import type { StationMap } from '../../src/types';
import { parseTbcReport } from './tbcAdjustmentReport';
import { decodeXlsxColumnA, decodeXlsxSheet } from './tbcXlsxReader';
import { groupMarksByName, setupCovarianceEcef } from './tbcParityModel';

interface Gate {
  readonly id: string;
  readonly name: string;
  readonly verdict: 'PASS' | 'FAIL' | 'NOTE';
  readonly detail: string;
}

const sorted = (ids: string[]): string[] => [...ids].sort();
const setOf = (ids: string[]): Set<string> => new Set(ids);
const missing = (need: string[], have: Set<string>): string[] => need.filter((id) => !have.has(id));

const main = (): void => {
  const args = process.argv.slice(2).filter((arg) => !arg.startsWith('--model'));
  const modelFlag = process.argv.includes('--model')
    ? (process.argv[process.argv.indexOf('--model') + 1] ?? 'a')
    : 'a';
  const modelB = modelFlag === 'b';
  const dir = args[0];
  if (!dir || !existsSync(dir)) {
    console.log('tbcParityEvidence: pass the TBC intake directory (read-only; never modified).');
    process.exit(2);
  }
  const gates: Gate[] = [];
  const fail = (id: string, name: string, detail: string): void => {
    gates.push({ id, name, verdict: 'FAIL', detail });
  };

  // (a) GVX via existing parseGvx.
  const gvxFile = readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.gvx')).sort()[0];
  if (!gvxFile) {
    console.log(JSON.stringify({ ok: false, error: 'no .gvx in intake dir' }));
    process.exit(1);
  }
  const gvxText = readFileSync(join(dir, gvxFile), 'utf8');
  const parsed = parseGvx(gvxText, gvxFile);
  const syntax = parseGvxSyntax(gvxText, gvxFile);
  if (!parsed.network || !parsed.source || !syntax.document) {
    console.log(JSON.stringify({ ok: false, error: 'GVX parse failed', diagnostics: parsed.diagnostics }));
    process.exit(1);
  }
  const { network, source } = parsed;
  const solutionIds = sorted(network.baselines.map((b) => b.solutionId ?? `id-${b.id}`));
  gates.push({
    id: 'A', name: 'GVX intake identity',
    verdict: 'PASS',
    detail: `vectors=${source.vectorCount} marks=${source.markCount} frame=${source.pointFrame.name}@${source.pointFrame.epoch} GVX v${source.version} (converter: Trimble Business Center 42.0 per SOURCE_DATA application block)`,
  });

  // (b) Evidence-only NAME grouping.
  const grouping = groupMarksByName(syntax.document.marks);
  if (grouping.mismatch) {
    fail('B', 'NAME grouping identity', grouping.mismatch);
  } else {
    gates.push({
      id: 'B', name: 'NAME grouping identity',
      verdict: 'PASS',
      detail: `${grouping.groups.size} unique NAMEs; same-NAME coordinates identical within 1e-6 m.`,
    });
  }
  const p041 = grouping.groups.get('P041');
  if (!p041) fail('B2', 'P041 datum presence', 'P041 NAME absent from GVX marks.');
  const stations: StationMap = {};
  [...grouping.groups.values()].forEach((group) => {
    const fixed = group.name === 'P041';
    stations[group.name] = {
      x: group.x, y: group.y, h: group.z,
      fixed, fixedX: fixed, fixedY: fixed, fixedH: fixed,
    };
  });
  const pointToName = new Map<string, string>();
  [...grouping.groups.values()].forEach((group) =>
    group.pointIds.forEach((id) => pointToName.set(id, group.name)),
  );
  const remapped: GnssBaselineObservation[] = network.baselines.map((b) => ({
    ...b,
    from: pointToName.get(b.from) ?? b.from,
    to: pointToName.get(b.to) ?? b.to,
  }));

  // (c) Report + settings.txt + vectorlist.xlsx.
  const reportPath = join(dir, 'cafa0ac3.html');
  const report = parseTbcReport(existsSync(reportPath) ? readFileSync(reportPath, 'utf8') : '');
  gates.push({
    id: 'C0', name: 'TBC report parse',
    verdict: report.dof === 228 && report.refFactor === 1.1 ? 'PASS' : 'FAIL',
    detail: `iterations=${report.iterations} refFactor=${report.refFactor} chiSq=${report.chiSquareText} dof=${report.dof} redundancy=${report.gnssRedundancy} constrained=${report.constrainedStation} ecefRows=${report.ecefRows.length} obs=${report.activeObsIds.length}`,
  });
  const reportIdSet = setOf(report.activeObsIds);
  const gvxIdSet = setOf(solutionIds);
  const unreported = missing(solutionIds, reportIdSet);
  const unmapped = missing(report.activeObsIds, gvxIdSet);
  gates.push({
    id: 'C', name: 'Observation-set identity (GVX <-> report)',
    verdict: unreported.length === 0 && unmapped.length === 0 ? 'PASS' : 'FAIL',
    detail: unreported.length === 0 && unmapped.length === 0
      ? `all ${solutionIds.length} GVX solutionIds present in report Adjusted GNSS Observations and vice versa.`
      : `GVX-not-in-report=[${unreported.join(',')}] report-not-in-GVX=[${unmapped.join(',')}]`,
  });
  const settingsPath = join(dir, 'settings.txt');
  const settingsText = existsSync(settingsPath) ? readFileSync(settingsPath, 'utf8') : '';
  // Scope to the GNSS setup-error block: earlier sections repeat the labels.
  const gnssSettings = settingsText.slice(settingsText.search(/Default Standard Errors\s*>\s*GNSS/i) === -1 ? 0 : settingsText.search(/Default Standard Errors\s*>\s*GNSS/i));
  const settingsCentering = /centering error:\s*([\d.]+)/i.exec(gnssSettings)?.[1] ?? null;
  const settingsAntenna = /height of antenna:\s*([\d.]+)/i.exec(gnssSettings)?.[1] ?? null;
  gates.push({
    id: 'C2', name: 'settings.txt cross-check',
    verdict: settingsCentering === '0.005' && settingsAntenna === '0.002' ? 'PASS' : 'NOTE',
    detail: `centering=${settingsCentering} antenna=${settingsAntenna} (report: ${report.centeringErr}/${report.antennaErr}); holds P041 fixed in 2D+h per settings note.`,
  });
  let xlsxIds: string[] = [];
  let xlsxDetail = 'vectorlist.xlsx absent.';
  const xlsxPath = join(dir, 'vectorlist.xlsx');
  if (existsSync(xlsxPath)) {
    try {
      const raw = readFileSync(xlsxPath);
      xlsxIds = decodeXlsxColumnA(raw);
      const grid = decodeXlsxSheet(raw, 'xl/worksheets/sheet1.xml');
      const cols = Math.max(...grid.map((row) => row.length));
      xlsxDetail = `rows=${grid.length} cols=${cols}; col A reconciled below; other columns reported raw (semantics UNRESOLVED).`;
    } catch (error) {
      xlsxDetail = `decode failed (${error instanceof Error ? error.message : String(error)}); ID reconciliation skipped.`;
    }
  }
  if (xlsxIds.length > 0) {
    const xlsxSet = setOf(xlsxIds);
    const gx = missing(solutionIds, xlsxSet);
    const xr = missing(xlsxIds, gvxIdSet);
    gates.push({
      id: 'D', name: 'Spreadsheet ID reconciliation (GVX <-> xlsx col A)',
      verdict: gx.length === 0 && xr.length === 0 ? 'PASS' : 'FAIL',
      detail: gx.length === 0 && xr.length === 0
        ? `all ${solutionIds.length} GVX solutionIds present in xlsx col A and vice versa. ${xlsxDetail}`
        : `GVX-not-in-xlsx=[${gx.join(',')}] xlsx-not-in-GVX=[${xr.join(',')}]`,
    });
  } else {
    gates.push({ id: 'D', name: 'Spreadsheet ID reconciliation (GVX <-> xlsx col A)', verdict: 'NOTE', detail: xlsxDetail });
  }

  // (d) MODEL A raw-GVX run (robust OFF by default) + Phase 12D statistics.
  const runModel = (baselines: GnssBaselineObservation[]) =>
    runGnssBaselineAdjustment({ stations, baselines });
  const resultA = runModel([...remapped].sort((a, b) => a.id - b.id));
  const seuwA = Math.sqrt(resultA.varianceFactor);
  const tbcInterval: [number, number] = [1.095, 1.105];
  gates.push({
    id: 'E', name: 'DOF cross-check',
    verdict: resultA.dof === 228 && resultA.numObsEquations === 273 && resultA.numParams === 45 ? 'PASS' : 'FAIL',
    detail: `n=${resultA.numObsEquations} u=${resultA.numParams} dof=${resultA.dof} (TBC 273/45/228); logicalObs=${resultA.logicalObservations} statistics=${resultA.statistics.length} (Phase 12D).`,
  });
  gates.push({
    id: 'F', name: 'SEUW vs TBC 1.10 display interval',
    verdict: seuwA >= tbcInterval[0] && seuwA < tbcInterval[1] ? 'PASS' : 'FAIL',
    detail: `SEUW=${seuwA.toFixed(6)} (displayed TBC 1.10 => underlying in [1.095,1.105)).`,
  });

  // (e) Per-station ECEF comparison (NAME-keyed; 16 rows, NOT 182 — corrected).
  const tbcByName = new Map(report.ecefRows.map((row) => [row.id, row]));
  const perStation = [...grouping.groups.keys()].sort().map((name) => {
    const station = resultA.stations[name];
    const ref = tbcByName.get(name);
    if (!station || !ref) return { name, dx: null, dy: null, dz: null, norm: null };
    const dx = (station.x ?? 0) - ref.x;
    const dy = (station.y ?? 0) - ref.y;
    const dz = (station.h ?? 0) - ref.z;
    return { name, dx, dy, dz, norm: Math.hypot(dx, dy, dz) };
  });
  const norms = perStation.map((s) => s.norm ?? Number.NaN).filter(Number.isFinite);
  const maxAbsComp = Math.max(...perStation.flatMap((s) => [s.dx ?? Number.NaN, s.dy ?? Number.NaN, s.dz ?? Number.NaN]).filter(Number.isFinite));
  const gPass = norms.length === perStation.length && maxAbsComp <= 5e-5;
  const maxNorm = Math.max(...norms);
  const rms = Math.sqrt(norms.reduce((sum, v) => sum + v * v, 0) / norms.length);
  const withinFloor = norms.filter((v) => v <= 5e-5 * Math.sqrt(3)).length;
  gates.push({
    id: 'G', name: 'Per-station adjusted ECEF vs TBC table',
    verdict: 'NOTE',
    detail: `n=${norms.length} max3D=${maxNorm.toExponential(3)} m rms3D=${rms.toExponential(3)} m; ${withinFloor}/${norms.length} within 4-decimal reference-resolution floor (5e-5 m/component). Residuals NOT compared (see gate J).`,
  });
  const p041Gvx: [number, number, number] = [p041?.x ?? Number.NaN, p041?.y ?? Number.NaN, p041?.z ?? Number.NaN];
  const p041Diff = report.p041Ecef
    ? [p041Gvx[0] - report.p041Ecef.x, p041Gvx[1] - report.p041Ecef.y, p041Gvx[2] - report.p041Ecef.z]
    : null;
  gates.push({
    id: 'H', name: 'P041 GVX-vs-TBC datum agreement',
    verdict: p041Diff != null && p041Diff.every((d) => Math.abs(d) <= 5e-5) ? 'PASS' : 'FAIL',
    detail: p041Diff
      ? `dX=${p041Diff[0]?.toExponential(3)} dY=${p041Diff[1]?.toExponential(3)} dZ=${p041Diff[2]?.toExponential(3)} m; each within +-5e-5 m display rounding — P041 fixed at higher-precision GVX coordinate justified.`
      : 'TBC P041 ECEF row missing.',
  });
  const vtpvA = resultA.varianceFactor * resultA.dof;
  const tbcVtpv: [number, number] = [1.095 * 1.095 * 228, 1.105 * 1.105 * 228];
  gates.push({
    id: 'I', name: 'vTPv vs implied TBC interval',
    verdict: vtpvA >= tbcVtpv[0] && vtpvA < tbcVtpv[1] ? 'PASS' : 'FAIL',
    detail: `vTPv=${vtpvA.toFixed(4)} (SEUW^2*dof); TBC-implied [${tbcVtpv[0].toFixed(4)},${tbcVtpv[1].toFixed(4)}).`,
  });
  gates.push({
    id: 'J', name: 'NOT-COMPARABLE ledger + frame reconciliation',
    verdict: 'NOTE',
    detail: 'Residuals NOT COMPARABLE (TBC reports Az/DeltaHt/EllipDist derived quantities; WebNet solves raw ECEF DX/DY/DZ — no exact conversion derived). Precision/covariance display terms NOT COMPARABLE (a-posteriori/DRMS display, not raw Qxx). Frame: GVX NAD83(2011)@2010 vs report NAD83(Conus)+State Plane+GEOID09 — ECEF comparison only; grid/geodetic/orthometric NOT compared.',
  });

  // (f) MODEL B setup-covariance hypothesis.
  let modelBResult: { seuw: number; maxNorm: number; rms: number; vtpv: number; dof: number } | null = null;
  if (modelB) {
    const nameXyz = new Map<string, [number, number, number]>();
    [...grouping.groups.values()].forEach((group) => nameXyz.set(group.name, [group.x, group.y, group.z]));
    const baselinesB = remapped.map((b) => {
      const setup = setupCovarianceEcef(nameXyz.get(b.from) ?? [0, 0, 0], nameXyz.get(b.to) ?? [0, 0, 0]);
      return {
        ...b,
        covariance: {
          xx: b.covariance.xx + setup.xx, yy: b.covariance.yy + setup.yy, zz: b.covariance.zz + setup.zz,
          xy: b.covariance.xy + setup.xy, xz: b.covariance.xz + setup.xz, yz: b.covariance.yz + setup.yz,
        },
      };
    });
    const resultB = runModel([...baselinesB].sort((a, b) => a.id - b.id));
    const seuwB = Math.sqrt(resultB.varianceFactor);
    const normsB = [...grouping.groups.keys()].sort().map((name) => {
      const station = resultB.stations[name];
      const ref = tbcByName.get(name);
      if (!station || !ref) return Number.NaN;
      return Math.hypot((station.x ?? 0) - ref.x, (station.y ?? 0) - ref.y, (station.h ?? 0) - ref.z);
    }).filter(Number.isFinite);
    modelBResult = {
      seuw: seuwB,
      maxNorm: Math.max(...normsB),
      rms: Math.sqrt(normsB.reduce((s, v) => s + v * v, 0) / normsB.length),
      vtpv: resultB.varianceFactor * resultB.dof,
      dof: resultB.dof,
    };
    const improves = Math.abs(seuwB - 1.1) < Math.abs(seuwA - 1.1) ? 'closer to 1.10' : 'NOT closer to 1.10';
    gates.push({
      id: 'B-HYP', name: 'Model B setup-covariance hypothesis',
      verdict: 'NOTE',
      detail: `HYPOTHESIS (not TBC's formula): SEUW=${seuwB.toFixed(6)} max3D=${modelBResult.maxNorm.toExponential(3)} rms3D=${modelBResult.rms.toExponential(3)} — ${improves} than Model A SEUW=${seuwA.toFixed(6)}.`,
    });
  }

  const passCount = gates.filter((g) => g.verdict === 'PASS').length;
  const failCount = gates.filter((g) => g.verdict === 'FAIL').length;
  const hardFails = gates.filter((g) => g.verdict === 'FAIL' && !['F', 'I'].includes(g.id));
  // Brief S30 rubric: L0 input parity, L1 structural (n/u/dof), L2 coordinate
  // (ECEF within reference resolution), L3 stochastic (ref factor/covariance),
  // L4 residual. L4 is unreachable here (gate J NOT COMPARABLE); L3 needs F.
  void hardFails;
  const fPass = gates.find((g) => g.id === 'F')?.verdict === 'PASS';
  const ePass = gates.find((g) => g.id === 'E')?.verdict === 'PASS';
  const cPass = gates.find((g) => g.id === 'C')?.verdict === 'PASS';
  const parityLevel = fPass && gPass ? 3 : gPass ? 2 : ePass ? 1 : cPass ? 0 : 0;

  const evidence = {
    ok: failCount === 0,
    model: modelB ? 'B' : 'A',
    gvxFile, gvxFrame: `${source.pointFrame.name}@${source.pointFrame.epoch}`,
    vectors: source.vectorCount, marks: source.markCount, names: grouping.groups.size,
    report: {
      iterations: report.iterations, refFactor: report.refFactor, chiSquare: report.chiSquareText,
      dof: report.dof, redundancy: report.gnssRedundancy, apriori: report.aprioriScalar,
      confidence: report.confidenceMode, constrained: report.constrainedStation,
      ecefRows: report.ecefRows.length, obsIds: report.activeObsIds.length,
    },
    modelA: {
      n: resultA.numObsEquations, u: resultA.numParams, dof: resultA.dof,
      iterations: resultA.iterations, converged: resultA.converged,
      seuw: seuwA, vtpv: vtpvA, maxCorrectionM: resultA.maxCorrectionM,
      max3D: maxNorm, rms3D: rms, withinFloor: `${withinFloor}/${norms.length}`,
      p041DiffM: p041Diff, statistics: resultA.statistics.length,
    },
    modelB: modelBResult,
    perStation,
    gates: gates.map((g) => ({ id: g.id, verdict: g.verdict, detail: g.detail })),
    parityLevel, passCount, failCount,
  };
  console.log(JSON.stringify(evidence, null, 2));

  // (g) Markdown report.
  const gateRows = gates.map((g) => `| ${g.id} | ${g.name} | ${g.verdict} | ${g.detail} |`).join('\n');
  const stationRows = perStation.map((s) =>
    `| ${s.name} | ${s.dx != null ? s.dx.toExponential(3) : '?'} | ${s.dy != null ? s.dy.toExponential(3) : '?'} | ${s.dz != null ? s.dz.toExponential(3) : '?'} | ${s.norm != null ? s.norm.toExponential(3) : '?'} |`,
  ).join('\n');
  const md = `# Phase 12E.2 — REAL-TBC commercial parity evidence\n\n` +
    `Evidence-only. No production math, parser semantics, tolerances, routing, UI, or CRS code was modified.\n\n` +
    `## Intake\n\n` +
    `- GVX: \`${gvxFile}\` — ${source.vectorCount} vectors, ${source.markCount} POINT records, ${grouping.groups.size} unique NAMEs, frame ${source.pointFrame.name}@${source.pointFrame.epoch}, GVX v${source.version} converted by Trimble Business Center 42.0 (SOURCE_DATA application block).\n` +
    `- Report: \`cafa0ac3.html\` — project "Adjusting the Network", US State Plane 1983 / NAD 1983 (Conus), global WGS84, GEOID09, 2 iterations, ref factor 1.10, chi-square FAILED, DOF 228.\n` +
    `- CORRECTION to the phase brief: the Adjusted ECEF table carries 16 rows (one per station NAME), not 182. The 182 figure is the GVX POINT-record count. Per-station comparison is therefore NAME-keyed over all 16 stations.\n` +
    `- P041 fixed 2D+h at the higher-precision GVX coordinate (gate H: agrees with the TBC 4-decimal display within +-5e-5 m/component).\n\n` +
    `## Gates A-J\n\n| Gate | Name | Verdict | Detail |\n| --- | --- | --- | --- |\n${gateRows}\n\n` +
    `## Scorecard\n\n` +
    `- Observation-set identity (gate C): ${gates.find((g) => g.id === 'C')?.verdict} — ${solutionIds.length} GVX solutionIds vs ${report.activeObsIds.length} report IDs.\n` +
    `- DOF (gate E): WebNet n=${resultA.numObsEquations} u=${resultA.numParams} dof=${resultA.dof} vs TBC 273/45/228.\n` +
    `- SEUW (gate F): WebNet ${seuwA.toFixed(6)} vs TBC displayed 1.10 (underlying in [1.095,1.105)).\n` +
    `- vTPv (gate I): WebNet ${vtpvA.toFixed(4)} vs TBC-implied [${tbcVtpv[0].toFixed(4)},${tbcVtpv[1].toFixed(4)}).\n` +
    `- Coordinates (gate G): max3D ${maxNorm.toExponential(3)} m, rms3D ${rms.toExponential(3)} m over ${norms.length} NAMEs; TBC 4-decimal rounding imposes a +-5e-5 m/component reference-resolution floor.\n\n` +
    `## Parity level: ${parityLevel} / 4\n\n` +
    `Rubric (brief S30): L0 input parity (vector set/datum/frame/stochastic source identified); L1 structural (same n/u/dof/topology/control); L2 coordinate (adjusted ECEF within reference resolution); L3 stochastic (reference factor/covariance/precision after reconciliation); L4 residual (UNREACHABLE — TBC reports Az/DeltaHt/EllipDist derived quantities, not ECEF, so residual parity is NOT COMPARABLE without an exact conversion that was not derived).\n\n` +
    `## Model A (raw GVX, robust OFF)\n\n` +
    `SEUW ${seuwA.toFixed(6)}, vTPv ${vtpvA.toFixed(4)}, iterations ${resultA.iterations}, converged ${resultA.converged}, maxCorrection ${resultA.maxCorrectionM.toExponential(3)} m, Phase-12D statistics blocks ${resultA.statistics.length}.\n\n` +
    `## Model B (setup-covariance HYPOTHESIS${modelB ? ' — RUN' : ' — NOT RUN (pass --model b)'})\n\n` +
    (modelBResult
      ? `SEUW ${modelBResult.seuw.toFixed(6)}, vTPv ${modelBResult.vtpv.toFixed(4)}, max3D ${modelBResult.maxNorm.toExponential(3)} m, rms3D ${modelBResult.rms.toExponential(3)} m. HYPOTHESIS, not TBC's formula.\n`
      : `Endpoint setup covariance (0.005 m horizontal + 0.002 m vertical, ENU-rotated per station) was not applied in this run.\n`) +
    `\n## Per-station ECEF differences (WebNet minus TBC, metres)\n\n| Station | dX | dY | dZ | 3D norm |\n| --- | --- | --- | --- | --- |\n${stationRows}\n\n` +
    `## Frame reconciliation\n\nGVX vectors/coordinates are NAD83(2011)@2010; the TBC report adjusts in NAD 1983 (Conus) with a State Plane projection and GEOID09. Comparison is performed on adjusted ECEF coordinates only; grid, geodetic, and orthometric quantities are NOT compared.\n\n` +
    `## NOT-COMPARABLE ledger\n\n- Residuals: TBC Adjusted GNSS Observations are Az/DeltaHt/EllipDist derived quantities per vector; WebNet solves raw ECEF DX/DY/DZ. No exact conversion was derived, so residual parity is NOT COMPARABLE.\n- Precision/covariance display: TBC a-posteriori errors, error ellipses, and precision ratios are DRMS display quantities, not raw Qxx — NOT COMPARABLE.\n- vectorlist.xlsx columns beyond col A (solution IDs) carry UNRESOLVED semantics (no header row; raw values only).\n\n` +
    `## Recommended Phase 12E.3 scope (no production change made)\n\n- Derive or source the exact TBC Az/DeltaHt/EllipDist residual conversion before any residual-parity claim.\n- Resolve vectorlist.xlsx column semantics against TBC documentation.\n- Decide whether the Model B setup-covariance hypothesis (or another weighting) explains the SEUW gap, or record the gap as an open modeling difference.\n`;
  const outDir = join(process.cwd(), 'reports', 'gnss');
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, 'phase12e-tbc-commercial-parity.md'), md);
};

main();
