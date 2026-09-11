// Study — build-injected application identity (Phase 5B).
//
// Single seam for version/commit shown in Manage > Application diagnostics.
// Vite injects `__STUDY_APP_COMMIT__` at build time (STUDY_COMMIT /
// GITHUB_SHA); local dev/test fallback is `"local"`. Version is injected
// the same way with the package.json version as fallback so browser and
// Tauri runtimes report the same identity without importing package.json.

declare const __STUDY_APP_COMMIT__: string | undefined;
declare const __STUDY_APP_VERSION__: string | undefined;

export const STUDY_APP_VERSION_FALLBACK = '0.1.0-beta.1';
export const STUDY_APP_COMMIT_FALLBACK = 'local';

export const getStudyAppVersion = (): string =>
  typeof __STUDY_APP_VERSION__ !== 'undefined' && __STUDY_APP_VERSION__
    ? __STUDY_APP_VERSION__
    : STUDY_APP_VERSION_FALLBACK;

export const getStudyAppCommit = (): string =>
  typeof __STUDY_APP_COMMIT__ !== 'undefined' && __STUDY_APP_COMMIT__
    ? __STUDY_APP_COMMIT__
    : STUDY_APP_COMMIT_FALLBACK;

export interface StudyAppInfo {
  version: string;
  commit: string;
}

export const getStudyAppInfo = (): StudyAppInfo => ({
  version: getStudyAppVersion(),
  commit: getStudyAppCommit(),
});
