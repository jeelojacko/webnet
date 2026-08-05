import type { NbLawManifest, NbLawManifestEntry } from './nbLawTypes';

export type NbLawManifestValidationResult = {
  valid: boolean;
  errors: string[];
};

const SOURCE_TYPES = new Set(['act', 'regulation']);

const isPriority = (value: unknown): value is NbLawManifestEntry['priority'] =>
  typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 5;

export const buildNbLawSourceUrl = (
  entry: Pick<NbLawManifestEntry, 'sourceType' | 'sourceCorpus' | 'sourceIdentifier'>,
  sourceBaseUrl = 'https://laws.gnb.ca/en/document',
): string => {
  const corpus = entry.sourceCorpus ?? (entry.sourceType === 'act' ? 'cs' : 'cr');
  return `${sourceBaseUrl.replace(/\/$/, '')}/${corpus}/${encodeURIComponent(entry.sourceIdentifier)}`;
};

export const validateNbLawManifest = (manifest: NbLawManifest): NbLawManifestValidationResult => {
  const errors: string[] = [];
  if (manifest.schemaVersion !== 1) errors.push('Manifest schemaVersion must be 1.');
  if (!manifest.id?.trim()) errors.push('Manifest id is required.');
  if (!manifest.sourceBaseUrl?.startsWith('https://laws.gnb.ca/')) {
    errors.push('Manifest sourceBaseUrl must use laws.gnb.ca.');
  }
  const ids = new Set<string>();
  for (const entry of manifest.documents ?? []) {
    if (!entry.id?.trim()) errors.push('Document id is required.');
    if (ids.has(entry.id)) errors.push(`Duplicate document id: ${entry.id}.`);
    ids.add(entry.id);
    if (!entry.manualTitle?.trim()) errors.push(`${entry.id} manualTitle is required.`);
    if (!entry.currentTitle?.trim()) errors.push(`${entry.id} currentTitle is required.`);
    if (!SOURCE_TYPES.has(entry.sourceType)) errors.push(`${entry.id} sourceType is invalid.`);
    if (entry.sourceCorpus && !['cs', 'cr', 'ar'].includes(entry.sourceCorpus)) {
      errors.push(`${entry.id} sourceCorpus is invalid.`);
    }
    if (!entry.sourceIdentifier?.trim()) errors.push(`${entry.id} sourceIdentifier is required.`);
    if (!isPriority(entry.priority)) errors.push(`${entry.id} priority must be 1-5.`);
    if (!Array.isArray(entry.categories)) errors.push(`${entry.id} categories must be an array.`);
    if (!Array.isArray(entry.tags)) errors.push(`${entry.id} tags must be an array.`);
    if (entry.sourceType === 'regulation' && !entry.parentActId) {
      errors.push(`${entry.id} regulation requires parentActId.`);
    }
    if (entry.sourceType === 'act' && entry.parentActId) {
      errors.push(`${entry.id} act must not declare parentActId.`);
    }
  }
  for (const entry of manifest.documents ?? []) {
    if (entry.parentActId && !ids.has(entry.parentActId)) {
      errors.push(`${entry.id} parentActId does not exist: ${entry.parentActId}.`);
    }
  }
  return { valid: errors.length === 0, errors };
};

export const getEnabledNbLawEntries = (manifest: NbLawManifest): NbLawManifestEntry[] =>
  manifest.documents.filter((entry) => entry.enabled);
