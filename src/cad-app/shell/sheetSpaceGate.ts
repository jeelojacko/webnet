import type { CadShellActions } from './cadShellTypes';

/**
 * Phase 19B Round 2C — model/sheet command gating (§1.6).
 *
 * On sheet tabs, model commands dispatch nowhere: mutating/session-starting
 * entries are blocked (boolean entries answer false, void entries no-op),
 * a few object/string entries answer an explicit unavailable outcome, and
 * Undo/Redo reroute to the caller-supplied sheet-history handlers (§§83-84).
 * Reads (query, describe and preflight families), drawing file ops, and chrome/dialog
 * openers pass through — opening a manager is harmless because its
 * mutations route through the same gated actions.
 */
const UNAVAILABLE = 'Paper space: model commands are unavailable on layout tabs.';

const READ_PREFIXES = ['query', 'describe', 'preflight'];

const READ_THROUGH = new Set([
  'ensureBlockSymbols',
  'newDrawing',
  'openDrawingFile',
  'saveDrawing',
  'requestLandXmlImport',
  'openSurveyManager',
  'openBlockManager',
  'openAnnotationManager',
  'openSurveyTableManager',
  'openLayerManager',
  'setSnapPreference',
  'toggleDraftingPanel',
  'toggleExportCenter',
]);

const STRING_BLOCKS = new Set([
  'rebuildProfile',
  'rebuildSections',
  'rebuildSectionLine',
  'createSectionViews',
  'requestVolume',
  'createAnalysis',
  'requestAnalysis',
  'rebuildSurface',
  'rebuildAllSurfaces',
  'previewSurfaceCompose',
  'requestSurfaceCompose',
]);

export const gateActionsForSheetSpace = (
  base: CadShellActions,
  sheetUndo: () => void,
  sheetRedo: () => void,
): CadShellActions =>
  new Proxy(base, {
    get(target, property, receiver) {
      if (property === 'undo') return sheetUndo;
      if (property === 'redo') return sheetRedo;
      if (typeof property !== 'string') return Reflect.get(target, property, receiver);
      if (READ_THROUGH.has(property) || READ_PREFIXES.some((prefix) => property.startsWith(prefix))) {
        return Reflect.get(target, property, receiver);
      }
      if (property === 'editField') return () => ({ applied: false });
      if (property === 'runBlockOp') return () => ({ applied: false, reason: UNAVAILABLE });
      if (property === 'runAnnotationOp') return () => ({ applied: false, reason: UNAVAILABLE });
      if (property === 'submitSessionText') return () => UNAVAILABLE;
      if (STRING_BLOCKS.has(property)) return () => UNAVAILABLE;
      const value = Reflect.get(target, property, receiver);
      if (typeof value !== 'function') return value;
      return () => false;
    },
  });
