import type { ImportedLegalComponent } from '../studyTypes';
import type { AiLearningObjective, AiStudyNote, AiStudyUnitProposal, AiValidationIssue } from './studyAiTypes';
import { focusTextForSource, normalizeAiValidationText } from './studyAiUnitFidelity';

// V5 (unit-authoring-v5) fidelity gates. V4 behavior is intentionally untouched:
// every check in this module runs only for proposals whose prompt spec is v5.
// All issues are errors: they invalidate the unit and route it back for repair.

const STOP_WORDS = new Set([
  'with', 'when', 'where', 'while', 'after', 'before', 'from', 'into', 'upon', 'under', 'over',
  'this', 'that', 'these', 'those', 'than', 'such', 'some', 'each', 'every', 'other', 'either',
  'within', 'without', 'against', 'through', 'between', 'being', 'have', 'has', 'had', 'does',
  'did', 'were', 'which', 'who', 'whom', 'whose', 'their', 'there', 'here', 'only', 'not', 'nor',
]);

// Mini-stemmer: good enough to equate party/parties, determine/determines,
// instrument/instrument(s), witness/witnessing, etc.
const miniStem = (word: string): string => {
  let w = word;
  if (w.endsWith('ies') && w.length > 4) w = `${w.slice(0, -3)}y`;
  else if (w.endsWith('es') && w.length > 3) w = w.slice(0, -2);
  else if (w.endsWith('s') && w.length > 3 && !w.endsWith('ss')) w = w.slice(0, -1);
  if (w.endsWith('ed') && w.length > 4) w = w.slice(0, -2);
  else if (w.endsWith('ing') && w.length > 5) w = w.slice(0, -3);
  return w;
};
const contentWords = (text: string): string[] =>
  Array.from(new Set(normalizeAiValidationText(text)
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((word) => word.length >= 4 && !STOP_WORDS.has(word) && !/^\d+$/.test(word))));

const overlapCount = (from: string[], against: string[]): number => {
  const stems = new Set(against.map(miniStem));
  const matched = new Set<string>();
  for (const word of from) if (stems.has(miniStem(word))) matched.add(miniStem(word));
  return matched.size;
};

// Citation-history lines (e.g. "R.S., c.195, s.42; 1986, c.69, s.6" or
// "1965-66, c.110, s.27; 1975, c.8, s.6") name amendment sections that must
// never count as references the source itself relies on.
const CITATION_LINE = /^(?:(?:R\.S\.|S\.C\.|C\.S\.|S\.S\.|C\.C\.)\s*,?\s*|\d{4}(?:-\d{2,4})?\s*,\s*[ccl]\.\d+)/;

const stripCitationHistory = (text: string): string =>
  text
    .split('\n')
    .filter((line) => !CITATION_LINE.test(line.trim()))
    .join('\n');

