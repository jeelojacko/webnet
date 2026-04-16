import {
  CANADA_CRS_CATALOG,
  getCrsDefinition,
  type CrsAreaOfUseBounds,
  type CrsDefinition,
} from './crsCatalog';

export type CanadianCrsTestAuthority = 'EPSG' | 'CUSTOM';
export type CanadianCrsTestFamily = 'UTM' | 'MTM' | 'PROVINCIAL';
export type CanadianCrsValidityStatus = 'current' | 'superseded' | 'legacy-app-alias';

export interface CanadianCrsSourceProvenance {
  authority: 'EPSG' | 'NRCan' | 'Province';
  title: string;
  organization: string;
  reference: string;
  url: string;
}

export interface CanadianCrsTestConfig {
  id: string;
  webnetCrsId: string;
  authority: CanadianCrsTestAuthority;
  code?: number;
  name: string;
  family: CanadianCrsTestFamily;
  provinceOrRegion?: string;
  sourceNotes: string[];
  sourceProvenance: CanadianCrsSourceProvenance[];
  areaOfUse: {
    westLon: number;
    southLat: number;
    eastLon: number;
    northLat: number;
  };
  axisOrder: 'EN' | 'NE';
  units: 'metre';
  verticalHandling: 'ellipsoidal-only' | 'orthometric-supported' | 'none';
  generationMode: 'projected';
  projectionMethod: string;
  datum: string;
  datumRealization: string;
  status: CanadianCrsValidityStatus;
}

const EPSG_HOME_URL = 'https://epsg.org/';
const NRCAN_GEOSPATIAL_REFERENCE_URL =
  'https://natural-resources.canada.ca/earth-sciences/geodesy/geodetic-reference-systems/9050';
const QUEBEC_SCOPQ_URL = 'https://www.quebec.ca/gouvernement/ministere/ressources-naturelles';
const NEW_BRUNSWICK_PROJECTION_URL = 'https://www.snb.ca/geonb1/e/apps/geoNB-CTS-E.asp';
const PEI_SPATIAL_REFERENCE_URL =
  'https://www.princeedwardisland.ca/sites/default/files/legislation/l02-2-1-land_survey_act_spatial_referencing_regulations.pdf';
const ONTARIO_MNR_URL = 'https://data.ontario.ca/en/dataset/ontario-radar-digital-surface-model';
const BC_ALBERS_URL =
  'https://clss.nrcan.gc.ca/data-donnees/sgb-maps-dag-carte/carte-index-map/Metadata-Map-of-Canada-Lands-British-Columbia.html';
const ALBERTA_RESOURCE_URL =
  'https://www.alberta.ca/land-system-database-users-manual-features';

const toAreaOfUse = (bounds: CrsAreaOfUseBounds): CanadianCrsTestConfig['areaOfUse'] => ({
  westLon: bounds.minLonDeg,
  southLat: bounds.minLatDeg,
  eastLon: bounds.maxLonDeg,
  northLat: bounds.maxLatDeg,
});

const projectionMethodFor = (def: CrsDefinition): string => {
  switch (def.projectionFamily) {
    case 'utm':
      return 'Transverse Mercator (UTM)';
    case 'mtm':
      return 'Transverse Mercator (MTM)';
    case 'oblique-stereographic':
      return 'Double stereographic';
    case 'lambert-conformal-conic':
      return 'Lambert Conic Conformal (2SP)';
    case 'albers-equal-area':
      return 'Albers Equal Area';
    case 'transverse-mercator':
      return 'Transverse Mercator';
    default:
      return def.projectionFamily;
  }
};

const baseFromDefinition = (
  def: CrsDefinition,
  extras: Pick<
    CanadianCrsTestConfig,
    | 'authority'
    | 'code'
    | 'family'
    | 'provinceOrRegion'
    | 'sourceNotes'
    | 'sourceProvenance'
    | 'datumRealization'
    | 'status'
  >,
): CanadianCrsTestConfig => ({
  id: def.id,
  webnetCrsId: def.id,
  authority: extras.authority,
  code: extras.code,
  name: def.label,
  family: extras.family,
  provinceOrRegion: extras.provinceOrRegion,
  sourceNotes: extras.sourceNotes,
  sourceProvenance: extras.sourceProvenance,
  areaOfUse: toAreaOfUse(def.areaOfUseBounds ?? { minLonDeg: -141, minLatDeg: 41, maxLonDeg: -52, maxLatDeg: 84 }),
  axisOrder: 'EN',
  units: 'metre',
  verticalHandling: 'ellipsoidal-only',
  generationMode: 'projected',
  projectionMethod: projectionMethodFor(def),
  datum: def.datum,
  datumRealization: extras.datumRealization,
  status: extras.status,
});

