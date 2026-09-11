/**
 * Deterministic audit of the two canonical-revalidation coverage warnings
 * (V4 coverage-warning audit): APPROVED_FOCUS_NOT_COVERED and
 * UNCOVERED_SUBSTANTIVE_SOURCE.
 *
 * The checkers being mirrored live in `studyAiValidation.ts`
 * (`validateCoverage` and `validateApprovedFocusCoverage`). This module does
 * NOT import that file (it is edited by another worker; treat as read-only);
 * the predicates are re-derived here exactly, matching the validator line for
 * line — including the "covered" prefix matching on
 * `${sourceKey}::${label}::${objectiveId}` keys and the quirk that a
 * `covered` child with `objectiveIds: undefined` still counts as covered
 * while `objectiveIds: []` (empty array) does not.
 *
 * Pure + deterministic: same proposal + same components => same instances,
 * classifications and assessments. No IO, no provider, no wall clock.
 */
import type { ImportedLegalComponent } from '../studyTypes';
import type {
  AiLearningObjective,
  AiMapFocusSelection,
  AiProposedSourceGroup,
  AiSourceCoverage,
  AiStudyUnitProposal,
} from './studyAiTypes';
import { normalizeAiValidationText } from './studyAiUnitFidelity';

export type CoverageWarningCode =
  | 'APPROVED_FOCUS_NOT_COVERED'
  | 'UNCOVERED_SUBSTANTIVE_SOURCE';

export type CoverageWarningCategory = 'child-label' | 'defined-term';

export type CoverageClassification = 'A' | 'B' | 'C';

export const COVERAGE_WARNING_CODES: CoverageWarningCode[] = [
  'APPROVED_FOCUS_NOT_COVERED',
  'UNCOVERED_SUBSTANTIVE_SOURCE',
];

export const UNCOVERED_SUBSTANTIVE_SOURCE: CoverageWarningCode =
  'UNCOVERED_SUBSTANTIVE_SOURCE';

export const APPROVED_FOCUS_NOT_COVERED: CoverageWarningCode =
  'APPROVED_FOCUS_NOT_COVERED';

/** A sourceCoverage childLabels element (the optional-array accessor is hard to index directly). */
export type CoverageChildEntry = NonNullable<AiSourceCoverage['childLabels']>[number];

/**
 * A single warning instance as emitted by the mirrored checkers:
 * `(sourceKey, label)` identity with the presentation flags needed by the
 * A/B/C classifier.
 */
export type CoverageWarningInstance = {
  code: CoverageWarningCode;
  sourceKey: string;
  category: CoverageWarningCategory;
  /** Subsection label (child-label) or the raw defined term (defined-term). */
  label: string;
  /**
   * True when the label is one of that sourceKey's approved focus-selection
   * childLabels; false for instances the validator emitted in the
   * no-focus-selection all-subsection scope (APPROVED instances are true by
   * construction).
   */
  approved: boolean;
};

export type CoverageTwinRef = {
  /** The other coverage-warning code (never fires for the same identity). */
  code: CoverageWarningCode;
  /** Whether an instance with the same (sourceKey, label) exists for it. */
  present: boolean;
};

export type ClassifiedCoverageInstance = CoverageWarningInstance & {
  classification: CoverageClassification;
  classificationBasis: string;
  twin: CoverageTwinRef;
};

export type CoverageSourceCoverageEntry = {
  label: string;
  status: CoverageChildEntry['status'];
  objectiveIds?: string[];
  reason?: string;
};

export type CoverageSubstantiveAssessment = {
  /**
   * Deterministic evidence rule applied (see each rule's comment in
   * `assessSubstantiveCoverage`).
   */
  method: 'evidence-containment' | 'term-containment' | 'coverage-declared' | 'none';
  coverageStatus: CoverageChildEntry['status'] | null;
  coverageReason: string | null;
  /** Objective ids the coverage child entry declares (if any). */
  declaredObjectiveIds: string[];
  /**
   * Objective ids that substantively teach the label/term under the method
   * rule (equals `declaredObjectiveIds` on the coverage-declared fallback).
   */
  teachingObjectiveIds: string[];
  note: string;
};

