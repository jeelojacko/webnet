// Study — centralized safe new-tab opening.
//
// Every "opens a Study page in a NEW browser tab" button goes through this
// module so feature tokens (`noopener,noreferrer`) and path building stay
// single-sourced. In-app SPA navigation is NOT routed here: callers choose
// new-tab semantics only when leaving the current view would destroy
// component-local session state (active Locate/Drill/Mock sessions) or when
// the learner explicitly asks for the statute library in a separate tab.
//
// Contract: `noopener,noreferrer` removes the reverse window reference, so a
// browser legitimately returns `null` from `window.open()` even when the tab
// opened. Callers MUST NOT treat a null WindowProxy as a popup failure —
// this helper reports only genuine synchronous exceptions. User-initiated
// clicks simply attempt the open; the opened tab cannot be observed.

/** Path of the Study Library SPA page (used as the statute library). */
export const STUDY_LIBRARY_PATH = '/study/library';

/** Deep-link path into a document provision (mirrors StudyApp navigation). */
export const studyProvisionPath = (documentId: string, sourceKey: string): string =>
  `/study/document/${encodeURIComponent(documentId)}#${encodeURIComponent(sourceKey)}`;

export type StudyNewTabResult = { attempted: true } | { attempted: false; error: Error };

/**
 * Attempts to open a Study SPA path in a new tab with `noopener,noreferrer`.
 *
 * Returns `{ attempted: true }` as soon as the open was requested. A null
 * WindowProxy (expected with `noopener`, and also returned when a popup is
 * blocked) is intentionally NOT reported as failure — with noopener semantics
 * the browser gives the caller no handle either way. Only a genuine
 * synchronous exception surfaces as `{ attempted: false, error }`.
 */
export const openStudyUrlNewTab = (path: string): StudyNewTabResult => {
  try {
    window.open(path, '_blank', 'noopener,noreferrer');
    return { attempted: true };
  } catch (error) {
    return {
      attempted: false,
      error: error instanceof Error ? error : new Error(String(error)),
    };
  }
};

/** Opens a document provision in a new tab (active-session deep links). */
export const openProvisionNewTab = (documentId: string, sourceKey: string): StudyNewTabResult =>
  openStudyUrlNewTab(studyProvisionPath(documentId, sourceKey));
