import type { ImportedLegalComponent } from '../studyTypes';
import type { AiLearningObjective, AiProposedSourceGroup, AiStudyUnitProposal } from './studyAiTypes';

export const normalizeAiValidationText = (value: string): string =>
  value.replace(/\s+/g, ' ').replace(/[“”]/g, '"').replace(/[‘’]/g, "'").trim().toLowerCase();

const referenceAtom = String.raw`(?:\d+(?:\.\d+)?|\(\d+(?:\.\d+)?\))(?:\([^)]+\))*`;
const legalReferenceLeadPattern = new RegExp(
  String.raw`\b(sections?|subsections?|paragraphs?)\s+((?:${referenceAtom})(?:\s*(?:,|and|or)\s*(?:${referenceAtom}))*)`,
  'gi',
);
const bareSubsectionPattern = /\b\d+(?:\.\d+)?\([^)]+\)(?:\([^)]+\))*/g;
export const quantityPattern =
  /\$\s*\b\d+(?:\.\d+)?\b|\b\d+(?:\.\d+)?\s*(?:days?|months?|years?|per cent|percent|%)\b|\b(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirty|sixty)\s+(?:days?|months?|years?)\b/gi;

export const sourceSectionFromKey = (sourceKey: string): string | undefined =>
  /^section:(\d+(?:\.\d+)?)/i.exec(sourceKey)?.[1];

const trimReferenceTail = (value: string): string =>
  value
    .replace(/\b(?:for|when|where|if|unless|except|subject|despite|notwithstanding)\b.*$/i, '')
    .trim();

const splitReferenceParts = (body: string): string[] =>
  trimReferenceTail(body)
    .replace(/\s*,?\s+(?:and|or)\s+/gi, ',')
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);

const canonicalKind = (prefix: string): 'section' | 'subsection' | 'paragraph' =>
  prefix.toLowerCase().startsWith('paragraph')
    ? 'paragraph'
    : prefix.toLowerCase().startsWith('section')
      ? 'section'
      : 'subsection';

const parseReferencePart = (
  part: string,
  currentSection: string | undefined,
  previousSection: string | undefined,
): { value: string; section?: string } | undefined => {
  const fullMatch = /^(\d+(?:\.\d+)?)(\([^)]+\)(?:\([^)]+\))*)/.exec(part);
  if (fullMatch) return { value: `${fullMatch[1]}${fullMatch[2]}`, section: fullMatch[1] };
  const relativeMatch = /^(\(\d+(?:\.\d+)?\)(?:\([^)]+\))*)/.exec(part);
  if (relativeMatch) {
    const section = previousSection ?? currentSection;
    return section ? { value: `${section}${relativeMatch[1]}`, section } : { value: relativeMatch[1] };
  }
  const sectionMatch = /^(\d+(?:\.\d+)?)(?!\s*\()/.exec(part);
  if (sectionMatch) return { value: sectionMatch[1], section: sectionMatch[1] };
  return undefined;
};

export const normalizeLegalReference = (token: string, currentSection?: string): string[] => {
  const normalized = normalizeAiValidationText(token);
  const prefixMatch = /^(sections?|subsections?|paragraphs?)\s+(.+)$/i.exec(normalized);
  if (!prefixMatch) return [normalized];
  const kind = canonicalKind(prefixMatch[1]);
  const values: string[] = [];
  let previousSection: string | undefined;
  splitReferenceParts(prefixMatch[2]).forEach((part) => {
    const parsed = parseReferencePart(part, currentSection, previousSection);
    if (!parsed) return;
    previousSection = parsed.section ?? previousSection;
    values.push(`${kind} ${parsed.value}`);
    if (kind === 'subsection' || kind === 'paragraph') values.push(parsed.value);
  });
  return values.length > 0 ? values : [normalized];
};

export const collectLegalReferences = (text: string, currentSection?: string): string[] => {
  const values: string[] = [];
  Array.from(text.matchAll(legalReferenceLeadPattern)).forEach((match) => {
    values.push(...normalizeLegalReference(`${match[1]} ${match[2]}`, currentSection));
  });
  Array.from(text.matchAll(bareSubsectionPattern)).forEach((match) => {
    values.push(normalizeAiValidationText(match[0]));
  });
  return Array.from(new Set(values));
};

export const collectRiskTokens = (text: string, currentSection?: string): string[] =>
  Array.from(new Set([
    ...collectLegalReferences(text, currentSection),
    ...Array.from(text.matchAll(quantityPattern)).map((match) => normalizeAiValidationText(match[0])),
  ]));

export const collectRiskTokensForSource = (text: string, sourceKey: string): string[] =>
  Array.from(new Set([
    ...collectLegalReferences(text, sourceSectionFromKey(sourceKey)),
    ...Array.from(text.matchAll(quantityPattern)).map((match) => normalizeAiValidationText(match[0])),
  ]));

const sourceTextsForObjective = (
  objective: AiLearningObjective,
  sourceComponents: ImportedLegalComponent[],
): string[] =>
  objective.sourceKeys.map((sourceKey) => sourceComponents.find((component) => component.sourceKey === sourceKey)?.text ?? '');

const isAlphanumeric = (value: string | undefined): boolean => Boolean(value && /[A-Za-z0-9]/.test(value));

export type TruncationCandidateField = 'answer' | 'evidence';

