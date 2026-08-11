/** @vitest-environment jsdom */

import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import StudyLayout from '../../src/study/components/StudyLayout';
import StudyManagePage from '../../src/study/components/StudyManagePage';
import StudyPreviewPage from '../../src/study/components/StudyPreviewPage';
import StudyRubricEditor from '../../src/study/components/StudyRubricEditor';
import StudySessionPage from '../../src/study/components/StudySessionPage';
import StudyUnitEditorPage from '../../src/study/components/StudyUnitEditorPage';
import { createSeedStudyData } from '../../src/study/studySeed';
import type { StudyDataSnapshot, StudySessionItem } from '../../src/study/studyTypes';

const renderIntoRoot = async (node: React.ReactNode, root: Root | null) => {
  await act(async () => {
    root?.render(node);
  });
};

const input = (label: string): HTMLTextAreaElement | HTMLInputElement => {
  const element = Array.from(document.querySelectorAll('textarea,input')).find((entry) => entry.closest('label')?.textContent?.includes(label));
  expect(element).toBeTruthy();
  return element as HTMLTextAreaElement | HTMLInputElement;
};

const sessionItemFromSeed = (data: StudyDataSnapshot): StudySessionItem => ({
  unit: data.units[0],
  prompt: data.prompts[0],
  progress: data.progress[0],
  concepts: data.concepts.filter((concept) => concept.unitId === data.units[0].id),
  rubrics: data.rubrics.filter((rubric) => rubric.unitId === data.units[0].id),
  due: true,
});

