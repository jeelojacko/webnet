/**
 * Phase 12J.4 — small pure helpers for RINEX OBS header parsing.
 *
 * Fail-closed numerics: every numeric field that is present but unparseable
 * throws. Absent optional lines yield null, never a guess.
 */

export class RinexParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RinexParseError';
  }
}

/** RINEX fixed-width label column (cols 61-80). */
export const rinexLabel = (line: string): string => line.slice(60).trim();

/** Strict float: rejects empty strings and NaN (Number() accepts ''). */
export function strictFloat(token: string, context: string): number {
  const t = token.trim();
  if (t === '') throw new RinexParseError(`Missing numeric value (${context}).`);
  // Allow Fortran D/d exponents found in NAV files.
  const v = Number(t.replace(/([0-9])d([+-]?)/i, '$1e$2').replace(/D/i, 'E'));
  if (!Number.isFinite(v)) {
    throw new RinexParseError(`Malformed numeric "${t}" (${context}).`);
  }
  return v;
}

export function strictInt(token: string, context: string): number {
  const v = strictFloat(token, context);
  if (!Number.isInteger(v)) {
    throw new RinexParseError(`Expected integer, got "${token}" (${context}).`);
  }
  return v;
}

/** GPS week + tow-of-week (s) for a UTC millisecond epoch. */
export function gpsWeekTow(epochMs: number): { week: number; tow: number } {
  const gpsEpochMs = Date.UTC(1980, 0, 6, 0, 0, 0);
  const elapsed = Math.floor((epochMs - gpsEpochMs) / 1000);
  const week = Math.floor(elapsed / 604800);
  return { week, tow: elapsed - week * 604800 };
}

/** Two-digit RINEX 2 year pivot: 80-99 -> 19xx, else 20xx. */
export function fullYear(yy: number): number {
  return yy >= 80 ? 1900 + yy : 2000 + yy;
}

/** Build an ISO UTC string from date/time parts; throws on bad ranges. */
export function epochIso(parts: {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}): { ms: number; iso: string } {
  const { year, month, day, hour, minute, second } = parts;
  for (const [name, v, lo, hi] of [
    ['month', month, 1, 12],
    ['day', day, 1, 31],
    ['hour', hour, 0, 24],
    ['minute', minute, 0, 60],
  ] as const) {
    if (!Number.isInteger(v) || v < lo || v > hi) {
      throw new RinexParseError(`Epoch ${name} out of range: ${v}.`);
    }
  }
  if (!Number.isFinite(second) || second < 0 || second >= 61) {
    throw new RinexParseError(`Epoch second out of range: ${second}.`);
  }
  const whole = Math.floor(second);
  const ms = Math.round((second - whole) * 1000);
  const msEpoch = Date.UTC(year, month - 1, day, hour, minute, whole, ms);
  if (!Number.isFinite(msEpoch)) {
    throw new RinexParseError('Unrepresentable epoch date.');
  }
  return { ms: msEpoch, iso: new Date(msEpoch).toISOString() };
}

/**
 * Parse a RINEX 2.x OBS epoch line (yy mm dd hh mm ss.ssssss flag nsat...).
 * Returns null when the line is not an epoch line.
 */
export function parseObs2Epoch(line: string): { ms: number; sats: string[] } | null {
  const m =
    /^(\s*\d{1,2})(\s+\d{1,2})(\s+\d{1,2})(\s+\d{1,2})(\s+\d{1,2})([\s.0-9]{10,12})(\s+\d)(\s+\d{1,3})(.*)$/.exec(
      line,
    );
  if (!m) return null;
  const yy = strictInt(m[1]!, 'epoch year');
  const { ms } = epochIso({
    year: fullYear(yy),
    month: strictInt(m[2]!, 'epoch month'),
    day: strictInt(m[3]!, 'epoch day'),
    hour: strictInt(m[4]!, 'epoch hour'),
    minute: strictInt(m[5]!, 'epoch minute'),
    second: strictFloat(m[6]!, 'epoch second'),
  });
  const nsat = strictInt(m[8]!, 'epoch sat count');
  const sats: string[] = [];
  const rest = m[9] ?? '';
  for (let i = 0; i < nsat; i += 1) {
    const chunk = rest.slice(i * 3, i * 3 + 3);
    const sys = chunk.slice(0, 1).trim();
    const prn = chunk.slice(1).trim();
    if (sys && prn) sats.push(`${sys}${prn.padStart(2, '0')}`);
  }
  return { ms, sats };
}

/**
 * Parse a RINEX 3.x OBS epoch line ('> yyyy mm dd hh mm ss.sssssss ...').
 * Returns null when the line is not an epoch line.
 */
export function parseObs3Epoch(line: string): { ms: number } | null {
  if (!line.startsWith('>')) return null;
  const f = line.slice(1).trim().split(/\s+/);
  if (f.length < 6) throw new RinexParseError('Malformed RINEX 3 epoch line.');
  const { ms } = epochIso({
    year: strictInt(f[0]!, 'epoch year'),
    month: strictInt(f[1]!, 'epoch month'),
    day: strictInt(f[2]!, 'epoch day'),
    hour: strictInt(f[3]!, 'epoch hour'),
    minute: strictInt(f[4]!, 'epoch minute'),
    second: strictFloat(f[5]!, 'epoch second'),
  });
  return { ms };
}

/** Observation-code frequency band: second char digit ('C1C'->'1'). */
export function obsBand(code: string): string | null {
  const b = code.length >= 2 ? code[1] : '';
  return b === '1' || b === '2' || b === '5' ? b : null;
}

/** Line-length / size caps shared by header scan and preflight. */
export const MAX_LINE_LENGTH = 4096;
