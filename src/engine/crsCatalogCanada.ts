import {
  CANADA_DATUM_OPS,
  parseProj4Parameters,
  type CrsAreaOfUseBounds,
  type CrsDefinition,
} from './crsCatalogCore';

import { CANADA_PROVINCIAL_CATALOG_PART_1 } from './crsCatalogCanadaProvincialPart01';
import { CANADA_PROVINCIAL_CATALOG_PART_2 } from './crsCatalogCanadaProvincialPart02';
const buildAreaOfUseBoundsForUtm = (zoneNumber: number): CrsAreaOfUseBounds => {
  const lon0 = zoneNumber * 6 - 183;
  return {
    minLatDeg: 40,
    maxLatDeg: 84,
    minLonDeg: lon0 - 3.5,
    maxLonDeg: lon0 + 3.5,
  };
};

const buildCanadaUtm = (zoneNumber: number): CrsDefinition => ({
  id: `CA_NAD83_CSRS_UTM_${String(zoneNumber).padStart(2, '0')}N`,
  label: `Canada NAD83(CSRS)v8 / UTM Zone ${zoneNumber}N`,
  catalogGroup: 'canada-utm',
  region: 'canada',
  datum: 'NAD83(CSRS)',
  datumRealization: 'NAD83(CSRS)v8',
  projectionFamily: 'utm',
  linearUnit: 'm',
  axisOrder: 'E,N',
  areaOfUse: `Canada UTM Zone ${zoneNumber}N`,
  areaOfUseBounds: buildAreaOfUseBoundsForUtm(zoneNumber),
  zoneNumber: zoneNumber,
  epsgCode: String(22800 + zoneNumber),
  validityStatus: 'current',
  proj4: `+proj=utm +zone=${zoneNumber} +ellps=GRS80 +units=m +no_defs +type=crs`,
  projParams: parseProj4Parameters(
    `+proj=utm +zone=${zoneNumber} +ellps=GRS80 +units=m +no_defs +type=crs`,
  ),
  projectionParams: {
    lon0Deg: zoneNumber * 6 - 183,
    k0: 0.9996,
    falseEastingM: 500000,
    falseNorthingM: 0,
  },
  supportedDatumOps: CANADA_DATUM_OPS,
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
  datumRealization: 'NAD83(CSRS)',
  projectionFamily: 'mtm',
  linearUnit: 'm',
  axisOrder: 'E,N',
  areaOfUse: `Canada MTM Zone ${row.zoneNumber}`,
  areaOfUseBounds: {
    minLatDeg: 40,
    maxLatDeg: 62,
    minLonDeg: row.lon0Deg - 1.8,
    maxLonDeg: row.lon0Deg + 1.8,
  },
  zoneNumber: row.zoneNumber,
  epsgCode: row.epsgCode,
  validityStatus: 'current',
  proj4: `+proj=tmerc +lat_0=0 +lon_0=${row.lon0Deg} +k=0.9999 +x_0=304800 +y_0=0 +ellps=GRS80 +units=m +no_defs +type=crs`,
  projParams: parseProj4Parameters(
    `+proj=tmerc +lat_0=0 +lon_0=${row.lon0Deg} +k=0.9999 +x_0=304800 +y_0=0 +ellps=GRS80 +units=m +no_defs +type=crs`,
  ),
  projectionParams: {
    lat0Deg: 0,
    lon0Deg: row.lon0Deg,
    k0: 0.9999,
    falseEastingM: 304800,
    falseNorthingM: 0,
  },
  supportedDatumOps: CANADA_DATUM_OPS,
});

const CANADA_UTM_CATALOG: CrsDefinition[] = Array.from({ length: 16 }, (_, idx) =>
  buildCanadaUtm(7 + idx),
);

const CANADA_MTM_CATALOG: CrsDefinition[] = MTM_ZONE_METADATA.map((row) => buildCanadaMtm(row));

const CANADA_PROVINCIAL_CATALOG: CrsDefinition[] = [
  ...CANADA_PROVINCIAL_CATALOG_PART_1,
  ...CANADA_PROVINCIAL_CATALOG_PART_2,
];

export const CANADA_CRS_CATALOG: CrsDefinition[] = [
  ...CANADA_UTM_CATALOG,
  ...CANADA_MTM_CATALOG,
  ...CANADA_PROVINCIAL_CATALOG,
];
