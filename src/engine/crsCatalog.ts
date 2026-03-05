export interface CrsDefinition {
  id: string;
  label: string;
  region: 'canada';
  datum: string;
  projectionFamily: 'utm';
  linearUnit: 'm';
  axisOrder: 'E,N';
  areaOfUse: string;
  zoneNumber: number;
  proj4: string;
}

const buildCanadaUtm = (zoneNumber: number): CrsDefinition => ({
  id: `CA_NAD83_CSRS_UTM_${String(zoneNumber).padStart(2, '0')}N`,
  label: `Canada NAD83(CSRS) / UTM Zone ${zoneNumber}N`,
  region: 'canada',
  datum: 'NAD83(CSRS)',
  projectionFamily: 'utm',
  linearUnit: 'm',
  axisOrder: 'E,N',
  areaOfUse: `Canada UTM Zone ${zoneNumber}N`,
  zoneNumber,
  proj4: `+proj=utm +zone=${zoneNumber} +ellps=GRS80 +units=m +no_defs`,
});

export const CANADA_CRS_CATALOG: CrsDefinition[] = Array.from(
  { length: 16 },
  (_, idx) => buildCanadaUtm(7 + idx),
);

export const DEFAULT_CANADA_CRS_ID = 'CA_NAD83_CSRS_UTM_20N';

const BY_ID = new Map(CANADA_CRS_CATALOG.map((row) => [row.id.toUpperCase(), row]));

export const getCrsDefinition = (id?: string): CrsDefinition | undefined => {
  if (!id) return undefined;
  return BY_ID.get(String(id).trim().toUpperCase());
};

export const resolveCrsDefinition = (id?: string): CrsDefinition =>
  getCrsDefinition(id) ?? getCrsDefinition(DEFAULT_CANADA_CRS_ID)!;
