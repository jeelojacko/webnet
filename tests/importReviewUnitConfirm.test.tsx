/** @vitest-environment jsdom */

/**
 * Phase 17C reviewer-fix pass (L1, L4): unit confirmation in the import-review
 * modal fails closed. Legacy staged sources without retained raw text are
 * never labelled user-confirmed (re-select required); reparse failures
 * surface a visible message and keep commit blocked.
 */
import { act, useRef, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { describe, expect, it } from 'vitest';

import { importExternalInput } from '../src/engine/importers';
import { buildImportConflictResolutionDefaults, type ImportConflict } from '../src/engine/importConflictReview';
import { useImportReviewApplyActions } from '../src/hooks/useImportReviewApplyActions';
import {
  buildDefaultConflictRenameValues,
  buildWorkspaceFromSources,
  createImportReviewSource,
  type FilePickerMode,
  type ImportReviewState,
} from '../src/hooks/useImportReviewWorkflowTypes';
import type { ParseSettings } from '../src/appStateTypes';
import type { CoordMode, InstrumentLibrary } from '../src/types';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const CSV = 'ID,Northing,Easting,Elevation\nA,100,200,10\n';

const buildState = (rawText: string | undefined): ImportReviewState => {
  const imported = importExternalInput(CSV, 'points.csv');
  if (!imported.detected || !imported.dataset || !imported.notice) throw new Error('fixture failed');
  const source = createImportReviewSource(
    'source:0',
    'points.csv',
    imported.notice,
    imported.dataset,
    true,
    rawText,
  );
  const workspace = buildWorkspaceFromSources([source]);
  const conflicts: ImportConflict[] = [];
  const groupLabels: Record<string, string> = {};
  const groupComments: Record<string, string> = {};
  workspace.reviewModel.groups.forEach((group) => {
    groupLabels[group.key] = group.label;
    groupComments[group.key] = group.defaultComment;
  });
  return {
    sourceName: 'points.csv',
    notice: imported.notice,
    sources: [source],
    dataset: workspace.dataset,
    reviewModel: workspace.reviewModel,
    comparisonSummary: null,
    comparisonMode: 'non-mta-only',
    excludedItemIds: new Set(),
    fixedItemIds: new Set(),
    groupLabels,
    groupComments,
    rowOverrides: {},
    rowTypeOverrides: {},
    preset: 'clean-webnet',
    importFaceNormalizationMode: 'on',
    importStyle: 'generic',
    stagedAssociatedSettings: null,
    force2DOutput: false,
    nextSyntheticId: 1,
    nextSourceId: 1,
    conflicts,
    conflictResolutions: buildImportConflictResolutionDefaults(conflicts),
    conflictRenameValues: buildDefaultConflictRenameValues(conflicts),
    resolutionValidationMessage: null,
  };
};

const Harness = ({ initial }: { initial: ImportReviewState }) => {
  const [state, setState] = useState<ImportReviewState | null>(initial);
  const filePickerModeRef = useRef<FilePickerMode>('replace');
  const actions = useImportReviewApplyActions({
    importReviewState: state,
    setImportReviewState: setState,
    setPendingAnglePromptFile: () => {},
    filePickerModeRef,
    triggerFileSelect: () => {},
    buildImportConflicts: () => [],
    currentInput: '',
    currentIncludeFiles: {},
    parseSettings: {} as ParseSettings,
    projectInstruments: {} as InstrumentLibrary,
    coordMode: '3D' as CoordMode,
    setInput: () => {},
    setProjectIncludeFiles: () => {},
    setImportNotice: () => {},
    resetWorkspaceForImportedInput: () => {},
  });
  return (
    <>
      <button type="button" onClick={() => actions.handleConfirmSourceUnits('source:0', 'ft')}>
        confirm-ft
      </button>
      <span data-testid="msg">{state?.resolutionValidationMessage ?? ''}</span>
      <span data-testid="origin">{state?.sources[0]?.dataset.sourceUnits?.origin ?? ''}</span>
      <span data-testid="blocked">{String(state?.sources[0]?.dataset.needsUnitConfirmation)}</span>
    </>
  );
};

const mount = (initial: ImportReviewState) => {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root: Root = createRoot(container);
  act(() => {
    root.render(<Harness initial={initial} />);
  });
  const text = (testId: string): string =>
    container.querySelector(`[data-testid="${testId}"]`)?.textContent ?? '';
  const confirm = async (): Promise<void> => {
    await act(async () => {
      container.querySelector<HTMLButtonElement>('button')!.click();
      await Promise.resolve();
    });
  };
  return {
    text,
    confirm,
    cleanup: () => {
      act(() => root.unmount());
      container.remove();
    },
  };
};

describe('import-review unit confirmation fail-closed', () => {
  it('L1: legacy source without raw text is never labelled confirmed; re-select required', async () => {
    const harness = mount(buildState(undefined));
    try {
      await harness.confirm();
      expect(harness.text('msg')).toMatch(/Re-select the file|re-select/i);
      expect(harness.text('origin')).toBe('unknown-legacy');
      expect(harness.text('blocked')).toBe('true');
    } finally {
      harness.cleanup();
    }
  });

  it('L4: unreparsable retained text surfaces a message and stays blocked', async () => {
    const harness = mount(buildState('this is not an importable dataset'));
    try {
      await harness.confirm();
      expect(harness.text('msg')).not.toBe('');
      expect(harness.text('origin')).toBe('unknown-legacy');
      expect(harness.text('blocked')).toBe('true');
    } finally {
      harness.cleanup();
    }
  });

  it('confirming with retained raw text still labels user-confirmed and unblocks', async () => {
    const harness = mount(buildState(CSV));
    try {
      await harness.confirm();
      expect(harness.text('msg')).toBe('');
      expect(harness.text('origin')).toBe('user-confirmed');
      expect(harness.text('blocked')).toBe('false');
    } finally {
      harness.cleanup();
    }
  });
});
