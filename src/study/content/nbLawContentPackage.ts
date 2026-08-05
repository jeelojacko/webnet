import type { NbLawContentPackage, NbLawNormalizedDocument } from './nbLawTypes';

export type NbLawContentPackageValidation = {
  valid: boolean;
  errors: string[];
};

export const buildNbLawContentPackage = ({
  id,
  manifestId,
  createdAt,
  documents,
}: {
  id: string;
  manifestId: string;
  createdAt: string;
  documents: NbLawNormalizedDocument[];
}): NbLawContentPackage => ({
  schemaVersion: 1,
  id,
  manifestId,
  createdAt,
  documents,
  relationships: documents
    .filter((document) => document.documentType === 'regulation' && document.parentActId)
    .map((document) => ({ parentActId: document.parentActId as string, regulationId: document.id })),
  sourceHashes: Object.fromEntries(documents.map((document) => [document.id, document.contentHash])),
});

export const validateNbLawContentPackage = (
  contentPackage: NbLawContentPackage,
): NbLawContentPackageValidation => {
  const errors: string[] = [];
  if (contentPackage.schemaVersion !== 1) errors.push('Package schemaVersion must be 1.');
  if (!contentPackage.id?.trim()) errors.push('Package id is required.');
  const ids = new Set(contentPackage.documents.map((document) => document.id));
  for (const document of contentPackage.documents) {
    if (document.schemaVersion !== 1) errors.push(`${document.id} document schemaVersion must be 1.`);
    if (!document.officialTitle.trim()) errors.push(`${document.id} officialTitle is required.`);
    if (!document.sourceUrl.startsWith('https://laws.gnb.ca/')) {
      errors.push(`${document.id} sourceUrl must use laws.gnb.ca.`);
    }
    if (document.sections.length === 0) errors.push(`${document.id} must include at least one section.`);
    if (contentPackage.sourceHashes[document.id] !== document.contentHash) {
      errors.push(`${document.id} sourceHashes entry does not match document hash.`);
    }
    if (document.parentActId && !ids.has(document.parentActId)) {
      errors.push(`${document.id} parentActId does not exist in package.`);
    }
  }
  return { valid: errors.length === 0, errors };
};
