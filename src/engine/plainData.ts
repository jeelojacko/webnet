const isPlainRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value != null && !Array.isArray(value) && !(value instanceof Uint8Array);

export const deepClonePlain = <T,>(value: T): T => {
  if (typeof structuredClone === 'function') {
    return structuredClone(value);
  }
  if (value == null || typeof value !== 'object') return value;
  if (Array.isArray(value)) {
    return value.map((entry) => deepClonePlain(entry)) as T;
  }
  if (value instanceof Uint8Array) {
    return new Uint8Array(value) as T;
  }
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, entryValue]) => [
      key,
      deepClonePlain(entryValue),
    ]),
  ) as T;
};

const normalizePlainValue = (value: unknown): unknown => {
  if (value == null) return value;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'function') {
    return `[function:${value.name || 'anonymous'}]`;
  }
  if (value instanceof Uint8Array) {
    return Array.from(value);
  }
  if (Array.isArray(value)) {
    return value.map((entry) => normalizePlainValue(entry));
  }
  if (value instanceof Set) {
    return [...value].map((entry) => normalizePlainValue(entry));
  }
  if (isPlainRecord(value)) {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, entryValue]) => entryValue !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entryValue]) => [key, normalizePlainValue(entryValue)]),
    );
  }
  return String(value);
};

export const stableSerializePlain = (value: unknown): string =>
  JSON.stringify(normalizePlainValue(value));

export const buildReductionUsageSignature = (
  summary:
    | {
        bearing: { grid: number; measured: number };
        angle: { grid: number; measured: number };
        direction: { grid: number; measured: number };
        distance: { ground: number; grid: number; ellipsoidal: number };
        total: number;
      }
    | null
    | undefined,
): string =>
  summary
    ? [
        summary.bearing.grid,
        summary.bearing.measured,
        summary.angle.grid,
        summary.angle.measured,
        summary.direction.grid,
        summary.direction.measured,
        summary.distance.ground,
        summary.distance.grid,
        summary.distance.ellipsoidal,
        summary.total,
      ].join('|')
    : 'none';
