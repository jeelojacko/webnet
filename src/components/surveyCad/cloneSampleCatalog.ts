import { SAMPLE_CATALOG } from '../../engine/fieldToFinish/sampleCatalog';

/** Fresh deep-ish copy of the sample catalog for workspace-owned state. */
export const cloneSampleCatalog = (): typeof SAMPLE_CATALOG => ({
  ...SAMPLE_CATALOG,
  definitions: SAMPLE_CATALOG.definitions.map((entry) => ({
    ...entry,
    lineworkBehavior: { ...entry.lineworkBehavior },
  })),
  aliases: SAMPLE_CATALOG.aliases.map((alias) => ({ ...alias })),
});
