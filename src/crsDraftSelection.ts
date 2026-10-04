import type { CrsCatalogGroupFilter } from './appStateTypes';
import { CRS_CATALOG, type CrsDefinition } from './engine/crsCatalog';
import type { SettingsState } from './appStateTypes';

export const filterCrsCatalogByGroupAndUnits = (
  group: CrsCatalogGroupFilter,
  units: SettingsState['units'],
): CrsDefinition[] => {
  const byGroup =
    group === 'all' ? CRS_CATALOG : CRS_CATALOG.filter((row) => row.catalogGroup === group);
  const preferredSpcsLinearUnit = units === 'ft' ? 'us-ft' : 'm';
  return byGroup.filter(
    (row) => row.catalogGroup !== 'us-spcs' || row.linearUnit === preferredSpcsLinearUnit,
  );
};

const spcsCompanionId = (selected: CrsDefinition): string | null => {
  if (selected.catalogGroup !== 'us-spcs') return null;
  return selected.linearUnit === 'us-ft'
    ? selected.id.replace(/_FTUS$/, '')
    : `${selected.id}_FTUS`;
};

/**
 * User picked a new catalog group. The group is authoritative: the caller sets
 * it, and this only decides whether the CRS must move to stay consistent.
 * Returns `{ nextCrsId }` when the current CRS is absent from the new group's
 * unit-filtered catalog, otherwise null (keep the current CRS).
 */
export const resolveUserCatalogGroupChange = ({
  crsId,
  nextGroup,
  units,
}: {
  crsId: string;
  nextGroup: CrsCatalogGroupFilter;
  units: SettingsState['units'];
}): { nextCrsId: string } | null => {
  const visible = filterCrsCatalogByGroupAndUnits(nextGroup, units);
  if (visible.length === 0) return null;
  if (visible.some((row) => row.id === crsId)) return null;
  const selected = CRS_CATALOG.find((row) => row.id === crsId);
  const companionId = selected ? spcsCompanionId(selected) : null;
  if (companionId && visible.some((row) => row.id === companionId)) {
    return { nextCrsId: companionId };
  }
  return { nextCrsId: visible[0].id };
};

/**
 * The draft crsId changed from outside the category control (project
 * open/import/reset). The loaded CRS is authoritative: follow it into its
 * catalog group. Never rewrites the crsId itself, so a saved project reopens
 * with its exact CRS intact.
 */
export const resolveExternalCrsChange = ({
  crsId,
  currentGroupFilter,
}: {
  crsId: string;
  currentGroupFilter: CrsCatalogGroupFilter;
}): { nextCatalogGroupFilter: CrsCatalogGroupFilter } | null => {
  if (currentGroupFilter === 'all') return null;
  const selected = CRS_CATALOG.find((row) => row.id === crsId);
  if (!selected) return null;
  if (selected.catalogGroup === currentGroupFilter) return null;
  return { nextCatalogGroupFilter: selected.catalogGroup };
};

/**
 * An external crsId change landed on an unknown id while in Grid mode
 * (e.g. a project file referencing a CRS absent from the catalog). Sanitize
 * to the first visible entry so the controlled CRS select always holds a
 * valid value. Local mode is excluded: there `crsId` is an inert sentinel
 * (typically 'LOCAL') and must never be rewritten.
 */
export const resolveUnknownGridExternalCrsId = ({
  crsId,
  coordSystemMode,
  visibleCatalog,
}: {
  crsId: string;
  coordSystemMode: 'local' | 'grid';
  visibleCatalog: CrsDefinition[];
}): { nextCrsId: string } | null => {
  if (coordSystemMode !== 'grid') return null;
  if (CRS_CATALOG.some((row) => row.id === crsId)) return null;
  if (visibleCatalog.length === 0) return null;
  return { nextCrsId: visibleCatalog[0].id };
};

/**
 * Display units changed while the crsId did not (no project load). Only maps
 * an SPCS CRS to its ft/m companion when one exists in the visible catalog;
 * non-SPCS selections are never mutated because of a unit change.
 */
export const resolveSpcsUnitCompanion = ({
  crsId,
  visibleCatalog,
}: {
  crsId: string;
  visibleCatalog: CrsDefinition[];
}): { nextCrsId: string } | null => {
  const selected = CRS_CATALOG.find((row) => row.id === crsId);
  if (!selected) return null;
  const companionId = spcsCompanionId(selected);
  if (companionId && visibleCatalog.some((row) => row.id === companionId)) {
    return { nextCrsId: companionId };
  }
  return null;
};
