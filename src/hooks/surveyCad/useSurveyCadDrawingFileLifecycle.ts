/**
 * STRUCT-194.3 — drawing file lifecycle (New / Open / Save / Import-adjusted).
 *
 * Extracted verbatim from `SurveyCadWorkspace` with no behavior change:
 *   - New: blank drawing in the current units + `cad-created` lifecycle event.
 *   - Save: `buildCadDrawingFileName` / `serializeCadDrawingFile` /
 *     `saveBrowserTextFile` with `CAD_DRAWING_FILE_TYPES`; status + `cad-saved`
 *     only when the write actually succeeded.
 *   - Open: MAX_CAD_DRAWING_TEXT_BYTES size check first, then read + parse;
 *     parse errors surface as status text; success replaces the drawing and
 *     emits `cad-opened`.
 *   - Import-adjusted: explicit bridge snapshot precedence
 *     (`importSnapshotIntoCadDrawing`), then the legacy gate
 *     `result != null && canFeedDraftingFromResult && resultDependencyIdentity`
 *     with the exact stale/blocked wording.
 *
 * `replaceActiveDrawing` preserves the exact emission order:
 * `emitDrawingChange` -> `replaceCadProject` -> `setFileStatusText`.
 *
 * The hook is called once, unconditionally, at the former handler position, so
 * the current `activeDrawing` / `emitDrawingChange` / `replaceCadProject`
 * closures are captured on the render that produced them (fresh each render).
 */
import type { ChangeEvent, Dispatch, SetStateAction } from 'react';
import {
  assertBrowserFileSize,
  readBrowserFileAsText,
  saveBrowserTextFile,
} from '../../engine/browserFileIo';
import {
  buildCadDrawingFileName,
  createBlankCadDrawingDocument,
  MAX_CAD_DRAWING_TEXT_BYTES,
  parseCadDrawingFile,
  serializeCadDrawingFile,
} from '../../engine/cad/cadDrawingFile';
import { importAdjustedPointsIntoCadDrawing } from '../../engine/cad/cadAdjustedPointsImport';
import { importSnapshotIntoCadDrawing } from '../../cad-app/cadSnapshotImport';
import type { CadDrawingLifecycleEvent } from '../../cad-app/cadAppTypes';
import type { AdjustmentSourceSnapshot } from '../../cad-app/cadSourceBridge';
import type { ResultDependencyIdentity } from '../../engine/resultIntegrity';
import type { CadDrawingDocument, CadProject } from '../../engine/cad/cadTypes';
import type { AdjustmentResult, UnitsMode } from '../../types';

const CAD_DRAWING_FILE_TYPES = [
  {
    description: 'WebNet CAD Drawing',
    accept: {
      'application/json': ['.wncad', '.json'],
    },
  },
];

export interface SurveyCadDrawingFileLifecycleArgs {
  activeDrawing: CadDrawingDocument;
  emitDrawingChange: Dispatch<SetStateAction<CadDrawingDocument | null>>;
  replaceCadProject: (_project: CadProject, _statusText?: string) => void;
  units: UnitsMode;
  onDrawingLifecycle?: (_event: CadDrawingLifecycleEvent, _fileName: string | null) => void;
  adjustmentSnapshot?: AdjustmentSourceSnapshot | null;
  result?: AdjustmentResult | null;
  canFeedDraftingFromResult?: boolean;
  resultDependencyIdentity?: ResultDependencyIdentity | null;
  setFileStatusText: (_text: string) => void;
}

export interface SurveyCadDrawingFileLifecycle {
  /** Replace the active drawing and status: emit -> replace project -> status. */
  replaceActiveDrawing: (_nextDrawing: CadDrawingDocument, _statusText: string) => void;
  handleNewDrawing: () => void;
  handleSaveDrawing: () => Promise<void>;
  handleOpenDrawingChange: (_event: ChangeEvent<HTMLInputElement>) => Promise<void>;
  /** True when an adjustment source may feed the drawing (bridge or live). */
  hasAdjustmentSource: boolean;
  handleImportAdjustedPoints: () => void;
}

export const useSurveyCadDrawingFileLifecycle = ({
  activeDrawing,
  emitDrawingChange,
  replaceCadProject,
  units,
  onDrawingLifecycle,
  adjustmentSnapshot = null,
  result = null,
  canFeedDraftingFromResult = false,
  resultDependencyIdentity = null,
  setFileStatusText,
}: SurveyCadDrawingFileLifecycleArgs): SurveyCadDrawingFileLifecycle => {
  const replaceActiveDrawing = (nextDrawing: CadDrawingDocument, statusText: string): void => {
    emitDrawingChange(nextDrawing);
    replaceCadProject(nextDrawing.project, statusText);
    setFileStatusText(statusText);
  };

  const handleNewDrawing = (): void => {
    replaceActiveDrawing(
      createBlankCadDrawingDocument({ units }),
      'New CAD drawing created.',
    );
    onDrawingLifecycle?.('cad-created', null);
  };

  const handleSaveDrawing = async (): Promise<void> => {
    const fileName = buildCadDrawingFileName(activeDrawing.name);
    const saved = await saveBrowserTextFile(
      fileName,
      serializeCadDrawingFile(activeDrawing),
      CAD_DRAWING_FILE_TYPES,
    );
    if (saved) {
      setFileStatusText(`Saved ${fileName}.`);
      onDrawingLifecycle?.('cad-saved', fileName);
    }
  };

  const handleOpenDrawingChange = async (event: ChangeEvent<HTMLInputElement>): Promise<void> => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try {
      assertBrowserFileSize(file, MAX_CAD_DRAWING_TEXT_BYTES, `${file.name} CAD drawing`);
      const rawText = await readBrowserFileAsText(file);
      const parsed = parseCadDrawingFile(rawText);
      if (!parsed.ok) {
        setFileStatusText(parsed.errors.join(' '));
        return;
      }
      replaceActiveDrawing(parsed.drawing, `Opened ${file.name}.`);
      onDrawingLifecycle?.('cad-opened', file.name);
    } catch (error) {
      setFileStatusText(error instanceof Error ? error.message : String(error));
    }
  };

  const hasAdjustmentSource =
    adjustmentSnapshot != null ||
    (result != null && canFeedDraftingFromResult && resultDependencyIdentity != null);

  const handleImportAdjustedPoints = (): void => {
    // Phase 18A: explicit bridge snapshot first (standalone CAD has no live result).
    if (adjustmentSnapshot) {
      const imported = importSnapshotIntoCadDrawing({
        document: activeDrawing,
        snapshot: adjustmentSnapshot,
      });
      if (!imported.ok) {
        setFileStatusText(imported.message);
        return;
      }
      replaceActiveDrawing(imported.drawing, 'Imported adjusted points.');
      return;
    }
    if (!result || !canFeedDraftingFromResult || !resultDependencyIdentity) {
      setFileStatusText(
        'Import blocked: the adjustment result is not current (stale, failed, or non-production run). Re-run the adjustment, then import again.',
      );
      return;
    }
    const nextDrawing = importAdjustedPointsIntoCadDrawing({
      document: activeDrawing,
      identity: resultDependencyIdentity,
      result,
      sourceName: 'Current adjustment',
    });
    replaceActiveDrawing(nextDrawing, 'Imported adjusted points.');
  };

  return {
    replaceActiveDrawing,
    handleNewDrawing,
    handleSaveDrawing,
    handleOpenDrawingChange,
    hasAdjustmentSource,
    handleImportAdjustedPoints,
  };
};
