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
const QUEBEC_EPSG_CODES_URL = 'https://www.mrnf.gouv.qc.ca/wp-content/uploads/CO_codes_epsg_quebec.pdf';
const NOVA_SCOTIA_CRS_URL =
  'https://geonova.novascotia.ca/sites/default/files/resource-library/NSCRS%20Technical%20Support%200004%20Projections%2029Feb2016.pdf';
const NEW_BRUNSWICK_PROJECTION_URL = 'https://www.snb.ca/geonb1/e/apps/geoNB-CTS-E.asp';
const PEI_SPATIAL_REFERENCE_URL =
  'https://www.princeedwardisland.ca/sites/default/files/legislation/l02-2-1-land_survey_act_spatial_referencing_regulations.pdf';
const ONTARIO_MNR_URL = 'https://data.ontario.ca/en/dataset/ontario-radar-digital-surface-model';
const BC_ALBERS_URL =
  'https://clss.nrcan.gc.ca/data-donnees/sgb-maps-dag-carte/carte-index-map/Metadata-Map-of-Canada-Lands-British-Columbia.html';
const CANADA_ATLAS_LAMBERT_URL =
  'https://natural-resources.canada.ca/earth-sciences/geodesy/geodetic-reference-systems/9050';
const ALBERTA_RESOURCE_URL =
  'https://www.alberta.ca/system/files/custom_downloaded_images/ep-sample-id-card-ascm.pdf';
const ONTARIO_TERANET_URL = 'https://www.teranetexpress.ca/csp/';
const SASKATCHEWAN_RESOURCE_URL =
  'https://training.saskatchewan.ca/EnergyAndResources/Files/Notices/2022/MRO%20177-22.pdf';
const MANITOBA_RESOURCE_URL =
  'https://www.gov.mb.ca/sd/research-data-and-maps/geomanitoba/geospatial-data-acquisition/index.html';
const NUNAVUT_RESOURCE_URL =
  'https://clss.nrcan-rncan.gc.ca/data-donnees/sgb-maps-dag-carte/carte-index-map/Metadata-Map-of-Canada-Lands-Nunavut.html';
