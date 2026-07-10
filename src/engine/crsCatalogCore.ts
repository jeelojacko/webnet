export type CrsCatalogGroup =
  | 'global'
  | 'canada-utm'
  | 'canada-mtm'
  | 'canada-provincial'
  | 'us-spcs';
export type CrsValidityStatus = 'current' | 'superseded' | 'legacy-app-alias';

export interface CrsAreaOfUseBounds {
  minLatDeg: number;
  maxLatDeg: number;
  minLonDeg: number;
  maxLonDeg: number;
}

export interface CrsProjectionParam {
  key: string;
  value: string;
}

export interface CrsDatumOperationSupport {
  primary: string;
  fallbacks: string[];
}

export interface CrsDefinition {
  id: string;
  label: string;
  catalogGroup: CrsCatalogGroup;
  region: 'canada' | 'usa' | 'global';
  datum: string;
  datumRealization?: string;
  projectionFamily:
    | 'utm'
    | 'mtm'
    | 'oblique-stereographic'
    | 'oblique-mercator'
    | 'lambert-conformal-conic'
    | 'albers-equal-area'
    | 'transverse-mercator';
  linearUnit: 'm' | 'us-ft';
  axisOrder: 'E,N';
  areaOfUse: string;
  areaOfUseBounds?: CrsAreaOfUseBounds;
  zoneNumber?: number;
  epsgCode?: string;
  authorityAliases?: string[];
  validityStatus?: CrsValidityStatus;
  proj4: string;
  projParams: CrsProjectionParam[];
  projectionParams?: {
    lat0Deg?: number;
    lon0Deg?: number;
    k0?: number;
    falseEastingM?: number;
    falseNorthingM?: number;
    lat1Deg?: number;
    lat2Deg?: number;
  };
  factorStrategy?: 'formula' | 'numeric-local';
  supportedDatumOps: CrsDatumOperationSupport;
}

export const parseProj4Parameters = (proj4: string): CrsProjectionParam[] =>
  proj4
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.startsWith('+'))
    .map((token) => token.slice(1))
    .map((token) => {
      const sep = token.indexOf('=');
      if (sep < 0) return { key: token, value: 'true' };
      return {
        key: token.slice(0, sep),
        value: token.slice(sep + 1),
      };
    });

export const CANADA_DATUM_OPS: CrsDatumOperationSupport = {
  primary: 'NAD83(CSRS)<->WGS84 (EPSG-compatible operation)',
  fallbacks: ['PROJ4 geocentric approximation'],
};

export const USA_DATUM_OPS: CrsDatumOperationSupport = {
  primary: 'NAD83(2011)<->WGS84 (EPSG-compatible operation)',
  fallbacks: ['PROJ4 geocentric approximation'],
};
