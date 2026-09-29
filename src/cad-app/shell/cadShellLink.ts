import { useSyncExternalStore } from 'react';
import type { DraftDocument } from '../../engine/cad/cadDraftTypes';
import type {
  CadCursorPoint,
  CadShellActions,
  CadWorkspaceSnapshot,
} from './cadShellTypes';
import { cadWorkspaceSnapshotsEqual } from './cadShellSnapshotEqual';

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
   * Phase 19B QA — generation counter for the `actions` channel. Plain
   * assignment never re-renders subscribers, so a remount that republishes
   * an equal snapshot left the chrome reading a stale (nulled) actions
   * object forever. The workspace bumps this on (un)register; chrome
   * subscribes and re-reads `actions` on change.
   */
  getActionsVersion: () => number;
  subscribeActions: (_listener: () => void) => () => void;
  notifyActions: () => void;
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
  /**
   * Phase 19B Round 3F — set by the shell so the workspace's draft-only
   * editors (title-block templates, sheet objects) commit through the
   * shell-owned Draft history instead of replaceCadProject, which wipes
   * model undo/redo. Null when no shell is mounted (fallback path).
   */
  requestDraftCommit: ((_next: DraftDocument) => void) | null;
}

export const createCadShellLink = (): CadShellLink => {
  let snapshot: CadWorkspaceSnapshot | null = null;
  let cursor: CadCursorPoint | null = null;
  let actionsVersion = 0;
  const slowListeners = new Set<() => void>();
  const cursorListeners = new Set<() => void>();
  const actionsListeners = new Set<() => void>();
  return {
    getSnapshot: () => snapshot,
    subscribe: (listener) => {
      slowListeners.add(listener);
      return () => {
        slowListeners.delete(listener);
      };
    },
    publish: (next) => {
      if (cadWorkspaceSnapshotsEqual(snapshot, next)) return;
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
    getActionsVersion: () => actionsVersion,
    subscribeActions: (listener) => {
      actionsListeners.add(listener);
      return () => {
        actionsListeners.delete(listener);
      };
    },
    notifyActions: () => {
      actionsVersion += 1;
      actionsListeners.forEach((listener) => listener());
    },
    requestLayerManager: null,
    requestToolspaceTab: null,
    requestBlockManager: null,
    requestAnnotationManager: null,
    requestSurveyTableManager: null,
    requestDraftCommit: null,
  };
};

export const useCadShellSnapshot = (link: CadShellLink): CadWorkspaceSnapshot | null =>
  useSyncExternalStore(link.subscribe, link.getSnapshot, link.getSnapshot);

export const useCadShellCursor = (link: CadShellLink): CadCursorPoint | null =>
  useSyncExternalStore(link.subscribeCursor, link.getCursor, link.getCursor);

export const useCadShellActionsVersion = (link: CadShellLink): number =>
  useSyncExternalStore(link.subscribeActions, link.getActionsVersion, link.getActionsVersion);