const sectionRootOfKey = (sourceKey: string): string | undefined =>
  /^section:(\d+(?:\.\d+)*)(?:#|$)/i.exec(sourceKey)?.[1];

const refRoot = (ref: string): string => {
  const bare = ref.split('(')[0];
  if (/^\d+(\.\d+){2,}$/.test(bare)) return bare; // bylaw-style: keep full path
  return bare.split('.')[0];
};

const collectClaimReferences = (rawText: string): string[] => {
  const text = stripCitationHistory(rawText);
  const refs = new Set<string>();
  const add = (ref: string | undefined): void => {
    if (!ref) return;
    const root = refRoot(ref);
    if (root && /^\d/.test(root)) refs.add(root);
  };
  for (const m of text.matchAll(/\b(?:sections?|subsections?|paragraphs?|articles?|clauses?|subparagraphs?)\s+(\d+(?:\.\d+)*(?:\([0-9a-zA-Z]+\))*)/gi)) add(m[1]);
  for (const m of text.matchAll(/\bs\.\s*(\d+(?:\.\d+)?)/gi)) add(m[1]);
  for (const m of text.matchAll(/(?<![\d.])\b(\d+(?:\.\d+)?)\(\d+(?:\.\d+)?\)/g)) add(m[1]);
  for (const m of text.matchAll(/(?<![\d.])(\d+(?:\.\d+){2,})(?![\d.])/g)) {
    if (/^\s*(?:cm|mm|km|m|ha|acres?|hectares?|percent|%|days?|months?|years?|metres|meters)\b/i.test(text.slice(m.index + m[0].length))) continue;
    add(m[1]);
  }
  return [...refs];
};

const focusTextForKeys = (
  proposal: AiStudyUnitProposal,
  components: ImportedLegalComponent[],
  sourceKeys: string[],
): string => {
  const group = proposal.approvedGroup;
  if (!group) return '';
  return sourceKeys
    .filter((key) => group.sourceKeys.includes(key))
    .map((key) => focusTextForSource(components, group, key))
    .filter(Boolean)
    .join('\n');
};

const pushIssue = (
  issues: AiValidationIssue[],
  issue: Omit<AiValidationIssue, 'severity' | 'code'> & {
    code: string;
    proposalId?: string;
    objectiveId?: string;
    sourceKey?: string;
  },
): void => {
  issues.push({
    ...issue,
    code: issue.code as AiValidationIssue['code'],
    severity: 'error',
  });
};

// 1. Evidence must be a verbatim character-for-character copy of the source.
const checkEvidenceVerbatim = (
  proposal: AiStudyUnitProposal,
  components: ImportedLegalComponent[],
  issues: AiValidationIssue[],
): void => {
  for (const objective of proposal.objectives ?? []) {
    for (const sourceKey of objective.sourceKeys ?? []) {
      const component = components.find((entry) => entry.sourceKey === sourceKey);
      if (!component) continue; // shared evidence validation reports the source problem
      const sourceText = component.text.replace(/\s+$/g, '');
      for (const evidence of objective.evidence ?? []) {
        if (evidence.sourceKey !== sourceKey || !evidence.evidenceText) continue;
        if (!sourceText.includes(evidence.evidenceText)) {
          pushIssue(issues, {
            code: 'EVIDENCE_NOT_EXACT_VERBATIM',
            proposalId: proposal.proposalId,
            objectiveId: objective.id,
            sourceKey,
            answerFragment: evidence.evidenceText,
            message: `Objective evidence is not a verbatim substring of ${sourceKey}. Copy the exact text from exactSourceText without normalizing or paraphrasing.`,
          });
        }
      }
    }
  }
};

// 2. Strict V5 sourceCoverage contract: exactly the selected childLabels, once each,
// with covered (valid objectiveIds) or intentionally-omitted (reason).
const checkSourceCoverageContract = (
  proposal: AiStudyUnitProposal,
  issues: AiValidationIssue[],
): void => {
  const group = proposal.approvedGroup;
  if (!group) return;
  const selected = new Map<string, Set<string>>();
  for (const selection of group.focusSelections ?? []) {
    const labels = selection.childLabels ?? [];
    if (labels.length === 0) continue;
    const existing = selected.get(selection.sourceKey) ?? new Set<string>();
    for (const label of labels) existing.add(label);
    selected.set(selection.sourceKey, existing);
  }
  const objectiveIds = new Set((proposal.objectives ?? []).map((objective) => objective.id));
  const coverage = proposal.sourceCoverage ?? [];
  const seen = new Set<string>();
  for (const entry of coverage) {
    if (!group.sourceKeys.includes(entry.sourceKey)) {
      pushIssue(issues, {
        code: 'SOURCE_COVERAGE_EXTRA_SOURCE',
        proposalId: proposal.proposalId,
        sourceKey: entry.sourceKey,
        message: `sourceCoverage includes sourceKey ${entry.sourceKey} which is not in the approved group.`,
      });
      continue;
    }
    for (const child of entry.childLabels ?? []) {
      const id = `${entry.sourceKey}::${child.label}`;
      if (seen.has(id)) {
        pushIssue(issues, {
          code: 'SOURCE_COVERAGE_DUPLICATE_LABEL',
          proposalId: proposal.proposalId,
          sourceKey: entry.sourceKey,
          message: `sourceCoverage declares ${id} more than once.`,
        });
        continue;
      }
      seen.add(id);
      if (!selected.get(entry.sourceKey)?.has(child.label)) {
        pushIssue(issues, {
          code: 'SOURCE_COVERAGE_EXTRA_LABEL',
          proposalId: proposal.proposalId,
          sourceKey: entry.sourceKey,
          message: `sourceCoverage includes childLabel ${child.label} which is not part of the approved focus for ${entry.sourceKey}.`,
        });
        continue;
      }
      if (child.status === 'covered') {
        if (!child.objectiveIds || child.objectiveIds.length === 0) {
          pushIssue(issues, {
            code: 'SOURCE_COVERAGE_COVERED_WITHOUT_OBJECTIVES',
            proposalId: proposal.proposalId,
            sourceKey: entry.sourceKey,
            message: `sourceCoverage marks ${id} covered but lists no objectiveIds.`,
          });
        }
        for (const objectiveId of child.objectiveIds ?? []) {
          if (!objectiveIds.has(objectiveId)) {
            pushIssue(issues, {
              code: 'SOURCE_COVERAGE_UNKNOWN_OBJECTIVE',
              proposalId: proposal.proposalId,
              sourceKey: entry.sourceKey,
              objectiveId,
              message: `sourceCoverage references unknown objective id ${objectiveId}.`,
            });
          }
        }
      } else if (child.status === 'intentionally-omitted') {
        if (!child.reason || !child.reason.trim()) {
          pushIssue(issues, {
            code: 'SOURCE_COVERAGE_OMISSION_WITHOUT_REASON',
            proposalId: proposal.proposalId,
            sourceKey: entry.sourceKey,
            message: `sourceCoverage intentionally omits ${id} without a source-grounded reason.`,
          });
        }
      } else {
        pushIssue(issues, {
          code: 'SOURCE_COVERAGE_INVALID_STATUS',
          proposalId: proposal.proposalId,
          sourceKey: entry.sourceKey,
          message: `sourceCoverage status ${child.status} is not valid for selected label ${id}; use covered or intentionally-omitted.`,
        });
      }
    }
  }
  const sortedKeys = [...selected.keys()].sort();
  for (const sourceKey of sortedKeys) {
    for (const label of [...(selected.get(sourceKey) ?? [])].sort()) {
      if (!seen.has(`${sourceKey}::${label}`)) {
        pushIssue(issues, {
          code: 'SOURCE_COVERAGE_MISSING_SELECTED_LABEL',
          proposalId: proposal.proposalId,
          sourceKey,
          message: `sourceCoverage is missing selected childLabel ${label} for ${sourceKey}.`,
        });
      }
    }
  }
};

// 3. A source prohibition must not come back as an affirmative duty.
const checkPolarityReversal = (
  proposal: AiStudyUnitProposal,
  components: ImportedLegalComponent[],
  issues: AiValidationIssue[],
): void => {
  const group = proposal.approvedGroup;
  if (!group) return;
  const focusTexts = group.sourceKeys.map((key) => focusTextForSource(components, group, key));
  for (const objective of proposal.objectives ?? []) {
    const answerText = [objective.objective, objective.guidedQuestion, objective.studyAnswer]
      .filter(Boolean)
      .join(' ');
    if (!answerText || !/\b(shall|must)\b/i.test(answerText)) continue;
    const answerWords = contentWords(answerText);
    // Scan sentence-by-sentence: a faithful negation in one sentence must not
    // mask a reversal in another, and a "No ... shall" sentence is faithful
    // wherever it sits in the joined answer, not only at the start.
    for (const sentence of answerText.split(/(?<=[.!?])\s+|\n+/)) {
      if (!/\b(shall|must)\b/i.test(sentence)) continue;
      // A faithful negative answer repeats the source negation.
      if (/^(no|neither)\b/i.test(sentence)) continue;
      if (/\b(?:is|are|was|were)\s+prohibited\b/i.test(sentence)) continue;
      for (const sourceText of focusTexts) {
        if (!sourceText) continue;
        const prohibited = /(?<![\w.])(no|neither)\b([^.;]{1,160}?)\b(shall|must)\b/gi;
        for (const match of sourceText.matchAll(prohibited)) {
          const actorText = match[2];
          const tailText = sourceText.slice(match.index + match[0].length, match.index + match[0].length + 260);
          // Scope the conditional guard to this clause only: a later sentence in
          // the same section may carry its own "unless" that does not qualify us.
          const clauseEnd = tailText.search(/[.!?](?:\s|$)/);
          const clauseText = clauseEnd >= 0 ? tailText.slice(0, clauseEnd + 1) : tailText;
          if (/\b(unless|except)\b/i.test(clauseText)) continue;
          const actorWords = contentWords(actorText);
          const sourceTerms = contentWords(clauseText);
          if (actorWords.length === 0 || sourceTerms.length < 3) continue;
          const actorRequirement = actorWords.length <= 2 ? actorWords.length : Math.ceil(actorWords.length / 2);
          if (overlapCount(actorWords, answerWords) < actorRequirement) continue;
          for (const duty of sentence.matchAll(/\b(?:shall|must)\b/g)) {
            const tail = sentence.slice(duty.index + duty[0].length, duty.index + duty[0].length + 140);
            const head = tail.split(/\s+/).slice(0, 4).join(' ');
            if (/^not\b/i.test(head)) continue;
            const overlap = overlapCount(contentWords(tail), sourceTerms);
            if (overlap >= Math.max(2, Math.ceil(sourceTerms.length * 0.5))) {
              pushIssue(issues, {
                code: 'POLARITY_REVERSAL',
                proposalId: proposal.proposalId,
                objectiveId: objective.id,
                message: `The source prohibits this act ("No ... shall") but the answer states it as an affirmative duty.`,
                answerFragment: sentence.slice(duty.index, duty.index + 160),
                sourceFragment: `${match[0]}${tailText.slice(0, 160)}`,
              });
              return;
            }
          }
        }
      }
    }
  }
};

// 4. A conditional or discretionary source trigger must not come back as a mandatory duty.
const MENTAL_VERB_STEMS = ['determin', 'believ', 'satisfi', 'recogni', 'consider'];

const findConditionalClause = (sourceText: string): { stem: string; words: string[] } | undefined => {
  for (const match of sourceText.matchAll(/\b(?:if|when|whenever|where)\b/g)) {
    const clause = sourceText.slice(match.index, match.index + 220);
    const stem = MENTAL_VERB_STEMS.find((candidate) => clause.toLowerCase().includes(candidate));
    if (stem) return { stem, words: contentWords(clause) };
  }
  return undefined;
};

const checkLegalModalityReversal = (
  proposal: AiStudyUnitProposal,
  components: ImportedLegalComponent[],
  issues: AiValidationIssue[],
): void => {
  const group = proposal.approvedGroup;
  if (!group) return;
  for (const objective of proposal.objectives ?? []) {
    const answerText = [objective.objective, objective.guidedQuestion, objective.studyAnswer]
      .filter(Boolean)
      .join(' ');
    if (!answerText || !/\b(must|shall)\b/i.test(answerText)) continue;
    // A conditional answer ("If the Minister determines ... the Minister may ...") is faithful.
    if (/\b(?:if|when|whenever|where)\b[^.]{0,240}?\b(?:may|might)\b/i.test(answerText)) continue;
    const answerWords = contentWords(answerText);
    for (const sourceKey of objective.sourceKeys ?? []) {
      const sourceText = focusTextForSource(components, group, sourceKey);
      if (!sourceText) continue;
      const clause = findConditionalClause(sourceText);
      if (!clause || clause.words.length < 4) continue;
      const requiredOverlap = Math.max(3, Math.ceil(clause.words.length * 0.35));
      if (overlapCount(clause.words, answerWords) < requiredOverlap) continue;
      for (const duty of answerText.matchAll(/\b(?:must|shall)\b/g)) {
        const tail = answerText.slice(duty.index + duty[0].length, duty.index + duty[0].length + 160);
        const words = tail.split(/\s+/).slice(0, 8);
        if (words.some((word) => word.toLowerCase().startsWith(clause.stem))) {
          pushIssue(issues, {
            code: 'LEGAL_MODALITY_REVERSAL',
            proposalId: proposal.proposalId,
            objectiveId: objective.id,
            message: `The source trigger is conditional ("${clause.stem}...") but the answer states it as a mandatory duty. Keep the source's condition and modality.`,
            answerFragment: answerText.slice(duty.index, duty.index + 160),
          });
          return;
        }
      }
    }
  }
};

// 5. Legal-effect claims ("does not bar...", "does not create a free-standing...")
// must be literally grounded in the approved source.
const LEGAL_EFFECT_PATTERNS: RegExp[] = [
  /\bdo(?:es)?\s+not\s+(?:actually|inadvertently|otherwise|technically)?\s*(?:bar|preclude|prevent)\b/gi,
  /\bdo(?:es)?\s+not\s+create\s+(?:a\s+)?(?:free[\s-]?standing|independent|separate|additional|new)\b/gi,
];

const checkUnsupportedLegalEffect = (
  proposal: AiStudyUnitProposal,
  components: ImportedLegalComponent[],
  issues: AiValidationIssue[],
): void => {
  const group = proposal.approvedGroup;
  if (!group) return;
  const approvedFocus = normalizeAiValidationText(focusTextForKeys(proposal, components, group.sourceKeys));
  const claims: Array<{ field: string; note?: AiStudyNote; text: string }> = [];
  if (proposal.studySummary) claims.push({ field: 'studySummary', text: proposal.studySummary });
  for (const note of proposal.studyNotes ?? []) {
    if (note.basis === 'source-derived') claims.push({ field: `studyNote ${note.id}`, note, text: note.text });
  }
  for (const claim of claims) {
    const normalized = normalizeAiValidationText(claim.text);
    const focus = claim.note?.sourceKeys?.length
      ? normalizeAiValidationText(focusTextForKeys(proposal, components, claim.note.sourceKeys))
      : approvedFocus;
    for (const pattern of LEGAL_EFFECT_PATTERNS) {
      pattern.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = pattern.exec(normalized)) !== null) {
        const words = normalized.split(/\s+/);
        let start = 0;
        let wordIndex = 0;
        for (let i = 0; i < words.length; i += 1) {
          const end = start + words[i].length;
          if (match.index >= start && match.index < end) { wordIndex = i; break; }
          start = end + 1;
        }
        const span = words.slice(wordIndex, wordIndex + 7).join(' ');
        if (focus.includes(span)) continue;
        pushIssue(issues, {
          code: 'UNSUPPORTED_LEGAL_EFFECT',
          proposalId: proposal.proposalId,
          message: `${claim.field} asserts an ungrounded legal effect ("${match[0]}") that does not appear in the approved source.`,
          answerFragment: span,
        });
      }
    }
  }
};

