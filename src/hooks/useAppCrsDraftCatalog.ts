import { useCallback, useEffect, useMemo, useRef, type Dispatch, type SetStateAction } from 'react';
import {
  filterCrsCatalogByGroupAndUnits,
  resolveExternalCrsChange,
  resolveSpcsUnitCompanion,
  resolveUnknownGridExternalCrsId,
  resolveUserCatalogGroupChange,
} from '../crsDraftSelection';
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
  const filteredDraftCrsCatalog = useMemo(
    () => filterCrsCatalogByGroupAndUnits(crsCatalogGroupFilter, settingsDraft.units),
    [crsCatalogGroupFilter, settingsDraft.units],
  );
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

  /**
   * User-driven category change. Authoritative: the group is set together
   * with a valid CRS from the new group (batched, so the sync effect below
   * only ever observes the paired result). Never touches coordSystemMode.
   */
  const handleCrsCatalogGroupChange = useCallback(
    (nextGroup: CrsCatalogGroupFilter) => {
      if (nextGroup === crsCatalogGroupFilter) return;
      const resolution = resolveUserCatalogGroupChange({
        crsId: parseSettingsDraft.crsId,
        nextGroup,
        units: settingsDraft.units,
      });
      setCrsCatalogGroupFilter(nextGroup);
      if (resolution) {
        const nextCrsId = resolution.nextCrsId;
        setParseSettingsDraft((prev) => ({ ...prev, crsId: nextCrsId }));
      }
    },
    [
      crsCatalogGroupFilter,
      parseSettingsDraft.crsId,
      settingsDraft.units,
      setCrsCatalogGroupFilter,
      setParseSettingsDraft,
    ],
  );

  // Narrow sync for EXTERNAL changes only. Previous values distinguish a
  // project load/import (crsId changed: follow the loaded CRS into its group,
  // keep its exact id) from a display-unit change (crsId unchanged: map an
  // SPCS CRS to its ft/m companion). User group changes go through
  // handleCrsCatalogGroupChange above and never reach either branch as a
  // group-forcing correction. Search is intentionally not a dependency: it
  // stays a pure visibility filter.
  // Null-initialized: the first run also takes the external branch so an
  // unknown Grid id present at mount is sanitized instead of surviving via
  // a self-equal previous value. With consistent initial state both
  // resolutions are null, so first mount is otherwise a no-op.
  const prevCrsIdRef = useRef<string | null>(null);
  const prevUnitsRef = useRef(settingsDraft.units);
  useEffect(() => {
    const prevCrsId = prevCrsIdRef.current;
    const prevUnits = prevUnitsRef.current;
    const crsIdChanged = prevCrsId === null || parseSettingsDraft.crsId !== prevCrsId;
    const unitsChanged = settingsDraft.units !== prevUnits;
    prevCrsIdRef.current = parseSettingsDraft.crsId;
    prevUnitsRef.current = settingsDraft.units;
    if (crsIdChanged) {
      const resolution = resolveExternalCrsChange({
        crsId: parseSettingsDraft.crsId,
        currentGroupFilter: crsCatalogGroupFilter,
      });
      if (resolution) setCrsCatalogGroupFilter(resolution.nextCatalogGroupFilter);
      const unknownResolution = resolveUnknownGridExternalCrsId({
        crsId: parseSettingsDraft.crsId,
        coordSystemMode: parseSettingsDraft.coordSystemMode,
        visibleCatalog: filteredDraftCrsCatalog,
      });
      if (unknownResolution) {
        const nextCrsId = unknownResolution.nextCrsId;
        setParseSettingsDraft((prev) => ({ ...prev, crsId: nextCrsId }));
      }
      return;
    }
    if (unitsChanged) {
      const resolution = resolveSpcsUnitCompanion({
        crsId: parseSettingsDraft.crsId,
        visibleCatalog: filteredDraftCrsCatalog,
      });
      if (resolution) {
        const nextCrsId = resolution.nextCrsId;
        setParseSettingsDraft((prev) => ({ ...prev, crsId: nextCrsId }));
      }
    }
  }, [
    crsCatalogGroupFilter,
    filteredDraftCrsCatalog,
    parseSettingsDraft.coordSystemMode,
    parseSettingsDraft.crsId,
    settingsDraft.units,
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
    handleCrsCatalogGroupChange,
  };
};
