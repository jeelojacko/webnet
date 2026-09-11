/** @vitest-environment jsdom */

import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import StudyDocumentPage from '../src/components/StudyDocumentPage';
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
});
