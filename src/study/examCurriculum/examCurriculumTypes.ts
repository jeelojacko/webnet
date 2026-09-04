// Exam Curriculum V1 — schema types.
//
// The Exam Curriculum is a NEW, standalone curriculum layer on top of the
// authoritative nb-sit-statute corpus. It is open-book exam oriented and is
// intentionally distinct from the V5 StudyUnit records, Study Map proposals,
// and AI-authored unit proposals. It defines WHAT is to be learned
// (recognition cues, core understanding, recall targets, lookup targets)
// before any learner-facing card content is authored.

export const EXAM_CURRICULUM_ARCHITECTURE_VERSION = 'exam-curriculum-v1';
export const EXAM_CURRICULUM_SCHEMA_VERSION = 1;

export type ExamCurriculumTier = 'A' | 'B' | 'C' | 'D' | 'NAV';

export type ExamUnitType =
  | 'document_orientation'
  | 'core_concept'
  | 'cross_document_navigation'
  | 'lookup_drill';

export type ExamLearningDepth = 'recognize' | 'understand' | 'recall' | 'retrieve';

export type ExamCurriculumReviewWeight = 'high' | 'medium' | 'low';

export type ExamCurriculumStatus = 'planned' | 'authored' | 'reviewed';

export type ExamCurriculumAnchorRole =
  | 'orientation'
  | 'core_rule'
  | 'navigation'
  | 'example'
  | 'related';

/** A resolved pointer at one corpus component inside one document. */
export interface ExamCurriculumSourceAnchor {
  documentId: string;
  sourceKey: string;
  /** Human label of the component (section label, schedule label, ...). */
  label: string;
  role: ExamCurriculumAnchorRole;
}

/** A compact "where to look in the statute" target for open-book study. */
export interface ExamCurriculumLookupTarget {
  prompt: string;
  documentId: string;
  sourceKey?: string;
}

export interface ExamCurriculumUnit {
  id: string;
  unitType: ExamUnitType;
  tier: ExamCurriculumTier;
  title: string;
  /** Canonical corpus document IDs this unit draws from. */
  sourceDocumentIds: string[];
  sourceAnchors: ExamCurriculumSourceAnchor[];
  learningDepths: ExamLearningDepth[];
  examGoal: string;
  recognitionCues: string[];
  coreUnderstanding: string[];
  /** Compact rules the learner should know without opening the statute. */
  mustRecall: string[];
  /** Where to find exact statutory detail in an open-book setting. */
  mustLocate: ExamCurriculumLookupTarget[];
  relatedUnitIds: string[];
  reviewWeight: ExamCurriculumReviewWeight;
  status: ExamCurriculumStatus;
}

export interface ExamCurriculumManifest {
  schemaVersion: 1;
  curriculumId: string;
  architectureVersion: typeof EXAM_CURRICULUM_ARCHITECTURE_VERSION;
  sourcePackageId: string;
  sourceCorpusContentHash: string;
  createdAt: string;
  /** sha256 over canonicalJson of the manifest with createdAt+contentHash removed. */
  contentHash: string;
  units: ExamCurriculumUnit[];
}

/**
 * Catalog-level input: a section range expressed with label endpoints.
 * Dotted descendants and parenthesized subparts of an endpoint resolve
 * together (document-order semantics); a two-endpoint range spans every
 * section between the groups in document order.
 */
export interface ExamCurriculumSectionRange {
  /** Inclusive from-endpoint, e.g. "12", "2.1", "19.01", "21.4". */
  from: string;
  /** Inclusive to-endpoint; defaults to `from`. */
  to?: string;
}

