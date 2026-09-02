import type { ImportedLegalComponent } from '../studyTypes';
import type { NbLawContentPackage, NbLawDocumentComponent } from '../content/nbLawTypes';

/**
 * Map a content-package component to the authoritative-source shape the Unit
 * authoring validator grounds proposals against. Shared so the external
 * authoring script (studyAiAuthoring.ts), the local Unit authoring runner, and
 * any future import path build sourceComponents byte-identically.
 */

export const componentToImported = (
  document: NbLawContentPackage['documents'][number],
  component: NbLawDocumentComponent,
): ImportedLegalComponent => ({
  documentId: document.id,
  id: component.id,
  sourceKey: component.sourceKey,
  componentType: component.componentType,
  label: component.label,
  heading: component.heading,
  text: component.text,
  contentHash: component.contentHash,
  subsections: component.componentType === 'section' ? component.subsections : undefined,
  extractionStatus: 'complete',
});

/** Components for one proposal: the package document's entries whose sourceKey is selected. */
export const sourceComponentsForProposal = (
  pkg: NbLawContentPackage,
  documentId: string,
  sourceKeys: string[],
): ImportedLegalComponent[] => {
  const document = pkg.documents.find((entry) => entry.id === documentId);
  if (!document) return [];
  return document.components
    .filter((component) => sourceKeys.includes(component.sourceKey))
    .map((component) => componentToImported(document, component));
};
