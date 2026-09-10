import type { ImportedLegalComponent } from '../studyTypes';
import type {
  AiMapFocusSelection,
  AiMapRevisionSuggestion,
  AiStudyUnitProposal,
  AiValidationIssue,
} from './studyAiTypes';
import { normalizeAiValidationText } from './studyAiUnitFidelity';

/**
 * Unit Authoring v5 map-revision contract (see study-content/ai/specs/unit-authoring-v5.md).
 * All v5 revision-contract checks live here so studyAiValidation.ts stays small.
 * The module never imports from studyAiValidation.ts (no cycles): issue shape and the
 * normalize helper are mirrored from there, and source text comes in through the
 * `sourceComponents` parameter used by the v4 retroactive-concept check.
 */

export const UNIT_REVISION_CONTRACT_CODES: readonly string[] = [
  'GENERATED_UNIT_HAS_BROAD_GROUP_WARNING',
  'GENERATED_UNIT_HAS_REVISION_SUGGESTION',
  'MAP_REVISION_STATUS_REQUIRES_BROAD_WARNING',
  'MAP_REVISION_RATIONALE_CONTRADICTORY',
  'MAP_REVISION_OUTSIDE_APPROVED_FOCUS',
];

export const CONTRADICTORY_REVISION_PHRASES: readonly string[] = [
  'no revision needed',
  'no further revision is required',
  'no structural change required',
  'appropriately scoped as a single unit',
  'current grouping is appropriate',
];

const normalizeText = normalizeAiValidationText;
const RETROACTIVE_PATTERN = /\bretroactive\b|\bretroactivity\b/;

type RevisionGroup = AiMapRevisionSuggestion['proposedGroups'][number];

const addIssue = (
  issues: AiValidationIssue[],
  issue: Omit<AiValidationIssue, 'severity'> & { severity?: AiValidationIssue['severity'] },
): void => {
  issues.push({ severity: issue.severity ?? 'error', ...issue });
};

const nonEmptyString = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0;

const stringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((entry) => typeof entry === 'string');

export const validateUnitRevisionContractV5 = (
  proposal: AiStudyUnitProposal,
  issues: AiValidationIssue[],
  sourceComponents: ImportedLegalComponent[],
): void => {
  if (proposal.authoringStatus === 'generated') {
    checkGeneratedUnit(proposal, issues);
    return;
  }
  if (proposal.authoringStatus === 'needs-map-revision') {
    checkNeedsRevisionTriplet(proposal, sourceComponents, issues);
  }
};

const checkGeneratedUnit = (proposal: AiStudyUnitProposal, issues: AiValidationIssue[]): void => {
  if (proposal.warnings?.includes('MAP_GROUP_TOO_BROAD_FOR_GOOD_UNIT')) {
    addIssue(issues, {
      code: 'GENERATED_UNIT_HAS_BROAD_GROUP_WARNING',
      proposalId: proposal.proposalId,
      message: 'A generated unit must not carry MAP_GROUP_TOO_BROAD_FOR_GOOD_UNIT.',
    });
  }
  if (proposal.mapRevisionSuggestion != null) {
    addIssue(issues, {
      code: 'GENERATED_UNIT_HAS_REVISION_SUGGESTION',
      proposalId: proposal.proposalId,
      message: 'A generated unit must not include mapRevisionSuggestion.',
    });
  }
};

const checkNeedsRevisionTriplet = (
  proposal: AiStudyUnitProposal,
  sourceComponents: ImportedLegalComponent[],
  issues: AiValidationIssue[],
): void => {
  if (!proposal.warnings?.includes('MAP_GROUP_TOO_BROAD_FOR_GOOD_UNIT')) {
    addIssue(issues, {
      code: 'MAP_REVISION_STATUS_REQUIRES_BROAD_WARNING',
      proposalId: proposal.proposalId,
      message: 'needs-map-revision requires the MAP_GROUP_TOO_BROAD_FOR_GOOD_UNIT warning.',
    });
  }
  const suggestion = proposal.mapRevisionSuggestion ?? null;
  if (
    !suggestion ||
    !nonEmptyString(suggestion.reason) ||
    !Array.isArray(suggestion.proposedGroups) ||
    suggestion.proposedGroups.length < 2
  ) {
    addIssue(issues, {
      code: 'MAP_REVISION_SUGGESTION_REQUIRED',
      proposalId: proposal.proposalId,
      message:
        'needs-map-revision requires a mapRevisionSuggestion with a reason and at least two finer proposed groups.',
    });
    return;
  }
  const emittedFocusKeys = new Set<string>();
  suggestion.proposedGroups.forEach((group) => {
    checkSuggestedGroup(group, proposal, sourceComponents, issues, emittedFocusKeys);
  });
  checkContradictoryReason(suggestion.reason, proposal, issues);
};

