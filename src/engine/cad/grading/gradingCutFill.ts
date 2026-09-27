/**
 * Phase 20B — cut/fill classification and exact zero-station splitting.
 *
 * Numeric only (station/delta pairs); no imports from sibling grading
 * modules. Classification and dedupe use the shared Phase 18I `zeroDelta`
 * policy. `requireSourceCoverage` is the fail-closed BLOCK gate for cut/fill
 * mode: any null (outside target / target void) delta blocks calculation.
 */
import { zeroDelta } from '../surfaces/volume/zero';

export type CutFillClass = 'CUT' | 'FILL' | 'TIED';

interface StationDelta {
  station: number;
  delta: number;
}

/** Target above source → CUT, below → FILL, zeroDelta-equal → TIED. */
export const classifySourceDelta = (delta: number): CutFillClass => {
  if (Math.abs(delta) <= zeroDelta(delta, 0)) return 'TIED';
  return delta > 0 ? 'CUT' : 'FILL';
};

const isZeroDelta = (delta: number): boolean =>
  Math.abs(delta) <= zeroDelta(delta, 0);

const pairwise = (stations: number[], deltas: number[]): StationDelta[] => {
  const pairs: StationDelta[] = [];
  const count = Math.min(stations.length, deltas.length);
  for (let i = 0; i < count; i += 1) {
    pairs.push({ station: stations[i], delta: deltas[i] });
  }
  pairs.sort((a, b) => a.station - b.station);
  return pairs;
};

/** Linear zero crossing between two opposite-sign stations. */
const crossingStation = (a: StationDelta, b: StationDelta): number | null => {
  if (isZeroDelta(a.delta) || isZeroDelta(b.delta)) return null;
  if ((a.delta > 0) === (b.delta > 0)) return null;
  const t = a.delta / (a.delta - b.delta);
  return a.station + (b.station - a.station) * t;
};

/**
 * Station list with every exact linear zero crossing inserted, sorted
 * ascending and zeroDelta-deduped. Originals are preserved.
 */
export const splitStationsAtZeros = (
  stations: number[],
  deltas: number[],
): number[] => {
  const pairs = pairwise(stations, deltas);
  const candidates = pairs.map((pair) => pair.station);
  for (let i = 0; i + 1 < pairs.length; i += 1) {
    const crossing = crossingStation(pairs[i], pairs[i + 1]);
    if (crossing !== null) candidates.push(crossing);
  }
  candidates.sort((a, b) => a - b);
  const out: number[] = [];
  for (const station of candidates) {
    const prev = out[out.length - 1];
    if (prev === undefined || Math.abs(station - prev) > zeroDelta(station, prev)) {
      out.push(station);
    }
  }
  return out;
};

/**
 * True only when every station has a finite target delta. Any null (outside
 * the target or in a target void) or non-finite value BLOCKS cut/fill.
 */
export const requireSourceCoverage = (deltas: Array<number | null>): boolean =>
  deltas.length > 0 && deltas.every((delta) => delta !== null && Number.isFinite(delta));
