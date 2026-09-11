/** @vitest-environment jsdom */

import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import StudyDocumentPage from '../src/components/StudyDocumentPage';
import { buildCompleteDocumentText } from '../src/studyOfficialContent';
import { StudyLegalTextBlock } from '../src/components/StudyLegalTextBlock';
import { parseLegalDisplayBlocks } from '../src/components/StudyLegalTextBlock.utils';
import type { ImportedLegalComponent, StudyDataSnapshot } from '../src/studyTypes';
import { createSeedStudyData } from '../src/studySeed';

const component = ({
  sourceKey,
  componentType,
  label,
  heading,
  text,
  subsections = [],
}: Pick<ImportedLegalComponent, 'sourceKey' | 'componentType' | 'label' | 'heading' | 'text'> &
  Partial<Pick<ImportedLegalComponent, 'subsections'>>): ImportedLegalComponent => ({
  documentId: 'doc-reader',
  id: sourceKey.replace(/[^a-z0-9]+/gi, '-'),
  sourceKey,
  componentType,
  label,
  heading,
  text,
  contentHash: `${sourceKey}-hash`,
  subsections,
  extractionStatus: 'complete',
});

const createReaderData = (): StudyDataSnapshot => {
  const seed = createSeedStudyData('2026-08-05T10:00:00.000Z');
  return {
    ...seed,
    documents: [
      {
        id: 'doc-reader',
        title: 'Reader Act',
        kind: 'act',
        jurisdiction: 'New Brunswick',
        category: 'Statute law',
        priority: 1,
        summary: '',
        sourceFiles: [],
        createdAt: seed.exportedAt,
        updatedAt: seed.exportedAt,
      },
    ],
    legalDocuments: [
      {
        id: 'doc-reader',
        packageId: 'package',
        manifestId: 'manifest',
        officialTitle: 'Reader Act',
        officialCitationDisplay: 'R-1',
        officialCitationNormalized: 'r1',
        documentType: 'act',
        sourceUrl: 'https://example.test',
        fetchDate: seed.exportedAt,
        contentHash: 'document-hash',
        importedAt: seed.exportedAt,
        packageCreatedAt: seed.exportedAt,
      },
    ],
    legalComponents: [
      component({
        sourceKey: 'section:2',
        componentType: 'section',
        label: '2',
        heading: 'Application requirements',
        text: '2 Substantive body text.',
        subsections: [
          {
            id: 'section-2-subsection-1',
            sourceKey: 'section:2/subsection:1',
            label: '2(1)',
            text: '2(1) Subsection body text.',
            contentHash: 'subsection-hash',
          },
        ],
      }),
      component({
        sourceKey: 'schedule:schedule-a',
        componentType: 'schedule',
        label: 'SCHEDULE A',
        heading: 'Schedule topic',
        text: 'Schedule body text.',
      }),
      component({
        sourceKey: 'form:form-1',
        componentType: 'form',
        label: 'FORM 1',
        heading: 'Form topic',
        text: 'Form body text.',
      }),
    ],
    units: [],
    prompts: [],
    concepts: [],
    progress: [],
  };
};

const clickButtonContaining = async (text: string) => {
  const button = Array.from(document.querySelectorAll('button')).find((entry) => entry.textContent?.includes(text));
  expect(button).toBeTruthy();
  await act(async () => {
    button?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await new Promise((resolve) => window.requestAnimationFrame(resolve));
  });
};

