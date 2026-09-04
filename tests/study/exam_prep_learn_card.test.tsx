/** @vitest-environment jsdom */

// Exam Prep Learn source-link UX: large anchor lists preview the first chips
// with a component-local Show all / Show fewer toggle; every anchor stays
// individually openable and duplicates are never deduplicated. Plus the
// compact Learn legend.

import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ExamCurriculumSourceAnchor, ExamCurriculumUnit } from '../../src/study/examCurriculum/examCurriculumTypes';
import { LearnLegend } from '../../src/study/examPrep/components/ExamPrepLearn';
import {
  ExamUnitCard,
  SOURCE_ANCHOR_PREVIEW_LIMIT,
} from '../../src/study/examPrep/components/examUnitCard';

const renderIntoRoot = async (node: React.ReactNode, root: Root | null) => {
  await act(async () => {
    root?.render(node);
  });
};

const anchor = (
  sourceKey: string,
  documentId = 'doc-one',
): ExamCurriculumSourceAnchor => ({
  documentId,
  sourceKey,
  label: sourceKey.replace(/^section:/, 's.'),
  role: 'core_rule',
});

const makeUnit = (
  overrides: Partial<ExamCurriculumUnit> = {},
): ExamCurriculumUnit => ({
  id: 'TEST-01',
  unitType: 'core_concept',
  tier: 'A',
  title: 'Test unit',
  sourceDocumentIds: ['doc-one'],
  sourceAnchors: [],
  learningDepths: ['recognize', 'recall'],
  examGoal: 'Test goal.',
  recognitionCues: [],
  coreUnderstanding: [],
  mustRecall: [],
  mustLocate: [],
  relatedUnitIds: [],
  reviewWeight: 'medium',
  status: 'reviewed',
  ...overrides,
});

const openButtons = (): HTMLButtonElement[] =>
  Array.from(document.querySelectorAll<HTMLButtonElement>('button[title^="Open "]'));

const click = (button: HTMLButtonElement): Promise<void> =>
  act(async () => {
    button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });

describe('ExamUnitCard source anchors', () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    root?.unmount();
    container?.remove();
    root = null;
    container = null;
  });

  it('renders every anchor openable without a Show-all toggle when at or under the preview limit', async () => {
    const onOpenProvision = vi.fn();
    const unit = makeUnit({ sourceAnchors: [anchor('section:1'), anchor('section:2'), anchor('section:3')] });
    await renderIntoRoot(
      <ExamUnitCard unit={unit} onOpenProvision={onOpenProvision} />,
      root,
    );

    expect(openButtons()).toHaveLength(3);
    expect(document.body.textContent).not.toContain('Show all');
    await click(openButtons()[1]!);
    expect(onOpenProvision).toHaveBeenCalledWith('doc-one', 'section:2');
  });

  it('previews the first anchors, then expands to every anchor with Show fewer', async () => {
    const onOpenProvision = vi.fn();
    const anchors = Array.from({ length: SOURCE_ANCHOR_PREVIEW_LIMIT + 2 }, (_, index) =>
      anchor(`section:${index + 1}`),
    );
    const unit = makeUnit({ sourceAnchors: anchors });
    await renderIntoRoot(<ExamUnitCard unit={unit} onOpenProvision={onOpenProvision} />, root);

    expect(openButtons()).toHaveLength(SOURCE_ANCHOR_PREVIEW_LIMIT);
    const showAll = Array.from(document.querySelectorAll('button')).find((button) =>
      button.textContent?.includes(`Show all ${anchors.length} anchors`),
    );
    expect(showAll).toBeTruthy();
    expect(showAll?.getAttribute('aria-expanded')).toBe('false');
    expect(document.body.textContent).not.toContain('Show fewer');

    await click(showAll!);
    expect(openButtons()).toHaveLength(anchors.length);
    expect(showAll?.getAttribute('aria-expanded')).toBe('true');
    expect(document.body.textContent).toContain('Show fewer');

    // Every anchor, including the ones beyond the preview, opens its provision.
    await click(openButtons().at(-1)!);
    expect(onOpenProvision).toHaveBeenLastCalledWith(
      'doc-one',
      `section:${anchors.length}`,
    );

    const showFewer = Array.from(document.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('Show fewer'),
    );
    await click(showFewer!);
    expect(openButtons()).toHaveLength(SOURCE_ANCHOR_PREVIEW_LIMIT);
  });

  it('keeps duplicate (document, sourceKey) anchors without deduplication', async () => {
    const onOpenProvision = vi.fn();
    // One anchor repeated twice among otherwise unique anchors.
    const unique = Array.from({ length: SOURCE_ANCHOR_PREVIEW_LIMIT + 1 }, (_, index) =>
      anchor(`section:${index + 1}`),
    );
    const duplicated = { ...unique[0]! };
    const unit = makeUnit({ sourceAnchors: [...unique, duplicated] });
    await renderIntoRoot(<ExamUnitCard unit={unit} onOpenProvision={onOpenProvision} />, root);

    const showAll = Array.from(document.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('Show all'),
    );
    expect(showAll).toBeTruthy();
    await click(showAll!);

    // 13 unique + 1 duplicate => every entry still renders (no dedup).
    expect(openButtons()).toHaveLength(unique.length + 1);
    expect(document.body.textContent).toContain(`Supporting sources (${unique.length + 1})`);
  });

  it('lists source documents under the chips once the full anchor set is shown for multi-document units', async () => {
    const onOpenProvision = vi.fn();
    const anchors = Array.from({ length: SOURCE_ANCHOR_PREVIEW_LIMIT + 1 }, (_, index) =>
      index % 2 === 0 ? anchor(`section:${index + 1}`, 'doc-one') : anchor(`section:${index + 1}`, 'doc-two'),
    );
    const unit = makeUnit({
      sourceDocumentIds: ['doc-one', 'doc-two'],
      sourceAnchors: anchors,
    });
    await renderIntoRoot(<ExamUnitCard unit={unit} onOpenProvision={onOpenProvision} />, root);

    expect(openButtons()).toHaveLength(SOURCE_ANCHOR_PREVIEW_LIMIT);
    const showAll = Array.from(document.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('Show all'),
    );
    await click(showAll!);
    expect(document.body.textContent).toContain('doc-one · doc-two');
  });
});

describe('ExamPrepLearn compact legend', () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    root?.unmount();
    container?.remove();
    root = null;
    container = null;
  });

  it('explains the card colours, source chips and badges', async () => {
    await renderIntoRoot(<LearnLegend />, root);
    const text = document.body.textContent ?? '';
    expect(text).toContain('Remember — recall from memory');
    expect(text).toContain('Look here — provisions to practise locating');
    expect(text).toContain('Supporting sources ground the whole unit; chips open provisions');
    expect(text).toContain('Studied toggle tracks unit progress');
  });
});
