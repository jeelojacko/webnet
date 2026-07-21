import { useEffect, useMemo, type Dispatch, type SetStateAction } from 'react';
import { resolveDraftCrsSelection } from '../crsDraftSelection';
import {
  CRS_CATALOG,
  DEFAULT_CANADA_CRS_ID,
} from '../engine/crsCatalog';
import { parseProj4Parameters } from '../app/appHelpers';
import type {
  CrsCatalogGroupFilter,
  ParseSettings,
  SettingsState,
} from '../appStateTypes';

export const useAppCrsDraftCatalog = ({
  parseSettingsDraft,
  setParseSettingsDraft,
  settingsDraft,
  crsCatalogGroupFilter,
  setCrsCatalogGroupFilter,
  crsSearchQuery,
}: {
  parseSettingsDraft: ParseSettings;
  setParseSettingsDraft: Dispatch<SetStateAction<ParseSettings>>;
  settingsDraft: SettingsState;
  crsCatalogGroupFilter: CrsCatalogGroupFilter;
  setCrsCatalogGroupFilter: Dispatch<SetStateAction<CrsCatalogGroupFilter>>;
  crsSearchQuery: string;
}) => {
  const selectedDraftCrs = useMemo(
    () =>
      CRS_CATALOG.find((row) => row.id === parseSettingsDraft.crsId) ??
      CRS_CATALOG.find((row) => row.id === DEFAULT_CANADA_CRS_ID) ??
      CRS_CATALOG[0],
    [parseSettingsDraft.crsId],
  );
  const crsCatalogGroupCounts = useMemo(() => {
    const counts: Record<CrsCatalogGroupFilter, number> = {
      all: CRS_CATALOG.length,
      global: 0,
      'canada-utm': 0,
      'canada-mtm': 0,
      'canada-provincial': 0,
      'us-spcs': 0,
    };
    CRS_CATALOG.forEach((row) => {
      counts[row.catalogGroup] += 1;
    });
    return counts;
  }, []);
  const filteredDraftCrsCatalog = useMemo(() => {
    const byGroup =
      crsCatalogGroupFilter === 'all'
        ? CRS_CATALOG
        : CRS_CATALOG.filter((row) => row.catalogGroup === crsCatalogGroupFilter);
    const preferredSpcsLinearUnit = settingsDraft.units === 'ft' ? 'us-ft' : 'm';
    return byGroup.filter(
      (row) => row.catalogGroup !== 'us-spcs' || row.linearUnit === preferredSpcsLinearUnit,
    );
  }, [crsCatalogGroupFilter, settingsDraft.units]);
  const searchedDraftCrsCatalog = useMemo(() => {
    const token = crsSearchQuery.trim().toUpperCase();
    if (!token) return filteredDraftCrsCatalog;
    return filteredDraftCrsCatalog.filter((row) => {
      const id = row.id.toUpperCase();
      const label = row.label.toUpperCase();
      const epsg = (row.epsgCode ?? '').toUpperCase();
      return id.includes(token) || label.includes(token) || epsg.includes(token);
    });
  }, [crsSearchQuery, filteredDraftCrsCatalog]);
  const visibleDraftCrsCatalog = useMemo(() => {
    if (searchedDraftCrsCatalog.length > 0) return searchedDraftCrsCatalog;
    if (selectedDraftCrs) return [selectedDraftCrs];
    return [];
  }, [searchedDraftCrsCatalog, selectedDraftCrs]);
  const selectedCrsProj4Params = useMemo(
    () => selectedDraftCrs?.projParams ?? parseProj4Parameters(selectedDraftCrs?.proj4 ?? ''),
    [selectedDraftCrs],
  );

  useEffect(() => {
    const resolution = resolveDraftCrsSelection({
      crsId: parseSettingsDraft.crsId,
      crsCatalogGroupFilter,
      filteredDraftCrsCatalog,
    });
    if (!resolution) return;
    if (resolution.nextCatalogGroupFilter) {
      setCrsCatalogGroupFilter(resolution.nextCatalogGroupFilter);
      return;
    }
    if (resolution.nextCrsId) {
      setParseSettingsDraft((prev) => ({
        ...prev,
        crsId: resolution.nextCrsId ?? prev.crsId,
      }));
    }
  }, [
    crsCatalogGroupFilter,
    filteredDraftCrsCatalog,
    parseSettingsDraft.crsId,
    setCrsCatalogGroupFilter,
    setParseSettingsDraft,
  ]);

  return {
    selectedDraftCrs,
    crsCatalogGroupCounts,
    filteredDraftCrsCatalog,
    searchedDraftCrsCatalog,
    visibleDraftCrsCatalog,
    selectedCrsProj4Params,
  };
};