export type TruncationCandidateIssue = {
  field: TruncationCandidateField;
  text: string;
  sourceText: string;
  trigger: string;
};

export const findTruncationCandidates = (
  objective: AiLearningObjective,
  proposal: AiStudyUnitProposal,
  sourceComponents: ImportedLegalComponent[],
): TruncationCandidateIssue[] => {
  const sourceTexts = sourceTextsForObjective(objective, sourceComponents);
  const candidates = [
    { field: 'answer' as const, text: objective.studyAnswer },
    ...objective.evidence.map((evidence) => ({ field: 'evidence' as const, text: evidence.evidenceText })),
  ];
  const issues: TruncationCandidateIssue[] = [];
  candidates.forEach(({ field, text }) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    if (/[.。…]{3,}\s*$/.test(trimmed)) {
      issues.push({ field, text: trimmed, sourceText: sourceTexts.join('\n\n'), trigger: 'literal-ellipsis' });
    }
    if (field === 'answer') {
      if (/^[a-z]\w*\b/.test(trimmed) && !/^(a|an|and|as|at|by|for|if|in|of|on|or|the|to|with)\b/i.test(trimmed)) {
        issues.push({ field, text: trimmed, sourceText: sourceTexts.join('\n\n'), trigger: 'suspicious-lowercase-start' });
      }
      if (/[A-Za-z,;:]$/.test(trimmed) && !/\b(Act|Regulation|Registrar General|Director of Surveys|Board|Minister|Council)$/.test(trimmed)) {
        issues.push({ field, text: trimmed, sourceText: sourceTexts.join('\n\n'), trigger: 'suspicious-ending' });
      }
    }
    sourceTexts.forEach((sourceText) => {
      const index = sourceText.indexOf(trimmed);
      if (index < 0) {
        if (field === 'evidence' && /\w[.。…]{3,}\s*$/.test(trimmed)) {
          issues.push({ field, text: trimmed, sourceText, trigger: 'damaged-source-span' });
        }
        return;
      }
      if (isAlphanumeric(sourceText[index - 1]) && isAlphanumeric(trimmed[0])) {
        issues.push({ field, text: trimmed, sourceText, trigger: 'mid-token-start' });
      }
      const after = sourceText[index + trimmed.length];
      if (isAlphanumeric(after) && isAlphanumeric(trimmed.at(-1))) {
        issues.push({ field, text: trimmed, sourceText, trigger: 'mid-token-end' });
      }
    });
  });
  if (/[.。…]{3,}/.test(proposal.studySummary) && objective.studyAnswer.includes('...')) {
    issues.push({
      field: 'answer',
      text: proposal.studySummary,
      sourceText: sourceTexts.join('\n\n'),
      trigger: 'summary-built-from-truncated-answer',
    });
  }
  return issues;
};

const childLabelSourceText = (
  sourceComponents: ImportedLegalComponent[],
  sourceKey: string,
  label: string,
): string | undefined => {
  const component = sourceComponents.find((entry) => entry.sourceKey === sourceKey);
  if (!component) return undefined;
  const subsection = component.subsections?.find((entry) => entry.label === label);
  return subsection?.text ?? (component.label === label ? component.text : undefined);
};

export const focusTextForSource = (
  sourceComponents: ImportedLegalComponent[],
  approvedGroup: AiProposedSourceGroup,
  sourceKey: string,
): string => {
  const component = sourceComponents.find((entry) => entry.sourceKey === sourceKey);
  if (!component) return '';
  const selections = approvedGroup.focusSelections.filter((selection) => selection.sourceKey === sourceKey);
  const childTexts = selections.flatMap((selection) =>
    (selection.childLabels ?? [])
      .map((label) => childLabelSourceText(sourceComponents, sourceKey, label))
      .filter((text): text is string => Boolean(text)),
  );
  return childTexts.length > 0 ? childTexts.join('\n\n') : component.text;
};

export const approvedFocusTextForObjective = (
  objective: AiLearningObjective,
  proposal: AiStudyUnitProposal,
  sourceComponents: ImportedLegalComponent[],
): string => {
  if (!proposal.approvedGroup) {
    return objective.sourceKeys
      .map((sourceKey) => sourceComponents.find((component) => component.sourceKey === sourceKey)?.text ?? '')
      .join('\n\n');
  }
  return objective.sourceKeys
    .map((sourceKey) => focusTextForSource(sourceComponents, proposal.approvedGroup as AiProposedSourceGroup, sourceKey))
    .join('\n\n');
};

const importantPhrasePatterns = [
  /\b(?:registrar general|director of surveys|development officer|occupational health and safety act|community planning act|land titles act|registry act)\b/g,
  /\b(?:shall not|must not|may not|shall|must|required|prohibited|deemed|void|notice|hearing|deadline|application|affidavit|surveyor|minister|board|council|regulator|inspector|owner|applicant)\b/g,
  /\b(?:if|unless|except|subject to|despite|notwithstanding|on application|satisfied|prescribed form|written summary|public purpose|money in lieu)\b/g,
  quantityPattern,
];

export const significantLegalSupportTerms = (text: string): string[] => {
  const normalized = normalizeAiValidationText(text);
  const terms = importantPhrasePatterns.flatMap((pattern) => {
    pattern.lastIndex = 0;
    return Array.from(normalized.matchAll(pattern)).map((match) => match[0]);
  });
  return Array.from(new Set(terms));
};
