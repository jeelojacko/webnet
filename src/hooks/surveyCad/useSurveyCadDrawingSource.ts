/**
 * STRUCT-194.1 — drawing source seam extracted from SurveyCadWorkspace.
 *
 * Owns the exact legacy drawing-source precedence:
 *   1. controlled `drawing` prop (never touched), else
 *   2. `persistedState` migrated to a drawing, else
 *   3. a spike project built from input/parseOptions (adjustment-backed only
 *      when `canFeedDraftingFromResult`), else
 *   4. a blank drawing.
 *
 * The fallback persisted-state setter (`emitDrawingChange`) maps
 * `CadDrawingDocument -> SurveyCadPersistedState` and strips the synthetic
 * `cad-drawing:` id prefix, preserving the original SetStateAction updater
 * semantics (previousLegacy -> previousDrawing, activeDrawing fallback,
 * null handling, and identity no-op).
 *
 * Behavior-preserving: memo deps, precedence, units/meters, CAD ids, and the
 * "no persisted setter on a controlled drawing" rule are unchanged from the
 * pre-extraction inline implementation.
 */
import { useMemo, type Dispatch, type SetStateAction } from 'react';
import { buildSurveyCadSpikeProject } from '../../engine/cad/cadModel';
import {
  createBlankCadDrawingDocument,
  migrateSurveyCadStateToDrawing,
} from '../../engine/cad/cadDrawingFile';
import type {
  CadBounds,
  CadDrawingDocument,
  SurveyCadPersistedState,
} from '../../engine/cad/cadTypes';
import type { ResultDependencyIdentity } from '../../engine/resultIntegrity';
import type { AdjustmentResult, InstrumentLibrary, ParseOptions, UnitsMode } from '../../types';

export interface SurveyCadDrawingSourceArgs {
  /** Controlled drawing. When supplied it wins over every legacy source. */
  drawing?: CadDrawingDocument | null;
  /** Controlled drawing setter. When supplied the persisted fallback is unused. */
  onDrawingChange?: Dispatch<SetStateAction<CadDrawingDocument | null>>;
  persistedState?: SurveyCadPersistedState | null;
  onPersistedStateChange?: Dispatch<SetStateAction<SurveyCadPersistedState | null>>;
  input: string;
  instrumentLibrary: InstrumentLibrary;
  parseOptions?: ParseOptions;
  units: UnitsMode;
  result?: AdjustmentResult | null;
  /** Result identity stamped onto adjustment-backed spike entities. */
  resultDependencyIdentity?: ResultDependencyIdentity | null;
  /** Fail-closed gate for feeding the current result into a new spike. */
  canFeedDraftingFromResult: boolean;
}

export interface SurveyCadDrawingSource {
  /** Drawing derived from the legacy persisted/spike/blank precedence. */
  legacyDrawing: CadDrawingDocument;
  /** Effective drawing: controlled prop when supplied, otherwise legacy. */
  activeDrawing: CadDrawingDocument;
  /** Controlled setter when supplied, otherwise the persisted-state fallback. */
  emitDrawingChange: Dispatch<SetStateAction<CadDrawingDocument | null>>;
}

/**
 * Copy the four bound fields only (never aliases the source object). Kept
 * here because it was part of the original drawing-source region; root still
 * needs it for viewport bounds and the surface prop.
 */
export const cloneCadBounds = (bounds: CadBounds | null): CadBounds | null =>
  bounds
    ? {
        minX: bounds.minX,
        minY: bounds.minY,
        maxX: bounds.maxX,
        maxY: bounds.maxY,
      }
    : null;

export const useSurveyCadDrawingSource = ({
  drawing = null,
  onDrawingChange,
  persistedState = null,
  onPersistedStateChange,
  input,
  instrumentLibrary,
  parseOptions,
  units,
  result = null,
  resultDependencyIdentity = null,
  canFeedDraftingFromResult,
}: SurveyCadDrawingSourceArgs): SurveyCadDrawingSource => {
  const legacyDrawing = useMemo<CadDrawingDocument>(() => {
    if (persistedState) {
      return migrateSurveyCadStateToDrawing({
        state: persistedState,
        units,
      });
    }
    if (parseOptions) {
      const project = buildSurveyCadSpikeProject({
        input,
        instrumentLibrary,
        parseOptions,
        units,
        result: canFeedDraftingFromResult ? result : null,
        resultDependencyIdentity,
      });
      const migrated = migrateSurveyCadStateToDrawing({
        state: {
          version: 1,
          sourceSignature: 'legacy',
          project,
        },
        name: project.name,
        units,
      });
      return migrated;
    }
    return createBlankCadDrawingDocument({ units });
  }, [canFeedDraftingFromResult, input, instrumentLibrary, parseOptions, persistedState, result, resultDependencyIdentity, units]);

  const activeDrawing = drawing ?? legacyDrawing;
  const emitDrawingChange: Dispatch<SetStateAction<CadDrawingDocument | null>> =
    onDrawingChange ??
    ((update) => {
      if (!onPersistedStateChange) return;
      onPersistedStateChange((previousLegacy) => {
        const previousDrawing = previousLegacy
          ? migrateSurveyCadStateToDrawing({ state: previousLegacy, units })
          : activeDrawing;
        const nextDrawing = typeof update === 'function' ? update(previousDrawing) : update;
        if (nextDrawing === previousDrawing) return previousLegacy;
        return nextDrawing
          ? {
              version: 1,
              sourceSignature: nextDrawing.drawingId.startsWith('cad-drawing:')
                ? nextDrawing.drawingId.slice('cad-drawing:'.length)
                : nextDrawing.drawingId,
              project: nextDrawing.project,
              parcelLayout: nextDrawing.parcelLayout,
              showParcelLabels: nextDrawing.showParcelLabels,
            }
          : null;
      });
    });

  return { legacyDrawing, activeDrawing, emitDrawingChange };
};
