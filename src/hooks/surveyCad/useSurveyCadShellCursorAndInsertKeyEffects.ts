/**
 * STRUCT-194.8 — shell cursor readout + block-INSERT Escape effects.
 *
 * Extracted verbatim from `SurveyCadWorkspace` with no behavior change, at the
 * exact former block-Escape position (immediately after the shell-snapshot
 * publish effect, before the surface build helpers). Two effects:
 *   1. Esc ends the block INSERT pick loop only when the event target is NOT a
 *      typing control (capture phase, so the dock input keeps its own Esc);
 *      no-op while no INSERT pick is armed and cleanup removes the capture
 *      listener.
 *   2. PERF-183.1 shell cursor readout over the imperative pointer channel: it
 *      publishes the snapped point, else the raw pointer formatted to three
 *      decimals, else `null`; it publishes once on subscribe and never commits
 *      root React state for an idle pointer move (no setState per event).
 *
 * Dependency arrays and cleanup are byte-identical to the originals.
 */
import { useEffect, type Dispatch, type RefObject, type SetStateAction } from 'react';
import type { CadSnapCandidate } from '../../engine/cad/cadTypes';
import type { CadShellLink } from '../../cad-app/shell/cadShellLink';

/** Armed block INSERT pick state (Phase 18N). */
export interface CadBlockInsertPick {
  definitionId: string;
  scale: number;
  rotationDeg: number;
  repeat: boolean;
}

export interface SurveyCadShellCursorAndInsertKeyEffectsArgs {
  blockInsertPick: CadBlockInsertPick | null;
  setBlockInsertPick: Dispatch<SetStateAction<CadBlockInsertPick | null>>;
  shellLink: CadShellLink | null;
  cursorActiveSnap: CadSnapCandidate | null;
  /** Always-fresh pointer ref (PERF-183.1); read imperatively, never a dep. */
  cursorPointerWorldPointRef: RefObject<{ x: number; y: number } | null>;
  /** Imperative pointer channel subscription (identity is a dep). */
  subscribeCursorPointerWorldPoint: (
    _listener: (_point: { x: number; y: number } | null) => void,
  ) => () => void;
}

export const useSurveyCadShellCursorAndInsertKeyEffects = ({
  blockInsertPick,
  setBlockInsertPick,
  shellLink,
  cursorActiveSnap,
  cursorPointerWorldPointRef,
  subscribeCursorPointerWorldPoint,
}: SurveyCadShellCursorAndInsertKeyEffectsArgs): void => {
  // Phase 18N — Esc ends the INSERT pick loop (capture: runs before the
  // command dock input consumes it; typing targets keep their own Esc).
  useEffect(() => {
    if (!blockInsertPick) return;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT')) {
        return;
      }
      setBlockInsertPick(null);
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
  }, [blockInsertPick]);

  useEffect(() => {
    if (!shellLink) return;
    // PERF-183.1 — cursor readout rides the imperative pointer channel so
    // idle pointer moves never commit root React state. Snap changes still
    // re-run this effect through the `activeSnap` dependency.
    const publishCursor = (): void => {
      const snap = cursorActiveSnap;
      const raw = cursorPointerWorldPointRef.current;
      shellLink.publishCursor(
        snap
          ? { x: snap.x, y: snap.y, label: snap.label }
          : raw
            ? { x: raw.x, y: raw.y, label: `${raw.x.toFixed(3)},${raw.y.toFixed(3)}` }
            : null,
      );
    };
    const unsubscribe = subscribeCursorPointerWorldPoint(publishCursor);
    publishCursor();
    return unsubscribe;
  }, [
    shellLink,
    cursorActiveSnap,
    cursorPointerWorldPointRef,
    subscribeCursorPointerWorldPoint,
  ]);
};
