import { describe, expect, it } from 'vitest';

import {
  CRS_CATALOG,
  CANADA_CRS_CATALOG,
  DEFAULT_CANADA_CRS_ID,
  getCrsDefinition,
  resolveCrsDefinition,
} from '../src/engine/crsCatalog';
import {
  computeClassicTraverseLegacyDisplayGridFactors,
  computeGridFactors,
  inverseClassicTraverseDisplayGeodetic,
  inverseENToGeodetic,
  projectGeodeticToEN,
} from '../src/engine/geodesy';

describe('Canada CRS catalog (Phase 2 expansion)', () => {
  it('keeps default UTM id and includes MTM + provincial entries', () => {
    expect(resolveCrsDefinition().id).toBe(DEFAULT_CANADA_CRS_ID);

    expect(CANADA_CRS_CATALOG.some((row) => row.id === 'CA_NAD83_CSRS_MTM_01')).toBe(true);
    expect(CANADA_CRS_CATALOG.some((row) => row.id === 'CA_NAD83_CSRS_MTM_10')).toBe(true);
    expect(CANADA_CRS_CATALOG.some((row) => row.id === 'CA_NAD83_CSRS_NB_STEREO_DOUBLE')).toBe(
      true,
    );
    expect(CANADA_CRS_CATALOG.some((row) => row.id === 'CA_NAD83_CSRS_QC_LAMBERT')).toBe(true);
    expect(CANADA_CRS_CATALOG.some((row) => row.id === 'CA_NAD83_CSRS_NS_MTM_2010_4')).toBe(true);
    expect(CANADA_CRS_CATALOG.some((row) => row.id === 'CA_NAD83_CSRS_NS_MTM_2010_5')).toBe(true);
    expect(CANADA_CRS_CATALOG.some((row) => row.id === 'CA_NAD83_CSRS_SK_ATS')).toBe(true);
    expect(CANADA_CRS_CATALOG.some((row) => row.id === 'CA_NAD83_CSRS_MB_3TM')).toBe(true);
    expect(CANADA_CRS_CATALOG.some((row) => row.id === 'CA_NAD83_CSRS_NU_STEREOGRAPHIC')).toBe(true);
    expect(CANADA_CRS_CATALOG.some((row) => row.id === 'CA_NAD83_CSRS_YT_TM')).toBe(true);
    expect(CANADA_CRS_CATALOG.some((row) => row.id === 'CA_NAD83_CSRS_NT_TM')).toBe(true);
    expect(CANADA_CRS_CATALOG.some((row) => row.id === 'CA_NAD83_CSRS_QC_MUNICIPAL_LCC')).toBe(true);
    expect(CANADA_CRS_CATALOG.some((row) => row.id === 'CA_NAD83_CSRS_ON_MNR_LAMBERT')).toBe(true);
    expect(CANADA_CRS_CATALOG.some((row) => row.id === 'CA_NAD83_CSRS_AB_3TM_117W')).toBe(true);
    expect(CANADA_CRS_CATALOG.some((row) => row.id === 'CA_NAD83_CSRS_AB_10TM_FOREST')).toBe(true);
    expect(CANADA_CRS_CATALOG.some((row) => row.id === 'CA_NAD83_CSRS_YT_ALBERS')).toBe(true);
    expect(CANADA_CRS_CATALOG.some((row) => row.id === 'CA_NAD83_CSRS_NT_LAMBERT')).toBe(true);
    expect(CANADA_CRS_CATALOG.some((row) => row.id === 'CA_NAD83_CSRS_CA_ATLAS_LAMBERT')).toBe(true);
    expect(CANADA_CRS_CATALOG.some((row) => row.id === 'CA_NAD83_CSRS_ON_TERANET_LAMBERT')).toBe(true);
    expect(CANADA_CRS_CATALOG.some((row) => row.id === 'CA_NAD83_CSRS_ARCTIC_LCC_3_29')).toBe(true);
    expect(CRS_CATALOG.some((row) => row.id === 'US_NAD83_2011_SPCS_NY_EAST')).toBe(true);
    expect(CRS_CATALOG.some((row) => row.id === 'US_NAD83_2011_SPCS_NY_CENTRAL')).toBe(true);
    expect(CRS_CATALOG.some((row) => row.id === 'US_NAD83_2011_SPCS_NY_WEST')).toBe(true);
    expect(CRS_CATALOG.some((row) => row.id === 'US_NAD83_2011_SPCS_NY_EAST_FTUS')).toBe(true);
    expect(CRS_CATALOG.some((row) => row.id === 'US_NAD83_2011_SPCS_NY_CENTRAL_FTUS')).toBe(true);
    expect(CRS_CATALOG.some((row) => row.id === 'US_NAD83_2011_SPCS_NY_WEST_FTUS')).toBe(true);
    expect(CRS_CATALOG.some((row) => row.id === 'US_NAD83_2011_SPCS_CA_ZONE_1')).toBe(true);
    expect(CRS_CATALOG.some((row) => row.id === 'US_NAD83_2011_SPCS_CA_ZONE_2')).toBe(true);
    expect(CRS_CATALOG.some((row) => row.id === 'US_NAD83_2011_SPCS_CA_ZONE_3')).toBe(true);
    expect(CRS_CATALOG.some((row) => row.id === 'US_NAD83_2011_SPCS_CA_ZONE_1_FTUS')).toBe(true);
    expect(CRS_CATALOG.some((row) => row.id === 'US_NAD83_2011_SPCS_CA_ZONE_2_FTUS')).toBe(true);
    expect(CRS_CATALOG.some((row) => row.id === 'US_NAD83_2011_SPCS_CA_ZONE_3_FTUS')).toBe(true);
    expect(CRS_CATALOG.some((row) => row.id === 'US_NAD83_2011_SPCS_CA_ZONE_4')).toBe(true);
    expect(CRS_CATALOG.some((row) => row.id === 'US_NAD83_2011_SPCS_CA_ZONE_4_FTUS')).toBe(true);
    expect(CRS_CATALOG.some((row) => row.id === 'US_NAD83_2011_SPCS_CA_ZONE_5')).toBe(true);
    expect(CRS_CATALOG.some((row) => row.id === 'US_NAD83_2011_SPCS_CA_ZONE_5_FTUS')).toBe(true);
    expect(CRS_CATALOG.some((row) => row.id === 'US_NAD83_2011_SPCS_CA_ZONE_6')).toBe(true);
    expect(CRS_CATALOG.some((row) => row.id === 'US_NAD83_2011_SPCS_CA_ZONE_6_FTUS')).toBe(true);
    expect(CRS_CATALOG.some((row) => row.id === 'US_NAD83_2011_SPCS_PA_NORTH')).toBe(true);
    expect(CRS_CATALOG.some((row) => row.id === 'US_NAD83_2011_SPCS_PA_NORTH_FTUS')).toBe(true);
    expect(CRS_CATALOG.some((row) => row.id === 'US_NAD83_2011_SPCS_PA_SOUTH')).toBe(true);
    expect(CRS_CATALOG.some((row) => row.id === 'US_NAD83_2011_SPCS_PA_SOUTH_FTUS')).toBe(true);
    expect(CRS_CATALOG.some((row) => row.id === 'US_NAD83_2011_SPCS_TX_NORTH')).toBe(true);
    expect(CRS_CATALOG.some((row) => row.id === 'US_NAD83_2011_SPCS_TX_NORTH_FTUS')).toBe(true);
    expect(CRS_CATALOG.some((row) => row.id === 'US_NAD83_2011_SPCS_TX_NORTH_CENTRAL')).toBe(true);
    expect(CRS_CATALOG.some((row) => row.id === 'US_NAD83_2011_SPCS_TX_NORTH_CENTRAL_FTUS')).toBe(true);
    expect(CRS_CATALOG.some((row) => row.id === 'US_NAD83_2011_SPCS_TX_CENTRAL')).toBe(true);
    expect(CRS_CATALOG.some((row) => row.id === 'US_NAD83_2011_SPCS_TX_CENTRAL_FTUS')).toBe(true);
    expect(CRS_CATALOG.some((row) => row.id === 'US_NAD83_2011_SPCS_TX_SOUTH_CENTRAL')).toBe(true);
    expect(CRS_CATALOG.some((row) => row.id === 'US_NAD83_2011_SPCS_TX_SOUTH_CENTRAL_FTUS')).toBe(
      true,
    );
    expect(CRS_CATALOG.some((row) => row.id === 'US_NAD83_2011_SPCS_TX_SOUTH')).toBe(true);
    expect(CRS_CATALOG.some((row) => row.id === 'US_NAD83_2011_SPCS_TX_SOUTH_FTUS')).toBe(true);
    expect(CRS_CATALOG.some((row) => row.id === 'US_NAD83_2011_SPCS_FL_EAST')).toBe(true);
    expect(CRS_CATALOG.some((row) => row.id === 'US_NAD83_2011_SPCS_FL_EAST_FTUS')).toBe(true);
    expect(CRS_CATALOG.some((row) => row.id === 'US_NAD83_2011_SPCS_FL_NORTH')).toBe(true);
    expect(CRS_CATALOG.some((row) => row.id === 'US_NAD83_2011_SPCS_FL_NORTH_FTUS')).toBe(true);
    expect(CRS_CATALOG.some((row) => row.id === 'US_NAD83_2011_SPCS_FL_WEST')).toBe(true);
    expect(CRS_CATALOG.some((row) => row.id === 'US_NAD83_2011_SPCS_FL_WEST_FTUS')).toBe(true);
    expect(CRS_CATALOG.some((row) => row.id === 'US_NAD83_2011_SPCS_GA_EAST')).toBe(true);
    expect(CRS_CATALOG.some((row) => row.id === 'US_NAD83_2011_SPCS_GA_EAST_FTUS')).toBe(true);
    expect(CRS_CATALOG.some((row) => row.id === 'US_NAD83_2011_SPCS_GA_WEST')).toBe(true);
    expect(CRS_CATALOG.some((row) => row.id === 'US_NAD83_2011_SPCS_GA_WEST_FTUS')).toBe(true);
    expect(CRS_CATALOG.some((row) => row.id === 'US_NAD83_2011_SPCS_NC')).toBe(true);
    expect(CRS_CATALOG.some((row) => row.id === 'US_NAD83_2011_SPCS_NC_FTUS')).toBe(true);
    expect(CRS_CATALOG.some((row) => row.id === 'US_NAD83_2011_SPCS_AL_EAST')).toBe(true);
    expect(CRS_CATALOG.some((row) => row.id === 'US_NAD83_2011_SPCS_AL_EAST_FTUS')).toBe(true);
    expect(CRS_CATALOG.some((row) => row.id === 'US_NAD83_2011_SPCS_AL_WEST')).toBe(true);
    expect(CRS_CATALOG.some((row) => row.id === 'US_NAD83_2011_SPCS_AL_WEST_FTUS')).toBe(true);
    expect(CRS_CATALOG.some((row) => row.id === 'US_NAD83_2011_SPCS_TN')).toBe(true);
    expect(CRS_CATALOG.some((row) => row.id === 'US_NAD83_2011_SPCS_TN_FTUS')).toBe(true);
    expect(CRS_CATALOG.some((row) => row.id === 'US_NAD83_2011_SPCS_KY_NORTH')).toBe(true);
    expect(CRS_CATALOG.some((row) => row.id === 'US_NAD83_2011_SPCS_KY_NORTH_FTUS')).toBe(true);
    expect(CRS_CATALOG.some((row) => row.id === 'US_NAD83_2011_SPCS_KY_SINGLE_ZONE')).toBe(true);
    expect(CRS_CATALOG.some((row) => row.id === 'US_NAD83_2011_SPCS_KY_SINGLE_ZONE_FTUS')).toBe(
      true,
    );
    expect(CRS_CATALOG.some((row) => row.id === 'US_NAD83_2011_SPCS_KY_SOUTH')).toBe(true);
    expect(CRS_CATALOG.some((row) => row.id === 'US_NAD83_2011_SPCS_KY_SOUTH_FTUS')).toBe(true);
    expect(CRS_CATALOG.some((row) => row.id === 'US_NAD83_2011_SPCS_RI')).toBe(true);
    expect(CRS_CATALOG.some((row) => row.id === 'US_NAD83_2011_SPCS_RI_FTUS')).toBe(true);
    expect(CRS_CATALOG.some((row) => row.id === 'US_NAD83_2011_SPCS_SD_NORTH')).toBe(true);
    expect(CRS_CATALOG.some((row) => row.id === 'US_NAD83_2011_SPCS_SD_NORTH_FTUS')).toBe(true);
    expect(CRS_CATALOG.some((row) => row.id === 'US_NAD83_2011_SPCS_SD_SOUTH')).toBe(true);
    expect(CRS_CATALOG.some((row) => row.id === 'US_NAD83_2011_SPCS_SD_SOUTH_FTUS')).toBe(true);
    expect(CRS_CATALOG.some((row) => row.id === 'US_NAD83_2011_SPCS_VT')).toBe(true);
    expect(CRS_CATALOG.some((row) => row.id === 'US_NAD83_2011_SPCS_VT_FTUS')).toBe(true);
    expect(CRS_CATALOG.some((row) => row.id === 'US_NAD83_2011_SPCS_VA_NORTH')).toBe(true);
    expect(CRS_CATALOG.some((row) => row.id === 'US_NAD83_2011_SPCS_VA_NORTH_FTUS')).toBe(true);
    expect(CRS_CATALOG.some((row) => row.id === 'US_NAD83_2011_SPCS_VA_SOUTH')).toBe(true);
    expect(CRS_CATALOG.some((row) => row.id === 'US_NAD83_2011_SPCS_VA_SOUTH_FTUS')).toBe(true);
    expect(CRS_CATALOG.some((row) => row.id === 'US_NAD83_2011_SPCS_WA_NORTH')).toBe(true);
    expect(CRS_CATALOG.some((row) => row.id === 'US_NAD83_2011_SPCS_WA_NORTH_FTUS')).toBe(true);
    expect(CRS_CATALOG.some((row) => row.id === 'US_NAD83_2011_SPCS_WA_SOUTH')).toBe(true);
    expect(CRS_CATALOG.some((row) => row.id === 'US_NAD83_2011_SPCS_WA_SOUTH_FTUS')).toBe(true);
    expect(CRS_CATALOG.some((row) => row.id === 'US_NAD83_2011_SPCS_WV_NORTH')).toBe(true);
    expect(CRS_CATALOG.some((row) => row.id === 'US_NAD83_2011_SPCS_WV_NORTH_FTUS')).toBe(true);
    expect(CRS_CATALOG.some((row) => row.id === 'US_NAD83_2011_SPCS_WV_SOUTH')).toBe(true);
    expect(CRS_CATALOG.some((row) => row.id === 'US_NAD83_2011_SPCS_WV_SOUTH_FTUS')).toBe(true);
    expect(CRS_CATALOG.some((row) => row.id === 'US_NAD83_2011_SPCS_WI_CENTRAL')).toBe(true);
    expect(CRS_CATALOG.some((row) => row.id === 'US_NAD83_2011_SPCS_WI_CENTRAL_FTUS')).toBe(true);
    expect(CRS_CATALOG.some((row) => row.id === 'US_NAD83_2011_SPCS_WI_NORTH')).toBe(true);
    expect(CRS_CATALOG.some((row) => row.id === 'US_NAD83_2011_SPCS_WI_NORTH_FTUS')).toBe(true);
    expect(CRS_CATALOG.some((row) => row.id === 'US_NAD83_2011_SPCS_WI_SOUTH')).toBe(true);
    expect(CRS_CATALOG.some((row) => row.id === 'US_NAD83_2011_SPCS_WI_SOUTH_FTUS')).toBe(true);
    expect(CRS_CATALOG.some((row) => row.id === 'US_NAD83_2011_SPCS_WY_EAST')).toBe(true);
    expect(CRS_CATALOG.some((row) => row.id === 'US_NAD83_2011_SPCS_WY_EAST_FTUS')).toBe(true);
    expect(CRS_CATALOG.some((row) => row.id === 'US_NAD83_2011_SPCS_WY_EAST_CENTRAL')).toBe(true);
    expect(CRS_CATALOG.some((row) => row.id === 'US_NAD83_2011_SPCS_WY_EAST_CENTRAL_FTUS')).toBe(
      true,
    );
    expect(CRS_CATALOG.some((row) => row.id === 'US_NAD83_2011_SPCS_WY_WEST')).toBe(true);
    expect(CRS_CATALOG.some((row) => row.id === 'US_NAD83_2011_SPCS_WY_WEST_FTUS')).toBe(true);
    expect(CRS_CATALOG.some((row) => row.id === 'US_NAD83_2011_SPCS_WY_WEST_CENTRAL')).toBe(true);
    expect(CRS_CATALOG.some((row) => row.id === 'US_NAD83_2011_SPCS_WY_WEST_CENTRAL_FTUS')).toBe(
      true,
    );
    expect(CRS_CATALOG.some((row) => row.id === 'US_NAD83_2011_SPCS_UT_CENTRAL')).toBe(true);
    expect(CRS_CATALOG.some((row) => row.id === 'US_NAD83_2011_SPCS_UT_CENTRAL_FTUS')).toBe(true);
    expect(CRS_CATALOG.some((row) => row.id === 'US_NAD83_2011_SPCS_UT_NORTH')).toBe(true);
    expect(CRS_CATALOG.some((row) => row.id === 'US_NAD83_2011_SPCS_UT_NORTH_FTUS')).toBe(true);
    expect(CRS_CATALOG.some((row) => row.id === 'US_NAD83_2011_SPCS_UT_SOUTH')).toBe(true);
    expect(CRS_CATALOG.some((row) => row.id === 'US_NAD83_2011_SPCS_UT_SOUTH_FTUS')).toBe(true);
    expect(CRS_CATALOG.some((row) => row.id === 'US_NAD83_2011_SPCS_CO_CENTRAL')).toBe(true);
    expect(CRS_CATALOG.some((row) => row.id === 'US_NAD83_2011_SPCS_CO_CENTRAL_FTUS')).toBe(true);
    expect(CRS_CATALOG.some((row) => row.id === 'US_NAD83_2011_SPCS_CO_NORTH')).toBe(true);
    expect(CRS_CATALOG.some((row) => row.id === 'US_NAD83_2011_SPCS_CO_NORTH_FTUS')).toBe(true);
    expect(CRS_CATALOG.some((row) => row.id === 'US_NAD83_2011_SPCS_CO_SOUTH')).toBe(true);
    expect(CRS_CATALOG.some((row) => row.id === 'US_NAD83_2011_SPCS_CO_SOUTH_FTUS')).toBe(true);
    expect(CRS_CATALOG.some((row) => row.id === 'US_NAD83_2011_SPCS_CT')).toBe(true);
    expect(CRS_CATALOG.some((row) => row.id === 'US_NAD83_2011_SPCS_CT_FTUS')).toBe(true);
    expect(CRS_CATALOG.some((row) => row.id === 'US_NAD83_2011_SPCS_DE')).toBe(true);
    expect(CRS_CATALOG.some((row) => row.id === 'US_NAD83_2011_SPCS_DE_FTUS')).toBe(true);
    expect(CRS_CATALOG.some((row) => row.id === 'US_NAD83_2011_SPCS_KS_NORTH')).toBe(true);
    expect(CRS_CATALOG.some((row) => row.id === 'US_NAD83_2011_SPCS_KS_NORTH_FTUS')).toBe(true);
    expect(CRS_CATALOG.some((row) => row.id === 'US_NAD83_2011_SPCS_KS_SOUTH')).toBe(true);
    expect(CRS_CATALOG.some((row) => row.id === 'US_NAD83_2011_SPCS_KS_SOUTH_FTUS')).toBe(true);
    expect(CRS_CATALOG.some((row) => row.id === 'US_NAD83_2011_SPCS_LA_NORTH')).toBe(true);
    expect(CRS_CATALOG.some((row) => row.id === 'US_NAD83_2011_SPCS_LA_NORTH_FTUS')).toBe(true);
    expect(CRS_CATALOG.some((row) => row.id === 'US_NAD83_2011_SPCS_LA_SOUTH')).toBe(true);
    expect(CRS_CATALOG.some((row) => row.id === 'US_NAD83_2011_SPCS_LA_SOUTH_FTUS')).toBe(true);
    expect(CRS_CATALOG.some((row) => row.id === 'US_NAD83_2011_SPCS_ME_EAST')).toBe(true);
    expect(CRS_CATALOG.some((row) => row.id === 'US_NAD83_2011_SPCS_ME_EAST_FTUS')).toBe(true);
    expect(CRS_CATALOG.some((row) => row.id === 'US_NAD83_2011_SPCS_ME_WEST')).toBe(true);
    expect(CRS_CATALOG.some((row) => row.id === 'US_NAD83_2011_SPCS_ME_WEST_FTUS')).toBe(true);
    expect(CRS_CATALOG.some((row) => row.id === 'US_NAD83_2011_SPCS_MD')).toBe(true);
    expect(CRS_CATALOG.some((row) => row.id === 'US_NAD83_2011_SPCS_MD_FTUS')).toBe(true);
    expect(CRS_CATALOG.some((row) => row.id === 'US_NAD83_2011_SPCS_MA_ISLAND')).toBe(true);
    expect(CRS_CATALOG.some((row) => row.id === 'US_NAD83_2011_SPCS_MA_ISLAND_FTUS')).toBe(true);
    expect(CRS_CATALOG.some((row) => row.id === 'US_NAD83_2011_SPCS_MA_MAINLAND')).toBe(true);
    expect(CRS_CATALOG.some((row) => row.id === 'US_NAD83_2011_SPCS_MA_MAINLAND_FTUS')).toBe(true);
    expect(CRS_CATALOG.some((row) => row.id === 'US_NAD83_2011_SPCS_MN_CENTRAL')).toBe(true);
    expect(CRS_CATALOG.some((row) => row.id === 'US_NAD83_2011_SPCS_MN_CENTRAL_FTUS')).toBe(true);
    expect(CRS_CATALOG.some((row) => row.id === 'US_NAD83_2011_SPCS_MN_NORTH')).toBe(true);
    expect(CRS_CATALOG.some((row) => row.id === 'US_NAD83_2011_SPCS_MN_NORTH_FTUS')).toBe(true);
    expect(CRS_CATALOG.some((row) => row.id === 'US_NAD83_2011_SPCS_MN_SOUTH')).toBe(true);
    expect(CRS_CATALOG.some((row) => row.id === 'US_NAD83_2011_SPCS_MN_SOUTH_FTUS')).toBe(true);
    expect(CRS_CATALOG.some((row) => row.id === 'US_NAD83_2011_SPCS_IL_EAST')).toBe(true);
    expect(CRS_CATALOG.some((row) => row.id === 'US_NAD83_2011_SPCS_IL_EAST_FTUS')).toBe(true);
    expect(CRS_CATALOG.some((row) => row.id === 'US_NAD83_2011_SPCS_IL_WEST')).toBe(true);
    expect(CRS_CATALOG.some((row) => row.id === 'US_NAD83_2011_SPCS_IL_WEST_FTUS')).toBe(true);
    expect(CRS_CATALOG.some((row) => row.id === 'US_NAD83_2011_SPCS_IN_EAST')).toBe(true);
    expect(CRS_CATALOG.some((row) => row.id === 'US_NAD83_2011_SPCS_IN_EAST_FTUS')).toBe(true);
    expect(CRS_CATALOG.some((row) => row.id === 'US_NAD83_2011_SPCS_IN_WEST')).toBe(true);
    expect(CRS_CATALOG.some((row) => row.id === 'US_NAD83_2011_SPCS_IN_WEST_FTUS')).toBe(true);
  });

  it('resolves CRS by canonical id and EPSG aliases', () => {
    const byId = getCrsDefinition('CA_NAD83_CSRS_NB_STEREO_DOUBLE');
    const byEpsgToken = getCrsDefinition('EPSG:2953');
    const byEpsgNumeric = getCrsDefinition('2953');
    const byUtmV8 = getCrsDefinition('EPSG:22810');
    const byAb3tm = getCrsDefinition('EPSG:22764');
    const byQcLambert = getCrsDefinition('EPSG:3799');
    const byNsMtm4 = getCrsDefinition('8082');
    const byNsMtm5 = getCrsDefinition('EPSG:8083');
    const bySkAts = getCrsDefinition('CA_NAD83_CSRS_SK_ATS');
    const byMb3tm = getCrsDefinition('CA_NAD83_CSRS_MB_3TM');
    const byNu = getCrsDefinition('CA_NAD83_CSRS_NU_STEREOGRAPHIC');
    const byYt = getCrsDefinition('CA_NAD83_CSRS_YT_TM');
    const byNt = getCrsDefinition('CA_NAD83_CSRS_NT_TM');
    const byQcMunicipal = getCrsDefinition('EPSG:6622');
    const byAbForest = getCrsDefinition('EPSG:3402');
    const byYtAlbers = getCrsDefinition('EPSG:3579');
    const byNtLambert = getCrsDefinition('EPSG:3581');
    const byCaAtlas = getCrsDefinition('EPSG:3979');
    const byOnTeranet = getCrsDefinition('EPSG:5321');
    const byArctic = getCrsDefinition('EPSG:6103');
    const byUsNyEast = getCrsDefinition('EPSG:6536');
    const byUsNyCentral = getCrsDefinition('6534');
    const byUsNyWest = getCrsDefinition('EPSG:6540');
    const byUsNyEastFt = getCrsDefinition('EPSG:6537');
    const byUsNyCentralFt = getCrsDefinition('6535');
    const byUsNyWestFt = getCrsDefinition('EPSG:6541');
    const byUsCa1 = getCrsDefinition('EPSG:6415');
    const byUsCa2 = getCrsDefinition('6417');
    const byUsCa3 = getCrsDefinition('EPSG:6419');
    const byUsCa1Ft = getCrsDefinition('EPSG:6416');
    const byUsCa2Ft = getCrsDefinition('6418');
    const byUsCa3Ft = getCrsDefinition('EPSG:6420');
    const byUsCa4 = getCrsDefinition('EPSG:6421');
    const byUsCa4Ft = getCrsDefinition('6422');
    const byUsCa5 = getCrsDefinition('EPSG:6423');
    const byUsCa5Ft = getCrsDefinition('6424');
    const byUsCa6 = getCrsDefinition('EPSG:6425');
    const byUsCa6Ft = getCrsDefinition('6426');
    const byUsPaNorth = getCrsDefinition('EPSG:6562');
    const byUsPaNorthFt = getCrsDefinition('6563');
    const byUsPaSouth = getCrsDefinition('EPSG:6564');
    const byUsPaSouthFt = getCrsDefinition('6565');
    const byUsTxNorth = getCrsDefinition('EPSG:6581');
    const byUsTxNorthFt = getCrsDefinition('6582');
    const byUsTxNorthCentral = getCrsDefinition('EPSG:6583');
    const byUsTxNorthCentralFt = getCrsDefinition('6584');
    const byUsTxCentral = getCrsDefinition('EPSG:6577');
    const byUsTxCentralFt = getCrsDefinition('6578');
    const byUsTxSouthCentral = getCrsDefinition('EPSG:6587');
    const byUsTxSouthCentralFt = getCrsDefinition('6588');
    const byUsTxSouth = getCrsDefinition('EPSG:6585');
    const byUsTxSouthFt = getCrsDefinition('6586');
    const byUsFlEast = getCrsDefinition('EPSG:6437');
    const byUsFlEastFt = getCrsDefinition('6438');
    const byUsFlNorth = getCrsDefinition('EPSG:6440');
    const byUsFlNorthFt = getCrsDefinition('6441');
    const byUsFlWest = getCrsDefinition('EPSG:6442');
    const byUsFlWestFt = getCrsDefinition('6443');
    const byUsGaEast = getCrsDefinition('EPSG:6444');
    const byUsGaEastFt = getCrsDefinition('6445');
    const byUsGaWest = getCrsDefinition('EPSG:6446');
    const byUsGaWestFt = getCrsDefinition('6447');
    const byUsNc = getCrsDefinition('EPSG:6542');
    const byUsNcFt = getCrsDefinition('6543');
    const byUsAlEast = getCrsDefinition('EPSG:6355');
    const byUsAlEastFt = getCrsDefinition('9748');
    const byUsAlWest = getCrsDefinition('EPSG:6356');
    const byUsAlWestFt = getCrsDefinition('9749');
    const byUsTn = getCrsDefinition('EPSG:6575');
    const byUsTnFt = getCrsDefinition('6576');
    const byUsKyNorth = getCrsDefinition('EPSG:6470');
    const byUsKyNorthFt = getCrsDefinition('6471');
    const byUsKySingle = getCrsDefinition('EPSG:6472');
    const byUsKySingleFt = getCrsDefinition('6473');
    const byUsKySouth = getCrsDefinition('EPSG:6474');
    const byUsKySouthFt = getCrsDefinition('6475');
    const byUsRi = getCrsDefinition('EPSG:6567');
    const byUsRiFt = getCrsDefinition('6568');
    const byUsSdNorth = getCrsDefinition('EPSG:6571');
    const byUsSdNorthFt = getCrsDefinition('6572');
    const byUsSdSouth = getCrsDefinition('EPSG:6573');
    const byUsSdSouthFt = getCrsDefinition('6574');
    const byUsVt = getCrsDefinition('EPSG:6589');
    const byUsVtFt = getCrsDefinition('6590');
    const byUsVaNorth = getCrsDefinition('EPSG:6592');
    const byUsVaNorthFt = getCrsDefinition('6593');
    const byUsVaSouth = getCrsDefinition('EPSG:6594');
    const byUsVaSouthFt = getCrsDefinition('6595');
    const byUsWaNorth = getCrsDefinition('EPSG:6596');
    const byUsWaNorthFt = getCrsDefinition('6597');
    const byUsWaSouth = getCrsDefinition('EPSG:6598');
    const byUsWaSouthFt = getCrsDefinition('6599');
    const byUsWvNorth = getCrsDefinition('EPSG:6600');
    const byUsWvNorthFt = getCrsDefinition('6601');
    const byUsWvSouth = getCrsDefinition('EPSG:6602');
    const byUsWvSouthFt = getCrsDefinition('6603');
    const byUsWiCentral = getCrsDefinition('EPSG:6604');
    const byUsWiCentralFt = getCrsDefinition('6605');
    const byUsWiNorth = getCrsDefinition('EPSG:6606');
    const byUsWiNorthFt = getCrsDefinition('6607');
    const byUsWiSouth = getCrsDefinition('EPSG:6608');
    const byUsWiSouthFt = getCrsDefinition('6609');
    const byUsWyEast = getCrsDefinition('EPSG:6611');
    const byUsWyEastFt = getCrsDefinition('6612');
    const byUsWyEastCentral = getCrsDefinition('EPSG:6613');
    const byUsWyEastCentralFt = getCrsDefinition('6614');
    const byUsWyWest = getCrsDefinition('EPSG:6615');
    const byUsWyWestFt = getCrsDefinition('6616');
    const byUsWyWestCentral = getCrsDefinition('EPSG:6617');
    const byUsWyWestCentralFt = getCrsDefinition('6618');
    const byUsUtCentral = getCrsDefinition('EPSG:6619');
    const byUsUtNorth = getCrsDefinition('6620');
    const byUsUtSouth = getCrsDefinition('EPSG:6621');
    const byUsUtCentralFt = getCrsDefinition('6625');
    const byUsUtNorthFt = getCrsDefinition('EPSG:6626');
    const byUsUtSouthFt = getCrsDefinition('6627');
    const byUsCoCentral = getCrsDefinition('EPSG:6427');
    const byUsCoCentralFt = getCrsDefinition('6428');
    const byUsCoNorth = getCrsDefinition('EPSG:6429');
    const byUsCoNorthFt = getCrsDefinition('6430');
    const byUsCoSouth = getCrsDefinition('EPSG:6431');
    const byUsCoSouthFt = getCrsDefinition('6432');
    const byUsCt = getCrsDefinition('EPSG:6433');
    const byUsCtFt = getCrsDefinition('6434');
    const byUsDe = getCrsDefinition('EPSG:6435');
    const byUsDeFt = getCrsDefinition('6436');
    const byUsKsNorth = getCrsDefinition('EPSG:6466');
    const byUsKsNorthFt = getCrsDefinition('6467');
    const byUsKsSouth = getCrsDefinition('EPSG:6468');
    const byUsKsSouthFt = getCrsDefinition('6469');
    const byUsLaNorth = getCrsDefinition('EPSG:6476');
    const byUsLaNorthFt = getCrsDefinition('6477');
    const byUsLaSouth = getCrsDefinition('EPSG:6478');
    const byUsLaSouthFt = getCrsDefinition('6479');
    const byUsMeEast = getCrsDefinition('EPSG:6483');
    const byUsMeEastFt = getCrsDefinition('6484');
    const byUsMeWest = getCrsDefinition('EPSG:6485');
    const byUsMeWestFt = getCrsDefinition('6486');
    const byUsMd = getCrsDefinition('EPSG:6487');
    const byUsMdFt = getCrsDefinition('6488');
    const byUsMaIsland = getCrsDefinition('EPSG:6489');
    const byUsMaIslandFt = getCrsDefinition('6490');
    const byUsMaMainland = getCrsDefinition('EPSG:6491');
    const byUsMaMainlandFt = getCrsDefinition('6492');
    const byUsMnCentral = getCrsDefinition('EPSG:6500');
    const byUsMnCentralFt = getCrsDefinition('6501');
    const byUsMnNorth = getCrsDefinition('EPSG:6502');
    const byUsMnNorthFt = getCrsDefinition('6503');
    const byUsMnSouth = getCrsDefinition('EPSG:6504');
    const byUsMnSouthFt = getCrsDefinition('6505');
    const byUsIlEast = getCrsDefinition('EPSG:6454');
    const byUsIlEastFt = getCrsDefinition('6455');
    const byUsIlWest = getCrsDefinition('EPSG:6456');
    const byUsIlWestFt = getCrsDefinition('6457');
    const byUsInEast = getCrsDefinition('EPSG:6458');
    const byUsInEastFt = getCrsDefinition('6459');
    const byUsInWest = getCrsDefinition('EPSG:6460');
    const byUsInWestFt = getCrsDefinition('6461');

    expect(byId?.id).toBe('CA_NAD83_CSRS_NB_STEREO_DOUBLE');
    expect(byEpsgToken?.id).toBe('CA_NAD83_CSRS_NB_STEREO_DOUBLE');
    expect(byEpsgNumeric?.id).toBe('CA_NAD83_CSRS_NB_STEREO_DOUBLE');
    expect(byUtmV8?.id).toBe('CA_NAD83_CSRS_UTM_10N');
    expect(byAb3tm?.id).toBe('CA_NAD83_CSRS_AB_3TM_117W');
    expect(byQcLambert?.id).toBe('CA_NAD83_CSRS_QC_LAMBERT');
    expect(byNsMtm4?.id).toBe('CA_NAD83_CSRS_NS_MTM_2010_4');
    expect(byNsMtm5?.id).toBe('CA_NAD83_CSRS_NS_MTM_2010_5');
    expect(bySkAts?.id).toBe('CA_NAD83_CSRS_SK_ATS');
    expect(byMb3tm?.id).toBe('CA_NAD83_CSRS_MB_3TM');
    expect(byNu?.id).toBe('CA_NAD83_CSRS_NU_STEREOGRAPHIC');
    expect(byYt?.id).toBe('CA_NAD83_CSRS_YT_TM');
    expect(byNt?.id).toBe('CA_NAD83_CSRS_NT_TM');
    expect(byQcMunicipal?.id).toBe('CA_NAD83_CSRS_QC_MUNICIPAL_LCC');
    expect(byAbForest?.id).toBe('CA_NAD83_CSRS_AB_10TM_FOREST');
    expect(byYtAlbers?.id).toBe('CA_NAD83_CSRS_YT_ALBERS');
    expect(byNtLambert?.id).toBe('CA_NAD83_CSRS_NT_LAMBERT');
    expect(byCaAtlas?.id).toBe('CA_NAD83_CSRS_CA_ATLAS_LAMBERT');
    expect(byOnTeranet?.id).toBe('CA_NAD83_CSRS_ON_TERANET_LAMBERT');
    expect(byArctic?.id).toBe('CA_NAD83_CSRS_ARCTIC_LCC_3_29');
    expect(byUsNyEast?.id).toBe('US_NAD83_2011_SPCS_NY_EAST');
    expect(byUsNyCentral?.id).toBe('US_NAD83_2011_SPCS_NY_CENTRAL');
    expect(byUsNyWest?.id).toBe('US_NAD83_2011_SPCS_NY_WEST');
    expect(byUsNyEastFt?.id).toBe('US_NAD83_2011_SPCS_NY_EAST_FTUS');
    expect(byUsNyCentralFt?.id).toBe('US_NAD83_2011_SPCS_NY_CENTRAL_FTUS');
    expect(byUsNyWestFt?.id).toBe('US_NAD83_2011_SPCS_NY_WEST_FTUS');
    expect(byUsCa1?.id).toBe('US_NAD83_2011_SPCS_CA_ZONE_1');
    expect(byUsCa2?.id).toBe('US_NAD83_2011_SPCS_CA_ZONE_2');
    expect(byUsCa3?.id).toBe('US_NAD83_2011_SPCS_CA_ZONE_3');
    expect(byUsCa1Ft?.id).toBe('US_NAD83_2011_SPCS_CA_ZONE_1_FTUS');
    expect(byUsCa2Ft?.id).toBe('US_NAD83_2011_SPCS_CA_ZONE_2_FTUS');
    expect(byUsCa3Ft?.id).toBe('US_NAD83_2011_SPCS_CA_ZONE_3_FTUS');
    expect(byUsCa4?.id).toBe('US_NAD83_2011_SPCS_CA_ZONE_4');
    expect(byUsCa4Ft?.id).toBe('US_NAD83_2011_SPCS_CA_ZONE_4_FTUS');
    expect(byUsCa5?.id).toBe('US_NAD83_2011_SPCS_CA_ZONE_5');
    expect(byUsCa5Ft?.id).toBe('US_NAD83_2011_SPCS_CA_ZONE_5_FTUS');
    expect(byUsCa6?.id).toBe('US_NAD83_2011_SPCS_CA_ZONE_6');
    expect(byUsCa6Ft?.id).toBe('US_NAD83_2011_SPCS_CA_ZONE_6_FTUS');
    expect(byUsPaNorth?.id).toBe('US_NAD83_2011_SPCS_PA_NORTH');
    expect(byUsPaNorthFt?.id).toBe('US_NAD83_2011_SPCS_PA_NORTH_FTUS');
    expect(byUsPaSouth?.id).toBe('US_NAD83_2011_SPCS_PA_SOUTH');
    expect(byUsPaSouthFt?.id).toBe('US_NAD83_2011_SPCS_PA_SOUTH_FTUS');
    expect(byUsTxNorth?.id).toBe('US_NAD83_2011_SPCS_TX_NORTH');
    expect(byUsTxNorthFt?.id).toBe('US_NAD83_2011_SPCS_TX_NORTH_FTUS');
    expect(byUsTxNorthCentral?.id).toBe('US_NAD83_2011_SPCS_TX_NORTH_CENTRAL');
    expect(byUsTxNorthCentralFt?.id).toBe('US_NAD83_2011_SPCS_TX_NORTH_CENTRAL_FTUS');
    expect(byUsTxCentral?.id).toBe('US_NAD83_2011_SPCS_TX_CENTRAL');
    expect(byUsTxCentralFt?.id).toBe('US_NAD83_2011_SPCS_TX_CENTRAL_FTUS');
    expect(byUsTxSouthCentral?.id).toBe('US_NAD83_2011_SPCS_TX_SOUTH_CENTRAL');
    expect(byUsTxSouthCentralFt?.id).toBe('US_NAD83_2011_SPCS_TX_SOUTH_CENTRAL_FTUS');
    expect(byUsTxSouth?.id).toBe('US_NAD83_2011_SPCS_TX_SOUTH');
    expect(byUsTxSouthFt?.id).toBe('US_NAD83_2011_SPCS_TX_SOUTH_FTUS');
    expect(byUsFlEast?.id).toBe('US_NAD83_2011_SPCS_FL_EAST');
    expect(byUsFlEastFt?.id).toBe('US_NAD83_2011_SPCS_FL_EAST_FTUS');
    expect(byUsFlNorth?.id).toBe('US_NAD83_2011_SPCS_FL_NORTH');
    expect(byUsFlNorthFt?.id).toBe('US_NAD83_2011_SPCS_FL_NORTH_FTUS');
    expect(byUsFlWest?.id).toBe('US_NAD83_2011_SPCS_FL_WEST');
    expect(byUsFlWestFt?.id).toBe('US_NAD83_2011_SPCS_FL_WEST_FTUS');
    expect(byUsGaEast?.id).toBe('US_NAD83_2011_SPCS_GA_EAST');
    expect(byUsGaEastFt?.id).toBe('US_NAD83_2011_SPCS_GA_EAST_FTUS');
    expect(byUsGaWest?.id).toBe('US_NAD83_2011_SPCS_GA_WEST');
    expect(byUsGaWestFt?.id).toBe('US_NAD83_2011_SPCS_GA_WEST_FTUS');
    expect(byUsNc?.id).toBe('US_NAD83_2011_SPCS_NC');
    expect(byUsNcFt?.id).toBe('US_NAD83_2011_SPCS_NC_FTUS');
    expect(byUsAlEast?.id).toBe('US_NAD83_2011_SPCS_AL_EAST');
    expect(byUsAlEastFt?.id).toBe('US_NAD83_2011_SPCS_AL_EAST_FTUS');
    expect(byUsAlWest?.id).toBe('US_NAD83_2011_SPCS_AL_WEST');
    expect(byUsAlWestFt?.id).toBe('US_NAD83_2011_SPCS_AL_WEST_FTUS');
    expect(byUsTn?.id).toBe('US_NAD83_2011_SPCS_TN');
    expect(byUsTnFt?.id).toBe('US_NAD83_2011_SPCS_TN_FTUS');
    expect(byUsKyNorth?.id).toBe('US_NAD83_2011_SPCS_KY_NORTH');
    expect(byUsKyNorthFt?.id).toBe('US_NAD83_2011_SPCS_KY_NORTH_FTUS');
    expect(byUsKySingle?.id).toBe('US_NAD83_2011_SPCS_KY_SINGLE_ZONE');
    expect(byUsKySingleFt?.id).toBe('US_NAD83_2011_SPCS_KY_SINGLE_ZONE_FTUS');
    expect(byUsKySouth?.id).toBe('US_NAD83_2011_SPCS_KY_SOUTH');
    expect(byUsKySouthFt?.id).toBe('US_NAD83_2011_SPCS_KY_SOUTH_FTUS');
    expect(byUsRi?.id).toBe('US_NAD83_2011_SPCS_RI');
    expect(byUsRiFt?.id).toBe('US_NAD83_2011_SPCS_RI_FTUS');
    expect(byUsSdNorth?.id).toBe('US_NAD83_2011_SPCS_SD_NORTH');
    expect(byUsSdNorthFt?.id).toBe('US_NAD83_2011_SPCS_SD_NORTH_FTUS');
    expect(byUsSdSouth?.id).toBe('US_NAD83_2011_SPCS_SD_SOUTH');
    expect(byUsSdSouthFt?.id).toBe('US_NAD83_2011_SPCS_SD_SOUTH_FTUS');
    expect(byUsVt?.id).toBe('US_NAD83_2011_SPCS_VT');
    expect(byUsVtFt?.id).toBe('US_NAD83_2011_SPCS_VT_FTUS');
    expect(byUsVaNorth?.id).toBe('US_NAD83_2011_SPCS_VA_NORTH');
    expect(byUsVaNorthFt?.id).toBe('US_NAD83_2011_SPCS_VA_NORTH_FTUS');
    expect(byUsVaSouth?.id).toBe('US_NAD83_2011_SPCS_VA_SOUTH');
    expect(byUsVaSouthFt?.id).toBe('US_NAD83_2011_SPCS_VA_SOUTH_FTUS');
    expect(byUsWaNorth?.id).toBe('US_NAD83_2011_SPCS_WA_NORTH');
    expect(byUsWaNorthFt?.id).toBe('US_NAD83_2011_SPCS_WA_NORTH_FTUS');
    expect(byUsWaSouth?.id).toBe('US_NAD83_2011_SPCS_WA_SOUTH');
    expect(byUsWaSouthFt?.id).toBe('US_NAD83_2011_SPCS_WA_SOUTH_FTUS');
    expect(byUsWvNorth?.id).toBe('US_NAD83_2011_SPCS_WV_NORTH');
    expect(byUsWvNorthFt?.id).toBe('US_NAD83_2011_SPCS_WV_NORTH_FTUS');
    expect(byUsWvSouth?.id).toBe('US_NAD83_2011_SPCS_WV_SOUTH');
    expect(byUsWvSouthFt?.id).toBe('US_NAD83_2011_SPCS_WV_SOUTH_FTUS');
    expect(byUsWiCentral?.id).toBe('US_NAD83_2011_SPCS_WI_CENTRAL');
    expect(byUsWiCentralFt?.id).toBe('US_NAD83_2011_SPCS_WI_CENTRAL_FTUS');
    expect(byUsWiNorth?.id).toBe('US_NAD83_2011_SPCS_WI_NORTH');
    expect(byUsWiNorthFt?.id).toBe('US_NAD83_2011_SPCS_WI_NORTH_FTUS');
    expect(byUsWiSouth?.id).toBe('US_NAD83_2011_SPCS_WI_SOUTH');
    expect(byUsWiSouthFt?.id).toBe('US_NAD83_2011_SPCS_WI_SOUTH_FTUS');
    expect(byUsWyEast?.id).toBe('US_NAD83_2011_SPCS_WY_EAST');
    expect(byUsWyEastFt?.id).toBe('US_NAD83_2011_SPCS_WY_EAST_FTUS');
    expect(byUsWyEastCentral?.id).toBe('US_NAD83_2011_SPCS_WY_EAST_CENTRAL');
    expect(byUsWyEastCentralFt?.id).toBe('US_NAD83_2011_SPCS_WY_EAST_CENTRAL_FTUS');
    expect(byUsWyWest?.id).toBe('US_NAD83_2011_SPCS_WY_WEST');
    expect(byUsWyWestFt?.id).toBe('US_NAD83_2011_SPCS_WY_WEST_FTUS');
    expect(byUsWyWestCentral?.id).toBe('US_NAD83_2011_SPCS_WY_WEST_CENTRAL');
    expect(byUsWyWestCentralFt?.id).toBe('US_NAD83_2011_SPCS_WY_WEST_CENTRAL_FTUS');
    expect(byUsUtCentral?.id).toBe('US_NAD83_2011_SPCS_UT_CENTRAL');
    expect(byUsUtNorth?.id).toBe('US_NAD83_2011_SPCS_UT_NORTH');
    expect(byUsUtSouth?.id).toBe('US_NAD83_2011_SPCS_UT_SOUTH');
    expect(byUsUtCentralFt?.id).toBe('US_NAD83_2011_SPCS_UT_CENTRAL_FTUS');
    expect(byUsUtNorthFt?.id).toBe('US_NAD83_2011_SPCS_UT_NORTH_FTUS');
    expect(byUsUtSouthFt?.id).toBe('US_NAD83_2011_SPCS_UT_SOUTH_FTUS');
    expect(byUsCoCentral?.id).toBe('US_NAD83_2011_SPCS_CO_CENTRAL');
    expect(byUsCoCentralFt?.id).toBe('US_NAD83_2011_SPCS_CO_CENTRAL_FTUS');
    expect(byUsCoNorth?.id).toBe('US_NAD83_2011_SPCS_CO_NORTH');
    expect(byUsCoNorthFt?.id).toBe('US_NAD83_2011_SPCS_CO_NORTH_FTUS');
    expect(byUsCoSouth?.id).toBe('US_NAD83_2011_SPCS_CO_SOUTH');
    expect(byUsCoSouthFt?.id).toBe('US_NAD83_2011_SPCS_CO_SOUTH_FTUS');
    expect(byUsCt?.id).toBe('US_NAD83_2011_SPCS_CT');
    expect(byUsCtFt?.id).toBe('US_NAD83_2011_SPCS_CT_FTUS');
    expect(byUsDe?.id).toBe('US_NAD83_2011_SPCS_DE');
    expect(byUsDeFt?.id).toBe('US_NAD83_2011_SPCS_DE_FTUS');
    expect(byUsKsNorth?.id).toBe('US_NAD83_2011_SPCS_KS_NORTH');
    expect(byUsKsNorthFt?.id).toBe('US_NAD83_2011_SPCS_KS_NORTH_FTUS');
    expect(byUsKsSouth?.id).toBe('US_NAD83_2011_SPCS_KS_SOUTH');
    expect(byUsKsSouthFt?.id).toBe('US_NAD83_2011_SPCS_KS_SOUTH_FTUS');
    expect(byUsLaNorth?.id).toBe('US_NAD83_2011_SPCS_LA_NORTH');
    expect(byUsLaNorthFt?.id).toBe('US_NAD83_2011_SPCS_LA_NORTH_FTUS');
    expect(byUsLaSouth?.id).toBe('US_NAD83_2011_SPCS_LA_SOUTH');
    expect(byUsLaSouthFt?.id).toBe('US_NAD83_2011_SPCS_LA_SOUTH_FTUS');
    expect(byUsMeEast?.id).toBe('US_NAD83_2011_SPCS_ME_EAST');
    expect(byUsMeEastFt?.id).toBe('US_NAD83_2011_SPCS_ME_EAST_FTUS');
    expect(byUsMeWest?.id).toBe('US_NAD83_2011_SPCS_ME_WEST');
    expect(byUsMeWestFt?.id).toBe('US_NAD83_2011_SPCS_ME_WEST_FTUS');
    expect(byUsMd?.id).toBe('US_NAD83_2011_SPCS_MD');
    expect(byUsMdFt?.id).toBe('US_NAD83_2011_SPCS_MD_FTUS');
    expect(byUsMaIsland?.id).toBe('US_NAD83_2011_SPCS_MA_ISLAND');
    expect(byUsMaIslandFt?.id).toBe('US_NAD83_2011_SPCS_MA_ISLAND_FTUS');
    expect(byUsMaMainland?.id).toBe('US_NAD83_2011_SPCS_MA_MAINLAND');
    expect(byUsMaMainlandFt?.id).toBe('US_NAD83_2011_SPCS_MA_MAINLAND_FTUS');
    expect(byUsMnCentral?.id).toBe('US_NAD83_2011_SPCS_MN_CENTRAL');
    expect(byUsMnCentralFt?.id).toBe('US_NAD83_2011_SPCS_MN_CENTRAL_FTUS');
    expect(byUsMnNorth?.id).toBe('US_NAD83_2011_SPCS_MN_NORTH');
    expect(byUsMnNorthFt?.id).toBe('US_NAD83_2011_SPCS_MN_NORTH_FTUS');
    expect(byUsMnSouth?.id).toBe('US_NAD83_2011_SPCS_MN_SOUTH');
    expect(byUsMnSouthFt?.id).toBe('US_NAD83_2011_SPCS_MN_SOUTH_FTUS');
    expect(byUsIlEast?.id).toBe('US_NAD83_2011_SPCS_IL_EAST');
    expect(byUsIlEastFt?.id).toBe('US_NAD83_2011_SPCS_IL_EAST_FTUS');
    expect(byUsIlWest?.id).toBe('US_NAD83_2011_SPCS_IL_WEST');
    expect(byUsIlWestFt?.id).toBe('US_NAD83_2011_SPCS_IL_WEST_FTUS');
    expect(byUsInEast?.id).toBe('US_NAD83_2011_SPCS_IN_EAST');
    expect(byUsInEastFt?.id).toBe('US_NAD83_2011_SPCS_IN_EAST_FTUS');
    expect(byUsInWest?.id).toBe('US_NAD83_2011_SPCS_IN_WEST');
    expect(byUsInWestFt?.id).toBe('US_NAD83_2011_SPCS_IN_WEST_FTUS');
  });

  it('exposes projection parameters, datum-op support metadata, and area-of-use bounds', () => {
    const nb = getCrsDefinition('CA_NAD83_CSRS_NB_STEREO_DOUBLE');
    expect(nb).toBeDefined();
    expect((nb?.projParams.length ?? 0) > 0).toBe(true);
    expect(nb?.supportedDatumOps.primary.length).toBeGreaterThan(0);
    expect(nb?.areaOfUseBounds).toBeDefined();
  });

  it('projects and inverses geodetic positions with NB stereographic double projection', () => {
    const forward = projectGeodeticToEN({
      latDeg: 46.72,
      lonDeg: -66.64,
      originLatDeg: 46.5,
      originLonDeg: -66.5,
      model: 'local-enu',
      coordSystemMode: 'grid',
      crsId: 'CA_NAD83_CSRS_NB_STEREO_DOUBLE',
    });

    expect(Number.isFinite(forward.east)).toBe(true);
    expect(Number.isFinite(forward.north)).toBe(true);
    expect(forward.crsId).toBe('CA_NAD83_CSRS_NB_STEREO_DOUBLE');

    const inverse = inverseENToGeodetic({
      east: forward.east,
      north: forward.north,
      originLatDeg: 46.5,
      originLonDeg: -66.5,
      model: 'local-enu',
      coordSystemMode: 'grid',
      crsId: 'EPSG:2953',
    });

    expect('failureReason' in inverse).toBe(false);
    if ('failureReason' in inverse) return;
    expect(inverse.latDeg).toBeCloseTo(46.72, 7);
    expect(inverse.lonDeg).toBeCloseTo(-66.64, 7);
  });

  it('uses closed-form factor formulas for TM and projection-formula support for the CSRS NB stereographic definition', () => {
    const utm = computeGridFactors(46.72, -66.64, 'CA_NAD83_CSRS_UTM_20N');
    expect(utm).not.toBeNull();
    expect(utm?.source).toBe('projection-formula');

    const nbCsrs = computeGridFactors(
      45.94603498341826,
      -66.64432272768907,
      'CA_NAD83_CSRS_NB_STEREO_DOUBLE',
    );
    expect(nbCsrs).not.toBeNull();
    expect(nbCsrs?.source).toBe('projection-formula');
    expect((nbCsrs?.gridScaleFactor ?? 0)).toBeCloseTo(0.99993613, 6);
    expect((nbCsrs?.convergenceAngleRad ?? 0) * (180 / Math.PI)).toBeCloseTo(-169.83115474, 3);

    const lambert = computeGridFactors(50.0, -85.0, 'CA_NAD83_CSRS_ON_MNR_LAMBERT');
    expect(lambert).not.toBeNull();
    expect(lambert?.source).toBe('numerical-fallback');
    expect(lambert?.diagnostics.includes('FACTOR_APPROXIMATION_USED')).toBe(true);
  });

  it('exposes the legacy NB83 display contract used to derive the tiny traverse listing residuals', () => {
    const latDeg = 45.94603498341826;
    const lonDeg = -66.64432272768907;

    const parityNbCsrs = computeGridFactors(latDeg, lonDeg, 'CA_NAD83_CSRS_NB_STEREO_DOUBLE');
    const legacyDisplay = computeClassicTraverseLegacyDisplayGridFactors(latDeg, lonDeg);

    expect(parityNbCsrs).not.toBeNull();
    expect(legacyDisplay).not.toBeNull();

    const gridPpmDelta =
      ((legacyDisplay?.gridScaleFactor ?? 0) - (parityNbCsrs?.gridScaleFactor ?? 0)) * 1e6;
    expect(gridPpmDelta).toBeCloseTo(-82.2056, 1);
    expect(Number.isFinite(legacyDisplay?.convergenceAngleRad ?? Number.NaN)).toBe(true);
    expect(Number.isFinite(parityNbCsrs?.convergenceAngleRad ?? Number.NaN)).toBe(true);
    expect(
      Math.abs((legacyDisplay?.convergenceAngleRad ?? 0) - (parityNbCsrs?.convergenceAngleRad ?? 0)),
    ).toBeGreaterThan(0.1);
  });

  it('exposes the classic traverse geodetic display inverse used by the NB83 parity listing', () => {
    const displayInverse = inverseClassicTraverseDisplayGeodetic(2488810.236, 7438438.733);

    expect(displayInverse).not.toBeNull();
    expect(displayInverse?.crsId).toBe('CA_NAD83_CSRS_NB_STEREO_DOUBLE');
    expect(displayInverse?.latDeg ?? Number.NaN).toBeCloseTo(45.9460347294, 7);
    expect(displayInverse?.lonDeg ?? Number.NaN).toBeCloseTo(-66.6443216077, 7);
  });
});