/** One fully-audited warning instance row (all report fields, no jobId). */
export type CoverageAuditInstanceRow = ClassifiedCoverageInstance & {
  approvedGroup: {
    sourceKeys: string[];
    focusSelections: Array<{ sourceKey: string; childLabels: string[]; definedTerms: string[] }>;
  };
  selectedFocusItems: { childLabels: string[]; definedTerms: string[] };
  sourceCoverageEntry: CoverageSourceCoverageEntry | null;
  objectiveIds: string[];
  substantiveAssessment: CoverageSubstantiveAssessment;
};

const normalizeText = normalizeAiValidationText;

const coverageByKeyOf = (proposal: AiStudyUnitProposal): Map<string, AiSourceCoverage> =>
  new Map((proposal.sourceCoverage ?? []).map((entry) => [entry.sourceKey, entry]));

/**
 * Map over the approved-group focus selections in the same last-wins fashion
 * the validator builds it (`new Map(array.map(...))`), so duplicate selection
 * sourceKeys collapse identically to the checker.
 */
const approvedLabelsBySourceOf = (
  proposal: AiStudyUnitProposal,
): Map<string, Set<string>> => {
  const bySource = new Map<string, Set<string>>();
  for (const selection of proposal.approvedGroup?.focusSelections ?? []) {
    bySource.set(selection.sourceKey, new Set(selection.childLabels ?? []));
  }
  return bySource;
};

/**
 * Mirror of the APPROVED_FOCUS_NOT_COVERED covered/omitted key sets.
 *
 * A `covered` child contributes `${sk}::${label}::${id}` per declared
 * objectiveId; when `objectiveIds` is undefined the validator falls back to
 * the bare `${sk}::${label}` key (i.e. `covered` with NO objectiveIds field
 * counts as covered) but when it is an EMPTY array it contributes nothing
 * (so `covered` with `objectiveIds: []` still warns). `intentionally-omitted`
 * counts only with a nonblank reason.
 */
const coverageKeySetsOf = (proposal: AiStudyUnitProposal): { covered: Set<string>; omitted: Set<string> } => {
  const covered = new Set<string>();
  const omitted = new Set<string>();
  for (const entry of proposal.sourceCoverage ?? []) {
    for (const child of entry.childLabels ?? []) {
      if (child.status === 'covered') {
        if (child.objectiveIds === undefined) {
          covered.add(`${entry.sourceKey}::${child.label}`);
        } else {
          for (const id of child.objectiveIds) covered.add(`${entry.sourceKey}::${child.label}::${id}`);
        }
      }
      if (child.status === 'intentionally-omitted' && child.reason?.trim()) {
        omitted.add(`${entry.sourceKey}::${child.label}`);
      }
    }
  }
  return { covered, omitted };
};

/** Normalized text the validator scans for defined-term coverage. */
const objectiveSearchText = (objective: AiLearningObjective): string =>
  `${objective.objective} ${objective.guidedQuestion} ${objective.studyAnswer}`;

const objectiveTeachesTerm = (objective: AiLearningObjective, term: string): boolean =>
  normalizeText(objectiveSearchText(objective)).includes(normalizeText(term));

/* ------------------------------------------------------------------ *
 * Predicate mirrors (exact re-derivation of the two checkers)        *
 * ------------------------------------------------------------------ */

/** Mirrors `validateCoverage`: an UNCOVERED instance fires per in-scope subsection with no coverage child entry. */
export const uncoveredPredicateFires = (
  proposal: AiStudyUnitProposal,
  components: ImportedLegalComponent[],
  sourceKey: string,
  label: string,
): boolean => {
  const component = components.find((entry) => entry.sourceKey === sourceKey);
  if (!component) return false;
  const approvedLabels = approvedLabelsBySourceOf(proposal).get(sourceKey);
  const inScope = !approvedLabels || approvedLabels.has(label);
  if (!inScope) return false;
  const presentAsSubsection = (component.subsections ?? []).some((subsection) => subsection.label === label);
  if (!presentAsSubsection) return false;
  const child = coverageByKeyOf(proposal).get(sourceKey)?.childLabels?.find(
    (item) => item.label === label,
  );
  return child === undefined;
};

