import { describe, expect, it } from 'vitest';
import { __studyAiGroundingTest, validateStudyMapGroupGrounding } from '../../src/study/ai/studyAiGrounding';
import type {
  AiMapFocusSelection,
  AiProposedSourceGroup,
  AiStudyMapJob,
  AiValidationIssue,
} from '../../src/study/ai/studyAiTypes';

const {
  splitGluedClauseNumbers,
  normalizeForPhraseTokens,
  hasOmissionMarker,
  matchSplitEvidence,
  evidenceSupported,
} = __studyAiGroundingTest;

// Exact saved REGULATION 83-130 s.7 attempt-1 material (revalidated in place; no
// run history is rewritten). The model cited the operative sentence without the
// leading clause number, while the normalized source glues it: "7The certificate...".
const S7_SOURCE =
  '7The certificate referred to in paragraph 11(2)(b) of the Act shall be a Certificate of Title in Form 3.\n2000-38';
const S7_EVIDENCE =
  'The certificate referred to in paragraph 11(2)(b) of the Act shall be a Certificate of Title in Form 3.';

describe('Study Map evidence grounding normalization', () => {
  it('revalidates the saved REGULATION 83-130 s.7 attempt evidence (glued clause number)', () => {
    expect(evidenceSupported(S7_SOURCE, S7_EVIDENCE)).toBe(true);
  });

  it('splits a glued token-initial clause number off the following letter', () => {
    expect(splitGluedClauseNumbers('7The certificate')).toBe('7 The certificate');
    expect(splitGluedClauseNumbers('13.1(4)The licensee')).toBe('13.1(4) The licensee');
    expect(splitGluedClauseNumbers('11(2)(b)Of the two')).toBe('11(2)(b) Of the two');
    expect(splitGluedClauseNumbers('7the lowercase')).toBe('7 the lowercase');
  });

  it('does not split identifiers, form codes, or hyphenated years', () => {
    expect(splitGluedClauseNumbers('Section7 the rule')).toBe('Section7 the rule');
    expect(splitGluedClauseNumbers('form3 data')).toBe('form3 data');
    expect(splitGluedClauseNumbers('2000-38 remains')).toBe('2000-38 remains');
    expect(splitGluedClauseNumbers('death after May 1, 1951.')).toBe('death after May 1, 1951.');
  });

  it('grounds the s.7 sentence with or without the leading clause number and space', () => {
    expect(
      evidenceSupported(S7_SOURCE, 'The certificate referred to in paragraph 11(2)(b) of the Act'),
    ).toBe(true);
    expect(
      evidenceSupported(
        S7_SOURCE,
        '7The certificate referred to in paragraph 11(2)(b) of the Act',
      ),
    ).toBe(true);
    expect(
      evidenceSupported(
        S7_SOURCE,
        '7 The certificate referred to in paragraph 11(2)(b) of the Act',
      ),
    ).toBe(true);
    expect(
      evidenceSupported(S7_SOURCE, 'paragraph 11(2)(b) of the Act shall be a Certificate'),
    ).toBe(true);
  });

  it('still rejects word substitution, even across the glued-number boundary', () => {
    expect(
      evidenceSupported(
        S7_SOURCE,
        'The certificate referred to in paragraph 11(2)(b) of the Act shall be a Certificate of Land in Form 3.',
      ),
    ).toBe(false);
    expect(evidenceSupported(S7_SOURCE, 'shall be a Certificate of Title in Form 4')).toBe(false);
  });

  it('still rejects paraphrase and non-contiguous omission (whole-token containment)', () => {
    expect(evidenceSupported(S7_SOURCE, 'the certificate must be in Form 3')).toBe(false);
    expect(
      evidenceSupported(S7_SOURCE, 'The certificate of the Act shall be a Certificate of Title'),
    ).toBe(false);
  });

  it('keeps the glued number as its own token and still tolerates typography', () => {
    expect(normalizeForPhraseTokens('7The certificate')).toEqual(['7', 'the', 'certificate']);
    const source = 'A person\u00a0\u2019s objection must be delivered in writing';
    expect(evidenceSupported(source, "A person's objection must be delivered in writing")).toBe(
      true,
    );
  });
});

// Exact REGULATION 83-130 s.24(11) source text from the saved ai-map run
// (batch-143, job map-daf65fa0b0594df6): the operative text contains the OCR
// whitespace artifact "a r easonable time". The model's cleaned evidence quotes
// the same sentence with "a reasonable time"; the exact whole-token path cannot
// match ('r' and 'easonable' are separate source tokens), so the split-tolerant
// fallback must accept it.
const S24_11_SOURCE =
  '24(11) Documents and things put in evidence at a hearing\n' +
  'of the Discipline Committee shall, upon the request of the\n' +
  'party who produced them, be returned by the Committee\n' +
  'within a r easonable time after the matter in issue has been\n' +
  'finally determined.';