const checkSuggestedGroup = (
  group: RevisionGroup,
  proposal: AiStudyUnitProposal,
  sourceComponents: ImportedLegalComponent[],
  issues: AiValidationIssue[],
  emittedFocusKeys: Set<string>,
): void => {
  if (
    !nonEmptyString(group.title) ||
    !stringArray(group.sourceKeys) ||
    group.sourceKeys.length === 0 ||
    !Array.isArray(group.focusSelections) ||
    !nonEmptyString(group.approximateLearningGoal)
  ) {
    addIssue(issues, {
      code: 'MAP_REVISION_GROUP_INVALID',
      proposalId: proposal.proposalId,
      message:
        'Each mapRevisionSuggestion group requires title, sourceKeys, focusSelections, and approximateLearningGoal.',
    });
    return;
  }
  if (group.sourceKeys.some((sourceKey) => !proposal.sourceKeys.includes(sourceKey))) {
    addIssue(issues, {
      code: 'MAP_REVISION_OUTSIDE_SOURCE',
      proposalId: proposal.proposalId,
      message: 'mapRevisionSuggestion groups must stay inside the original approved sourceKeys.',
    });
  }
  checkRetroactiveConcept(group, proposal, sourceComponents, issues);
  checkSuggestedGroupAgainstFocus(group, proposal, issues, emittedFocusKeys);
};

const checkRetroactiveConcept = (
  group: RevisionGroup,
  proposal: AiStudyUnitProposal,
  sourceComponents: ImportedLegalComponent[],
  issues: AiValidationIssue[],
): void => {
  const groupText = normalizeText(`${group.title} ${group.approximateLearningGoal}`);
  const approvedText = normalizeText(
    group.sourceKeys
      .map(
        (sourceKey) =>
          sourceComponents.find((component) => component.sourceKey === sourceKey)?.text ?? '',
      )
      .join('\n\n'),
  );
  if (RETROACTIVE_PATTERN.test(groupText) && !RETROACTIVE_PATTERN.test(approvedText)) {
    addIssue(issues, {
      code: 'MAP_REVISION_UNSUPPORTED_CONCEPT',
      proposalId: proposal.proposalId,
      message: 'mapRevisionSuggestion introduces an unsupported retroactive-effect concept.',
    });
  }
};

const checkSuggestedGroupAgainstFocus = (
  group: RevisionGroup,
  proposal: AiStudyUnitProposal,
  issues: AiValidationIssue[],
  emittedFocusKeys: Set<string>,
): void => {
  const approvedGroup = proposal.approvedGroup;
  if (!approvedGroup || !Array.isArray(group.focusSelections)) return;
  const approved = Array.isArray(approvedGroup.focusSelections)
    ? approvedGroup.focusSelections
    : [];
  const approvedSourceKeys = approvedGroup.sourceKeys ?? [];
  group.focusSelections.forEach((selection) => {
    const violation = focusViolationMessage(selection, approvedSourceKeys, approved);
    if (!violation || emittedFocusKeys.has(selection.sourceKey)) return;
    emittedFocusKeys.add(selection.sourceKey);
    addIssue(issues, {
      code: 'MAP_REVISION_OUTSIDE_APPROVED_FOCUS',
      proposalId: proposal.proposalId,
      sourceKey: selection.sourceKey,
      message: violation,
    });
  });
};

const focusViolationMessage = (
  selection: AiMapFocusSelection,
  approvedSourceKeys: string[],
  approved: AiMapFocusSelection[],
): string | undefined => {
  if (!approvedSourceKeys.includes(selection.sourceKey)) {
    return `mapRevisionSuggestion selection ${selection.sourceKey} is outside the approved group.`;
  }
  const app = approved.find((entry) => entry.sourceKey === selection.sourceKey);
  if (!app) {
    return `mapRevisionSuggestion sourceKey ${selection.sourceKey} is not an approved focus selection.`;
  }
  if (app.childLabels !== undefined) {
    const proposedLabels = selection.childLabels ?? [];
    const unknownLabel = proposedLabels.find((label) => !app.childLabels?.includes(label));
    if (unknownLabel !== undefined) {
      return `mapRevisionSuggestion childLabel ${unknownLabel} is not in the approved focus selection for ${selection.sourceKey}.`;
    }
    if (proposedLabels.length === 0) {
      return `mapRevisionSuggestion widens ${selection.sourceKey} beyond the approved childLabels.`;
    }
  }
  if (app.definedTerms !== undefined) {
    const proposedTerms = selection.definedTerms ?? [];
    const unknownTerm = proposedTerms.find((term) => !app.definedTerms?.includes(term));
    if (unknownTerm !== undefined) {
      return `mapRevisionSuggestion definedTerm ${unknownTerm} is not in the approved focus selection for ${selection.sourceKey}.`;
    }
    if (proposedTerms.length === 0 && app.childLabels === undefined) {
      return `mapRevisionSuggestion widens ${selection.sourceKey} beyond the approved definedTerms.`;
    }
  }
  return undefined;
};

const checkContradictoryReason = (
  reason: string,
  proposal: AiStudyUnitProposal,
  issues: AiValidationIssue[],
): void => {
  const normalizedReason = normalizeText(reason);
  const phrase = CONTRADICTORY_REVISION_PHRASES.find((candidate) =>
    normalizedReason.includes(normalizeText(candidate)),
  );
  if (phrase === undefined) return;
  addIssue(issues, {
    code: 'MAP_REVISION_RATIONALE_CONTRADICTORY',
    proposalId: proposal.proposalId,
    message: `mapRevisionSuggestion reason contradicts needs-map-revision: "${phrase}".`,
  });
};
