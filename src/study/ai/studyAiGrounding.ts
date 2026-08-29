import type {
  AiProposedSourceGroup,
  AiSourceContext,
  AiStudyMapJob,
  AiValidationIssue,
} from './studyAiTypes';

const STOP_WORDS = new Set([
  'act',
  'section',
  'subsection',
  'paragraph',
  'regulation',
  'regulations',
  'rule',
  'rules',
  'recall',
  'know',
  'understand',
  'practical',
  'legal',
  'source',
  'sources',
  'study',
  'unit',
  'provision',
  'provisions',
  'defined',
  'definitions',
  'terms',
  'scope',
  'limits',
  'other',
  'core',
  'procedure',
  'conditions',
  'enforcement',
  'related',
  'topic',
  'topics',
  'group',
  'current',
  'includes',
  'including',
  'required',
  'require',
  'requires',
  'following',
  'follow',
  'follows',
  'these',
  'those',
  'which',
  'from',
  'under',
  'both',
  'public',
  'state',
  'subject',
  'target',
  'authoring',
  'approximate',
  'learning',
  'goal',
  'focus',
  'focuses',
  'distinct',
  'separate',
  'coherent',
  'supporting',
  'support',
  'supports',
  'matter',
  'material',
]);

const HIGH_RISK_CONTEXT_TOPIC_TERMS = new Set([
  'appeal',
  'delegate',
  'delegation',
  'priority',
  'priorities',
  'transitional',
]);

const TOPIC_ALIASES: Record<string, string[]> = {
  amendment: ['amend', 'amending', 'amended'],
  amendments: ['amend', 'amending', 'amended'],
  approval: ['approve', 'approved'],
  approvals: ['approve', 'approved'],
  definition: ['definitions'],
  delegation: ['delegate', 'delegated'],
  delivery: ['deliver', 'delivered'],
  filing: ['file', 'filed'],
  notification: ['notify', 'notice'],
  priority: ['priorities'],
  registration: ['register', 'registered'],
  rejection: ['reject', 'rejected'],
};

const GENERIC_GROUP_PATTERN =
  /^(?:[^-:]+[-:]\s*)?(?:core rule|procedure or conditions|effects, exceptions, or enforcement|other defined terms|related provisions)$/i;

