// Exam Curriculum V1 — deterministic validator.
//
// Validates a built curriculum against:
//   - structural identity rules (unique IDs, known tiers/types/depths,
//     non-empty titles/goals),
//   - corpus binding (known documents, known sourceKeys, anchor/document
//     coherence, duplicate anchors),
//   - reference integrity (relatedUnitIds),
//   - educational completeness per unit type,
//   - warning-level recall-vs-retrieve sanity heuristics (never hard errors).

import type {
  ExamCurriculumCorpusView,
  ExamCurriculumTier,
  ExamCurriculumUnit,
  ExamCurriculumValidationIssue,
  ExamCurriculumValidationReport,
  ExamLearningDepth,
  ExamUnitType,
} from './examCurriculumTypes';

export const EXAM_CURRICULUM_TIERS: readonly ExamCurriculumTier[] = ['A', 'B', 'C', 'D', 'NAV'];
export const EXAM_CURRICULUM_UNIT_TYPES: readonly ExamUnitType[] = [
  'document_orientation',
  'core_concept',
  'cross_document_navigation',
  'lookup_drill',
];
export const EXAM_CURRICULUM_LEARNING_DEPTHS: readonly ExamLearningDepth[] = [
  'recognize',
  'understand',
  'recall',
  'retrieve',
];

const WARNING_RECALL_ENTRY_LIMIT = 6;
const WARNING_RECALL_TEXT_LIMIT = 240;
const WARNING_ANCHOR_BREADTH_LIMIT = 40;
// Cross-document navigation is intentionally broader than a single-statute
// unit because it traverses many narrow statutory sources; keep a separate
// NAV-aware breadth threshold and leave the A-D threshold untouched.
const NAV_ANCHOR_BREADTH_LIMIT = 80;

const known = (values: readonly string[], value: string): boolean => values.includes(value);

const depths = (unit: ExamCurriculumUnit): Set<ExamLearningDepth> => new Set(unit.learningDepths);

const payloadCount = (unit: ExamCurriculumUnit): number =>
  unit.recognitionCues.length +
  unit.coreUnderstanding.length +
  unit.mustRecall.length +
  unit.mustLocate.length;

const validateOrientationUnit = (unit: ExamCurriculumUnit, errors: ExamCurriculumValidationIssue[]): void => {
  const unitDepths = depths(unit);
  if (unit.tier === 'D') {
    // Tier-D units are awareness-only: they must at least target recognition
    // and carry one study target; understanding is not required (D-MUNI-01
    // adds it where the legacy/repealed status itself is the point).
    if (!unitDepths.has('recognize')) {
      errors.push({
        level: 'error',
        unitId: unit.id,
        code: 'orientation-missing-depth',
        message: 'Tier-D document_orientation unit must target learning depth "recognize"',
      });
    }
    if (payloadCount(unit) === 0) {
      errors.push({
        level: 'error',
        unitId: unit.id,
        code: 'orientation-missing-payload',
        message:
          'document_orientation unit must have at least one recognition cue, core-understanding point, or study target',
      });
    }
    return;
  }
  for (const required of ['recognize', 'understand'] as const) {
    if (!unitDepths.has(required)) {
      errors.push({
        level: 'error',
        unitId: unit.id,
        code: 'orientation-missing-depth',
        message: `document_orientation unit must target learning depth "${required}"`,
      });
    }
  }
  if (unit.tier === 'B' || unit.tier === 'C') {
    // Tier-B/C cards carry the exam goal in their title question and may omit
    // recognition cues / core understanding per card; they must still carry
    // at least one educational payload field.
    if (payloadCount(unit) === 0) {
      errors.push({
        level: 'error',
        unitId: unit.id,
        code: 'orientation-missing-payload',
        message:
          'document_orientation unit must have at least one recognition cue, core-understanding point, or study target',
      });
    }
    return;
  }
  if (unit.recognitionCues.length === 0) {
    errors.push({
      level: 'error',
      unitId: unit.id,
      code: 'orientation-missing-cues',
      message: 'document_orientation unit must have at least one recognition cue',
    });
  }
  if (unit.coreUnderstanding.length === 0) {
    errors.push({
      level: 'error',
      unitId: unit.id,
      code: 'orientation-missing-core',
      message: 'document_orientation unit must have at least one core-understanding point',
    });
  }
};