/** One planned unit before corpus resolution (deterministic curation data). */
export interface ExamCurriculumUnitSpec {
  id: string;
  title: string;
  unitType: Exclude<ExamUnitType, 'cross_document_navigation' | 'lookup_drill'>;
  /** Tier of the unit; defaults to 'A' for the frozen Tier-A catalog. */
  tier?: ExamCurriculumTier;
  documentId: string;
  /** Section ranges resolved against the corpus document. */
  ranges: ExamCurriculumSectionRange[];
  /** Schedule letters (e.g. "A" -> SCHEDULE A) resolved as supplemental anchors. */
  schedules?: string[];
  /** Form labels (e.g. "Form 1") resolved as supplemental anchors. */
  forms?: string[];
  learningDepths: ExamLearningDepth[];
  examGoal: string;
  recognitionCues: string[];
  coreUnderstanding: string[];
  mustRecall: string[];
  /** Lookup prompts; optional section/schedule/form pins, all resolved to sourceKeys. */
  mustLocate: ExamCurriculumLookupSpec[];
  relatedUnitIds: string[];
  reviewWeight: ExamCurriculumReviewWeight;
}

export interface ExamCurriculumLookupSpec {
  prompt: string;
  sectionLabel?: string;
  scheduleLabel?: string;
  formLabel?: string;
}

/**
 * Cross-document Navigation source: one corpus document plus the section
 * ranges (and optional schedule/form labels) that carry the navigation point.
 * Resolution is identical to A-D range resolution but scoped to this document.
 */
export interface ExamCrossDocumentSourceSpec {
  documentId: string;
  ranges: ExamCurriculumSectionRange[];
  /** Schedule letters (e.g. "A" -> SCHEDULE A) resolved as supplemental anchors. */
  schedules?: string[];
  /** Form labels (e.g. "Form 1") resolved as supplemental anchors. */
  forms?: string[];
}

/**
 * A cross-document lookup target: the prompt plus the EXPLICIT document the
 * pin must be resolved against (never silently resolved against another
 * document that happens to share a section number).
 */
export interface ExamCrossDocumentLookupSpec {
  prompt: string;
  documentId: string;
  /** Optional pins; when given they are resolved to a sourceKey in `documentId`. */
  sectionLabel?: string;
  scheduleLabel?: string;
  formLabel?: string;
}

/**
 * Planned cross-document Navigation unit before corpus resolution. These are
 * routing/issue-classification units that teach WHICH law to open first and
 * WHICH branch to follow for a fact pattern; they intentionally traverse
 * several statutes instead of summarizing one.
 */
export interface ExamCrossDocumentNavigationSpec {
  id: string;
  title: string;
  unitType: 'cross_document_navigation';
  tier: 'NAV';
  /** Sources in canonical source order; anchors follow this order, then corpus order. */
  sources: ExamCrossDocumentSourceSpec[];
  learningDepths: ExamLearningDepth[];
  examGoal: string;
  recognitionCues: string[];
  coreUnderstanding: string[];
  mustRecall: string[];
  mustLocate: ExamCrossDocumentLookupSpec[];
  relatedUnitIds: string[];
  reviewWeight: ExamCurriculumReviewWeight;
}

/** Union of every planned catalog entry (A-D single-document + NAV cross-document). */
export type ExamCurriculumCatalogSpec =
  | ExamCurriculumUnitSpec
  | ExamCrossDocumentNavigationSpec;

export interface ExamCurriculumCorpusView {
  packageId: string;
  corpusContentHash: string;
  documents: ExamCurriculumCorpusDocument[];
}

export interface ExamCurriculumCorpusDocument {
  id: string;
  officialTitle: string;
  /** All components in document order. */
  components: ExamCurriculumCorpusComponent[];
}

export interface ExamCurriculumCorpusComponent {
  id: string;
  sourceKey: string;
  label: string;
  componentType: string;
  /** Position within the document (components order). */
  order: number;
}

export const examCorpusSections = (doc: ExamCurriculumCorpusDocument): ExamCurriculumCorpusComponent[] =>
  doc.components.filter((c) => c.componentType === 'section');

export const examCorpusSupplemental = (
  doc: ExamCurriculumCorpusDocument,
  componentType: string,
): ExamCurriculumCorpusComponent[] =>
  doc.components.filter((c) => c.componentType === componentType);

export interface ExamCurriculumValidationIssue {
  level: 'error' | 'warning';
  unitId: string | null;
  code: string;
  message: string;
}

export interface ExamCurriculumValidationReport {
  errors: ExamCurriculumValidationIssue[];
  warnings: ExamCurriculumValidationIssue[];
}
