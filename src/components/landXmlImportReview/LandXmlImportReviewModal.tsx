import React, { useEffect, useMemo, useState } from 'react';
import type { LandXmlImportReviewSelection, LandXmlImportStagedState } from './landXmlImportReview.types';
import {
  buildLandXmlImportCommitPayload,
  countLandXmlImportSelection,
  createLandXmlImportReviewSelection,
  toggleLandXmlImportAlignment,
  toggleLandXmlImportPoints,
  toggleLandXmlImportSurface,
} from './landXmlImportReview.selection';
import { LandXmlImportReviewSummary } from './LandXmlImportReviewSummary';
import { LandXmlImportReviewObjects } from './LandXmlImportReviewObjects';
import { LandXmlImportReviewIssues } from './LandXmlImportReviewIssues';

export interface LandXmlImportReviewModalProps {
  staged: LandXmlImportStagedState;
  onChangeSelection: (_selection: LandXmlImportReviewSelection) => void;
  /** Cancel/close: workspace drops the staged preview, never mutates the drawing. */
  onCancel: () => void;
  /**
   * Worker-3 seam: receives the exact commit payload. This UI never mutates
   * the drawing; the workspace handler routes it through history + surface
   * builds (TODO seam named in SurveyCadWorkspace).
   */
  onImportSelected: (_payload: ReturnType<typeof buildLandXmlImportCommitPayload>) => void;
}

/**
 * Phase 18M — dense, professional LandXML Import Review. Staged-only: the
 * panel reads a preview and reports a selection; nothing here touches the
 * drawing, history, or the surface cache.
 */
export const LandXmlImportReviewModal = ({
  staged,
  onChangeSelection,
  onCancel,
  onImportSelected,
}: LandXmlImportReviewModalProps): React.JSX.Element => {
  // Double-click safety: one commit request per staged preview. Worker 3
  // controls the real async commit; a new preview/selection re-arms it.
  const [commitRequested, setCommitRequested] = useState(false);
  useEffect(() => {
    setCommitRequested(false);
  }, [staged]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onCancel();
      }
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
  }, [onCancel]);

  const selectedCount = useMemo(
    () => countLandXmlImportSelection(staged.preview, staged.selection),
    [staged.preview, staged.selection],
  );
  const canImport = selectedCount > 0 && !commitRequested;

  const handleImport = (): void => {
    if (!canImport) return;
    setCommitRequested(true);
    onImportSelected(buildLandXmlImportCommitPayload(staged));
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="LandXML Import Review"
      className="absolute inset-0 z-40 flex items-start justify-center bg-slate-950/70 p-4"
      data-landxml-import-review
    >
      <section className="mt-8 max-h-[85%] w-[720px] overflow-auto rounded border border-slate-600 bg-slate-900 p-3 text-slate-100 shadow-xl">
        <header className="mb-2 flex items-center justify-between gap-2">
          <h2 className="text-[13px] font-semibold">Import LandXML — Review</h2>
          <button
            type="button"
            className="rounded border border-slate-600 px-2 py-1 text-[12px] hover:bg-slate-800"
            onClick={onCancel}
            data-landxml-import-cancel
          >
            Cancel
          </button>
        </header>

        <LandXmlImportReviewSummary
          fileName={staged.fileName}
          version={staged.version}
          units={staged.preview.units}
          crs={staged.preview.crs}
          preview={staged.preview}
        />
        <LandXmlImportReviewObjects
          preview={staged.preview}
          selection={staged.selection}
          onTogglePoints={() => onChangeSelection(toggleLandXmlImportPoints(staged.selection))}
          onToggleAlignment={(name) =>
            onChangeSelection(toggleLandXmlImportAlignment(staged.selection, staged.preview, name))}
          onToggleSurface={(name) =>
            onChangeSelection(toggleLandXmlImportSurface(staged.selection, staged.preview, name))}
        />
        <LandXmlImportReviewIssues preview={staged.preview} />

        <footer className="mt-3 flex items-center justify-between gap-2 border-t border-slate-700 pt-2">
          <button
            type="button"
            className="rounded border border-slate-600 px-2 py-1 text-[12px] hover:bg-slate-800"
            onClick={() => onChangeSelection(createLandXmlImportReviewSelection(staged.preview))}
          >
            Select all importable
          </button>
          <div className="flex items-center gap-2">
            <span className="text-[12px] text-slate-400">{`${selectedCount} selected`}</span>
            <button
              type="button"
              className="rounded border border-sky-500 bg-sky-950 px-3 py-1 text-[12px] text-sky-100 hover:bg-sky-900 disabled:cursor-not-allowed disabled:opacity-40"
              disabled={!canImport}
              onClick={handleImport}
              data-landxml-import-selected
            >
              {`Import Selected (${selectedCount})`}
            </button>
          </div>
        </footer>
      </section>
    </div>
  );
};