describe('study phase 2E UI', () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
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

  it('renders collapsed sidebar entries as icon buttons and toggles persistence callback', async () => {
    const onCollapsed = vi.fn();
    await renderIntoRoot(
      <StudyLayout activePath="/study/library" sidebarCollapsed onSidebarCollapsedChange={onCollapsed} onNavigate={vi.fn()}>
        <div>Content</div>
      </StudyLayout>,
      root,
    );

    const library = document.querySelector('nav button[aria-label="Library"]');
    expect(library?.getAttribute('aria-current')).toBe('page');
    expect(library?.textContent).not.toContain('Library');
    expect(library?.getAttribute('title')).toBe('Library');

    const expand = document.querySelector('button[aria-label="Expand Study sidebar"]');
    await act(async () => {
      expand?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(onCollapsed).toHaveBeenCalledWith(false);
  });

  it('lets preview responses reveal rubric coverage without mutating the snapshot', async () => {
    const data: StudyDataSnapshot = createSeedStudyData('2026-08-05T10:00:00.000Z');
    data.units[0] = { ...data.units[0], responseModeOverride: 'guided' };
    const before = JSON.stringify(data);
    const onNavigate = vi.fn();
    await renderIntoRoot(<StudyPreviewPage data={data} unitId={data.units[0].id} onNavigate={onNavigate} />, root);

    const firstGuidedBox = input(data.rubrics[0].prompt);
    await act(async () => {
      firstGuidedBox.value = 'Preview answer';
      firstGuidedBox.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const reveal = Array.from(document.querySelectorAll('button')).find((button) => button.textContent === 'Reveal');
    await act(async () => {
      reveal?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    const covered = Array.from(document.querySelectorAll('button')).find((button) => button.textContent === 'Covered');
    await act(async () => {
      covered?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(document.body.textContent).toContain('Preview mode - progress and review history will not be changed.');
    expect(document.body.textContent).not.toContain('Good');
    expect(JSON.stringify(data)).toBe(before);

    const closePreview = Array.from(document.querySelectorAll('button')).find((button) => button.textContent === 'Close Preview');
    await act(async () => {
      closePreview?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(onNavigate).toHaveBeenCalledWith('/study/library?tab=units');
  });

  it('acknowledges source review from the unit editor without saving authoring changes', async () => {
    const data: StudyDataSnapshot = createSeedStudyData('2026-08-05T10:00:00.000Z');
    data.units[0] = { ...data.units[0], sourceReviewRequired: true };
    const acknowledged = {
      ...data.units[0],
      sourceReviewRequired: false,
      sourceReviewAcknowledgedAt: '2026-08-05T11:00:00.000Z',
    };
    const onSave = vi.fn(async () => {});
    const onAcknowledgeSourceReview = vi.fn(async () => acknowledged);
    await renderIntoRoot(
      <StudyUnitEditorPage data={data} unitId={data.units[0].id} onSave={onSave} onAcknowledgeSourceReview={onAcknowledgeSourceReview} onNavigate={vi.fn()} />,
      root,
    );

    const acknowledge = Array.from(document.querySelectorAll('button')).find((button) => button.textContent === 'Acknowledge reviewed source');
    await act(async () => {
      acknowledge?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(onAcknowledgeSourceReview).toHaveBeenCalledWith(data.units[0].id);
    expect(onSave).not.toHaveBeenCalled();
    expect(document.body.textContent).not.toContain('Source review is required.');
  });

  it('renders guided mode with required rubric textboxes and no monolithic textbox', async () => {
    const data: StudyDataSnapshot = createSeedStudyData('2026-08-05T10:00:00.000Z');
    await renderIntoRoot(
      <StudySessionPage
        activeItem={sessionItemFromSeed(data)}
        answer=""
        onAnswerChange={vi.fn()}
        guidedResponses={{}}
        onGuidedResponsesChange={vi.fn()}
        responseMode="guided"
        revealed={false}
        onRevealChange={vi.fn()}
        coveredConceptIds={[]}
        onToggleConcept={vi.fn()}
        rubricCoverage={[]}
        onRubricCoverageChange={vi.fn()}
        onRate={vi.fn()}
      />,
      root,
    );

    const textareas = Array.from(document.querySelectorAll('textarea'));
    expect(textareas).toHaveLength(data.rubrics.filter((rubric) => rubric.unitId === data.units[0].id && rubric.required).length);
    expect(document.body.textContent).not.toContain('Typed Recall');
  });

  it('keeps free-recall monolithic textbox and hybrid guided prompts', async () => {
    const data: StudyDataSnapshot = createSeedStudyData('2026-08-05T10:00:00.000Z');
    const baseProps = {
      activeItem: sessionItemFromSeed(data),
      answer: '',
      onAnswerChange: vi.fn(),
      guidedResponses: {},
      onGuidedResponsesChange: vi.fn(),
      revealed: false,
      onRevealChange: vi.fn(),
      coveredConceptIds: [],
      onToggleConcept: vi.fn(),
      rubricCoverage: [],
      onRubricCoverageChange: vi.fn(),
      onRate: vi.fn(),
    };
    await renderIntoRoot(<StudySessionPage {...baseProps} responseMode="free-recall" />, root);
    expect(document.body.textContent).toContain('Typed Recall');
    expect(document.body.textContent).not.toContain('Guided Prompts');

    await renderIntoRoot(<StudySessionPage {...baseProps} responseMode="hybrid" />, root);
    expect(document.body.textContent).toContain('Typed Recall');
    expect(document.body.textContent).toContain('Guided Prompts');
  });

  it('reveals each guided response with the matching rubric item', async () => {
    const data: StudyDataSnapshot = createSeedStudyData('2026-08-05T10:00:00.000Z');
    const item = sessionItemFromSeed(data);
    await renderIntoRoot(
      <StudySessionPage
        activeItem={item}
        answer=""
        onAnswerChange={vi.fn()}
        guidedResponses={{ [item.rubrics[0].id]: 'Matched guided answer' }}
        onGuidedResponsesChange={vi.fn()}
        responseMode="guided"
        revealed
        onRevealChange={vi.fn()}
        coveredConceptIds={[]}
        onToggleConcept={vi.fn()}
        rubricCoverage={[]}
        onRubricCoverageChange={vi.fn()}
        onRate={vi.fn()}
      />,
      root,
    );

    expect(document.body.textContent).toContain(item.rubrics[0].prompt);
    expect(document.body.textContent).toContain('Matched guided answer');
    expect(document.body.textContent).toContain(item.rubrics[0].referenceAnswer);
  });

  it('renders rubric question on its own row with a title tooltip', async () => {
    const data: StudyDataSnapshot = createSeedStudyData('2026-08-05T10:00:00.000Z');
    await renderIntoRoot(
      <StudyRubricEditor
        unitId={data.units[0].id}
        unitType="section"
        generatedStateLabel="generated"
        rubrics={data.rubrics.slice(0, 1)}
        sourceComponents={[]}
        onRubricsChange={vi.fn()}
      />,
      root,
    );

    const question = document.querySelector('input[aria-label="Rubric question"]');
    expect(question?.getAttribute('title')).toBe(data.rubrics[0].prompt);
    expect(question?.parentElement?.className).toContain('grid gap-2');
  });

  it('opens an in-app confirmation before deleting all manage data', async () => {
    const data: StudyDataSnapshot = createSeedStudyData('2026-08-05T10:00:00.000Z');
    const onDeleteAllData = vi.fn(async () => {});
    await renderIntoRoot(
      <StudyManagePage
        data={data}
        exportText="{}"
        importText=""
        onImportTextChange={vi.fn()}
        onImport={vi.fn()}
        onDeleteAllData={onDeleteAllData}
        officialPackageText=""
        onOfficialPackageTextChange={vi.fn()}
        officialPackagePreview={null}
        onPreviewOfficialPackage={vi.fn()}
        onImportOfficialPackage={vi.fn()}
        statusMessage=""
      />,
      root,
    );

    const deleteButton = Array.from(document.querySelectorAll('button')).find((button) => button.textContent === 'Delete All Data');
    await act(async () => {
      deleteButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(document.body.textContent).toContain('Delete all Study data?');
    expect(onDeleteAllData).not.toHaveBeenCalled();

    const confirmButton = Array.from(document.querySelectorAll('button')).find((button) => button.textContent === 'Confirm Delete All Data');
    await act(async () => {
      confirmButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(onDeleteAllData).toHaveBeenCalledTimes(1);
  });
});