/** Mirrors `validateApprovedFocusCoverage` child-label branch. */
export const approvedFocusPredicateFires = (
  proposal: AiStudyUnitProposal,
  sourceKey: string,
  label: string,
): boolean => {
  if (!proposal.approvedGroup) return false;
  const { covered, omitted } = coverageKeySetsOf(proposal);
  const prefix = `${sourceKey}::${label}`;
  const coveredHit = Array.from(covered).some((entry) => entry.startsWith(prefix));
  return !coveredHit && !omitted.has(prefix);
};

/** Mirrors `validateApprovedFocusCoverage` defined-term branch. */
export const approvedTermPredicateFires = (
  proposal: AiStudyUnitProposal,
  term: string,
): boolean =>
  !(proposal.objectives ?? []).some((objective) => objectiveTeachesTerm(objective, term));

/** True when the mirrored raw checker that produced `instance` still fires for it. */
export const predicateFiresFor = (
  proposal: AiStudyUnitProposal,
  instance: CoverageWarningInstance,
  components: ImportedLegalComponent[],
): boolean =>
  instance.code === UNCOVERED_SUBSTANTIVE_SOURCE
    ? uncoveredPredicateFires(proposal, components, instance.sourceKey, instance.label)
    : instance.category === 'defined-term'
      ? approvedTermPredicateFires(proposal, instance.label)
      : approvedFocusPredicateFires(proposal, instance.sourceKey, instance.label);

/* ------------------------------------------------------------------ *
 * Instance collection                                               *
 * ------------------------------------------------------------------ */

/**
 * Recompute BOTH checkers for one proposal over its grounding components and
 * return every warning instance they emit (order: components then
 * focusSelections, child-labels then defined-terms — the validator's order).
 */
export const collectCoverageInstances = (
  proposal: AiStudyUnitProposal,
  components: ImportedLegalComponent[],
): CoverageWarningInstance[] => {
  const instances: CoverageWarningInstance[] = [];
  const coverageByKey = coverageByKeyOf(proposal);
  const approvedLabelsBySource = approvedLabelsBySourceOf(proposal);

  // UNCOVERED_SUBSTANTIVE_SOURCE (mirror of validateCoverage): per component,
  // in-scope subsection labels missing a coverage child entry.
  components.forEach((component) => {
    const approvedLabels = approvedLabelsBySource.get(component.sourceKey);
    const labels =
      (component.subsections ?? [])
        .map((subsection) => subsection.label)
        .filter((label) => !approvedLabels || approvedLabels.has(label)) ?? [];
    if (labels.length === 0) return;
    const entry = coverageByKey.get(component.sourceKey);
    labels.forEach((label) => {
      const child = entry?.childLabels?.find((item) => item.label === label);
      if (child) return;
      instances.push({
        code: UNCOVERED_SUBSTANTIVE_SOURCE,
        sourceKey: component.sourceKey,
        category: 'child-label',
        label,
        approved: Boolean(approvedLabels?.has(label)),
      });
    });
  });

  if (!proposal.approvedGroup) return instances;

  // APPROVED_FOCUS_NOT_COVERED (mirror of validateApprovedFocusCoverage).
  const { covered, omitted } = coverageKeySetsOf(proposal);
  proposal.approvedGroup.focusSelections.forEach((selection) => {
    (selection.childLabels ?? []).forEach((label) => {
      const prefix = `${selection.sourceKey}::${label}`;
      const coveredHit = Array.from(covered).some((entry) => entry.startsWith(prefix));
      if (coveredHit || omitted.has(prefix)) return;
      instances.push({
        code: APPROVED_FOCUS_NOT_COVERED,
        sourceKey: selection.sourceKey,
        category: 'child-label',
        label,
        approved: true,
      });
    });
    (selection.definedTerms ?? []).forEach((term) => {
      if ((proposal.objectives ?? []).some((objective) => objectiveTeachesTerm(objective, term))) return;
      instances.push({
        code: APPROVED_FOCUS_NOT_COVERED,
        sourceKey: selection.sourceKey,
        category: 'defined-term',
        label: term,
        approved: true,
      });
    });
  });

  return instances;
};

