const INLINE_CANONICAL_OPS = [
  'UNITS',
  'SCALE',
  'MEASURED',
  'GRID',
  'COORD',
  'ORDER',
  '2D',
  '3D',
  '3REDUCE',
  'DELTA',
  'MAPMODE',
  'MAPSCALE',
  'CRS',
  'GEOID',
  'GPS',
  'LWEIGHT',
  'LEVELTOL',
  'QFIX',
  'NORMALIZE',
  'LONSIGN',
  'EDM',
  'CENTERING',
  'ADDC',
  'DEBUG',
  'CURVREF',
  'REFRACTION',
  'VRED',
  'AMODE',
  'ROBUST',
  'AUTOADJUST',
  'PRISM',
  'ROTATION',
  'LOSTSTATIONS',
  'AUTOSIDESHOT',
  'DESC',
  'TSCORR',
  'ALIAS',
  'I',
  'TS',
  'END',
  'DATA',
  'SEPARATOR',
  'INCLUDE',
  'MULTIPLIER',
  'ELEVATION',
  'PELEVATION',
  'VLEVEL',
  'COPYINPUT',
  'ELLIPSE',
  'RELATIVE',
  'PTOLERANCE',
] as const;

const INLINE_ALIAS_TO_CANONICAL: Record<string, string> = {
  DESCRIPTION: 'DESC',
  INSTRUMENT: 'I',
  INST: 'I',
  ADDCENTERING: 'ADDC',
  CURVE: 'CURVREF',
  LONGITUDE: 'LONSIGN',
  LONG: 'LONSIGN',
  MAP: 'MAPMODE',
  SEP: 'SEPARATOR',
  SEPERATOR: 'SEPARATOR',
  INCUDE: 'INCLUDE',
  MULT: 'MULTIPLIER',
  ELEV: 'ELEVATION',
  PELEV: 'PELEVATION',
  COPY: 'COPYINPUT',
  ELL: 'ELLIPSE',
  REL: 'RELATIVE',
  PTOL: 'PTOLERANCE',
  '3R': '3REDUCE',
};

type NormalizedInlineDirective = {
  op?: string;
  unknown?: boolean;
  ambiguous?: boolean;
  candidates?: string[];
};

export const normalizeInlineDirective = (
  rawDirectiveToken: string,
): NormalizedInlineDirective => {
  if (!rawDirectiveToken) return { unknown: true };
  const token = rawDirectiveToken
    .trim()
    .toUpperCase()
    .replace(/^[./]+/, '')
    .trim();
  if (!token) return { unknown: true };
  const aliasHit = INLINE_ALIAS_TO_CANONICAL[token];
  if (aliasHit) return { op: `.${aliasHit}` };
  if (INLINE_CANONICAL_OPS.includes(token as (typeof INLINE_CANONICAL_OPS)[number])) {
    return { op: `.${token}` };
  }
  const prefixed = INLINE_CANONICAL_OPS.filter((name) => name.startsWith(token));
  if (prefixed.length === 1) return { op: `.${prefixed[0]}` };
  if (prefixed.length > 1) {
    return {
      ambiguous: true,
      candidates: prefixed.map((name) => `.${name}`),
    };
  }
  return { unknown: true };
};