// 6. The study summary may not lean on provisions outside the approved focus.
const checkSummaryReferenceLeakage = (
  proposal: AiStudyUnitProposal,
  components: ImportedLegalComponent[],
  issues: AiValidationIssue[],
): void => {
  const group = proposal.approvedGroup;
  const summary = proposal.studySummary;
  if (!group || !summary) return;
  const allowed = new Set<string>();
  for (const sourceKey of group.sourceKeys) {
    const root = sectionRootOfKey(sourceKey);
    if (root) allowed.add(refRoot(root));
    for (const ref of collectClaimReferences(stripCitationHistory(focusTextForSource(components, group, sourceKey) ?? ''))) {
      allowed.add(refRoot(ref));
    }
  }
  const leaked = collectClaimReferences(summary).filter((ref) => !allowed.has(refRoot(ref)));
  if (leaked.length > 0) {
    pushIssue(issues, {
      code: 'CONTEXT_REF_LEAKAGE',
      proposalId: proposal.proposalId,
      message: `Study summary references provision(s) ${leaked.join(', ')} outside the approved focus; remove the contrast with other provisions.`,
    });
  }
};

// 7a. Actor roles invented by the summary ("a surveyor must ...") are overreach.
const ACTOR_ROLES = [
  'surveyor', 'engineer', 'architect', 'owner', 'occupier', 'applicant', 'claimant',
  'plaintiff', 'defendant', 'judge', 'council', 'minister', 'director', 'registrar',
  'officer', 'clerk',
];

