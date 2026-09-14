/**
 * Phase 12J.1 Batch B §9 — EVIDENCE ONLY.
 *
 * Independent H/E/N sign/axis check for S32 (P041 → SIXTWO). Reads the
 * ANTENNA DELTA H/E/N + APPROX POSITION XYZ from the corpus RINEX headers
 * (fail-closed SKIP when the corpus is absent), builds the local ENU basis
 * on WGS84, and verifies the processing correction
 *   Δ_mark = Δ_raw − (H_rov·Up_rov − H_base·Up_base)
 * matches the measured raw-minus-TBC residual in direction and magnitude.
 * A sign-flip control rules out coincidental ~2 m cancellation.
 * No vendor bytes committed. Never downloads anything.
 *
 * Usage: npx tsx scripts/gnss/gnss12j1AntennaHeightCheck.ts [--json]
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CORPUS_DIR } from './gnss12j1CorpusInventory';

const ROVER_OBS = '01241653.06o';
const BASE_OBS = 'p0411650_2.06o';
// Established Batch A evidence (pin + marker-ARP contract): raw RTKLIB
// broadcast vector and TBC B32 mark-to-mark vector for S32.
const RAW_D = [5822.2405, -5656.3389, -4844.809];
const TBC_D = [5822.646, -5654.885, -4846.085];

const A_WGS84 = 6378137.0;
const F_WGS84 = 1 / 298.257223563;
const E2 = F_WGS84 * (2 - F_WGS84);

type V3 = [number, number, number];
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a: V3, s: number): V3 => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = (a: V3): number => Math.sqrt(dot(a, a));

function ecefToGeodetic(xyz: V3): { lat: number; lon: number } {
  const [x, y, z] = xyz;
  const lon = Math.atan2(y, x);
  const p = Math.hypot(x, y);
  let lat = Math.atan2(z, p * (1 - E2));
  for (let i = 0; i < 5; i++) {
    const s = Math.sin(lat);
    const n = A_WGS84 / Math.sqrt(1 - E2 * s * s);
    lat = Math.atan2(z + E2 * n * s, p);
  }
  return { lat, lon };
}

function enuBasis(xyz: V3): { up: V3; east: V3; north: V3 } {
  const { lat, lon } = ecefToGeodetic(xyz);
  const cLat = Math.cos(lat);
  const sLat = Math.sin(lat);
  const cLon = Math.cos(lon);
  const sLon = Math.sin(lon);
  return {
    up: [cLat * cLon, cLat * sLon, sLat],
    east: [-sLon, cLon, 0],
    north: [-sLat * cLon, -sLat * sLon, cLat],
  };
}

function parseHeader(path: string): { approx: V3; hen: V3 } {
  const text = readFileSync(path, 'utf8');
  const lines = text.split('\n');
  let approx: V3 | null = null;
  let hen: V3 | null = null;
  for (const line of lines) {
    if (line.includes('APPROX POSITION XYZ')) {
      approx = [
        parseFloat(line.slice(0, 14)),
        parseFloat(line.slice(14, 28)),
        parseFloat(line.slice(28, 42)),
      ];
    } else if (line.includes('ANTENNA: DELTA H/E/N')) {
      hen = [
        parseFloat(line.slice(0, 14)),
        parseFloat(line.slice(14, 28)),
        parseFloat(line.slice(28, 42)),
      ];
    }
    if (line.includes('END OF HEADER')) break;
  }
  if (!approx || !hen || approx.some((v) => !isFinite(v)) || hen.some((v) => !isFinite(v))) {
    throw new Error(`unparseable header: ${path}`);
  }
  return { approx, hen };
}

function main(): void {
  const roverPath = join(CORPUS_DIR, ROVER_OBS);
  const basePath = join(CORPUS_DIR, BASE_OBS);
  if (!existsSync(roverPath) || !existsSync(basePath)) {
    console.log('SKIP: corpus absent (local RINEX pair not staged) — fail closed, no verdict.');
    process.exit(2);
  }
  const rover = parseHeader(roverPath);
  const base = parseHeader(basePath);
  const rovBasis = enuBasis(rover.approx);
  const basBasis = enuBasis(base.approx);
  // ARP = marker + H·Up + E·East + N·North (H>0 ⇒ ARP above marker).
  const rovArp = add(
    rover.approx,
    add(scale(rovBasis.up, rover.hen[0]), add(scale(rovBasis.east, rover.hen[1]), scale(rovBasis.north, rover.hen[2]))),
  );
  const basArp = add(
    base.approx,
    add(scale(basBasis.up, base.hen[0]), add(scale(basBasis.east, base.hen[1]), scale(basBasis.north, base.hen[2]))),
  );
  // Processing correction: raw connects base_ref → rover_phase; each end
  // drops H·Up (+ E/N terms) to reach its marker.
  const rovDrop = sub(rovArp, rover.approx);
  const basDrop = sub(basArp, base.approx);
  const correction = sub(rovDrop, basDrop);
  const residual = sub(RAW_D as V3, TBC_D as V3);
  const reduced = sub(residual, correction);
  const flipped = add(residual, correction); // sign-flip control
  const cosAngle = dot(correction, residual) / (norm(correction) * norm(residual));
  const json = process.argv.includes('--json');
  const out = {
    roverHen: rover.hen,
    baseHen: base.hen,
    roverUp: rovBasis.up.map((v) => +v.toFixed(6)),
    baseUp: basBasis.up.map((v) => +v.toFixed(6)),
    correction: correction.map((v) => +v.toFixed(4)),
    rawMinusTbc: residual.map((v) => +v.toFixed(4)),
    correctionNorm: +norm(correction).toFixed(4),
    residualNorm: +norm(residual).toFixed(4),
    cosAngle: +cosAngle.toFixed(6),
    reducedDelta: reduced.map((v) => +v.toFixed(4)),
    reducedNorm: +norm(reduced).toFixed(4),
    signFlipNorm: +norm(flipped).toFixed(4),
    verdict:
      cosAngle > 0.9999 && norm(reduced) < 0.05 && norm(flipped) > 3.9
        ? 'PASS: correction aligns with residual, reduces it to mm, flip worsens to ~4 m — sign/axis/FROM/TO confirmed, not coincidental.'
        : 'FAIL: correction does not explain the residual — do not apply.',
  };
  if (json) {
    console.log(JSON.stringify(out, null, 2));
  } else {
    console.log(`rover H/E/N ${rover.hen.join('/')}  base H/E/N ${base.hen.join('/')}`);
    console.log(`correction (H_rov·Up_rov − H_base·Up_base): [${correction.map((v) => v.toFixed(4)).join(', ')}]  |.|=${norm(correction).toFixed(4)} m`);
    console.log(`raw − TBC:                                [${residual.map((v) => v.toFixed(4)).join(', ')}]  |.|=${norm(residual).toFixed(4)} m`);
    console.log(`cos(correction, residual) = ${cosAngle.toFixed(6)}`);
    console.log(`reduced remainder: [${reduced.map((v) => v.toFixed(4)).join(', ')}]  |.|=${(norm(reduced) * 1000).toFixed(1)} mm`);
    console.log(`sign-flip control: |.|=${norm(flipped).toFixed(4)} m (must be ~4 m)`);
    console.log(`verdict: ${out.verdict}`);
  }
  if (!out.verdict.startsWith('PASS')) process.exit(1);
}

main();
