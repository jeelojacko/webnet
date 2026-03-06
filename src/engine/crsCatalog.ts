export type CrsCatalogGroup = 'global' | 'canada-utm' | 'canada-mtm' | 'canada-provincial';

export interface CrsDefinition {
  id: string;
  label: string;
  catalogGroup: CrsCatalogGroup;
  region: 'canada';
  datum: string;
  projectionFamily:
    | 'utm'
    | 'mtm'
    | 'oblique-stereographic'
    | 'lambert-conformal-conic'
    | 'albers-equal-area'
    | 'transverse-mercator';
  linearUnit: 'm';
  axisOrder: 'E,N';
  areaOfUse: string;
  zoneNumber?: number;
  epsgCode?: string;
  proj4: string;
}

const buildCanadaUtm = (zoneNumber: number): CrsDefinition => ({
  id: `CA_NAD83_CSRS_UTM_${String(zoneNumber).padStart(2, '0')}N`,
  label: `Canada NAD83(CSRS) / UTM Zone ${zoneNumber}N`,
  catalogGroup: 'canada-utm',
  region: 'canada',
  datum: 'NAD83(CSRS)',
  projectionFamily: 'utm',
  linearUnit: 'm',
  axisOrder: 'E,N',
  areaOfUse: `Canada UTM Zone ${zoneNumber}N`,
  zoneNumber: zoneNumber,
  proj4: `+proj=utm +zone=${zoneNumber} +ellps=GRS80 +units=m +no_defs`,
});

const MTM_ZONE_METADATA: Array<{ zoneNumber: number; lon0Deg: number; epsgCode: string }> = [
  { zoneNumber: 1, lon0Deg: -53, epsgCode: '26898' },
  { zoneNumber: 2, lon0Deg: -56, epsgCode: '26899' },
  { zoneNumber: 3, lon0Deg: -58.5, epsgCode: '2945' },
  { zoneNumber: 4, lon0Deg: -61.5, epsgCode: '2946' },
  { zoneNumber: 5, lon0Deg: -64.5, epsgCode: '2947' },
  { zoneNumber: 6, lon0Deg: -67.5, epsgCode: '2948' },
  { zoneNumber: 7, lon0Deg: -70.5, epsgCode: '2949' },
  { zoneNumber: 8, lon0Deg: -73.5, epsgCode: '2950' },
  { zoneNumber: 9, lon0Deg: -76.5, epsgCode: '2951' },
  { zoneNumber: 10, lon0Deg: -79.5, epsgCode: '2952' },
  { zoneNumber: 11, lon0Deg: -82.5, epsgCode: '26891' },
  { zoneNumber: 12, lon0Deg: -81, epsgCode: '26892' },
  { zoneNumber: 13, lon0Deg: -84, epsgCode: '26893' },
  { zoneNumber: 14, lon0Deg: -87, epsgCode: '26894' },
  { zoneNumber: 15, lon0Deg: -90, epsgCode: '26895' },
  { zoneNumber: 16, lon0Deg: -93, epsgCode: '26896' },
  { zoneNumber: 17, lon0Deg: -96, epsgCode: '26897' },
];

const buildCanadaMtm = (row: {
  zoneNumber: number;
  lon0Deg: number;
  epsgCode: string;
}): CrsDefinition => ({
  id: `CA_NAD83_CSRS_MTM_${String(row.zoneNumber).padStart(2, '0')}`,
  label: `Canada NAD83(CSRS) / MTM Zone ${row.zoneNumber}`,
  catalogGroup: 'canada-mtm',
  region: 'canada',
  datum: 'NAD83(CSRS)',
  projectionFamily: 'mtm',
  linearUnit: 'm',
  axisOrder: 'E,N',
  areaOfUse: `Canada MTM Zone ${row.zoneNumber}`,
  zoneNumber: row.zoneNumber,
  epsgCode: row.epsgCode,
  proj4: `+proj=tmerc +lat_0=0 +lon_0=${row.lon0Deg} +k=0.9999 +x_0=304800 +y_0=0 +ellps=GRS80 +units=m +no_defs`,
});

const CANADA_UTM_CATALOG: CrsDefinition[] = Array.from(
  { length: 16 },
  (_, idx) => buildCanadaUtm(7 + idx),
);

