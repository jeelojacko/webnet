import { useSyncExternalStore } from 'react';
import type {
  CadCursorPoint,
  CadShellActions,
  CadWorkspaceSnapshot,
} from './cadShellTypes';

/**
 * Phase 18B — one-way bridge between SurveyCadWorkspace (publisher) and the
 * CAD shell chrome (subscribers). Two channels: slow snapshots for chrome,
 * fast cursor points for the status-bar readout only.
 *
 * MULTI-DOC RESTRICTION (see CadApplicationShell): the link carries one
 * active workspace. True multi-document needs one link per tab plus
 * per-tab undo/selection inside useSurveyCadWorkspace — currently a single
 * history per mounted workspace. The tab strip is built so a second live
 * workspace can attach later (tabs address drawings by id), but 18B ships
 * one live workspace + Start tab only.
 */
export interface CadShellLink {
  getSnapshot: () => CadWorkspaceSnapshot | null;
  subscribe: (_listener: () => void) => () => void;
  publish: (_snapshot: CadWorkspaceSnapshot) => void;
  getCursor: () => CadCursorPoint | null;
  subscribeCursor: (_listener: () => void) => () => void;
  publishCursor: (_point: CadCursorPoint | null) => void;
  /** Set by the workspace; null until the workspace mounts. */
  actions: CadShellActions | null;
  /**
   * Phase 18D — set by the shell; survey ribbon buttons focus the
   * Toolspace tab through it (workspace cannot reach shell layout).
   */
  requestToolspaceTab: ((_tab: import('./cadShellTypes').CadToolspaceTab) => void) | null;
  /**
   * Phase 18C — set by the shell; the workspace LAYER command (typed text,
   * ribbon, manager) focuses the Layer Properties Manager through it.
   */
  requestLayerManager: (() => void) | null;
  /**
   * Phase 18N — set by the shell; registry BLOCK/BLOCKS entries and the
   * workspace insert flow open the Block Manager through it.
   */
  requestBlockManager: ((_tab?: 'blocks' | 'symbols' | 'insert') => void) | null;
  /**
   * Phase 18O — set by the shell; registry annotation style entries and the
   * Toolspace Settings nodes open the Annotation Styles manager through it.
   */
  requestAnnotationManager: ((_tab?: import('../annotation/cadAnnotationUiTypes').CadAnnotationManagerTab) => void) | null;
  /**
   * Phase 19A — set by the shell; registry TABLESTYLE and Toolspace style
   * nodes open the survey table manager through it.
   */
  requestSurveyTableManager: (() => void) | null;
}

const countsEqual = (
  a: CadWorkspaceSnapshot['layerEntityCounts'],
  b: CadWorkspaceSnapshot['layerEntityCounts'],
): boolean => {
  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  return keysA.length === keysB.length && keysA.every((key) => a[key] === b[key]);
};

const snapshotsEqual = (a: CadWorkspaceSnapshot | null, b: CadWorkspaceSnapshot | null): boolean => {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    a.drawingId === b.drawingId &&
    a.drawingName === b.drawingName &&
    a.units === b.units &&
    a.entityCount === b.entityCount &&
    a.selectionCount === b.selectionCount &&
    a.activeCommandKey === b.activeCommandKey &&
    a.commandPrompt === b.commandPrompt &&
    a.commandInputValue === b.commandInputValue &&
    a.canUndo === b.canUndo &&
    a.canRedo === b.canRedo &&
    a.historyDepth === b.historyDepth &&
    a.redoDepth === b.redoDepth &&
    a.snapStatusText === b.snapStatusText &&
    a.stationCount === b.stationCount &&
    a.dependencyStatus === b.dependencyStatus &&
    arraysEqual(a.availableCommands, b.availableCommands) &&
    arraysEqual(a.selectedEntityIds, b.selectedEntityIds) &&
    layersEqual(a.layers, b.layers) &&
    countsEqual(a.layerEntityCounts, b.layerEntityCounts) &&
    a.currentLayerId === b.currentLayerId &&
    arraysEqual(
      a.lineTypes.map((entry) => entry.id),
      b.lineTypes.map((entry) => entry.id),
    ) &&
    a.sheets.length === b.sheets.length &&
    a.sheets.every((sheet, index) => sheet.id === b.sheets[index]?.id && sheet.name === b.sheets[index]?.name) &&
    prefsEqual(a.snapPreferences, b.snapPreferences) &&
    previewsEqual(a.selectionPreview, b.selectionPreview) &&
    propertiesEqual(a.properties, b.properties) &&
    JSON.stringify(a.survey) === JSON.stringify(b.survey) &&
    JSON.stringify(a.surface) === JSON.stringify(b.surface) &&
    JSON.stringify(a.volume) === JSON.stringify(b.volume) &&
    JSON.stringify(a.analysis) === JSON.stringify(b.analysis) &&
    JSON.stringify(a.profile) === JSON.stringify(b.profile) &&
    JSON.stringify(a.section) === JSON.stringify(b.section) &&
    JSON.stringify(a.blocks) === JSON.stringify(b.blocks) &&
    JSON.stringify(a.annotation) === JSON.stringify(b.annotation)
  );
};