const validateCoreConceptUnit = (unit: ExamCurriculumUnit, errors: ExamCurriculumValidationIssue[]): void => {
  const unitDepths = depths(unit);
  if (!unitDepths.has('understand')) {
    errors.push({
      level: 'error',
      unitId: unit.id,
      code: 'core-concept-missing-understand',
      message: 'core_concept unit must target learning depth "understand"',
    });
  }
  if (!unitDepths.has('recall') && !unitDepths.has('retrieve')) {
    errors.push({
      level: 'error',
      unitId: unit.id,
      code: 'core-concept-missing-recall-or-retrieve',
      message: 'core_concept unit must target at least one of "recall" or "retrieve"',
    });
  }
  if (unit.mustRecall.length === 0 && unit.mustLocate.length === 0) {
    errors.push({
      level: 'error',
      unitId: unit.id,
      code: 'core-concept-missing-targets',
      message: 'core_concept unit must define at least one mustRecall or mustLocate target',
    });
  }
};

const validateCrossDocumentNavigationUnit = (
  unit: ExamCurriculumUnit,
  errors: ExamCurriculumValidationIssue[],
): void => {
  const unitDepths = depths(unit);
  if (unit.tier !== 'NAV') {
    errors.push({
      level: 'error',
      unitId: unit.id,
      code: 'navigation-tier-mismatch',
      message: 'cross_document_navigation unit must have tier NAV',
    });
  }
  const distinctSourceDocuments = new Set(unit.sourceDocumentIds);
  if (distinctSourceDocuments.size !== unit.sourceDocumentIds.length) {
    errors.push({
      level: 'error',
      unitId: unit.id,
      code: 'navigation-duplicate-source-document',
      message: 'sourceDocumentIds must not repeat a document',
    });
  }
  if (distinctSourceDocuments.size < 2) {
    errors.push({
      level: 'error',
      unitId: unit.id,
      code: 'navigation-too-few-documents',
      message: 'cross_document_navigation unit must span at least 2 source documents',
    });
  }
  for (const required of ['recognize', 'understand', 'retrieve'] as const) {
    if (!unitDepths.has(required)) {
      errors.push({
        level: 'error',
        unitId: unit.id,
        code: 'navigation-missing-depth',
        message: `cross_document_navigation unit must target learning depth "${required}"`,
      });
    }
  }
  if (unit.examGoal.trim() === '') {
    errors.push({
      level: 'error',
      unitId: unit.id,
      code: 'navigation-missing-exam-goal',
      message: 'cross_document_navigation unit must have a non-empty examGoal',
    });
  }
  if (unit.recognitionCues.length === 0) {
    errors.push({
      level: 'error',
      unitId: unit.id,
      code: 'navigation-missing-cues',
      message: 'cross_document_navigation unit must have at least one recognition cue',
    });
  }
  if (unit.coreUnderstanding.length === 0) {
    errors.push({
      level: 'error',
      unitId: unit.id,
      code: 'navigation-missing-core',
      message: 'cross_document_navigation unit must have at least one core-understanding point',
    });
  }
  if (unit.relatedUnitIds.length < 2) {
    errors.push({
      level: 'error',
      unitId: unit.id,
      code: 'navigation-too-few-related',
      message: 'cross_document_navigation unit must reference at least 2 related units',
    });
  }
  if (!['high', 'medium', 'low'].includes(unit.reviewWeight)) {
    errors.push({
      level: 'error',
      unitId: unit.id,
      code: 'navigation-invalid-review-weight',
      message: `unknown review weight "${unit.reviewWeight}"`,
    });
  }
  if (unit.mustLocate.length < 3) {
    errors.push({
      level: 'error',
      unitId: unit.id,
      code: 'navigation-too-few-lookups',
      message: 'cross_document_navigation unit must define at least 3 mustLocate targets',
    });
  }
  const lookupDocuments = new Set(unit.mustLocate.map((lookup) => lookup.documentId));
  if (lookupDocuments.size < 2) {
    errors.push({
      level: 'error',
      unitId: unit.id,
      code: 'navigation-lookup-breadth',
      message: 'mustLocate targets must span at least 2 distinct documents',
    });
  }
  for (const lookup of unit.mustLocate) {
    if (lookup.sourceKey === undefined) {
      errors.push({
        level: 'error',
        unitId: unit.id,
        code: 'navigation-lookup-unpinned',
        message: `mustLocate "${lookup.prompt}" must resolve to an explicit sourceKey`,
      });
    }
  }
  if (unit.mustRecall.length > 0 && !unitDepths.has('recall')) {
    errors.push({
      level: 'error',
      unitId: unit.id,
      code: 'navigation-recall-depth-missing',
      message: 'a mustRecall entry requires learning depth "recall"',
    });
  }
  if (unit.mustRecall.length > 1) {
    errors.push({
      level: 'error',
      unitId: unit.id,
      code: 'navigation-recall-list',
      message: 'cross_document_navigation units carry at most one compact mustRecall rule',
    });
  }
};