/* ------------------------------------------------------------------ *
 * Classification (A / B / C)                                        *
 * ------------------------------------------------------------------ */

const focusSelectionOf = (
  proposal: AiStudyUnitProposal,
  sourceKey: string,
): AiMapFocusSelection | undefined =>
  proposal.approvedGroup?.focusSelections.find((selection) => selection.sourceKey === sourceKey);

const coverageChildEntryOf = (
  proposal: AiStudyUnitProposal,
  sourceKey: string,
  label: string,
): CoverageSourceCoverageEntry | null => {
  const entry = (proposal.sourceCoverage ?? []).find((item) => item.sourceKey === sourceKey);
  const child = entry?.childLabels?.find((item) => item.label === label);
  return child
    ? {
        label: child.label,
        status: child.status,
        ...(child.objectiveIds !== undefined ? { objectiveIds: child.objectiveIds } : {}),
        ...(child.reason !== undefined ? { reason: child.reason } : {}),
      }
    : null;
};

/** Human-readable reason why an approved child-label has no UNCOVERED twin. */
const approvedNoTwinBasis = (
  proposal: AiStudyUnitProposal,
  instance: CoverageWarningInstance,
): string => {
  const child = coverageChildEntryOf(proposal, instance.sourceKey, instance.label);
  if (!child) {
    return (
      `no coverage child entry exists for the approved childLabel and it is not among the ` +
      `source's in-scope subsections, so only the approved-focus checker can flag it`
    );
  }
  if (child.status === 'covered') {
    return (
      `coverage entry exists but is defective: status "covered" with an empty objectiveIds ` +
      `array contributes no covered key (an undefined objectiveIds would count as covered)`
    );
  }
  if (child.status === 'intentionally-omitted') {
    return `coverage entry exists but is defective: status "intentionally-omitted" without a nonblank reason`;
  }
  return `coverage entry exists but is defective: status "${child.status}" contributes no covered or intentionally-omitted-with-reason entry`;
};

const classificationBasisFor = (
  proposal: AiStudyUnitProposal,
  instance: CoverageWarningInstance,
  twin: CoverageTwinRef,
): { classification: CoverageClassification; basis: string } => {
  if (instance.code === APPROVED_FOCUS_NOT_COVERED) {
    if (instance.category === 'defined-term') {
      return {
        classification: 'A',
        basis:
          `defined term "${instance.label}" is not taught: no objective objective/guidedQuestion/` +
          `studyAnswer text contains the normalized term (no coverage child entry applies to terms)`,
      };
    }
    if (twin.present) {
      return {
        classification: 'C',
        basis:
          `duplicate presentation of the same omission: an ${UNCOVERED_SUBSTANTIVE_SOURCE} instance ` +
          `exists for the same (${instance.sourceKey}, ${instance.label})`,
      };
    }
    return { classification: 'A', basis: approvedNoTwinBasis(proposal, instance) };
  }
  // UNCOVERED_SUBSTANTIVE_SOURCE.
  if (twin.present) {
    return {
      classification: 'A',
      basis:
        `primary diagnostic: the approved childLabel has no coverage child entry, which the ` +
        `approved-focus checker also presents (${APPROVED_FOCUS_NOT_COVERED} twin)`,
    };
  }
  return {
    classification: 'A',
    basis:
      `uncovered subsection label with no ${APPROVED_FOCUS_NOT_COVERED} twin (non-approved scope, ` +
      `no approved focus selection for the sourceKey, or an approved label already satisfied by a ` +
      `sibling prefix-covered coverage key)`, 
  };
};

