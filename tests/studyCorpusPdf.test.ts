/**
 * Phase 4C PDF/content normalization: row reconstruction without fake
 * intra-word spaces, conservative hyphen handling, and structural
 * subsection detection with own spans.
 */
import { describe, expect, it } from 'vitest';

import {
  detectPdfSubsectionSpans,
  normalizePdfHyphenation,
  renderPdfItemRow,
  renderPdfItemsAsText,
  type PdfItemGeometry,
} from '../scripts/studyCorpusPdf';

const item = (str: string, x: number, width: number, y = 100): PdfItemGeometry => ({ str, x, width, y });

describe('renderPdfItemRow', () => {
  it('joins abutting runs without faking a space (registration)', () => {
    // Mirrors doc-new-brunswick-land-surveyors-act.pdf p9: "registra"+"tion".
    const row = [
      item('15(1)', 75.5, 21.75),
      item(' ', 97.26, 13.52),
      item('Any applicant for registra', 110.78, 102.38),
      item('tion who', 213.29, 34.84),
      item(':', 248.21, 2.77),
      item(' ', 250.98, 63.11),
    ];
    expect(renderPdfItemRow(row)).toBe('15(1) Any applicant for registration who:');
  });

  it('joins abutting runs without faking a space (annual)', () => {
    // Mirrors p8: "The Ann"+"ual general meeting of the Association".
    const row = [
      item('11(1)', 75.5, 21.75),
      item(' ', 97.26, 13.52),
      item('The Ann', 110.78, 34.98),
      item('ual general meeting of the Association', 145.7, 152.31),
    ];
    expect(renderPdfItemRow(row)).toBe('11(1) The Annual general meeting of the Association');
  });

  it('joins single-letter splits (person, meeting, authorization)', () => {
    expect(
      renderPdfItemRow([item('of a p', 75.5, 40), item('erson who is', 115.6, 60)]),
    ).toBe('of a person who is');
    expect(
      renderPdfItemRow([item('before the meetin', 75.5, 120), item('g, include a copy.', 195.6, 90)]),
    ).toBe('before the meeting, include a copy.');
    // Mirrors p10: "authorizati"+"on" with a 0.17pt gap.
    expect(
      renderPdfItemRow([
        item('a certificate of authorizati', 75.5, 201.1),
        item('on', 276.77, 10.01),
        item(' ', 286.78, 6.77),
        item('a', 293.55, 4.42),
      ]),
    ).toBe('a certificate of authorization a');
  });

  it('keeps adjacent hyphen compounds tight (by-laws, vice-president)', () => {
    // Mirrors p1: "by"+"-"+"laws" with sub-point gaps.
    const row = [
      item('by', 187.19, 10.01),
      item('-', 197.06, 3.32),
      item('laws', 200.33, 18.04),
      item(' ', 218.37, 7.76),
      item('made', 226.13, 21.45),
    ];
    expect(renderPdfItemRow(row)).toBe('by-laws made');
  });

  it('separates words at genuine word pitch', () => {
    const row = [item('The', 75.5, 20), item(' ', 95.5, 7), item('Association', 102.5, 60)];
    expect(renderPdfItemRow(row)).toBe('The Association');
  });

  it('is order-independent and drops empty items', () => {
    const row = [item('world', 120, 30), item('', 75.5, 0), item('hello', 75.5, 30), item(' ', 105.5, 7)];
    expect(renderPdfItemRow(row)).toBe('hello world');
  });
});

describe('renderPdfItemsAsText', () => {
  it('orders rows top to bottom', () => {
    const items = [item('second', 75.5, 40, 50), item('first', 75.5, 30, 100)];
    expect(renderPdfItemsAsText(items)).toBe('first\nsecond');
  });
});

describe('normalizePdfHyphenation', () => {
  it('folds spaced alphabetic hyphens, including chains', () => {
    expect(normalizePdfHyphenation('made under the by - laws')).toBe('made under the by-laws');
    expect(normalizePdfHyphenation('Surveyor - in - training members')).toBe(
      'Surveyor-in-training members',
    );
    expect(normalizePdfHyphenation('two - thirds of members voting')).toBe(
      'two-thirds of members voting',
    );
  });

  it('joins line-wrapped compounds keeping the hyphen', () => {
    expect(normalizePdfHyphenation('the vice -\npresident, or in the absence')).toBe(
      'the vice-president, or in the absence',
    );
    expect(normalizePdfHyphenation('this Act or the By -\nlaws, commits')).toBe(
      'this Act or the By-laws, commits',
    );
    expect(normalizePdfHyphenation('on the twenty -\nfirst day')).toBe('on the twenty-first day');
    expect(normalizePdfHyphenation('of surveyor - in -\ntraining as prescribed')).toBe(
      'of surveyor-in-training as prescribed',
    );
  });

  it('leaves digits, dates, and revision stamps alone', () => {
    expect(normalizePdfHyphenation('1986-06 2')).toBe('1986-06 2');
    expect(normalizePdfHyphenation('sections 12 - 15 apply')).toBe('sections 12 - 15 apply');
  });
});

describe('detectPdfSubsectionSpans', () => {
  const section151 =
    '15(1) Any applicant for registration who:\n' +
    '(a) is a Canadian citizen,\n' +
    '(b) has met the necessary educational requirements prescribed in the by-laws,\n' +
    '(c) has fulfilled the requirements of surveyor-in-training,\n' +
    '(d) provides satisfactory evidence of good character, and\n' +
    'e) pays the prescribed fees,\n' +
    'may be registered as a land surveyor.';

  it('gives section 15(1) no 15(1)(1) child', () => {
    expect(detectPdfSubsectionSpans('15(1)', section151)).toEqual([]);
  });

  it('ignores mid-line prose references such as paragraph (1)(b)', () => {
    const section152 =
      '15(2) Any person not having met the conditions under\n' +
      'paragraph (1)(b) who desires to be registered as a land\n' +
      'surveyor, may make application to the Board. Upon the\n' +
      'Board certifying in writing to Council that the conditions\n' +
      'of paragraph (1)(b) have been met, Council may consider\n' +
      'the application for registration.';
    expect(detectPdfSubsectionSpans('15(2)', section152)).toEqual([]);
  });

  it('ignores wrapped prose continuations such as sub section\\n(1),', () => {
    const section193 =
      '19(3) Where a person fails to comply with sub section\n' +
      '(1), he may make full payment of fees within one year of\n' +
      'the time payment was due.';
    expect(detectPdfSubsectionSpans('19(3)', section193)).toEqual([]);
  });

  it('detects structural markers with own spans, not parent text', () => {
    const section =
      '21 Intro line for the section:\n' +
      '(1) First structural text here\n' +
      'continued on a second line.\n' +
      '(2) Second structural here.\n' +
      'See paragraph (1)(b) for detail.';
    const spans = detectPdfSubsectionSpans('21', section);
    expect(spans.map((span) => span.label)).toEqual(['21(1)', '21(2)']);
    expect(spans[0].text).toBe('(1) First structural text here\ncontinued on a second line.');
    expect(spans[1].text).toBe('(2) Second structural here.\nSee paragraph (1)(b) for detail.');
    for (const span of spans) {
      expect(span.text).not.toContain('21 Intro line');
    }
  });

  it('skips repeated numbers instead of emitting duplicate sourceKeys', () => {
    const section = '22 Head line:\n(1) First text.\n(1) Repeated number.';
    const spans = detectPdfSubsectionSpans('22', section);
    expect(spans.map((span) => span.label)).toEqual(['22(1)']);
  });
});
