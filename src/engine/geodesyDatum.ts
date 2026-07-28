import type { CoordSystemDiagnosticCode } from '../types';
import type { CrsDefinition } from './crsCatalog';

export const resolveDatumOperation = (
  def?: CrsDefinition,
): {
  datumOpId: string;
  warnings: string[];
  diagnostics: CoordSystemDiagnosticCode[];
  fallbackUsed: boolean;
} => {
  if (!def) {
    return {
      datumOpId: 'UNRESOLVED',
      warnings: ['CRS datum operation unresolved: unknown CRS definition.'],
      diagnostics: ['CRS_DATUM_FALLBACK'],
      fallbackUsed: true,
    };
  }
  const primary = def.supportedDatumOps?.primary?.trim();
  if (primary) {
    return {
      datumOpId: primary,
      warnings: [],
      diagnostics: [],
      fallbackUsed: false,
    };
  }
  const fallback = def.supportedDatumOps?.fallbacks?.find((token) => token.trim().length > 0);
  if (fallback) {
    return {
      datumOpId: fallback,
      warnings: [`CRS datum operation fallback used for ${def.id}: ${fallback}`],
      diagnostics: ['CRS_DATUM_FALLBACK'],
      fallbackUsed: true,
    };
  }
  return {
    datumOpId: 'WGS84-ASSUMED',
    warnings: [`CRS datum operation fallback used for ${def.id}: WGS84-ASSUMED`],
    diagnostics: ['CRS_DATUM_FALLBACK'],
    fallbackUsed: true,
  };
};
