/**
 * Phase 18U — pure scalar-range polygon clipper (no I/O, no UI).
 *
 * Sutherland–Hodgman against the two value half-planes value >= lower and
 * value <= upper. Crossing parameter t = (threshold − valueA)/(valueB − valueA)
 * interpolates x, y, value, and every key of the optional `extra` record.
 *
 * Machine-scale guards:
 * - |denom| < 1e-300 on a crossing edge: treated as no crossing (the edge is
 *   value-parallel at machine scale; inside/outside tests decide membership).
 * - Consecutive output points within 1e-12 (Euclidean) are deduped, including
 *   the closing wraparound point.
 */

export interface ScalarVertex {
  x: number;
  y: number;
  value: number;
  extra?: Record<string, number>;
}

export interface AnalysisBand {
  id: string;
  lower: number;
  upper: number;
}

const DEDUPE_TOL = 1e-12;
const DENOM_GUARD = 1e-300;

const lerpVertex = (a: ScalarVertex, b: ScalarVertex, t: number): ScalarVertex => {
  const out: ScalarVertex = {
    x: a.x + t * (b.x - a.x),
    y: a.y + t * (b.y - a.y),
    value: a.value + t * (b.value - a.value),
  };
  if (a.extra !== undefined || b.extra !== undefined) {
    const keys = new Set([...Object.keys(a.extra ?? {}), ...Object.keys(b.extra ?? {})]);
    const extra: Record<string, number> = {};
    for (const key of keys) {
      const av = a.extra?.[key] ?? 0;
      const bv = b.extra?.[key] ?? 0;
      extra[key] = av + t * (bv - av);
    }
    out.extra = extra;
  }
  return out;
};

const clipHalfPlane = (
  poly: ScalarVertex[],
  keep: (_value: number) => boolean,
  threshold: number,
): ScalarVertex[] => {
  if (poly.length === 0) return [];
  const out: ScalarVertex[] = [];
  let s = poly[poly.length - 1]!;
  let sIn = keep(s.value);
  for (const e of poly) {
    const eIn = keep(e.value);
    if (eIn) {
      if (!sIn) {
        const denom = e.value - s.value;
        if (Math.abs(denom) >= DENOM_GUARD) {
          out.push(lerpVertex(s, e, (threshold - s.value) / denom));
        }
      }
      out.push(e);
    } else if (sIn) {
      const denom = e.value - s.value;
      if (Math.abs(denom) >= DENOM_GUARD) {
        out.push(lerpVertex(s, e, (threshold - s.value) / denom));
      }
    }
    s = e;
    sIn = eIn;
  }
  return out;
};

const dedupe = (poly: ScalarVertex[]): ScalarVertex[] => {
  const out: ScalarVertex[] = [];
  for (const p of poly) {
    const prev = out[out.length - 1];
    if (prev !== undefined && Math.hypot(p.x - prev.x, p.y - prev.y) <= DEDUPE_TOL) continue;
    out.push(p);
  }
  if (out.length > 1) {
    const first = out[0]!;
    const last = out[out.length - 1]!;
    if (Math.hypot(first.x - last.x, first.y - last.y) <= DEDUPE_TOL) out.pop();
  }
  return out;
};

/** Clip a value-tagged polygon to the closed range [lower, upper]. */
export const clipScalarPolygon = (
  poly: ScalarVertex[],
  lower: number,
  upper: number,
): ScalarVertex[] => {
  if (poly.length === 0) return [];
  const lo = clipHalfPlane(poly, (value) => value >= lower, lower);
  const hi = clipHalfPlane(lo, (value) => value <= upper, upper);
  return dedupe(hi);
};

/**
 * Band lookup over bands sorted ascending by lower: [lower, upper) for every
 * band except the LAST, which is [lower, upper] (inclusive of max).
 */
export const classifyAnalysisValue = (
  value: number,
  bands: readonly AnalysisBand[],
): string | null => {
  for (let i = 0; i < bands.length; i += 1) {
    const band = bands[i]!;
    const isLast = i === bands.length - 1;
    if (value >= band.lower && (value < band.upper || (isLast && value <= band.upper))) {
      return band.id;
    }
  }
  return null;
};

export interface ValidatedAnalysisBands {
  ok: boolean;
  bands: AnalysisBand[];
  errors: string[];
}

interface RawBand {
  id?: unknown;
  lower?: unknown;
  upper?: unknown;
}

/**
 * Validate raw band definitions. Never silently fixes overlaps — returns
 * errors instead. Touching bands (lower === previous upper) are allowed;
 * gaps are allowed (values in gaps classify as UNCLASSIFIED).
 */
export const validateAnalysisBands = (raw: unknown): ValidatedAnalysisBands => {
  const errors: string[] = [];
  if (!Array.isArray(raw)) return { ok: false, bands: [], errors: ['bands must be an array'] };
  if (raw.length === 0) return { ok: false, bands: [], errors: ['at least one band is required'] };
  const parsed: AnalysisBand[] = [];
  for (let i = 0; i < raw.length; i += 1) {
    const entry = raw[i] as RawBand;
    const id = typeof entry?.id === 'string' && entry.id.length > 0 ? entry.id : null;
    const { lower, upper } = entry ?? {};
    if (id === null) errors.push(`band ${i}: id must be a non-empty string`);
    if (typeof lower !== 'number' || !Number.isFinite(lower)) {
      errors.push(`band ${i}: lower must be a finite number`);
    }
    if (typeof upper !== 'number' || !Number.isFinite(upper)) {
      errors.push(`band ${i}: upper must be a finite number`);
    }
    if (
      id !== null &&
      typeof lower === 'number' &&
      typeof upper === 'number' &&
      Number.isFinite(lower) &&
      Number.isFinite(upper)
    ) {
      if (!(lower < upper)) errors.push(`band ${i}: lower must be < upper`);
      else parsed.push({ id, lower, upper });
    }
  }
  if (errors.length > 0) return { ok: false, bands: [], errors };
  const bands = [...parsed].sort((a, b) => a.lower - b.lower);
  for (let i = 1; i < bands.length; i += 1) {
    if (bands[i]!.lower < bands[i - 1]!.upper) {
      errors.push(`band "${bands[i]!.id}" overlaps band "${bands[i - 1]!.id}"`);
    }
  }
  if (errors.length > 0) return { ok: false, bands: [], errors };
  return { ok: true, bands, errors: [] };
};
