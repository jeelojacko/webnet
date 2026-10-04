import { describe, expect, it } from 'vitest';

import {
  filterCrsCatalogByGroupAndUnits,
  resolveExternalCrsChange,
  resolveSpcsUnitCompanion,
  resolveUnknownGridExternalCrsId,
  resolveUserCatalogGroupChange,
} from '../src/crsDraftSelection';
import { CRS_CATALOG } from '../src/engine/crsCatalog';

const provincialId = 'CA_NAD83_CSRS_NB_STEREO_DOUBLE';
const utmId = 'CA_NAD83_CSRS_UTM_20N';

describe('resolveUserCatalogGroupChange', () => {
  it('keeps the CRS when it already belongs to the chosen group', () => {
    expect(
      resolveUserCatalogGroupChange({ crsId: utmId, nextGroup: 'canada-utm', units: 'm' }),
    ).toBeNull();
  });

  it('picks a valid UTM CRS when leaving a provincial CRS (no snap-back)', () => {
    const resolution = resolveUserCatalogGroupChange({
      crsId: provincialId,
      nextGroup: 'canada-utm',
      units: 'm',
    });
    expect(resolution).not.toBeNull();
    const picked = CRS_CATALOG.find((row) => row.id === resolution?.nextCrsId);
    expect(picked?.catalogGroup).toBe('canada-utm');
  });

  it('keeps the CRS for the empty global group instead of forcing a group', () => {
    expect(
      resolveUserCatalogGroupChange({ crsId: provincialId, nextGroup: 'global', units: 'm' }),
    ).toBeNull();
  });

  it('keeps the current CRS for `all`', () => {
    expect(
      resolveUserCatalogGroupChange({ crsId: provincialId, nextGroup: 'all', units: 'm' }),
    ).toBeNull();
  });
});

describe('resolveExternalCrsChange', () => {
  it('follows a loaded UTM CRS into its group without rewriting the id', () => {
    expect(
      resolveExternalCrsChange({ crsId: utmId, currentGroupFilter: 'canada-provincial' }),
    ).toEqual({ nextCatalogGroupFilter: 'canada-utm' });
  });

  it('leaves `all` alone on an external CRS change', () => {
    expect(resolveExternalCrsChange({ crsId: utmId, currentGroupFilter: 'all' })).toBeNull();
  });

  it('leaves unknown CRS ids alone instead of overwriting them', () => {
    expect(
      resolveExternalCrsChange({ crsId: 'UNKNOWN_CRS', currentGroupFilter: 'canada-utm' }),
    ).toBeNull();
  });
});

describe('resolveUnknownGridExternalCrsId', () => {
  it('sanitizes an unknown id to the first visible CRS in Grid mode', () => {
    const visible = filterCrsCatalogByGroupAndUnits('canada-utm', 'm');
    expect(
      resolveUnknownGridExternalCrsId({
        crsId: 'UNKNOWN_CRS',
        coordSystemMode: 'grid',
        visibleCatalog: visible,
      }),
    ).toEqual({ nextCrsId: visible[0].id });
  });

  it('leaves unknown ids alone in Local mode', () => {
    const visible = filterCrsCatalogByGroupAndUnits('all', 'm');
    expect(
      resolveUnknownGridExternalCrsId({
        crsId: 'LOCAL',
        coordSystemMode: 'local',
        visibleCatalog: visible,
      }),
    ).toBeNull();
  });

  it('leaves known ids alone', () => {
    const visible = filterCrsCatalogByGroupAndUnits('canada-utm', 'm');
    expect(
      resolveUnknownGridExternalCrsId({
        crsId: utmId,
        coordSystemMode: 'grid',
        visibleCatalog: visible,
      }),
    ).toBeNull();
  });
});

describe('resolveSpcsUnitCompanion', () => {
  it('maps an SPCS CRS to its ft companion when visible', () => {
    const spcsM = CRS_CATALOG.find(
      (row) =>
        row.catalogGroup === 'us-spcs' &&
        row.linearUnit === 'm' &&
        CRS_CATALOG.some((ft) => ft.id === `${row.id}_FTUS`),
    );
    expect(spcsM).toBeDefined();
    const visible = filterCrsCatalogByGroupAndUnits('us-spcs', 'ft');
    const resolution = resolveSpcsUnitCompanion({ crsId: spcsM!.id, visibleCatalog: visible });
    expect(resolution).toEqual({ nextCrsId: `${spcsM!.id}_FTUS` });
  });

  it('never mutates a non-SPCS CRS on a unit change', () => {
    const visible = filterCrsCatalogByGroupAndUnits('canada-utm', 'ft');
    expect(resolveSpcsUnitCompanion({ crsId: utmId, visibleCatalog: visible })).toBeNull();
  });
});
