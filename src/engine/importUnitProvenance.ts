/**
 * Phase 17C — linear-unit provenance for imported datasets.
 *
 * Canonical internal units are metres (linear) + radians (angular). Unit
 * conversion happens exactly once at the parse boundary; serialized text
 * then truthfully carries `.UNITS M`. A dataset that cannot name its source
 * unit is flagged `needsUnitConfirmation` (BLOCKING) instead of silently
 * assuming metres.
 */

/** Canonical linear units. `us-ft` is the US survey foot (1200/3937 m). */
export type LinearUnit = 'm' | 'ft' | 'us-ft' | 'mm' | 'cm';

/** Where the declared linear unit came from. */
export type UnitOrigin =
  | 'source-declared'
  | 'format-defined'
  | 'user-confirmed'
  | 'unknown-legacy';

export interface SourceUnits {
  linear: LinearUnit;
  origin: UnitOrigin;
}

/** Exact conversion factors to metres. ft is exact; us-ft is 1200/3937. */
export const UNIT_TO_METERS: Record<LinearUnit, number> = {
  m: 1,
  ft: 0.3048,
  'us-ft': 1200 / 3937,
  mm: 0.001,
  cm: 0.01,
};

/** Accept historical aliases (`usft`, `us_ft`, `feet`, ...). */
export const normalizeLinearUnit = (value: string | undefined): LinearUnit | undefined => {
  const key = value?.trim().toLowerCase().replace(/[_\s]/g, '') ?? '';
  if (key === 'm' || key === 'meter' || key === 'meters' || key === 'metre' || key === 'metres') return 'm';
  if (key === 'ft' || key === 'foot' || key === 'feet' || key === 'intlft' || key === 'internationalfoot') return 'ft';
  if (key === 'us-ft' || key === 'usft' || key === 'ussurveyfoot' || key === 'ussurveyfeet') return 'us-ft';
  if (key === 'mm' || key === 'millimeter' || key === 'millimetre') return 'mm';
  if (key === 'cm' || key === 'centimeter' || key === 'centimetre') return 'cm';
  return undefined;
};

export const linearToMeters = (value: number, unit: LinearUnit): number =>
  value * UNIT_TO_METERS[unit];

export const metersToLinear = (valueMeters: number, unit: LinearUnit): number =>
  valueMeters / UNIT_TO_METERS[unit];

/** Covariance scales with f^2; sigmas/coords/elevations/HI/HT scale with f. Never angular sigma. */
export const varianceScale = (unit: LinearUnit): number => {
  const factor = UNIT_TO_METERS[unit];
  return factor * factor;
};

export const sourceUnitsEqual = (left?: SourceUnits, right?: SourceUnits): boolean =>
  left?.linear === right?.linear && left?.origin === right?.origin;

export const describeSourceUnits = (units?: SourceUnits): string => {
  if (!units) return 'unknown (legacy)';
  const originLabel: Record<UnitOrigin, string> = {
    'source-declared': 'declared by source',
    'format-defined': 'defined by format',
    'user-confirmed': 'confirmed by user',
    'unknown-legacy': 'unknown (legacy)',
  };
  return `${units.linear} (${originLabel[units.origin]})`;
};

/**
 * Importer IDs whose formats carry no unit declaration, so their metre
 * outputs are unconfirmed until the user says otherwise. Evidence: no unit
 * element/attribute in the format; numeric outputs are hard-coded metres at
 * the call site. Do NOT claim `format-defined` for these.
 */
export const UNKNOWN_UNIT_IMPORTER_IDS: ReadonlySet<string> = new Set([
  'dbx-export',
  'jobxml',
  'carlson-rw5',
  'tds-raw',
  'fieldgenius-raw',
  'trimble-survey-report',
  'opus-report',
  'gvx',
  'gnss-csv',
  'terrestrial-csv',
]);

/** Importer IDs whose formats declare units in-band (honored, not assumed). */
export const SOURCE_DECLARED_IMPORTER_IDS: ReadonlySet<string> = new Set([
  'native-dat', // .UNITS directive, parsed at the core boundary
  'gnss-bl', // originalUnits carried by the GNSS network import
  'landxml', // Metric/Imperial linearUnit attribute
]);

export const unknownLegacyUnits = (): SourceUnits => ({ linear: 'm', origin: 'unknown-legacy' });

/** True when the dataset must not commit until the user confirms units. */
export const needsUnitConfirmation = (dataset: {
  sourceUnits?: SourceUnits;
  needsUnitConfirmation?: boolean;
}): boolean =>
  dataset.needsUnitConfirmation === true ||
  dataset.sourceUnits == null ||
  dataset.sourceUnits.origin === 'unknown-legacy';

/**
 * Record an explicit user confirmation. Keeps the already-normalized metre
 * values untouched — confirmation labels provenance, never reconverts.
 */
export const confirmDatasetUnits = <T extends { sourceUnits?: SourceUnits; needsUnitConfirmation?: boolean }>(
  dataset: T,
  linear: LinearUnit,
): T => ({
  ...dataset,
  sourceUnits: { linear, origin: 'user-confirmed' },
  needsUnitConfirmation: false,
});
