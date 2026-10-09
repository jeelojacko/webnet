/**
 * STRUCT-194.8 — surface edit-session Esc/Enter hotkeys.
 *
 * Extracted verbatim from `SurveyCadWorkspace` with no behavior change. Called
 * unconditionally after the four session hooks (18S edit, 18T point, 18V
 * bulk-selection, 18V bulk-edit) at the exact former effect position. The
 * capture-phase keydown handler keeps the exact priority:
 *   - Escape: edit -> point -> bulkSelection -> bulkEdit cancel, then one
 *     "Surface edit session ended." status notice;
 *   - Enter: point -> bulkEdit -> bulkSelection -> edit commit, each consuming
 *     the event only when it actually commits.
 * Typing targets (INPUT/TEXTAREA/SELECT) keep their own keys. The effect
 * short-circuits while no session is live and cleanup removes the listener.
 *
 * Dependency array is byte-identical with the original targeted
 * `exhaustive-deps` suppression (the four session aggregates are rebuilt per
 * render but only their changes should re-bind).
 */
import { useEffect, type Dispatch, type SetStateAction } from 'react';
import type { useSurveyCadSurfaceEditSessions } from './useSurveyCadSurfaceEditSessions';
import type { useSurveyCadSurfacePointEditSessions } from './useSurveyCadSurfacePointEditSessions';
import type { useSurveyCadSurfaceBulkSelection } from './useSurveyCadSurfaceBulkSelection';
import type { useSurveyCadSurfaceBulkEditSessions } from './useSurveyCadSurfaceBulkEditSessions';

export interface SurveyCadSurfaceEditHotkeysArgs {
  surfaceEditSessions: ReturnType<typeof useSurveyCadSurfaceEditSessions>;
  surfacePointEditSessions: ReturnType<typeof useSurveyCadSurfacePointEditSessions>;
  surfaceBulkSelection: ReturnType<typeof useSurveyCadSurfaceBulkSelection>;
  surfaceBulkEditSessions: ReturnType<typeof useSurveyCadSurfaceBulkEditSessions>;
  setFileStatusText: Dispatch<SetStateAction<string>>;
}

export const useSurveyCadSurfaceEditHotkeys = ({
  surfaceEditSessions,
  surfacePointEditSessions,
  surfaceBulkSelection,
  surfaceBulkEditSessions,
  setFileStatusText,
}: SurveyCadSurfaceEditHotkeysArgs): void => {
  // Phase 18S/18T/18V — Esc ends the active surface session; Enter commits
  // the staged edit/selection (capture, before dock input; typing targets
  // keep their own keys).
  useEffect(() => {
    if (
      !surfaceEditSessions.session &&
      !surfacePointEditSessions.session &&
      !surfaceBulkSelection.session &&
      !surfaceBulkEditSessions.session
    ) return;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape' && event.key !== 'Enter') return;
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT')) {
        return;
      }
      if (event.key === 'Escape') {
        surfaceEditSessions.cancel();
        surfacePointEditSessions.cancel();
        surfaceBulkSelection.cancel();
        surfaceBulkEditSessions.cancel();
        setFileStatusText('Surface edit session ended.');
      } else if (surfacePointEditSessions.session) {
        if (surfacePointEditSessions.handleEnter()) event.preventDefault();
      } else if (surfaceBulkEditSessions.handleEnter()) {
        event.preventDefault();
      } else if (surfaceBulkSelection.handleEnter()) {
        event.preventDefault();
      } else if (surfaceEditSessions.handleEnter()) {
        event.preventDefault();
      }
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [surfaceEditSessions, surfacePointEditSessions, surfaceBulkSelection, surfaceBulkEditSessions]);
};