const CANADA_MTM_CATALOG: CrsDefinition[] = MTM_ZONE_METADATA.map((row) => buildCanadaMtm(row));

const CANADA_PROVINCIAL_CATALOG: CrsDefinition[] = [
  {
    id: 'CA_NAD83_CSRS_NB_STEREO_DOUBLE',
    label: 'New Brunswick Stereographic Double Projection',
    catalogGroup: 'canada-provincial',
    region: 'canada',
    datum: 'NAD83(CSRS)',
    projectionFamily: 'oblique-stereographic',
    linearUnit: 'm',
    axisOrder: 'E,N',
    areaOfUse: 'New Brunswick',
    epsgCode: '2953',
    proj4:
      '+proj=sterea +lat_0=46.5 +lon_0=-66.5 +k=0.999912 +x_0=2500000 +y_0=7500000 +ellps=GRS80 +units=m +no_defs',
  },
  {
    id: 'CA_NAD83_CSRS_PEI_STEREOGRAPHIC',
    label: 'Prince Edward Island Stereographic',
    catalogGroup: 'canada-provincial',
    region: 'canada',
    datum: 'NAD83(CSRS)',
    projectionFamily: 'oblique-stereographic',
    linearUnit: 'm',
    axisOrder: 'E,N',
    areaOfUse: 'Prince Edward Island',
    epsgCode: '2954',
    proj4:
      '+proj=sterea +lat_0=47.25 +lon_0=-63 +k=0.999912 +x_0=400000 +y_0=800000 +ellps=GRS80 +units=m +no_defs',
  },
  {
    id: 'CA_NAD83_CSRS_ON_MNR_LAMBERT',
    label: 'Ontario MNR Lambert',
    catalogGroup: 'canada-provincial',
    region: 'canada',
    datum: 'NAD83(CSRS)',
    projectionFamily: 'lambert-conformal-conic',
    linearUnit: 'm',
    axisOrder: 'E,N',
    areaOfUse: 'Ontario',
    epsgCode: '3162',
    proj4:
      '+proj=lcc +lat_0=0 +lon_0=-85 +lat_1=44.5 +lat_2=53.5 +x_0=930000 +y_0=6430000 +ellps=GRS80 +units=m +no_defs',
  },
  {
    id: 'CA_NAD83_CSRS_BC_ALBERS',
    label: 'British Columbia Albers',
    catalogGroup: 'canada-provincial',
    region: 'canada',
    datum: 'NAD83(CSRS)',
    projectionFamily: 'albers-equal-area',
    linearUnit: 'm',
    axisOrder: 'E,N',
    areaOfUse: 'British Columbia',
    epsgCode: '3153',
    proj4:
      '+proj=aea +lat_0=45 +lon_0=-126 +lat_1=50 +lat_2=58.5 +x_0=1000000 +y_0=0 +ellps=GRS80 +units=m +no_defs',
  },
  {
    id: 'CA_NAD83_CSRS_AB_10TM_RESOURCE',
    label: 'Alberta 10-TM (Resource)',
    catalogGroup: 'canada-provincial',
    region: 'canada',
    datum: 'NAD83(CSRS)',
    projectionFamily: 'transverse-mercator',
    linearUnit: 'm',
    axisOrder: 'E,N',
    areaOfUse: 'Alberta',
    epsgCode: '3403',
    proj4:
      '+proj=tmerc +lat_0=0 +lon_0=-115 +k=0.9992 +x_0=0 +y_0=0 +ellps=GRS80 +units=m +no_defs',
  },
];

export const CANADA_CRS_CATALOG: CrsDefinition[] = [
  ...CANADA_UTM_CATALOG,
  ...CANADA_MTM_CATALOG,
  ...CANADA_PROVINCIAL_CATALOG,
];

export const DEFAULT_CANADA_CRS_ID = 'CA_NAD83_CSRS_UTM_20N';

const BY_ID = new Map<string, CrsDefinition>();

for (const row of CANADA_CRS_CATALOG) {
  BY_ID.set(row.id.toUpperCase(), row);
  if (row.epsgCode) {
    BY_ID.set(`EPSG:${row.epsgCode}`.toUpperCase(), row);
    BY_ID.set(row.epsgCode.toUpperCase(), row);
  }
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
