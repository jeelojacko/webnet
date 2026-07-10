import { type CrsDefinition } from './crsCatalogCore';
import { CANADA_CRS_CATALOG } from './crsCatalogCanada';
import { USA_SPCS_CATALOG } from './crsCatalogUsSpcs';

export { CANADA_CRS_CATALOG } from './crsCatalogCanada';

export type {
  CrsAreaOfUseBounds,
  CrsCatalogGroup,
  CrsDatumOperationSupport,
  CrsDefinition,
  CrsProjectionParam,
  CrsValidityStatus,
} from './crsCatalogCore';

export const CRS_CATALOG: CrsDefinition[] = [...CANADA_CRS_CATALOG, ...USA_SPCS_CATALOG];

export const DEFAULT_CANADA_CRS_ID = 'CA_NAD83_CSRS_UTM_20N';

const BY_ID = new Map<string, CrsDefinition>();

for (const row of CRS_CATALOG) {
  BY_ID.set(row.id.toUpperCase(), row);
  if (row.epsgCode) {
    BY_ID.set(`EPSG:${row.epsgCode}`.toUpperCase(), row);
    BY_ID.set(row.epsgCode.toUpperCase(), row);
  }
  row.authorityAliases?.forEach((alias) => {
    BY_ID.set(alias.toUpperCase(), row);
    const normalized = alias.toUpperCase().startsWith('EPSG:') ? alias.slice(5) : undefined;
    if (normalized) {
      BY_ID.set(normalized.toUpperCase(), row);
    }
  });
}

export const getCrsDefinition = (id?: string): CrsDefinition | undefined => {
  if (!id) return undefined;
  return BY_ID.get(String(id).trim().toUpperCase());
};

export const normalizeCrsId = (id?: string): string | undefined => {
  if (!id) return undefined;
  const token = String(id).trim();
  if (!token) return undefined;
  return getCrsDefinition(token)?.id ?? token.toUpperCase();
};

export const resolveCrsDefinition = (id?: string): CrsDefinition =>
  getCrsDefinition(id) ?? getCrsDefinition(DEFAULT_CANADA_CRS_ID)!;

export const isGeodeticInsideAreaOfUse = (
  def: CrsDefinition | undefined,
  latDeg: number,
  lonDeg: number,
): boolean | null => {
  if (!def?.areaOfUseBounds) return null;
  if (!Number.isFinite(latDeg) || !Number.isFinite(lonDeg)) return null;
  const b = def.areaOfUseBounds;
  return (
    latDeg >= b.minLatDeg && latDeg <= b.maxLatDeg && lonDeg >= b.minLonDeg && lonDeg <= b.maxLonDeg
  );
};
