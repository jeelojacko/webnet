import { describe, expect, it } from 'vitest';
import { __studyAiGroundingTest } from '../../src/study/ai/studyAiGrounding';

const { splitGluedClauseNumbers, normalizeForPhraseTokens, evidenceSupported } =
  __studyAiGroundingTest;

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
