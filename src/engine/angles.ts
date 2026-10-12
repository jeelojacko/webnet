export const RAD_TO_DEG = 180 / Math.PI;
export const DEG_TO_RAD = Math.PI / 180;
export const SEC_TO_RAD = Math.PI / (180 * 3600);

// Deterministic compact `DDD.MMSS` conversion. The fractional body is read
// textually instead of via floating-point subtraction, so a token like
// `45.3000` cannot drift into `45°30'40"` through binary carry. `MM` is the
// first two fractional digits, `SS` the next two, and any digits beyond the
// fourth become a decimal-seconds tail.
const compactDmsToRad = (body: string, sign: number): number => {
  const dotIndex = body.indexOf('.');
  const degreePart = dotIndex === -1 ? body : body.slice(0, dotIndex);
  const fracPart = dotIndex === -1 ? '' : body.slice(dotIndex + 1);
  const d = degreePart === '' ? 0 : Number.parseInt(degreePart, 10);
  const frac = fracPart.padEnd(4, '0');
  const m = Number.parseInt(frac.slice(0, 2), 10) || 0;
  const s = Number.parseInt(frac.slice(2, 4), 10) || 0;
  const tail = fracPart.length > 4 ? Number.parseFloat(`0.${fracPart.slice(4)}`) : 0;

  const decimalDegrees = d + m / 60 + (s + tail) / 3600;
  return decimalDegrees * DEG_TO_RAD * sign;
};

export const dmsToRad = (dmsStr: string): number => {
  if (!dmsStr) return 0;

  const trimmed = dmsStr.trim();

  // Strip exactly one leading sign before choosing the branch so a negative
  // compact body (`-45.3000`) is not misread as a hyphenated `DDD-MM-SS`
  // string. The hyphenated branch keeps its original arithmetic.
  let sign = 1;
  let body = trimmed;
  if (body.startsWith('-')) {
    sign = -1;
    body = body.substring(1);
  } else if (body.startsWith('+')) {
    body = body.substring(1);
  }

  // Handle hyphenated format: DDD-MM-SS.ss
  if (body.includes('-')) {
    const parts = body.split('-');
    const d = parseFloat(parts[0]);
    const m = parts[1] ? parseFloat(parts[1]) : 0;
    const s = parts[2] ? parseFloat(parts[2]) : 0;

    // Total degrees
    const totalDeg = d + m / 60 + s / 3600;
    return totalDeg * DEG_TO_RAD * sign;
  }

  // Handle standard decimal format: DDD.MMSS
  if (/^\d*\.?\d*$/.test(body) && /\d/.test(body)) {
    return compactDmsToRad(body, sign);
  }

  // Historical lenient fallback for non-numeric bodies (parseFloat
  // truncation); kept so long-standing `dmsToRad` behavior such as
  // `45abc` -> 45 is not changed here.
  const val = parseFloat(body);
  if (Number.isNaN(val)) return 0;

  const absVal = Math.abs(val);
  const d = Math.floor(absVal);
  const m = Math.floor((absVal - d) * 100);
  const s = ((absVal - d) * 100 - m) * 100;

  const decimalDegrees = d + m / 60 + s / 3600;
  return decimalDegrees * DEG_TO_RAD * sign;
};

export const radToDmsStr = (rad?: number | null): string => {
  if (rad === undefined || rad === null || Number.isNaN(rad)) return '000-00-00.0';
  let deg = rad * RAD_TO_DEG;
  deg %= 360;
  if (deg < 0) deg += 360;
  const d = Math.floor(deg);
  const rem1 = (deg - d) * 60;
  const m = Math.floor(rem1);
  const s = (rem1 - m) * 60;
  return `${d.toString().padStart(3, '0')}-${m.toString().padStart(2, '0')}-${s
    .toFixed(1)
    .padStart(4, '0')}`;
};
