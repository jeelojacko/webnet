import type { ImportedLegalDocument } from './studyTypes';

/** Deterministic navigation copy; never replaces or paraphrases official text. */
export const buildOfficialDocumentSummary = (document: ImportedLegalDocument): string => {
  const kind = document.documentType === 'regulation' ? 'regulation' : 'legislation';
  return `Official New Brunswick ${kind}: ${document.officialTitle}. Use official text for scope, definitions, and requirements.`;
};
