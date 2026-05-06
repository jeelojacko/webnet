import { describe, expect, it } from 'vitest';

import { resolveDraftCrsSelection } from '../src/crsDraftSelection';
import { CRS_CATALOG } from '../src/engine/crsCatalog';

describe('resolveDraftCrsSelection', () => {
  it('switches the catalog group instead of overwriting a valid hidden provincial CRS', () => {
    const filteredDraftCrsCatalog = CRS_CATALOG.filter((row) => row.catalogGroup === 'canada-utm');
    const resolution = resolveDraftCrsSelection({
      crsId: 'CA_NAD83_CSRS_NB_STEREO_DOUBLE',
      crsCatalogGroupFilter: 'canada-utm',
      filteredDraftCrsCatalog,
    });
    expect(resolution).toEqual({ nextCatalogGroupFilter: 'canada-provincial' });
  });

  it('falls back to the first visible CRS only when the loaded id is unknown', () => {
    const filteredDraftCrsCatalog = CRS_CATALOG.filter(
      (row) => row.catalogGroup === 'canada-utm',
    ).slice(0, 3);
    const resolution = resolveDraftCrsSelection({
      crsId: 'UNKNOWN_CRS',
      crsCatalogGroupFilter: 'canada-utm',
      filteredDraftCrsCatalog,
    });
    expect(resolution).toEqual({ nextCrsId: filteredDraftCrsCatalog[0]?.id });
  });
});
