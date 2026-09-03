// Exam Curriculum V1 — corpus view + range resolution.
//
// Resolves catalog-level focus specs (label endpoints such as "12", "2.1",
// "19.01", "21.4") against the authoritative content package. Resolution is
// document-order based, which copes with corpus label quirks (PDF-extracted
// subsection labels such as "12(1)" and dotted bylaw part labels) without
// special-casing: an endpoint's group is the exact label, "endpoint." dotted
// descendants, and "endpoint( subparts, and a range spans from the first
// group member to the last in document order.

import type {
  ExamCurriculumCorpusComponent,
  ExamCurriculumCorpusDocument,
  ExamCurriculumCorpusView,
  ExamCurriculumLookupSpec,
  ExamCurriculumSectionRange,
  ExamCurriculumSourceAnchor,
  ExamCurriculumUnit,
  ExamCurriculumUnitSpec,
} from './examCurriculumTypes';
import type { NbLawContentPackage } from '../content/nbLawTypes';

type CorpusPackageWithMetadata = NbLawContentPackage & {
  corpusMetadata?: { corpusContentHash?: string };
};

export const buildExamCurriculumCorpusView = (
  contentPackage: CorpusPackageWithMetadata,
): ExamCurriculumCorpusView => {
  const corpusContentHash = contentPackage.corpusMetadata?.corpusContentHash;
  if (!corpusContentHash) {
    throw new Error('exam-curriculum: content package is missing corpusMetadata.corpusContentHash');
  }
  return {
    packageId: contentPackage.id,
    corpusContentHash,
    documents: contentPackage.documents.map((doc) => ({
      id: doc.id,
      officialTitle: doc.officialTitle,
      components: doc.components.map((c, index) => ({
        id: c.id,
        sourceKey: c.sourceKey,
        label: c.label,
        componentType: c.componentType,
        order: index,
      })),
    })),
  };
};

const endpointGroup = (doc: ExamCurriculumCorpusDocument, endpoint: string): ExamCurriculumCorpusComponent[] => {
  const sections = doc.components.filter((c) => c.componentType === 'section');
  return sections.filter(
    (c) =>
      c.label === endpoint ||
      c.label.startsWith(`${endpoint}.`) ||
      c.label.startsWith(`${endpoint}(`),
  );
};

export const resolveExamCurriculumSectionRange = (
  doc: ExamCurriculumCorpusDocument,
  range: ExamCurriculumSectionRange,
): ExamCurriculumCorpusComponent[] => {
  const fromEndpoint = range.from;
  const toEndpoint = range.to ?? range.from;
  const fromGroup = endpointGroup(doc, fromEndpoint);
  const toGroup = endpointGroup(doc, toEndpoint);
  if (fromGroup.length === 0) {
    throw new Error(
      `exam-curriculum: no components match from-endpoint "${fromEndpoint}" in document ${doc.id}`,
    );
  }
  if (toGroup.length === 0) {
    throw new Error(
      `exam-curriculum: no components match to-endpoint "${toEndpoint}" in document ${doc.id}`,
    );
  }
  const fromOrder = Math.min(...fromGroup.map((c) => c.order));
  const toOrder = Math.max(...toGroup.map((c) => c.order));
  if (toOrder < fromOrder) {
    throw new Error(
      `exam-curriculum: range ${fromEndpoint}..${toEndpoint} is inverted in document ${doc.id}`,
    );
  }
  const sections = doc.components.filter(
    (c) => c.componentType === 'section' && c.order >= fromOrder && c.order <= toOrder,
  );
  return sections;
};

const findSupplemental = (
  doc: ExamCurriculumCorpusDocument,
  componentType: 'schedule' | 'form',
  label: string,
): ExamCurriculumCorpusComponent | null => {
  const wanted = label.toLowerCase();
  const match = doc.components.find(
    (c) => c.componentType === componentType && c.label.toLowerCase() === wanted,
  );
  return match ?? null;
};

