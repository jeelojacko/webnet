import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Repo root resolved file-relative (not from process.cwd()) so study tests
 * pass identically whether run from the repo root (`npm run test:agent`)
 * or standalone from study-desktop (`npm test`).
 */
export const STUDY_TEST_REPO_ROOT = fileURLToPath(new URL('../..', import.meta.url));

/** Absolute path into the shared root-level study-content corpus. */
export const studyTestContentPath = (...segments: string[]): string =>
  join(STUDY_TEST_REPO_ROOT, 'study-content', ...segments);