describe('study legal reader navigation', () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    window.history.replaceState(null, '', '/study/document/doc-reader');
    window.HTMLElement.prototype.scrollIntoView = vi.fn();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    root?.unmount();
    container?.remove();
    root = null;
    container = null;
    vi.restoreAllMocks();
  });

  it('removes duplicate opening heading and aligns clause markers for display', async () => {
    await act(async () => {
      root?.render(
        <StudyLegalTextBlock
          text={'15(1) Any applicant for registration who:\n(a) is a Canadian citizen;\n    and has met the requirements;\n(b) pays the fee.'}
          label="15(1)"
          heading="Any applicant for registration who:"
          highlight={(value, _query) => value}
        />,
      );
    });

    expect(container?.textContent).toContain('is a Canadian citizen;');
    expect(container?.textContent).not.toContain('15(1) Any applicant for registration who:');
    // Hanging-indent clause blocks keep exact text in flow (no split marker spans).
    expect(container?.querySelectorAll('.w-8')).toHaveLength(0);
    const indented = Array.from(container?.querySelectorAll('div') ?? []).filter(
      (entry) => (entry as HTMLElement).style.paddingLeft === '2rem',
    );
    expect(indented.length).toBeGreaterThanOrEqual(2);
  });

  it('parses (a)/e) markers, standalone and, paragraph boundaries and closing text', () => {
    const blocks = parseLegalDisplayBlocks(
      '15(1) Any applicant for registration who:\n' +
        '(a) is a Canadian citizen,\n' +
        '(b) has met the educational requirements\n' +
        'prescribed in the by-laws,\n' +
        'and\n' +
        'e) pays the prescribed fees,\n' +
        'may be registered as a land surveyor.',
    );
    expect(blocks.map((block) => block.kind)).toEqual([
      'body',
      'clause',
      'clause',
      'and',
      'clause',
    ]);
    // Continuation lines stay with their clause; exact text preserved.
    expect(blocks[2].text).toBe('(b) has met the educational requirements\nprescribed in the by-laws,');
    expect(blocks[4].text).toBe('e) pays the prescribed fees,\nmay be registered as a land surveyor.');
  });

  it('keeps blank-line paragraphs and marker-only lines as logical blocks', () => {
    const blocks = parseLegalDisplayBlocks('Where the Director may assess it\n\n(a)\nin the name of the estate,\n\n(b)\nin the name of the heirs.\n\nClosing paragraph.');
    expect(blocks.map((block) => block.kind)).toEqual(['body', 'clause', 'clause', 'body']);
    expect(blocks[1].text).toBe('(a)\nin the name of the estate,');
    expect(blocks[3].text).toBe('Closing paragraph.');
  });

  it('expands and focuses sections, subsections, schedules and forms from navigation clicks', async () => {
    await act(async () => {
      root?.render(
        <StudyDocumentPage
          data={createReaderData()}
          documentId="doc-reader"
          onSaveDocument={vi.fn()}
          onSaveUnit={vi.fn()}
          onCompleteReading={vi.fn()}
          onCreateUnitFromSelection={vi.fn()}
          onGenerateMissingStudyContent={vi.fn()}
          onAcknowledgeSourceReview={vi.fn()}
          onSelectDocument={vi.fn()}
          onNavigate={vi.fn()}
          onPreviewUnit={vi.fn()}
        />,
      );
    });

    expect(document.getElementById('section:2')?.textContent).not.toContain('Substantive body text.');

    await clickButtonContaining('2 Application requirements');
    expect(document.body.textContent).toContain('Substantive body text.');
    expect(document.activeElement?.id).toBe('section:2-heading');
    expect(window.location.hash).toBe('#section%3A2');
    expect(window.HTMLElement.prototype.scrollIntoView).toHaveBeenCalledTimes(1);

    await clickButtonContaining('2(1)');
    expect(document.body.textContent).toContain('Subsection body text.');
    expect(document.activeElement?.id).toBe('section:2/subsection:1-heading');
    expect(window.HTMLElement.prototype.scrollIntoView).toHaveBeenCalledTimes(2);

    await clickButtonContaining('SCHEDULE A Schedule topic');
    expect(document.body.textContent).toContain('Schedule body text.');
    expect(document.activeElement?.id).toBe('schedule:schedule-a-heading');

    await clickButtonContaining('FORM 1 Form topic');
    expect(document.body.textContent).toContain('Form body text.');
    expect(document.activeElement?.id).toBe('form:form-1-heading');
  });

  it('renders the complete document as structural clauses with the document title kicker', async () => {
    await act(async () => {
      root?.render(
        <StudyDocumentPage
          data={createReaderData()}
          documentId="doc-reader"
          onSaveDocument={vi.fn()}
          onSaveUnit={vi.fn()}
          onCompleteReading={vi.fn()}
          onCreateUnitFromSelection={vi.fn()}
          onGenerateMissingStudyContent={vi.fn()}
          onAcknowledgeSourceReview={vi.fn()}
          onSelectDocument={vi.fn()}
          onNavigate={vi.fn()}
          onPreviewUnit={vi.fn()}
        />,
      );
    });

    const complete = document.getElementById('complete-document');
    expect(complete).toBeTruthy();
    // Actual document title replaces the generic kicker.
    expect(complete?.textContent).toContain('Reader Act');
    expect(complete?.querySelector('.whitespace-pre-wrap')).toBeNull();
    // Each visible component renders structurally with its label/heading.
    expect(complete?.textContent).toContain('Application requirements');
    expect(complete?.textContent).toContain('Schedule topic');
    expect(complete?.textContent).toContain('Subsection body text.');
    // No giant per-provision cards inside the continuous view.
    expect(complete?.querySelectorAll('article').length ?? 0).toBe(0);
  });

  it('copies the exact buildCompleteDocumentText payload', async () => {
    const data = createReaderData();
    const written: string[] = [];
    Object.defineProperty(window.navigator, 'clipboard', {
      value: { writeText: vi.fn((value: string) => {
        written.push(value);
        return Promise.resolve();
      }) },
      configurable: true,
    });
    await act(async () => {
      root?.render(
        <StudyDocumentPage
          data={data}
          documentId="doc-reader"
          onSaveDocument={vi.fn()}
          onSaveUnit={vi.fn()}
          onCompleteReading={vi.fn()}
          onCreateUnitFromSelection={vi.fn()}
          onGenerateMissingStudyContent={vi.fn()}
          onAcknowledgeSourceReview={vi.fn()}
          onSelectDocument={vi.fn()}
          onNavigate={vi.fn()}
          onPreviewUnit={vi.fn()}
        />,
      );
    });

    await clickButtonContaining('Copy Complete Text');
    expect(written).toHaveLength(1);
    expect(written[0]).toBe(buildCompleteDocumentText(data.legalComponents));
  });

  it('orders complete-document components deterministically regardless of input order', async () => {
    const data = createReaderData();
    const shuffled = { ...data, legalComponents: [...data.legalComponents].reverse() };
    await act(async () => {
      root?.render(
        <StudyDocumentPage
          data={shuffled}
          documentId="doc-reader"
          onSaveDocument={vi.fn()}
          onSaveUnit={vi.fn()}
          onCompleteReading={vi.fn()}
          onCreateUnitFromSelection={vi.fn()}
          onGenerateMissingStudyContent={vi.fn()}
          onAcknowledgeSourceReview={vi.fn()}
          onSelectDocument={vi.fn()}
          onNavigate={vi.fn()}
          onPreviewUnit={vi.fn()}
        />,
      );
    });

    const headings = Array.from(document.getElementById('complete-document')?.querySelectorAll('h4') ?? []).map(
      (entry) => entry.textContent,
    );
    expect(headings.length).toBeGreaterThanOrEqual(3);
    // Canonical order: section before schedule before form.
    expect(headings[0]).toContain('2');
    expect(headings[1]).toContain('SCHEDULE A');
    expect(headings[2]).toContain('FORM 1');
  });

  it('highlights query matches inside the structural complete view', async () => {
    await act(async () => {
      root?.render(
        <StudyDocumentPage
          data={createReaderData()}
          documentId="doc-reader"
          onSaveDocument={vi.fn()}
          onSaveUnit={vi.fn()}
          onCompleteReading={vi.fn()}
          onCreateUnitFromSelection={vi.fn()}
          onGenerateMissingStudyContent={vi.fn()}
          onAcknowledgeSourceReview={vi.fn()}
          onSelectDocument={vi.fn()}
          onNavigate={vi.fn()}
          onPreviewUnit={vi.fn()}
        />,
      );
    });

    const input = document.querySelector('input[placeholder="Search official text"]') as HTMLInputElement | null;
    expect(input).toBeTruthy();
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
      setter?.call(input, 'substantive');
      input?.dispatchEvent(new Event('input', { bubbles: true }));
    });

    const marks = Array.from(document.getElementById('complete-document')?.querySelectorAll('mark') ?? []);
    expect(marks.length).toBeGreaterThan(0);
    expect(marks.some((mark) => mark.textContent?.toLowerCase() === 'substantive')).toBe(true);
  });
});