const buildUtmRow = (def: CrsDefinition): CanadianCrsTestConfig =>
  baseFromDefinition(def, {
    authority: 'CUSTOM',
    code: undefined,
    family: 'UTM',
    provinceOrRegion: 'Canada',
    datumRealization: 'NAD83(CSRS) realization to be pinned per authority-backed zone entry',
    status: 'legacy-app-alias',
    sourceNotes: [
      'Current WebNet app alias keeps UTM projection parameters but is not yet pinned to one current EPSG realization code per zone.',
      'Synthetic harness keeps this alias explicit so later batches can swap to audited current EPSG realization entries without changing harness shape.',
    ],
    sourceProvenance: [
      {
        authority: 'EPSG',
        title: 'EPSG Geodetic Parameter Registry',
        organization: 'IOGP EPSG',
        reference: `UTM zone alias for ${def.id}`,
        url: EPSG_HOME_URL,
      },
      {
        authority: 'NRCan',
        title: 'Geodetic Reference Systems',
        organization: 'Natural Resources Canada',
        reference: 'Canadian reference-frame and projected-coordinate-system guidance',
        url: NRCAN_GEOSPATIAL_REFERENCE_URL,
      },
    ],
  });

const buildMtmRow = (def: CrsDefinition): CanadianCrsTestConfig =>
  baseFromDefinition(def, {
    authority: def.epsgCode ? 'EPSG' : 'CUSTOM',
    code: def.epsgCode ? Number(def.epsgCode) : undefined,
    family: 'MTM',
    provinceOrRegion: 'Quebec / Eastern Canada',
    datumRealization: 'NAD83(CSRS)',
    status: def.epsgCode ? 'current' : 'legacy-app-alias',
    sourceNotes: [
      'MTM coverage carries Quebec/SCoPQ relevance and stays separate from UTM family tests.',
      'Later batches should attach explicit SCoPQ alias rows where provincial naming differs from the EPSG title.',
    ],
    sourceProvenance: [
      {
        authority: 'EPSG',
        title: 'EPSG Geodetic Parameter Registry',
        organization: 'IOGP EPSG',
        reference: def.epsgCode ? `EPSG:${def.epsgCode}` : def.id,
        url: EPSG_HOME_URL,
      },
      {
        authority: 'Province',
        title: 'Quebec provincial geospatial reference guidance',
        organization: 'Quebec government',
        reference: 'SCoPQ / MTM naming audit anchor',
        url: QUEBEC_SCOPQ_URL,
      },
    ],
  });