const checkSummaryActorOverreach = (
  proposal: AiStudyUnitProposal,
  components: ImportedLegalComponent[],
  issues: AiValidationIssue[],
): void => {
  const group = proposal.approvedGroup;
  const summary = proposal.studySummary;
  if (!group || !summary) return;
  const focus = normalizeAiValidationText(focusTextForKeys(proposal, components, group.sourceKeys));
  for (const sentence of summary.split(/(?<=[.!?])\s+|\n+/)) {
    if (!/\b(?:must|shall)\b/i.test(sentence)) continue;
    for (const role of Array.from(new Set(ACTOR_ROLES))) {
      if (new RegExp(`\\b${role}s?\\b`, 'i').test(sentence) && !focus.includes(role)) {
        pushIssue(issues, {
          code: 'SUMMARY_ACTOR_OVERREACH',
          proposalId: proposal.proposalId,
          message: `Study summary assigns a duty to "${role}" but the approved focus never names that actor.`,
          answerFragment: sentence.slice(0, 180),
        });
        return;
      }
    }
  }
};

// 7b. "before ... can approve ..." sequencing claims require the verb in the source.
const checkSummaryApprovalSequencing = (
  proposal: AiStudyUnitProposal,
  components: ImportedLegalComponent[],
  issues: AiValidationIssue[],
): void => {
  const group = proposal.approvedGroup;
  const summary = proposal.studySummary;
  if (!group || !summary) return;
  const pattern = /\bbefore\b[^.!?]{0,140}?\b(?:can|may)\s+approv/i;
  if (!pattern.test(summary)) return;
  const focus = focusTextForKeys(proposal, components, group.sourceKeys);
  if (/\bapprov/i.test(focus)) return;
  pushIssue(issues, {
    code: 'SUMMARY_APPROVAL_SEQUENCING',
    proposalId: proposal.proposalId,
    message: 'Study summary claims an approval step ("before ... approve") that the approved focus does not contain.',
  });
};