const YUKON_RESOURCE_URL = 'https://yukon.ca/en/map-services';
const NWT_RESOURCE_URL = 'https://www.nwtgeoscience.ca/metadata.htm';

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
    authority: def.epsgCode ? 'EPSG' : 'CUSTOM',
    code: def.epsgCode ? Number(def.epsgCode) : undefined,
    family: 'UTM',
    provinceOrRegion: 'Canada',
    datumRealization: def.datumRealization ?? 'NAD83(CSRS)v8',
    status: def.validityStatus ?? 'current',
    sourceNotes: [
      'Current WebNet UTM rows are pinned to explicit EPSG v8 realization codes while preserving stable internal ids.',
      'EPSG notes that the older “NAD83(CSRS) 2010 / UTM zone XXN Canada” naming is ambiguous across v6/v7/v8 and should not be treated as one unversioned CRS.',
    ],
    sourceProvenance: [
      {
        authority: 'EPSG',
        title: 'EPSG Geodetic Parameter Registry',
        organization: 'IOGP EPSG',
        reference: def.epsgCode ? `EPSG:${def.epsgCode}` : `UTM zone alias for ${def.id}`,
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
    datumRealization: def.datumRealization ?? 'NAD83(CSRS)',
    status: def.validityStatus ?? (def.epsgCode ? 'current' : 'legacy-app-alias'),
    sourceNotes: [
      'MTM coverage carries Quebec/SCoPQ relevance and stays separate from UTM family tests.',
      'Later batches should attach explicit SCoPQ alias rows where provincial naming differs from the EPSG title.',
    ],
    sourceProvenance: [
      {
        authority: 'EPSG',
        title: 'EPSG Geodetic Parameter Registry',
        organization: 'IOGP EPSG',
        reference:
          def.id === 'CA_NAD83_CSRS_SK_ATS'
            ? 'Alias maps to EPSG:22813 (NAD83(CSRS)v8 / UTM zone 13N)'
            : def.id === 'CA_NAD83_CSRS_MB_3TM'
              ? 'Alias maps to EPSG:26897 (NAD83(CSRS) / MTM zone 17)'
              : def.id === 'CA_NAD83_CSRS_YT_TM'
                  ? 'Alias maps to EPSG:22808 (NAD83(CSRS)v8 / UTM zone 8N)'
                  : def.id === 'CA_NAD83_CSRS_NT_TM'
                    ? 'Alias maps to EPSG:22810 (NAD83(CSRS)v8 / UTM zone 10N)'
              : def.epsgCode
                ? `EPSG:${def.epsgCode}`
                : def.id,
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
    def.id === 'CA_NAD83_CSRS_QC_LAMBERT'
      ? QUEBEC_EPSG_CODES_URL
      : def.id === 'CA_NAD83_CSRS_NS_MTM_2010_4' || def.id === 'CA_NAD83_CSRS_NS_MTM_2010_5'
        ? NOVA_SCOTIA_CRS_URL
      : def.id === 'CA_NAD83_CSRS_NB_STEREO_DOUBLE'
      ? NEW_BRUNSWICK_PROJECTION_URL
      : def.id === 'CA_NAD83_CSRS_PEI_STEREOGRAPHIC'
        ? PEI_SPATIAL_REFERENCE_URL
      : def.id === 'CA_NAD83_CSRS_ON_MNR_LAMBERT'
          ? ONTARIO_MNR_URL
          : def.id === 'CA_NAD83_CSRS_SK_ATS'
            ? SASKATCHEWAN_RESOURCE_URL
            : def.id === 'CA_NAD83_CSRS_MB_3TM'
              ? MANITOBA_RESOURCE_URL
              : def.id === 'CA_NAD83_CSRS_NU_STEREOGRAPHIC'
                ? NUNAVUT_RESOURCE_URL
              : def.id === 'CA_NAD83_CSRS_CA_ATLAS_LAMBERT' ||
                  def.id === 'CA_NAD83_CSRS_ARCTIC_LCC_3_29'
                ? CANADA_ATLAS_LAMBERT_URL
              : def.id === 'CA_NAD83_CSRS_ON_TERANET_LAMBERT'
                ? ONTARIO_TERANET_URL
              : def.id === 'CA_NAD83_CSRS_YT_ALBERS'
                ? YUKON_RESOURCE_URL
              : def.id === 'CA_NAD83_CSRS_NT_LAMBERT'
                ? NWT_RESOURCE_URL
              : def.id === 'CA_NAD83_CSRS_YT_TM'
                  ? YUKON_RESOURCE_URL
                  : def.id === 'CA_NAD83_CSRS_NT_TM'
                    ? NWT_RESOURCE_URL
            : def.id === 'CA_NAD83_CSRS_BC_ALBERS'
            ? BC_ALBERS_URL
            : ALBERTA_RESOURCE_URL;
  const provinceReference =
    def.id === 'CA_NAD83_CSRS_QC_LAMBERT'
      ? 'Quebec EPSG projected-code guidance for MTQ Lambert workflows'
      : def.id === 'CA_NAD83_CSRS_NS_MTM_2010_4' || def.id === 'CA_NAD83_CSRS_NS_MTM_2010_5'
        ? 'Nova Scotia coordinate reference system MTM 2010 zone guidance'
      : def.id === 'CA_NAD83_CSRS_NB_STEREO_DOUBLE'
      ? 'NB Stereographic Double Projection official usage guidance'
      : def.id === 'CA_NAD83_CSRS_PEI_STEREOGRAPHIC'
        ? 'PEI spatial referencing regulations for stereographic double projection'
      : def.id === 'CA_NAD83_CSRS_ON_MNR_LAMBERT'
          ? 'Ontario MNR Lambert data publication guidance'
        : def.id === 'CA_NAD83_CSRS_SK_ATS'
            ? 'Saskatchewan operational UTM Extended Zone 13N guidance (ATS-style workflow alias)'
        : def.id === 'CA_NAD83_CSRS_MB_3TM'
            ? 'Manitoba GeoManitoba operational geospatial workflow guidance (3TM-style alias)'
          : def.id === 'CA_NAD83_CSRS_NU_STEREOGRAPHIC'
            ? 'NRCan Canada Lands Nunavut metadata usage guidance (EPSG:3977 LCC operational reference)'
          : def.id === 'CA_NAD83_CSRS_CA_ATLAS_LAMBERT'
            ? 'NRCan geodetic reference guidance for Canada Atlas Lambert'
          : def.id === 'CA_NAD83_CSRS_ARCTIC_LCC_3_29'
            ? 'EPSG Arctic zone guidance for NAD83(CSRS) Canadian Arctic workflows'
          : def.id === 'CA_NAD83_CSRS_ON_TERANET_LAMBERT'
            ? 'Teranet Ontario projected workflow guidance'
          : def.id === 'CA_NAD83_CSRS_YT_ALBERS'
            ? 'Yukon Albers projected workflow guidance'
          : def.id === 'CA_NAD83_CSRS_NT_LAMBERT'
            ? 'NWT Lambert projected workflow guidance'
            : def.id === 'CA_NAD83_CSRS_YT_TM'
              ? 'Yukon territorial mapping guidance (TM-style projected alias)'
              : def.id === 'CA_NAD83_CSRS_NT_TM'
                ? 'NWT territorial mapping guidance (TM-style projected alias)'
        : def.id === 'CA_NAD83_CSRS_BC_ALBERS'
            ? 'NRCan Canada Lands metadata citing EPSG:3153'
            : def.id.startsWith('CA_NAD83_CSRS_AB_3TM_')
              ? 'Alberta Surveying and Mapping Division 3TM reference guidance'
              : 'Alberta provincial resource mapping guidance for 10TM';
  return baseFromDefinition(def, {
    authority: def.epsgCode ? 'EPSG' : 'CUSTOM',
    code: def.epsgCode ? Number(def.epsgCode) : undefined,
    family: 'PROVINCIAL',
    provinceOrRegion: def.areaOfUse,
    datumRealization: def.datumRealization ?? 'NAD83(CSRS)',
    status: def.validityStatus ?? (def.epsgCode ? 'current' : 'legacy-app-alias'),
    sourceNotes:
      def.id === 'CA_NAD83_CSRS_QC_LAMBERT'
        ? [
            'Quebec MTQ Lambert (EPSG:3799) is tracked as a provincial projected workflow independent from MTM zone rows.',
            'EPSG:6622 remains a separate realization-specific Quebec Lambert code and is tracked as a compatibility candidate, not an alias, until workflow requirements justify adding it.',
          ]
        : def.id === 'CA_NAD83_CSRS_NS_MTM_2010_4' || def.id === 'CA_NAD83_CSRS_NS_MTM_2010_5'
          ? [
              'Nova Scotia MTM 2010 coverage uses EPSG v6 CRS rows with province-specific false eastings.',
              'These rows complement, not replace, the existing Canada-wide MTM catalog family.',
            ]
          : def.id.startsWith('CA_NAD83_CSRS_AB_3TM_')
        ? [
            'Alberta 3TM urban survey rows are now part of the harness and use explicit EPSG v7 realization codes.',
            'These rows complement, not replace, Alberta 10TM resource mapping coverage.',
          ]
        : def.id === 'CA_NAD83_CSRS_SK_ATS'
        ? [
            'Saskatchewan ATS is modeled as an operational naming alias to the current NAD83(CSRS)v8 UTM zone 13 projection constants.',
            'EPSG does not publish a separate NAD83(CSRS) ATS projected CRS title; this row preserves provincial workflow naming while keeping the canonical UTM implementation stable.',
          ]
        : def.id === 'CA_NAD83_CSRS_MB_3TM'
        ? [
            'Manitoba 3TM is modeled as an operational naming alias to a NAD83(CSRS) 3-degree TM (MTM zone 17 style) projection contract.',
            'EPSG does not publish a distinct NAD83(CSRS) Manitoba 3TM title; this row keeps provincial naming available without replacing existing MTM zone rows.',
          ]
        : def.id === 'CA_NAD83_CSRS_NU_STEREOGRAPHIC'
        ? [
            'Nunavut projected workflow is mapped to EPSG:3977 (Canada Atlas Lambert) per NRCan metadata usage guidance.',
            'This remains an operational alias row so Nunavut naming stays explicit while projection constants remain EPSG-traceable.',
          ]
        : def.id === 'CA_NAD83_CSRS_CA_ATLAS_LAMBERT'
        ? [
            'Canada Atlas Lambert is tracked directly as EPSG:3979 for national Lambert workflows.',
            'This row is distinct from the Nunavut operational alias row to keep national-vs-territorial usage explicit.',
          ]
        : def.id === 'CA_NAD83_CSRS_ARCTIC_LCC_3_29'
        ? [
            'Arctic Zone 3-29 is tracked as EPSG:6103 for high-latitude Canadian Arctic mapping workflows.',
            'This row complements existing UTM/MTM and provincial rows for polar-area operations.',
          ]
        : def.id === 'CA_NAD83_CSRS_ON_TERANET_LAMBERT'
        ? [
            'Teranet Ontario Lambert is tracked as EPSG:5321 for Ontario land-registry interoperability workflows.',
            'This row is maintained separately from Ontario MNR Lambert because the projection constants differ.',
          ]
        : def.id === 'CA_NAD83_CSRS_YT_ALBERS'
        ? [
            'Yukon Albers is tracked directly as EPSG:3579 as a distinct equal-area projection workflow.',
            'This row complements Yukon TM alias coverage for workflows that require the Albers contract.',
          ]
        : def.id === 'CA_NAD83_CSRS_NT_LAMBERT'
        ? [
            'NWT Lambert is tracked directly as EPSG:3581 as a distinct Lambert projection workflow.',
            'This row complements NWT TM alias coverage for workflows that require Lambert parameters.',
          ]
        : def.id === 'CA_NAD83_CSRS_YT_TM'
        ? [
            'Yukon TM is modeled as an operational alias to a NAD83(CSRS)v8 UTM-zone transverse-Mercator contract.',
            'The alias preserves territorial naming while leaving canonical UTM rows unchanged.',
          ]
        : def.id === 'CA_NAD83_CSRS_NT_TM'
        ? [
            'NWT TM is modeled as an operational alias to a NAD83(CSRS)v8 UTM-zone transverse-Mercator contract.',
            'The alias preserves territorial naming while leaving canonical UTM rows unchanged.',
          ]
        : def.id === 'CA_NAD83_CSRS_QC_MUNICIPAL_LCC'
        ? [
            'Quebec municipal LCC coverage is mapped to EPSG:6622 (NAD83(CSRS)v2 / Quebec Lambert) as an explicit compatibility workflow row.',
            'This row is kept separate from EPSG:3799 so realization-specific municipal interoperability contracts remain explicit.',
          ]
        : def.id === 'CA_NAD83_CSRS_AB_10TM_RESOURCE'
        ? [
            'Alberta 10TM remains part of the provincial harness because WebNet already supports it for broader resource-mapping coverage.',
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
        authority:
          def.id === 'CA_NAD83_CSRS_BC_ALBERS' ||
          def.id === 'CA_NAD83_CSRS_CA_ATLAS_LAMBERT' ||
          def.id === 'CA_NAD83_CSRS_ARCTIC_LCC_3_29'
            ? 'NRCan'
            : 'Province',
        title:
          def.id === 'CA_NAD83_CSRS_BC_ALBERS' ||
          def.id === 'CA_NAD83_CSRS_CA_ATLAS_LAMBERT' ||
          def.id === 'CA_NAD83_CSRS_ARCTIC_LCC_3_29'
            ? 'NRCan Canada Lands metadata'
            : 'Provincial CRS usage guidance',
        organization:
          def.id === 'CA_NAD83_CSRS_BC_ALBERS' ||
          def.id === 'CA_NAD83_CSRS_CA_ATLAS_LAMBERT' ||
          def.id === 'CA_NAD83_CSRS_ARCTIC_LCC_3_29'
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