/**
 * Classify every instance of one proposal under the deterministic A/B/C rules
 * (see module doc): defined-term => A; approved child-label with an
 * UNCOVERED twin => C (duplicate presentation); approved child-label without
 * a twin => A (defective/absent coverage entry); every UNCOVERED instance =>
 * A. A final B override recomputes the raw checker predicate: if the
 * predicate no longer fires for the instance identity the classification
 * becomes B ('predicate recompute: no warning expected') — nonzero B means the
 * audit is surfacing a real validator inconsistency.
 */
export const classifyInstances = (
  proposal: AiStudyUnitProposal,
  instances: CoverageWarningInstance[],
  components: ImportedLegalComponent[],
): ClassifiedCoverageInstance[] => {
  const uncovered = new Set<string>();
  const approvedLabels = new Set<string>();
  const approvedTerms = new Set<string>();
  for (const instance of instances) {
    const key = `${instance.sourceKey}\u0000${instance.label}`;
    if (instance.code === UNCOVERED_SUBSTANTIVE_SOURCE) uncovered.add(key);
    else if (instance.category === 'defined-term') approvedTerms.add(key);
    else approvedLabels.add(key);
  }
  return instances.map((instance) => {
    const twin: CoverageTwinRef =
      instance.code === APPROVED_FOCUS_NOT_COVERED
        ? { code: UNCOVERED_SUBSTANTIVE_SOURCE, present: uncovered.has(`${instance.sourceKey}\u0000${instance.label}`) }
        : {
            code: APPROVED_FOCUS_NOT_COVERED,
            present: instance.category === 'child-label'
              ? approvedLabels.has(`${instance.sourceKey}\u0000${instance.label}`)
              : approvedTerms.has(`${instance.sourceKey}\u0000${instance.label}`),
          };
    const { classification, basis } = classificationBasisFor(proposal, instance, twin);
    // B override: a raw-predicate mismatch means the stored/collected instance
    // should never have fired. Expected 0 across the audit universe.
    if (!predicateFiresFor(proposal, instance, components)) {
      return {
        ...instance,
        twin,
        classification: 'B' as const,
        classificationBasis: 'predicate recompute: no warning expected',
      };
    }
    return { ...instance, twin, classification, classificationBasis: basis };
  });
};

/* ------------------------------------------------------------------ *
 * Substantive coverage assessment                                   *
 * ------------------------------------------------------------------ */

/**
 * Deterministic substantive-coverage assessment for one instance.
 *
 * child-label instances: an objective "teaches" the label when it references
 * the sourceKey AND one of its evidence entries for that sourceKey (the
 * excerpt text grounding the objective) contains the label's subsection text.
 * Subsection text is taken from the grounding component; because whole
 * subsections can exceed the excerpt scale the containment probe only runs
 * when the raw subsection text is short enough (<= 400 chars). Otherwise —
 * and for any label that is not a subsection — the teaching ids fall back to
 * the objective ids the matching coverage child entry declares (method
 * 'coverage-declared'; 'none' when there is no entry either).
 *
 * defined-term instances: teaching ids are the objectives whose normalized
 * objective/guidedQuestion/studyAnswer contains the normalized term.
 */