const normalize = (value: string): string =>
  value
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/[^\p{L}\p{N}().#'":-]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();

// Split a token-initial clause number off the letter that follows it so glued
// structural labels ("7The", "13.1(4)The", "11(2)(b)Of") compare identically whether
// the model or the source writes a space after the number. Only splits when the number
// begins the alphanumeric run (start of string or preceded by a non-alphanumeric), so
// ordinary identifiers like "Section7" or "form3" are left untouched. Applied symmetrically
// to both evidence and source; matching remains exact whole-token containment (no fuzziness).
const splitGluedClauseNumbers = (value: string): string =>
  value.replace(/(?<![\p{L}\p{N}])(\d[\d.]*(?:\([0-9A-Za-z.]+\))*)(?=\p{L})/gu, '$1 ');

const normalizeForPhrase = (value: string): string =>
  splitGluedClauseNumbers(
    value
      .replace(/[“”]/g, '"')
      .replace(/[‘’]/g, "'"),
  )
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();

const normalizeForPhraseTokens = (value: string): string[] => {
  const normalized = normalizeForPhrase(value);
  return normalized.length > 0 ? normalized.split(' ') : [];
};

// Contiguous token-sequence containment. Matching on whole tokens (rather
// than raw substring containment) keeps punctuation/whitespace/case tolerant
// while preventing mid-token matches such as "nit the" inside "unit the".
const tokensContain = (sourceTokens: string[], needleTokens: string[]): boolean => {
  if (needleTokens.length === 0) return false;
  if (needleTokens.length === 1) return sourceTokens.includes(needleTokens[0]);
  const first = needleTokens[0];
  for (let i = 0; i + needleTokens.length <= sourceTokens.length; i++) {
    if (sourceTokens[i] !== first) continue;
    let matches = true;
    for (let j = 1; j < needleTokens.length; j++) {
      if (sourceTokens[i + j] !== needleTokens[j]) {
        matches = false;
        break;
      }
    }
    if (matches) return true;
  }
  return false;
};

const stem = (term: string): string => {
  if (term.endsWith('ies') && term.length > 5) return `${term.slice(0, -3)}y`;
  if (term.endsWith('ing') && term.length > 6) return term.slice(0, -3);
  if (term.endsWith('ed') && term.length > 5) return term.slice(0, -2);
  if (term.endsWith('s') && term.length > 5) return term.slice(0, -1);
  return term;
};

const termForms = (term: string): string[] =>
  Array.from(new Set([term, stem(term), ...(TOPIC_ALIASES[term] ?? [])]));

const textHasTerm = (terms: Set<string>, term: string): boolean =>
  termForms(term).some((form) => terms.has(form));

const topicTerms = (text: string): string[] =>
  Array.from(new Set(normalize(text).match(/\b[\p{L}][\p{L}-]{3,}\b/gu) ?? []))
    .filter((word) => !STOP_WORDS.has(word))
    .map(stem)
    .filter((word) => !STOP_WORDS.has(word));

const termsInText = (text: string): Set<string> =>
  new Set(topicTerms(text).flatMap((term) => termForms(term)));

const addIssue = (
  issues: AiValidationIssue[],
  issue: Omit<AiValidationIssue, 'severity'> & { severity?: AiValidationIssue['severity'] },
): void => {
  issues.push({ severity: issue.severity ?? 'error', ...issue });
};

const contextEntries = (job: AiStudyMapJob): AiSourceContext[] =>
  [
    job.context.previous,
    job.context.next,
    ...(job.context.relevantDefinitions ?? []),
    ...(job.context.directlyReferencedProvisions ?? []),
  ].filter((context): context is AiSourceContext => Boolean(context));

const sourceTextByKey = (job: AiStudyMapJob): Map<string, string> => {
  const sources = new Map<string, string>();
  job.target.sourceKeys.forEach((sourceKey) => {
    sources.set(sourceKey, job.target.operativeSourceText);
  });
  // Context excerpts are bounded/truncated; they must never replace the
  // authoritative target source text, even when a context entry reuses a
  // target sourceKey (observed with relevantDefinitions pointing at the
  // target section itself).
  contextEntries(job).forEach((context) => {
    const text = context.operativeText ?? context.text;
    if (text && !sources.has(context.sourceKey)) {
      sources.set(context.sourceKey, text);
    }
  });
  return sources;
};

const contextTextByKey = (job: AiStudyMapJob): Map<string, string> =>
  new Map(contextEntries(job).map((context) => [context.sourceKey, context.operativeText ?? context.text]));

const authoringTextForGroup = (job: AiStudyMapJob, group: AiProposedSourceGroup): string => {
  const sources = sourceTextByKey(job);
  return [
    job.document.title,
    job.document.citation ?? '',
    job.target.heading ?? '',
    ...group.sourceKeys.map((sourceKey) => sources.get(sourceKey) ?? ''),
  ].join('\n\n');
};

const hasSpecificTopicSuffix = (title: string): boolean =>
  /\b(?:of|for|by|re|respecting|under|to)\s+[\p{L}][\p{L}-]{3,}/iu.test(title);

const evidenceSupported = (sourceText: string, evidence: string): boolean => {
  const evidenceTokens = normalizeForPhraseTokens(evidence);
  if (evidenceTokens.length === 0) return false;
  return tokensContain(normalizeForPhraseTokens(sourceText), evidenceTokens);
};

const definedTermPattern = (term: string): RegExp => {
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`["“]?${escaped}["”]?\\s*(?:,\\s*)?(?:unless[^,.;]+,\\s*)?means\\b`, 'iu');
};

const childLabelPattern = (label: string): RegExp => {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\\ /g, '\\s*');
  return new RegExp(`(?:^|\\n|\\s)${escaped}(?=\\s*[^\\d(]|\\s*$)`, 'iu');
};

const extractChildText = (sourceText: string, childLabels: string[], label: string): string | undefined => {
  const normalizedSource = sourceText.replace(/\r\n/g, '\n');
  const current = childLabelPattern(label).exec(normalizedSource);
  if (!current) return undefined;
  const currentIndex = current.index;
  const laterLabels = childLabels
    .filter((candidate) => candidate !== label)
    .map((candidate) => childLabelPattern(candidate).exec(normalizedSource))
    .filter((match): match is RegExpExecArray => {
      if (!match) return false;
      return match.index > currentIndex;
    })
    .sort((left, right) => left.index - right.index);
  const end = laterLabels[0]?.index ?? normalizedSource.length;
  return normalizedSource.slice(currentIndex, end).trim();
};

const childIsRepealOnly = (text: string): boolean =>
  /^\s*\d+(?:\.\d+)?\([^)]+\)\s*Repealed\b/i.test(text.trim());

const validateGroupSchemaGrounding = (
  group: AiProposedSourceGroup,
  job: AiStudyMapJob,
  issues: AiValidationIssue[],
): void => {
  const availableSources = sourceTextByKey(job);
  group.sourceKeys.forEach((sourceKey) => {
    if (!availableSources.has(sourceKey)) {
      addIssue(issues, {
        code: 'GROUP_SOURCE_KEY_NOT_AVAILABLE',
        jobId: job.jobId,
        sourceKey,
        message: `Group sourceKey is not present in target or supplied context: ${sourceKey}.`,
      });
    }
  });
  group.focusSelections.forEach((selection) => {
    if (!group.sourceKeys.includes(selection.sourceKey)) {
      addIssue(issues, {
        code: 'FOCUS_SOURCE_NOT_IN_GROUP',
        jobId: job.jobId,
        sourceKey: selection.sourceKey,
        message: `focusSelection.sourceKey must be one of the group's authoring sourceKeys: ${selection.sourceKey}.`,
      });
    }
  });
};