// 8. Study notes: approved sourceKeys only, plus grounding for source-derived notes.
const LEGAL_TERMS = [
  'individuals', 'corporations', 'corporation', 'company', 'companies', 'partnerships', 'partnership',
  'public bodies', 'public body', 'private', 'taxpayers', 'taxpayer', 'landowners', 'landowner',
  'lessees', 'lessee', 'tenants', 'tenant', 'licensees', 'licensee', 'mortgagees', 'mortgagee',
  'creditors', 'creditor', 'heritage', 'municipal', 'municipalities', 'court', 'judge', 'tribunal',
];

const checkStudyNotes = (
  proposal: AiStudyUnitProposal,
  components: ImportedLegalComponent[],
  issues: AiValidationIssue[],
): void => {
  const group = proposal.approvedGroup;
  if (!group) return;
  const notes = proposal.studyNotes ?? [];
  for (const note of notes) {
    const keys = note.sourceKeys ?? [];
    if (keys.length > 0 && !keys.every((key) => group.sourceKeys.includes(key))) {
      pushIssue(issues, {
        code: 'STUDY_NOTE_OUTSIDE_APPROVED_SOURCE',
        proposalId: proposal.proposalId,
        message: `Study note ${note.id} cites source keys outside the approved group: ${keys.filter((key) => !group.sourceKeys.includes(key)).join(', ')}.`,
      });
    }
    if (note.basis !== 'source-derived') continue;
    // A note without declared keys is grounded against the whole approved focus.
    const groundedKeys = keys.length > 0 ? keys : group.sourceKeys;
    const sourceText = focusTextForKeys(proposal, components, groundedKeys);
    const noteRefs = collectClaimReferences(note.text);
    const allowedRefs = new Set<string>();
    for (const key of groundedKeys) {
      const root = sectionRootOfKey(key);
      if (root) allowedRefs.add(refRoot(root));
      for (const ref of collectClaimReferences(stripCitationHistory(focusTextForSource(components, group, key) ?? ''))) allowedRefs.add(refRoot(ref));
    }
    const ungroundedRefs = noteRefs.filter((ref) => !allowedRefs.has(refRoot(ref)));
    const ungroundedTerms = LEGAL_TERMS.filter(
      (term) => new RegExp(`\\b${term}\\b`, 'i').test(note.text) && !new RegExp(`\\b${term}\\b`, 'i').test(sourceText),
    );
    if (ungroundedRefs.length === 0 && ungroundedTerms.length < 2) continue;
    pushIssue(issues, {
      code: 'SOURCE_DERIVED_NOTE_UNGROUNDED',
      proposalId: proposal.proposalId,
      message: `Study note ${note.id} is not grounded in its declared source (references: ${ungroundedRefs.join(', ') || 'none'}; ungrounded terms: ${ungroundedTerms.join(', ') || 'none'}).`,
      answerFragment: note.text.slice(0, 180),
    });
  }
};

export const validateUnitV5Fidelity = (
  proposal: AiStudyUnitProposal,
  components: ImportedLegalComponent[],
  issues: AiValidationIssue[],
): void => {
  checkEvidenceVerbatim(proposal, components, issues);
  checkSourceCoverageContract(proposal, issues);
  checkPolarityReversal(proposal, components, issues);
  checkLegalModalityReversal(proposal, components, issues);
  checkUnsupportedLegalEffect(proposal, components, issues);
  checkSummaryReferenceLeakage(proposal, components, issues);
  checkSummaryActorOverreach(proposal, components, issues);
  checkSummaryApprovalSequencing(proposal, components, issues);
  checkStudyNotes(proposal, components, issues);
};