export const assessSubstantiveCoverage = (
  proposal: AiStudyUnitProposal,
  instance: CoverageWarningInstance,
  components: ImportedLegalComponent[],
): CoverageSubstantiveAssessment => {
  const sourceKey = instance.sourceKey;
  const label = instance.label;
  if (instance.category === 'defined-term') {
    const teachingObjectiveIds = (proposal.objectives ?? [])
      .filter((objective) => objectiveTeachesTerm(objective, label))
      .map((objective) => objective.id);
    return {
      method: 'term-containment',
      coverageStatus: null,
      coverageReason: null,
      declaredObjectiveIds: [],
      teachingObjectiveIds,
      note: `normalized objective/guidedQuestion/studyAnswer text contains the normalized defined term`,
    };
  }
  const declared = coverageChildEntryOf(proposal, sourceKey, label);
  const declaredObjectiveIds = declared?.objectiveIds ?? [];
  const component = components.find((entry) => entry.sourceKey === sourceKey);
  const subsection = component?.subsections?.find((entry) => entry.label === label);
  if (!subsection) {
    return {
      method: 'none',
      coverageStatus: declared?.status ?? null,
      coverageReason: declared?.reason ?? null,
      declaredObjectiveIds,
      teachingObjectiveIds: [],
      note: `label is not a subsection of the source component; no evidence-containment probe possible`,
    };
  }
  if (subsection.text.length > 400) {
    return {
      method: 'coverage-declared',
      coverageStatus: declared?.status ?? null,
      coverageReason: declared?.reason ?? null,
      declaredObjectiveIds,
      teachingObjectiveIds: declaredObjectiveIds,
      note: `subsection text length ${subsection.text.length} > 400; teaching ids fall back to the declared coverage objectiveIds`,
    };
  }
  const subsectionText = normalizeText(subsection.text);
  if (subsectionText.length === 0) {
    return {
      method: 'coverage-declared',
      coverageStatus: declared?.status ?? null,
      coverageReason: declared?.reason ?? null,
      declaredObjectiveIds,
      teachingObjectiveIds: declaredObjectiveIds,
      note: `subsection text normalizes to empty; teaching ids fall back to the declared coverage objectiveIds`,
    };
  }
  const teachingObjectiveIds = (proposal.objectives ?? [])
    .filter(
      (objective) =>
        objective.sourceKeys.includes(sourceKey) &&
        objective.evidence.some(
          (evidence) =>
            evidence.sourceKey === sourceKey &&
            normalizeText(evidence.evidenceText).includes(subsectionText),
        ),
    )
    .map((objective) => objective.id);
  return {
    method: 'evidence-containment',
    coverageStatus: declared?.status ?? null,
    coverageReason: declared?.reason ?? null,
    declaredObjectiveIds,
    teachingObjectiveIds,
    note: `evidence/excerpt text of objectives referencing ${sourceKey} contains the normalized subsection text (<= 400 chars)`,
  };
};

/* ------------------------------------------------------------------ *
 * Row assembly                                                      *
 * ------------------------------------------------------------------ */

const trimmedFocusSelections = (
  group: AiProposedSourceGroup,
): Array<{ sourceKey: string; childLabels: string[]; definedTerms: string[] }> =>
  group.focusSelections.map((selection) => ({
    sourceKey: selection.sourceKey,
    childLabels: selection.childLabels ?? [],
    definedTerms: selection.definedTerms ?? [],
  }));

/**
 * Full audit rows for one proposal: collect -> classify -> assess, with the
 * presentation context (approved group, selected focus items, matching
 * coverage child entry) attached per instance. Deterministic.
 */
export const buildCoverageInstanceRows = (
  proposal: AiStudyUnitProposal,
  components: ImportedLegalComponent[],
): CoverageAuditInstanceRow[] => {
  const instances = collectCoverageInstances(proposal, components);
  const classified = classifyInstances(proposal, instances, components);
  const group = proposal.approvedGroup;
  return classified.map((instance) => {
    const selection = focusSelectionOf(proposal, instance.sourceKey);
    const assessment = assessSubstantiveCoverage(proposal, instance, components);
    return {
      ...instance,
      approvedGroup: {
        sourceKeys: group ? [...group.sourceKeys] : [],
        focusSelections: group ? trimmedFocusSelections(group) : [],
      },
      selectedFocusItems: {
        childLabels: selection?.childLabels ?? [],
        definedTerms: selection?.definedTerms ?? [],
      },
      sourceCoverageEntry: coverageChildEntryOf(proposal, instance.sourceKey, instance.label),
      objectiveIds: assessment.teachingObjectiveIds,
      substantiveAssessment: assessment,
    };
  });
};
