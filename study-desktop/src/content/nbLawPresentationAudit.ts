import type { NbLawNormalizedDocument } from './nbLawTypes';

export type NbLawPresentationAudit = {
  documents: number;
  components: number;
  parentComponentsWithChildren: number;
  aggregateParentComponents: number;
  doubleRenderRiskComponents: number;
  malformedLabelBodyJoins: number;
  affectedDocuments: string[];
  malformedExamples: string[];
};

const compact = (value: string): string => value.toLowerCase().replace(/[^a-z0-9]+/g, '');

const parentReproducesChildren = (text: string, children: string[]): boolean => {
  const parent = compact(text);
  const childText = children.map(compact).filter(Boolean);
  return childText.length > 0 && childText.every((child) => child.length > 12 && parent.includes(child));
};

const parentDisplayText = (text: string, children: string[]): string =>
  children
    .slice()
    .sort((left, right) => right.length - left.length)
    .reduce((value, child) => {
      const index = value.indexOf(child);
      return index >= 0 ? `${value.slice(0, index)}${value.slice(index + child.length)}` : value;
    }, text)
    .trim();

const malformedLabelBodyJoin = (text: string): boolean =>
  /(?:^|\n)\s*\d+(?:\.\d+)?(?:\([0-9a-z]+\))*[A-Z“]/i.test(text);

export const buildNbLawPresentationAudit = (
  documents: NbLawNormalizedDocument[],
): NbLawPresentationAudit => {
  const affectedDocuments = new Set<string>();
  const malformedExamples: string[] = [];
  let components = 0;
  let parentComponentsWithChildren = 0;
  let aggregateParentComponents = 0;
  let malformedLabelBodyJoins = 0;
  let doubleRenderRiskComponents = 0;

  for (const document of documents) {
    for (const component of document.components) {
      components += 1;
      const children = component.componentType === 'section' ? component.subsections : [];
      if (children.length > 0) {
        parentComponentsWithChildren += 1;
        const childTexts = children.map((child) => child.text);
        if (parentReproducesChildren(component.text, childTexts)) {
          aggregateParentComponents += 1;
          affectedDocuments.add(document.id);
          if (childTexts.some((child) => parentDisplayText(component.text, childTexts).includes(child))) {
            doubleRenderRiskComponents += 1;
          }
        }
      }
      const texts = [component.text, ...children.map((child) => child.text)];
      for (const text of texts) {
        if (!malformedLabelBodyJoin(text)) continue;
        malformedLabelBodyJoins += 1;
        if (malformedExamples.length < 20) malformedExamples.push(`${document.id}:${component.sourceKey}`);
        affectedDocuments.add(document.id);
      }
    }
  }

  return {
    documents: documents.length,
    components,
    parentComponentsWithChildren,
    aggregateParentComponents,
    doubleRenderRiskComponents,
    malformedLabelBodyJoins,
    affectedDocuments: [...affectedDocuments].sort(),
    malformedExamples,
  };
};
