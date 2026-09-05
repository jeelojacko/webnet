// Exam Prep Locate — ephemeral picker protocol (pure URL/message/matching).

import { describe, expect, it } from 'vitest';
import {
  buildExamPrepLocatePickerPath,
  createExamPrepLocatePickerToken,
  isExamPrepLocatePickMessage,
  locatePickMatchesExpected,
  parseExamPrepLocatePickerSearch,
  EXAM_PREP_PICKER_KIND,
  EXAM_PREP_PICKER_PARAM,
  EXAM_PREP_PICKER_TOKEN_PARAM,
} from '../../src/study/examPrep/examPrepLocatePicker';
import type { ExamPrepLocateTask } from '../../src/study/examPrep/examPrepTypes';

const task = (
  overrides: Partial<Pick<ExamPrepLocateTask, 'expectedDocumentId' | 'expectedSourceKey'>>,
): Pick<ExamPrepLocateTask, 'expectedDocumentId' | 'expectedSourceKey'> => ({
  expectedDocumentId: 'doc-registry-act',
  expectedSourceKey: 'section:34',
  ...overrides,
});

describe('exam prep locate picker protocol', () => {
  it('builds and parses a picker URL without leaking the expected location', () => {
    const prompt = 'Where must a duly registered conveyance be recorded?';
    const token = createExamPrepLocatePickerToken();
    const path = buildExamPrepLocatePickerPath(prompt, token);
    expect(path).toContain('/study/library?');
    expect(path).toContain(`${EXAM_PREP_PICKER_PARAM}=${EXAM_PREP_PICKER_KIND}`);
    expect(path).toContain(`${EXAM_PREP_PICKER_TOKEN_PARAM}=${encodeURIComponent(token)}`);
    // The picker URL carries ONLY the prompt — never any expected answer.
    expect(path).not.toContain('section:34');
    const search = path.slice(path.indexOf('?'));
    const parsed = parseExamPrepLocatePickerSearch(search);
    expect(parsed).toEqual({ kind: 'locate', prompt, token, sprintId: null });
    expect(parseExamPrepLocatePickerSearch('?tab=units')).toBeNull();
    expect(parseExamPrepLocatePickerSearch('')).toBeNull();
  });

  it('recognises only well-formed same-origin pick messages', () => {
    expect(
      isExamPrepLocatePickMessage({
        type: 'study-locate-pick',
        token: 't1',
        documentId: 'doc',
        sourceKey: 'section:1',
      }),
    ).toBe(true);
    expect(
      isExamPrepLocatePickMessage({
        type: 'study-locate-pick',
        token: 't1',
        documentId: 'doc',
        sourceKey: null,
      }),
    ).toBe(true);
    expect(isExamPrepLocatePickMessage({ type: 'other', token: 't' })).toBe(false);
    expect(isExamPrepLocatePickMessage(null)).toBe(false);
    expect(isExamPrepLocatePickMessage('nope')).toBe(false);
  });

  it('objective matching: exact pinned provision only for pinned targets', () => {
    const pinned = task({ expectedSourceKey: 'section:34' });
    expect(
      locatePickMatchesExpected(pinned, {
        documentId: 'doc-registry-act',
        sourceKey: 'section:34',
      }),
    ).toBe(true);
    // same document, wrong provision => missed
    expect(
      locatePickMatchesExpected(pinned, {
        documentId: 'doc-registry-act',
        sourceKey: 'section:35',
      }),
    ).toBe(false);
    // document-level pick for a pinned target => missed
    expect(
      locatePickMatchesExpected(pinned, { documentId: 'doc-registry-act', sourceKey: null }),
    ).toBe(false);
    // wrong document => missed
    expect(
      locatePickMatchesExpected(pinned, { documentId: 'doc-other', sourceKey: 'section:34' }),
    ).toBe(false);
  });

  it('objective matching: document-level targets accept any provision in the right document', () => {
    const docLevel = task({ expectedSourceKey: null });
    expect(
      locatePickMatchesExpected(docLevel, {
        documentId: 'doc-registry-act',
        sourceKey: 'section:1',
      }),
    ).toBe(true);
    expect(
      locatePickMatchesExpected(docLevel, { documentId: 'doc-registry-act', sourceKey: null }),
    ).toBe(true);
    expect(
      locatePickMatchesExpected(docLevel, { documentId: 'doc-other', sourceKey: 'section:1' }),
    ).toBe(false);
  });
});
