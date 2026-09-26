import { useCallback, useMemo, useRef, useState } from 'react';
import type { DraftDocument } from '../../engine/cad/cadDraftTypes';
import type { SheetCommitOptions } from '../../components/surveyCad/SheetWorkspace.types';

/**
 * Phase 19B Round 2C — shell-owned draft/sheet history (§§83-84).
 *
 * The live drawing draft is the present; past/future hold snapshots.
 * sheet-active Undo/Redo route here, model-active routes to model history
 * — never cross. Pointer-drag ticks commit transiently and coalesce into
 * the single transaction closed by the pointer-up commit.
 */
export interface DraftSheetHistoryController {
  commit: (_next: DraftDocument, _options?: SheetCommitOptions) => void;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  depth: number;
}

const MAX_ENTRIES = 100;

export const useDraftSheetHistory = (
  live: DraftDocument | undefined,
  publish: (_next: DraftDocument) => void,
): DraftSheetHistoryController => {
  const pastRef = useRef<DraftDocument[]>([]);
  const futureRef = useRef<DraftDocument[]>([]);
  const transientOpen = useRef(false);
  const liveRef = useRef(live);
  liveRef.current = live;
  const [version, setVersion] = useState(0);
  const bump = useCallback(() => setVersion((value) => value + 1), []);

  const commit = useCallback((next: DraftDocument, options?: SheetCommitOptions) => {
    const present = liveRef.current;
    if (next === present) {
      if (!options?.transient && transientOpen.current) {
        transientOpen.current = false;
        bump();
      }
      return;
    }
    if (options?.transient) {
      if (!transientOpen.current && present) {
        transientOpen.current = true;
        pastRef.current = [...pastRef.current.slice(-MAX_ENTRIES + 1), present];
        futureRef.current = [];
        bump();
      }
      publish(next);
      return;
    }
    transientOpen.current = false;
    if (present) pastRef.current = [...pastRef.current.slice(-MAX_ENTRIES + 1), present];
    futureRef.current = [];
    publish(next);
    bump();
  }, [publish, bump]);

  const undo = useCallback(() => {
    transientOpen.current = false;
    const present = liveRef.current;
    const top = pastRef.current[pastRef.current.length - 1];
    if (!top || !present) return;
    pastRef.current = pastRef.current.slice(0, -1);
    futureRef.current = [present, ...futureRef.current].slice(0, MAX_ENTRIES);
    publish(top);
    bump();
  }, [publish, bump]);

  const redo = useCallback(() => {
    transientOpen.current = false;
    const present = liveRef.current;
    const top = futureRef.current[0];
    if (!top || !present) return;
    futureRef.current = futureRef.current.slice(1);
    pastRef.current = [...pastRef.current.slice(-MAX_ENTRIES + 1), present];
    publish(top);
    bump();
  }, [publish, bump]);

  return useMemo(
    () => ({
      commit,
      undo,
      redo,
      canUndo: pastRef.current.length > 0,
      canRedo: futureRef.current.length > 0,
      depth: pastRef.current.length,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [commit, undo, redo, version],
  );
};
