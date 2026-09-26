/** @vitest-environment jsdom */

/**
 * Phase 19B Round 3F — draft-only history routing (architecture audit §1.7).
 *
 * The model-space DraftingPanel edits title-block templates. Before Round 3F
 * that routed through replaceCadProject and wiped the model undo/redo stacks.
 * This test pins the two required contracts:
 *   1. a title-block edit never clears/pushes model history;
 *   2. the edit lands in the Draft history, so sheet-space Ctrl+Z (= the
 *      shell sheetHist.undo) reverses the title edit, not the model Line.
 */

import React, { act, useCallback, useEffect, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import SurveyCadWorkspace from '../src/components/SurveyCadWorkspace';
import { createCadShellLink, type CadShellLink } from '../src/cad-app/shell/cadShellLink';
import {
  useDraftSheetHistory,
  type DraftSheetHistoryController,
} from '../src/cad-app/shell/useDraftSheetHistory';
import { addSheetToDraft, createPlanSheet, createTitleBlockTemplate } from '../src/engine/cad/cadSheets';
import { createBlankCadDrawingDocument } from '../src/engine/cad/cadDrawingFile';
import type { CadDrawingDocument, CadEntity } from '../src/engine/cad/cadTypes';
import type { DraftDocument } from '../src/engine/cad/cadDraftTypes';

const buildDrawing = (): CadDrawingDocument => {
  const base = createBlankCadDrawingDocument({ name: 'History fixture', units: 'm' });
  const line: CadEntity = {
    type: 'line',
    id: 'line-history',
    layerId: 'parcels',
    visible: true,
    locked: false,
    fromStationId: 'A',
    toStationId: 'B',
    fromX: 0,
    fromY: 0,
    toX: 100,
    toY: 0,
    sourceObservationIds: [],
  };
  const draft: DraftDocument = addSheetToDraft(
    { ...base.draft!, titleBlockDefinitions: [createTitleBlockTemplate('Seed block')] },
    createPlanSheet({ name: 'L1' }),
  );
  return {
    ...base,
    project: {
      ...base.project,
      entities: [line],
      bounds: { minX: 0, minY: 0, maxX: 100, maxY: 0 },
    },
    draft,
  };
};

const linkRef: { current: CadShellLink | null } = { current: null };
const sheetRef: { current: DraftSheetHistoryController | null } = { current: null };
const drawingRef: { current: CadDrawingDocument | null } = { current: null };

/** Mirrors the shell's wiring: draft commits go through useDraftSheetHistory. */
const Harness = ({ initial }: { initial: CadDrawingDocument }): React.JSX.Element => {
  const [drawing, setDrawing] = useState<CadDrawingDocument | null>(initial);
  const publishDraft = useCallback((next: DraftDocument) => {
    setDrawing((previous) => (previous ? { ...previous, draft: next } : previous));
  }, []);
  const sheetHist = useDraftSheetHistory(drawing?.draft, publishDraft);
  const link = linkRef.current as CadShellLink;
  useEffect(() => {
    link.requestDraftCommit = (next) => sheetHist.commit(next);
    return () => {
      link.requestDraftCommit = null;
    };
  }, [link, sheetHist]);
  useEffect(() => {
    sheetRef.current = sheetHist;
  }, [sheetHist]);
  useEffect(() => {
    drawingRef.current = drawing;
  }, [drawing]);
  return (
    <SurveyCadWorkspace
      drawing={drawing}
      onDrawingChange={setDrawing}
      units="m"
      result={null}
      shellLink={link}
      shellChrome
    />
  );
};

const clickByAria = async (container: HTMLElement, ariaLabel: string): Promise<void> => {
  const target = container.querySelector(`[aria-label="${ariaLabel}"]`) as HTMLElement | null;
  expect(target).not.toBeNull();
  await act(async () => {
    target!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
};

describe('19B Round 3F draft-only history routing', () => {
  let container: HTMLDivElement;
  let root: Root | null = null;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    act(() => {
      root?.unmount();
    });
    root = null;
    container.remove();
    linkRef.current = null;
    sheetRef.current = null;
    drawingRef.current = null;
  });

  it('a title-block edit preserves model history and is undone by sheet-space Undo', async () => {
    const link = createCadShellLink();
    linkRef.current = link;
    root = createRoot(container);
    await act(async () => {
      root!.render(<Harness initial={buildDrawing()} />);
    });
    expect(drawingRef.current?.project.entities).toHaveLength(1);

    // Model transaction: erase the seeded Line through the real shell actions.
    await act(async () => {
      link.actions!.selectAll();
    });
    await act(async () => {
      link.actions!.eraseSelection();
    });
    const afterErase = link.getSnapshot();
    expect(afterErase?.canUndo).toBe(true);
    expect(afterErase?.historyDepth ?? 0).toBeGreaterThan(0);
    const modelDepth = afterErase?.historyDepth ?? 0;
    expect(drawingRef.current?.project.entities).toHaveLength(0);

    // Draft-only edit through the production DraftingPanel title-block editor.
    await act(async () => {
      link.actions!.toggleDraftingPanel();
    });
    const titleTab = [...container.querySelectorAll('[role="tab"]')].find(
      (element) => element.textContent === 'Title Blocks',
    ) as HTMLElement | undefined;
    expect(titleTab).toBeDefined();
    await act(async () => {
      titleTab!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    // The panel edits the drawing's draft only if the engine sees the new
    // definition; capture the pre-edit count for the post-undo assertion.
    const templatesBefore = drawingRef.current?.draft?.titleBlockDefinitions.length ?? 0;
    await clickByAria(container, 'New title block');
    expect(drawingRef.current?.draft?.titleBlockDefinitions.length).toBe(templatesBefore + 1);

    // (1) Model history is untouched — no replaceCadProject, no wipe.
    const afterDraft = link.getSnapshot();
    expect(afterDraft?.canUndo).toBe(true);
    expect(afterDraft?.historyDepth).toBe(modelDepth);

    // (2) The edit is one Draft-history transaction.
    expect(sheetRef.current?.canUndo).toBe(true);
    expect(sheetRef.current?.depth).toBe(1);
    expect(drawingRef.current?.project.entities).toHaveLength(0);

    // Sheet-space Ctrl+Z (= shell sheetHist.undo) reverses the title edit.
    await act(async () => {
      sheetRef.current!.undo();
    });
    expect(drawingRef.current?.draft?.titleBlockDefinitions.length).toBe(templatesBefore);
    expect(sheetRef.current?.canUndo).toBe(false);
    // The Line stays erased: sheet Undo never reached model history.
    expect(drawingRef.current?.project.entities).toHaveLength(0);
    expect(link.getSnapshot()?.historyDepth).toBe(modelDepth);
  });
});