const validateFocusSelectionGrounding = (
  group: AiProposedSourceGroup,
  job: AiStudyMapJob,
  issues: AiValidationIssue[],
): void => {
  const availableSources = sourceTextByKey(job);
  const focusOptions = new Map((job.target.sourceFocusOptions ?? []).map((option) => [option.sourceKey, option]));
  group.focusSelections.forEach((selection) => {
    const sourceText = availableSources.get(selection.sourceKey);
    if (!sourceText || !group.sourceKeys.includes(selection.sourceKey)) return;
    const options = focusOptions.get(selection.sourceKey);
    const childLabels = options?.childLabels ?? [];
    selection.childLabels?.forEach((label) => {
      if (childLabels.length > 0 && !childLabels.includes(label)) {
        addIssue(issues, {
          code: 'FOCUS_CHILD_LABEL_NOT_IN_SOURCE',
          jobId: job.jobId,
          sourceKey: selection.sourceKey,
          message: `Child label is not available under ${selection.sourceKey}: ${label}.`,
        });
        return;
      }
      const childText = extractChildText(sourceText, childLabels, label);
      if (childText && childIsRepealOnly(childText)) {
        addIssue(issues, {
          code: 'FOCUS_CHILD_LABEL_NOT_USABLE',
          jobId: job.jobId,
          sourceKey: selection.sourceKey,
          message: `Child label is repeal-only and cannot be selected as current focus: ${label}.`,
        });
      }
    });
    selection.definedTerms?.forEach((term) => {
      if (!definedTermPattern(term).test(sourceText)) {
        addIssue(issues, {
          code: 'DEFINED_TERM_NOT_IN_FOCUS_SOURCE',
          jobId: job.jobId,
          sourceKey: selection.sourceKey,
          message: `Defined term is not defined in the focus source: ${term}.`,
        });
      }
    });
    selection.evidenceText?.forEach((evidence) => {
      const childTexts = (selection.childLabels ?? [])
        .map((label) => extractChildText(sourceText, childLabels, label))
        .filter((text): text is string => Boolean(text));
      const groundingText = childTexts.length > 0 ? childTexts.join('\n\n') : sourceText;
      if (!evidenceSupported(groundingText, evidence)) {
        addIssue(issues, {
          code: 'FOCUS_EVIDENCE_NOT_IN_SOURCE',
          jobId: job.jobId,
          sourceKey: selection.sourceKey,
          message: `Focus evidence is not present in the operative authoring source: ${evidence}.`,
        });
      }
    });
  });
};

const validateGroupTopicGrounding = (
  group: AiProposedSourceGroup,
  job: AiStudyMapJob,
  issues: AiValidationIssue[],
): void => {
  if (GENERIC_GROUP_PATTERN.test(group.titleSuggestion.trim()) && !hasSpecificTopicSuffix(group.titleSuggestion)) {
    addIssue(issues, {
      code: 'GENERIC_MAP_GROUP',
      severity: 'warning',
      jobId: job.jobId,
      message: `Generic Study Map group title: ${group.titleSuggestion}.`,
    });
  }
  const authoringText = authoringTextForGroup(job, group);
  const authoringTerms = termsInText(authoringText);
  const contextMap = contextTextByKey(job);
  const nonAuthoringContextText = Array.from(contextMap)
    .filter(([sourceKey]) => !group.sourceKeys.includes(sourceKey))
    .map(([, text]) => text)
    .join('\n\n');
  const contextTerms = termsInText(nonAuthoringContextText);
  const titleTerms = topicTerms(group.titleSuggestion);
  const riskBodyTerms = topicTerms(`${group.reason} ${group.approximateLearningGoal}`).filter((term) =>
    HIGH_RISK_CONTEXT_TOPIC_TERMS.has(term),
  );
  const unsupported = [...titleTerms, ...riskBodyTerms].filter((term) => !textHasTerm(authoringTerms, term));
  const contextOnly = unsupported.filter(
    (term) => HIGH_RISK_CONTEXT_TOPIC_TERMS.has(term) && textHasTerm(contextTerms, term),
  );
  if (contextOnly.length > 0) {
    addIssue(issues, {
      code: 'GROUP_TOPIC_NOT_GROUNDED',
      jobId: job.jobId,
      message: `Group topic appears grounded only in non-authoring context: ${Array.from(new Set(contextOnly)).slice(0, 8).join(', ')}.`,
    });
  }
};

export const validateStudyMapGroupGrounding = (
  group: AiProposedSourceGroup,
  job: AiStudyMapJob,
  issues: AiValidationIssue[],
): void => {
  validateGroupSchemaGrounding(group, job, issues);
  validateFocusSelectionGrounding(group, job, issues);
  validateGroupTopicGrounding(group, job, issues);
};

// Test-only hooks: unit tests exercise the deterministic evidence normalizer directly
// (glued clause-number splitting, whole-token containment, substitution rejection)
// without building a full authoring job.
export const __studyAiGroundingTest = {
  splitGluedClauseNumbers,
  normalizeForPhraseTokens,
  evidenceSupported,
};