const buildProvincialRow = (def: CrsDefinition): CanadianCrsTestConfig => {
  const provinceUrl =
    def.id === 'CA_NAD83_CSRS_NB_STEREO_DOUBLE'
      ? NEW_BRUNSWICK_PROJECTION_URL
      : def.id === 'CA_NAD83_CSRS_PEI_STEREOGRAPHIC'
        ? PEI_SPATIAL_REFERENCE_URL
        : def.id === 'CA_NAD83_CSRS_ON_MNR_LAMBERT'
          ? ONTARIO_MNR_URL
          : def.id === 'CA_NAD83_CSRS_BC_ALBERS'
            ? BC_ALBERS_URL
            : ALBERTA_RESOURCE_URL;
  const provinceReference =
    def.id === 'CA_NAD83_CSRS_NB_STEREO_DOUBLE'
      ? 'NB Stereographic Double Projection official usage guidance'
      : def.id === 'CA_NAD83_CSRS_PEI_STEREOGRAPHIC'
        ? 'PEI spatial referencing regulations for stereographic double projection'
        : def.id === 'CA_NAD83_CSRS_ON_MNR_LAMBERT'
          ? 'Ontario MNR Lambert data publication guidance'
          : def.id === 'CA_NAD83_CSRS_BC_ALBERS'
            ? 'NRCan Canada Lands metadata citing EPSG:3153'
            : 'Alberta provincial resource mapping guidance for 10TM';
  return baseFromDefinition(def, {
    authority: def.epsgCode ? 'EPSG' : 'CUSTOM',
    code: def.epsgCode ? Number(def.epsgCode) : undefined,
    family: 'PROVINCIAL',
    provinceOrRegion: def.areaOfUse,
    datumRealization: 'NAD83(CSRS)',
    status: def.epsgCode ? 'current' : 'legacy-app-alias',
    sourceNotes:
      def.id === 'CA_NAD83_CSRS_AB_10TM_RESOURCE'
        ? [
            'Current WebNet provincial Alberta coverage is 10TM resource mapping, not Alberta 3TM yet.',
            'Alberta 3TM authority-backed additions belong to later harness batches once CRS support is added to the app catalog.',
          ]
        : ['Provincial source captured so harness provenance stays auditable alongside EPSG metadata.'],
    sourceProvenance: [
      {
        authority: 'EPSG',
        title: 'EPSG Geodetic Parameter Registry',
        organization: 'IOGP EPSG',
        reference: def.epsgCode ? `EPSG:${def.epsgCode}` : def.id,
        url: EPSG_HOME_URL,
      },
      {
        authority: def.id === 'CA_NAD83_CSRS_BC_ALBERS' ? 'NRCan' : 'Province',
        title:
          def.id === 'CA_NAD83_CSRS_BC_ALBERS'
            ? 'NRCan Canada Lands metadata'
            : 'Provincial CRS usage guidance',
        organization:
          def.id === 'CA_NAD83_CSRS_BC_ALBERS'
            ? 'Natural Resources Canada'
            : 'Provincial authority',
        reference: provinceReference,
        url: provinceUrl,
      },
    ],
  });
};

export const CANADIAN_CRS_TEST_CATALOG: CanadianCrsTestConfig[] = CANADA_CRS_CATALOG.map((def) => {
  if (def.catalogGroup === 'canada-utm') return buildUtmRow(def);
  if (def.catalogGroup === 'canada-mtm') return buildMtmRow(def);
  return buildProvincialRow(def);
});

export const getCanadianCrsTestConfig = (id: string): CanadianCrsTestConfig | undefined =>
  CANADIAN_CRS_TEST_CATALOG.find((row) => row.id === id || row.webnetCrsId === id);

export const getCanadianCrsDefinitionForTest = (id: string): CrsDefinition => {
  const def = getCrsDefinition(id);
  if (!def) {
    throw new Error(`Unknown Canadian CRS test config: ${id}`);
  }
  return def;
};

export const formatCanadianCrsCatalogReport = (
  catalog: CanadianCrsTestConfig[] = CANADIAN_CRS_TEST_CATALOG,
): string => {
  const lines = ['Canadian CRS synthetic harness catalog', ''];
  catalog.forEach((row) => {
    const code = row.code != null ? `${row.authority}:${row.code}` : row.authority;
    const area = row.areaOfUse;
    lines.push(`${row.id}`);
    lines.push(`  code: ${code}`);
    lines.push(`  name: ${row.name}`);
    lines.push(`  family: ${row.family}`);
    lines.push(`  datum: ${row.datumRealization}`);
    lines.push(`  projection: ${row.projectionMethod}`);
    lines.push(`  axis: ${row.axisOrder}`);
    lines.push(
      `  area: W ${area.westLon.toFixed(3)} / S ${area.southLat.toFixed(3)} / E ${area.eastLon.toFixed(3)} / N ${area.northLat.toFixed(3)}`,
    );
    lines.push(`  status: ${row.status}`);
    lines.push(
      `  sources: ${row.sourceProvenance.map((source) => `${source.authority} ${source.reference}`).join(' | ')}`,
    );
    if (row.sourceNotes.length > 0) {
      lines.push(`  notes: ${row.sourceNotes.join(' ')}`);
    }
    lines.push('');
  });
  return lines.join('\n').trimEnd();
};
