import { describe, expect, it } from 'vitest';
import { findVersionDrift, readDesktopVersions } from '../scripts/check-version.mjs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  STUDY_APP_COMMIT_FALLBACK,
  STUDY_APP_VERSION_FALLBACK,
  getStudyAppCommit,
  getStudyAppInfo,
  getStudyAppVersion,
} from '../src/studyAppInfo';

describe('study desktop version consistency (Phase 5A)', () => {
  it('all desktop version sources agree on 0.1.0-beta.1', () => {
    const desktopDir = join(dirname(fileURLToPath(import.meta.url)), '..');
    expect(findVersionDrift(readDesktopVersions(desktopDir))).toEqual([]);
  });

  it('flags drift without touching the root package', () => {
    expect(
      findVersionDrift({
        packageJson: '0.1.0-beta.1',
        packageLock: '0.0.0',
        packageLockRoot: '0.1.0-beta.1',
        tauriConf: '0.1.0-beta.1',
        cargoToml: '0.1.0-beta.1',
        cargoLock: '0.1.0-beta.1',
      }),
    ).toEqual(['packageLock: expected 0.1.0-beta.1, found 0.0.0']);
  });
});

describe('study app identity seam (Phase 5B)', () => {
  it('falls back to version + local commit without build injection', () => {
    expect(getStudyAppVersion()).toBe(STUDY_APP_VERSION_FALLBACK);
    expect(getStudyAppCommit()).toBe(STUDY_APP_COMMIT_FALLBACK);
    expect(getStudyAppInfo()).toEqual({
      version: STUDY_APP_VERSION_FALLBACK,
      commit: STUDY_APP_COMMIT_FALLBACK,
    });
  });
});