const arraysEqual = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && a.every((entry, index) => entry === b[index]);

const layersEqual = (a: CadWorkspaceSnapshot['layers'], b: CadWorkspaceSnapshot['layers']): boolean =>
  a.length === b.length &&
  a.every((layer, index) => {
    const other = b[index];
    return (
      other != null &&
      layer.id === other.id &&
      layer.name === other.name &&
      layer.color === other.color &&
      layer.visible === other.visible &&
      layer.locked === other.locked &&
      layer.frozen === other.frozen &&
      layer.printable === other.printable &&
      layer.lineTypeId === other.lineTypeId &&
      layer.description === other.description &&
      (layer.transparency ?? 0) === (other.transparency ?? 0) &&
      layer.lineweightMm === other.lineweightMm
    );
  });

const prefsEqual = (
  a: CadWorkspaceSnapshot['snapPreferences'],
  b: CadWorkspaceSnapshot['snapPreferences'],
): boolean => {
  const keys = Object.keys(a) as Array<keyof typeof a>;
  return keys.length === Object.keys(b).length && keys.every((key) => a[key] === b[key]);
};

const previewsEqual = (
  a: CadWorkspaceSnapshot['selectionPreview'],
  b: CadWorkspaceSnapshot['selectionPreview'],
): boolean =>
  a.length === b.length &&
  a.every((entry, index) => entry.id === b[index]?.id && entry.label === b[index]?.label);

const propertiesEqual = (
  a: CadWorkspaceSnapshot['properties'],
  b: CadWorkspaceSnapshot['properties'],
): boolean => JSON.stringify(a) === JSON.stringify(b);

export const createCadShellLink = (): CadShellLink => {
  let snapshot: CadWorkspaceSnapshot | null = null;
  let cursor: CadCursorPoint | null = null;
  const slowListeners = new Set<() => void>();
  const cursorListeners = new Set<() => void>();
  return {
    getSnapshot: () => snapshot,
    subscribe: (listener) => {
      slowListeners.add(listener);
      return () => {
        slowListeners.delete(listener);
      };
    },
    publish: (next) => {
      if (snapshotsEqual(snapshot, next)) return;
      snapshot = next;
      slowListeners.forEach((listener) => listener());
    },
    getCursor: () => cursor,
    subscribeCursor: (listener) => {
      cursorListeners.add(listener);
      return () => {
        cursorListeners.delete(listener);
      };
    },
    publishCursor: (next) => {
      const current = cursor;
      if (current?.x === next?.x && current?.y === next?.y && current?.label === next?.label) return;
      cursor = next;
      cursorListeners.forEach((listener) => listener());
    },
    actions: null,
    requestLayerManager: null,
    requestToolspaceTab: null,
    requestBlockManager: null,
    requestAnnotationManager: null,
    requestSurveyTableManager: null,
  };
};

export const useCadShellSnapshot = (link: CadShellLink): CadWorkspaceSnapshot | null =>
  useSyncExternalStore(link.subscribe, link.getSnapshot, link.getSnapshot);

export const useCadShellCursor = (link: CadShellLink): CadCursorPoint | null =>
  useSyncExternalStore(link.subscribeCursor, link.getCursor, link.getCursor);