export const resolveExamCurriculumAnchorComponents = (
  doc: ExamCurriculumCorpusDocument,
  spec: ExamCurriculumUnitSpec,
): ExamCurriculumCorpusComponent[] => {
  const byKey = new Map<string, ExamCurriculumCorpusComponent>();
  for (const range of spec.ranges) {
    for (const component of resolveExamCurriculumSectionRange(doc, range)) {
      byKey.set(component.sourceKey, component);
    }
  }
  for (const letter of spec.schedules ?? []) {
    const match = findSupplemental(doc, 'schedule', `SCHEDULE ${letter}`);
    if (!match) throw new Error(`exam-curriculum: SCHEDULE ${letter} not found in document ${doc.id}`);
    byKey.set(match.sourceKey, match);
  }
  for (const formLabel of spec.forms ?? []) {
    const match = findSupplemental(doc, 'form', formLabel);
    if (!match) throw new Error(`exam-curriculum: form "${formLabel}" not found in document ${doc.id}`);
    byKey.set(match.sourceKey, match);
  }
  return [...byKey.values()].sort((a, b) => a.order - b.order);
};

const anchorRoleFor = (unitType: ExamCurriculumUnitSpec['unitType']): ExamCurriculumSourceAnchor['role'] =>
  unitType === 'document_orientation' ? 'orientation' : 'core_rule';

export const resolveExamCurriculumLookupTarget = (
  doc: ExamCurriculumCorpusDocument,
  lookup: ExamCurriculumLookupSpec,
): { prompt: string; documentId: string; sourceKey?: string } => {
  const resolveKey = (): string | undefined => {
    if (lookup.sectionLabel !== undefined) {
      // Exact label first; NBLS-style documents carry only subsection-expanded
      // labels (e.g. "15(1)"), so fall back to the endpoint group and pin the
      // group's first component (the start of the section).
      const match = doc.components.find(
        (c) => c.componentType === 'section' && c.label === lookup.sectionLabel,
      );
      if (match) return match.sourceKey;
      const group = endpointGroup(doc, lookup.sectionLabel);
      if (group.length === 0) {
        throw new Error(`exam-curriculum: section "${lookup.sectionLabel}" not found in document ${doc.id}`);
      }
      return [...group].sort((a, b) => a.order - b.order)[0].sourceKey;
    }
    if (lookup.scheduleLabel !== undefined) {
      const match = findSupplemental(doc, 'schedule', `SCHEDULE ${lookup.scheduleLabel}`);
      if (!match) throw new Error(`exam-curriculum: SCHEDULE ${lookup.scheduleLabel} not found in document ${doc.id}`);
      return match.sourceKey;
    }
    if (lookup.formLabel !== undefined) {
      const match = findSupplemental(doc, 'form', lookup.formLabel);
      if (!match) throw new Error(`exam-curriculum: form "${lookup.formLabel}" not found in document ${doc.id}`);
      return match.sourceKey;
    }
    return undefined;
  };
  return { prompt: lookup.prompt, documentId: doc.id, sourceKey: resolveKey() };
};

export const buildExamCurriculumUnitFromSpec = (
  spec: ExamCurriculumUnitSpec,
  corpus: ExamCurriculumCorpusView,
): ExamCurriculumUnit => {
  const doc = corpus.documents.find((d) => d.id === spec.documentId);
  if (!doc) throw new Error(`exam-curriculum: unknown document "${spec.documentId}" for unit ${spec.id}`);
  const components = resolveExamCurriculumAnchorComponents(doc, spec);
  const role = anchorRoleFor(spec.unitType);
  return {
    id: spec.id,
    unitType: spec.unitType,
    tier: 'A',
    title: spec.title,
    sourceDocumentIds: [doc.id],
    sourceAnchors: components.map((c) => ({
      documentId: doc.id,
      sourceKey: c.sourceKey,
      label: c.label,
      role,
    })),
    learningDepths: [...spec.learningDepths],
    examGoal: spec.examGoal,
    recognitionCues: [...spec.recognitionCues],
    coreUnderstanding: [...spec.coreUnderstanding],
    mustRecall: [...spec.mustRecall],
    mustLocate: spec.mustLocate.map((lookup) => resolveExamCurriculumLookupTarget(doc, lookup)),
    relatedUnitIds: [...spec.relatedUnitIds],
    reviewWeight: spec.reviewWeight,
    status: 'planned',
  };
};