const S24_11_EVIDENCE =
  'Documents and things put in evidence at a hearing of the Discipline Committee shall, upon the request of the party who produced them, be returned by the Committee within a reasonable time after the matter in issue has been finally determined.';

describe('Study Map evidence grounding split tolerance (fallback)', () => {
  it('matches a single source word split by an OCR whitespace artifact', () => {
    expect(
      matchSplitEvidence(
        normalizeForPhraseTokens('within a r easonable time after the matter'),
        normalizeForPhraseTokens('within a reasonable time'),
      ),
    ).toBe(true);
  });

  it('matches the real s.24(11) corpus case via evidenceSupported', () => {
    expect(evidenceSupported(S24_11_SOURCE, S24_11_EVIDENCE)).toBe(true);
  });

  it('matches the exact s.24(11) fragment that triggered the fallback', () => {
    expect(evidenceSupported(S24_11_SOURCE, 'within a reasonable time after the matter in issue')).toBe(
      true,
    );
  });

  it('matches evidence across multiple split source words and hyphenation', () => {
    expect(
      evidenceSupported(
        'the As sociation adopts these By-laws within a r easonable time',
        'the Association adopts these By-laws within a reasonable time',
      ),
    ).toBe(true);
  });

  it('does not let the fallback accept a missing word', () => {
    expect(evidenceSupported('reasonable care is required', 'reasonable care required')).toBe(false);
    expect(evidenceSupported(S24_11_SOURCE, 'within a reasonable after the matter')).toBe(false);
  });

  it('does not let the fallback accept an extra word', () => {
    expect(evidenceSupported('reasonable care is required', 'reasonable care is indeed required')).toBe(
      false,
    );
  });

  it('does not let the fallback accept a substituted word', () => {
    expect(evidenceSupported('reasonable care is required', 'reasonable cure is required')).toBe(false);
    expect(evidenceSupported('unit the', 'nit the')).toBe(false);
    expect(evidenceSupported(S24_11_SOURCE, 'within a reasonable period after the matter')).toBe(false);
  });

  it('never accepts ellipsis/omission evidence, even when the split would otherwise align', () => {
    expect(evidenceSupported('reasonable care is required', 'reasonable care ... required')).toBe(false);
    expect(evidenceSupported('reasonable care is required', 'reasonable care \u2026 required')).toBe(false);
    expect(evidenceSupported('reasonable care is required', 'reasonable care .. required')).toBe(false);
  });

  it('keeps the omission guard fallback-only: single dots still pass via the primary path', () => {
    expect(evidenceSupported('see section 5.2 for details', 'see section 5.2 for details')).toBe(true);
  });

  it('rejects substring and mid-word token splits', () => {
    expect(evidenceSupported('reasonable care is required', 'reason')).toBe(false);
    expect(
      matchSplitEvidence(normalizeForPhraseTokens('reasonable care'), normalizeForPhraseTokens('reas onable')),
    ).toBe(false);
    expect(
      matchSplitEvidence(normalizeForPhraseTokens('ab c'), normalizeForPhraseTokens('a bc')),
    ).toBe(false);
  });

  it('rejects evidence longer than the source and boundary-aligned substitutions', () => {
    expect(evidenceSupported('reasonable care', 'reasonable care is required')).toBe(false);
    expect(matchSplitEvidence(normalizeForPhraseTokens('land'), normalizeForPhraseTokens('title'))).toBe(
      false,
    );
    expect(
      matchSplitEvidence(normalizeForPhraseTokens('ab cd'), normalizeForPhraseTokens('ac bd')),
    ).toBe(false);
  });

  it('flags raw ellipsis markers directly', () => {
    expect(hasOmissionMarker('reasonable care ... required')).toBe(true);
    expect(hasOmissionMarker('reasonable care \u2026 required')).toBe(true);
    expect(hasOmissionMarker('a..b')).toBe(true);
    expect(hasOmissionMarker('section 5.2 of the Act')).toBe(false);
    expect(hasOmissionMarker('plain evidence without dots')).toBe(false);
  });
});

// Production regression fixtures (post-3692-run audit):
// Mining Act s.34 pattern — enumerated children preceded by a parent lead-in rule,
// where the authoritative source-focus option advertises NO child labels. The
// model's ad-hoc (a)/(b) labels must not slice the lead-in out of the grounding
// text. Strict-side fixture — Community Planning Act s.1 pattern — the
// authoritative option DOES advertise child labels, so cross-child evidence
// (definitions from 1(1) quoted under 1(2)) must remain invalid.
const PROSPECTOR_SOURCE =
  'Upon demand, a prospector shall produce and exhibit his licence to\n' +
  '(a) the officer of the Crown making the demand; and\n' +
  '(b) the owner of surface rights to land upon which the prospector has entered.';
const DEFINITIONS_SOURCE =
  'In this Act,\n' +
  '1(1) unless the context otherwise indicates, \u201cCommissioner\u201d means the Commissioner appointed under the Act; and\n' +
  '1(2) \u201cmunicipal plan\u201d means the municipal plan adopted under section 13.';

