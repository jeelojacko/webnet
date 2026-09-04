// Study — centralized safe new-tab opening.
//
// Every "opens a Study page in a NEW browser tab" button goes through this
// module so popup blocking, feature tokens (`noopener,noreferrer`), and
// path building stay single-sourced. In-app SPA navigation is NOT routed
// here: callers choose new-tab semantics only when leaving the current view
// would destroy component-local session state (active Locate/Drill/Mock
// sessions) or when the learner explicitly asks for the statute library in a
// separate tab.

/** Path of the Study Library SPA page (used as the statute library). */
export const STUDY_LIBRARY_PATH = '/study/library';

/** Deep-link path into a document provision (mirrors StudyApp navigation). */
export const studyProvisionPath = (documentId: string, sourceKey: string): string =>
  `/study/document/${encodeURIComponent(documentId)}#${encodeURIComponent(sourceKey)}`;

/**
 * Opens a Study SPA path in a new tab. Returns the opened window, or null
 * when the browser blocked the popup / the API is unavailable so callers can
 * surface their existing "could not open" UX.
 */
export const openStudyUrlNewTab = (path: string): Window | null => {
  try {
    return window.open(path, '_blank', 'noopener,noreferrer');
  } catch {
    return null;
  }
};

/** Opens a document provision in a new tab (active-session deep links). */
export const openProvisionNewTab = (documentId: string, sourceKey: string): Window | null =>
  openStudyUrlNewTab(studyProvisionPath(documentId, sourceKey));