const validateRecallRetrieveWarnings = (
  unit: ExamCurriculumUnit,
  warnings: ExamCurriculumValidationIssue[],
): void => {
  if (unit.mustRecall.length > WARNING_RECALL_ENTRY_LIMIT) {
    warnings.push({
      level: 'warning',
      unitId: unit.id,
      code: 'recall-list-suspiciously-large',
      message:
        `${unit.mustRecall.length} mustRecall entries — enumerated statutory lists belong in ` +
        'mustLocate for open-book study',
    });
  }
  for (const entry of unit.mustRecall) {
    if (entry.length > WARNING_RECALL_TEXT_LIMIT) {
      warnings.push({
        level: 'warning',
        unitId: unit.id,
        code: 'recall-entry-suspiciously-long',
        message: `mustRecall entry is ${entry.length} chars — likely a statute excerpt rather than a compact rule`,
      });
    }
  }
  const unitDepths = depths(unit);
  if (unitDepths.has('recall') && unit.mustRecall.length === 0 && unit.mustLocate.length > 0) {
    warnings.push({
      level: 'warning',
      unitId: unit.id,
      code: 'recall-target-only-in-mustlocate',
      message: 'unit targets "recall" depth but has no mustRecall entries (rule may be misplaced in mustLocate)',
    });
  }
  if (unit.sourceAnchors.length > (unit.unitType === 'cross_document_navigation' ? NAV_ANCHOR_BREADTH_LIMIT : WARNING_ANCHOR_BREADTH_LIMIT)) {
    warnings.push({
      level: 'warning',
      unitId: unit.id,
      code: 'excessive-source-breadth',
      message: `unit spans ${unit.sourceAnchors.length} source anchors — consider splitting or narrowing scope`,
    });
  }
};

