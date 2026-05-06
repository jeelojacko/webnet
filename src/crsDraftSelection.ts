import type { CrsCatalogGroupFilter } from './appStateTypes';
import { CRS_CATALOG, type CrsDefinition } from './engine/crsCatalog';

export interface DraftCrsResolution {
  nextCatalogGroupFilter?: CrsCatalogGroupFilter;
  nextCrsId?: string;
}

export const resolveDraftCrsSelection = ({
  crsId,
  crsCatalogGroupFilter,
  filteredDraftCrsCatalog,
}: {
  crsId: string;
  crsCatalogGroupFilter: CrsCatalogGroupFilter;
  filteredDraftCrsCatalog: CrsDefinition[];
}): DraftCrsResolution | null => {
  if (filteredDraftCrsCatalog.length === 0) return null;
  if (filteredDraftCrsCatalog.some((row) => row.id === crsId)) return null;
  const selected = CRS_CATALOG.find((row) => row.id === crsId);
  if (selected && selected.catalogGroup !== crsCatalogGroupFilter) {
    return { nextCatalogGroupFilter: selected.catalogGroup };
  }
  const fallbackCompanionId =
    selected?.catalogGroup === 'us-spcs'
      ? selected.linearUnit === 'us-ft'
        ? selected.id.replace(/_FTUS$/, '')
        : `${selected.id}_FTUS`
      : null;
  if (
    fallbackCompanionId &&
    filteredDraftCrsCatalog.some((row) => row.id === fallbackCompanionId)
  ) {
    return { nextCrsId: fallbackCompanionId };
  }
  return { nextCrsId: filteredDraftCrsCatalog[0].id };
};