const makeGroundingJob = (
  sourceKey: string,
  operativeSourceText: string,
  advertisedChildLabels: string[],
): AiStudyMapJob => ({
  schemaVersion: 1,
  jobId: 'map-grounding-test',
  runId: 'run-grounding-test',
  promptSpecVersion: 'study-map-v3',
  corpusContentHash: 'a'.repeat(64),
  inputHash: 'b'.repeat(64),
  document: { documentId: 'doc-test', title: 'Test Act', type: 'act' },
  target: {
    sourceKeys: [sourceKey],
    sectionLabels: ['34'],
    exactSourceText: operativeSourceText,
    operativeSourceText,
    sourceMetadata: {},
    sourceStatus: 'current',
    approximateInputSize: {
      exactCharacters: operativeSourceText.length,
      operativeCharacters: operativeSourceText.length,
      largeSection: false,
    },
    sourceFocusOptions: [{ sourceKey, label: '34', childLabels: advertisedChildLabels }],
    sourceHashes: { [sourceKey]: 'c'.repeat(64) },
  },
  context: {},
});

const makeGroundingGroup = (
  sourceKey: string,
  selections: AiMapFocusSelection[],
): AiProposedSourceGroup => ({
  groupId: 'g1',
  titleSuggestion: 'Licence production requirements',
  sourceKeys: [sourceKey],
  focusSelections: selections,
  reason: 'The rule sets out who may demand and inspect the licence.',
  approximateLearningGoal: 'Recall who may demand the licence and when it must be produced.',
});

const groundingCodes = (
  group: AiProposedSourceGroup,
  job: AiStudyMapJob,
): string[] => {
  const issues: AiValidationIssue[] = [];
  validateStudyMapGroupGrounding(group, job, issues);
  return issues.map((issue) => issue.code);
};

describe('focus grounding without advertised child labels', () => {
  it('accepts the parent lead-in quoted under ad-hoc (a)/(b) labels (Mining Act s.34 pattern)', () => {
    const job = makeGroundingJob('section:34', PROSPECTOR_SOURCE, []);
    const group = makeGroundingGroup('section:34', [
      {
        sourceKey: 'section:34',
        childLabels: ['(a)', '(b)'],
        evidenceText: ['Upon demand, a prospector shall produce and exhibit his licence to'],
      },
    ]);
    expect(groundingCodes(group, job)).not.toContain('FOCUS_EVIDENCE_NOT_IN_SOURCE');
  });

  it('still requires verbatim evidence even without advertised labels', () => {
    const job = makeGroundingJob('section:34', PROSPECTOR_SOURCE, []);
    const group = makeGroundingGroup('section:34', [
      {
        sourceKey: 'section:34',
        childLabels: ['(a)', '(b)'],
        evidenceText: ['a prospector must carry his licence at all times'],
      },
    ]);
    expect(groundingCodes(group, job)).toContain('FOCUS_EVIDENCE_NOT_IN_SOURCE');
  });
});

describe('focus grounding with advertised child labels (strict side preserved)', () => {
  it('keeps child-specific grounding: 1(1) definitions quoted under 1(2) stay invalid (CPA s.1 pattern)', () => {
    const job = makeGroundingJob('section:1', DEFINITIONS_SOURCE, ['1(1)', '1(2)']);
    const group = makeGroundingGroup('section:1', [
      {
        sourceKey: 'section:1',
        childLabels: ['1(2)'],
        evidenceText: ['\u201cCommissioner\u201d means the Commissioner appointed under the Act'],
      },
    ]);
    expect(groundingCodes(group, job)).toContain('FOCUS_EVIDENCE_NOT_IN_SOURCE');
  });

  it('accepts evidence inside the selected authoritative child', () => {
    const job = makeGroundingJob('section:1', DEFINITIONS_SOURCE, ['1(1)', '1(2)']);
    const group = makeGroundingGroup('section:1', [
      {
        sourceKey: 'section:1',
        childLabels: ['1(2)'],
        evidenceText: ['\u201cmunicipal plan\u201d means the municipal plan adopted under section 13'],
      },
    ]);
    expect(groundingCodes(group, job)).not.toContain('FOCUS_EVIDENCE_NOT_IN_SOURCE');
  });

  it('keeps rejecting selection of a child label the source does not advertise', () => {
    const job = makeGroundingJob('section:1', DEFINITIONS_SOURCE, ['1(1)', '1(2)']);
    const group = makeGroundingGroup('section:1', [
      {
        sourceKey: 'section:1',
        childLabels: ['1(3)'],
        evidenceText: ['\u201cmunicipal plan\u201d means the municipal plan adopted under section 13'],
      },
    ]);
    expect(groundingCodes(group, job)).toContain('FOCUS_CHILD_LABEL_NOT_IN_SOURCE');
  });
});