export const validateExamCurriculumUnits = (
  units: ExamCurriculumUnit[],
  corpus: ExamCurriculumCorpusView,
): ExamCurriculumValidationReport => {
  const errors: ExamCurriculumValidationIssue[] = [];
  const warnings: ExamCurriculumValidationIssue[] = [];
  const documentIds = new Set(corpus.documents.map((d) => d.id));
  const componentsByDocument = new Map(corpus.documents.map((d) => [d.id, new Set(d.components.map((c) => c.sourceKey))]));
  const unitIds = new Set(units.map((u) => u.id));

  const seenUnitIds = new Set<string>();
  for (const unit of units) {
    if (seenUnitIds.has(unit.id)) {
      errors.push({
        level: 'error',
        unitId: unit.id,
        code: 'duplicate-unit-id',
        message: `unit id "${unit.id}" appears more than once`,
      });
    }
    seenUnitIds.add(unit.id);

    if (!known(EXAM_CURRICULUM_TIERS, unit.tier as ExamCurriculumTier)) {
      errors.push({ level: 'error', unitId: unit.id, code: 'unknown-tier', message: `unknown tier "${unit.tier}"` });
    }
    if (!known(EXAM_CURRICULUM_UNIT_TYPES, unit.unitType as ExamUnitType)) {
      errors.push({
        level: 'error',
        unitId: unit.id,
        code: 'unknown-unit-type',
        message: `unknown unit type "${unit.unitType}"`,
      });
    }
    if (unit.title.trim() === '') {
      errors.push({ level: 'error', unitId: unit.id, code: 'empty-title', message: 'title must not be empty' });
    }
    // Tier-B/C/D cards state their exam goal as the card title; an empty
    // examGoal is only an error where the tier requires a dedicated goal.
    if (unit.examGoal.trim() === '' && unit.tier !== 'B' && unit.tier !== 'C' && unit.tier !== 'D') {
      errors.push({ level: 'error', unitId: unit.id, code: 'empty-exam-goal', message: 'examGoal must not be empty' });
    }
    for (const depth of unit.learningDepths) {
      if (!known(EXAM_CURRICULUM_LEARNING_DEPTHS, depth as ExamLearningDepth)) {
        errors.push({
          level: 'error',
          unitId: unit.id,
          code: 'unknown-learning-depth',
          message: `unknown learning depth "${depth}"`,
        });
      }
    }

    for (const documentId of unit.sourceDocumentIds) {
      if (!documentIds.has(documentId)) {
        errors.push({
          level: 'error',
          unitId: unit.id,
          code: 'unknown-document',
          message: `sourceDocumentIds references unknown document "${documentId}"`,
        });
      }
    }

    const anchorKeys = new Set<string>();
    for (const anchor of unit.sourceAnchors) {
      const anchorKey = `${anchor.documentId}::${anchor.sourceKey}`;
      if (anchorKeys.has(anchorKey)) {
        errors.push({
          level: 'error',
          unitId: unit.id,
          code: 'duplicate-source-anchor',
          message: `duplicate source anchor ${anchorKey} within one unit`,
        });
        continue;
      }
      anchorKeys.add(anchorKey);
      if (!unit.sourceDocumentIds.includes(anchor.documentId)) {
        errors.push({
          level: 'error',
          unitId: unit.id,
          code: 'anchor-document-mismatch',
          message: `source anchor ${anchorKey} is not one of the unit's sourceDocumentIds`,
        });
        continue;
      }
      const keys = componentsByDocument.get(anchor.documentId);
      if (!keys) continue; // unknown-document error already reported
      if (!keys.has(anchor.sourceKey)) {
        errors.push({
          level: 'error',
          unitId: unit.id,
          code: 'unknown-source-key',
          message: `sourceKey "${anchor.sourceKey}" does not exist in document "${anchor.documentId}"`,
        });
      }
    }

    const seenRelated = new Set<string>();
    for (const relatedId of unit.relatedUnitIds) {
      if (seenRelated.has(relatedId)) {
        errors.push({
          level: 'error',
          unitId: unit.id,
          code: 'duplicate-related-unit-id',
          message: `relatedUnitIds contains duplicate "${relatedId}"`,
        });
      }
      seenRelated.add(relatedId);
      if (!unitIds.has(relatedId)) {
        errors.push({
          level: 'error',
          unitId: unit.id,
          code: 'broken-related-unit-id',
          message: `relatedUnitIds references nonexistent unit "${relatedId}"`,
        });
      }
    }

    for (const lookup of unit.mustLocate) {
      if (lookup.prompt.trim() === '') {
        errors.push({
          level: 'error',
          unitId: unit.id,
          code: 'empty-lookup-prompt',
          message: 'mustLocate entry with empty prompt',
        });
      }
      if (!unit.sourceDocumentIds.includes(lookup.documentId)) {
        errors.push({
          level: 'error',
          unitId: unit.id,
          code: 'lookup-document-mismatch',
          message: `mustLocate document "${lookup.documentId}" is not one of the unit's sourceDocumentIds`,
        });
      } else if (lookup.sourceKey !== undefined) {
        const keys = componentsByDocument.get(lookup.documentId);
        if (keys && !keys.has(lookup.sourceKey)) {
          errors.push({
            level: 'error',
            unitId: unit.id,
            code: 'unknown-lookup-source-key',
            message: `mustLocate sourceKey "${lookup.sourceKey}" not found in "${lookup.documentId}"`,
          });
        }
      }
    }

    if (unit.unitType === 'document_orientation') validateOrientationUnit(unit, errors);
    if (unit.unitType === 'core_concept') validateCoreConceptUnit(unit, errors);
    if (unit.unitType === 'cross_document_navigation') validateCrossDocumentNavigationUnit(unit, errors);

    validateRecallRetrieveWarnings(unit, warnings);
  }

  return { errors, warnings };
};
