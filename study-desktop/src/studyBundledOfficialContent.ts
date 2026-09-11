// Study — platform-neutral bundled official-content seam (Phase 5C/5D).
//
// The desktop bundle ships the current official package as a read-only
// resource; this module is the only frontend entry point to it. The default
// bridge calls the narrow Rust status/read commands (no path crosses IPC);
// outside the Tauri runtime those reject and the library reports
// unavailable (browser-safe fallback). Tests inject a fake bridge.
//
// Parsing, validation, preview, and import all reuse the existing official
// content core (`studyOfficialContent.ts`) — there is no duplicate importer
// here, only pure guards plus thin async wrappers.

import {
  parseOfficialContentPackage,
  previewOfficialContentPackage,
  type OfficialContentPreview,
} from './studyOfficialContent';
import {
  studyNativeBundledOfficialPackageId,
  studyNativeBundledOfficialPackageText,
  studyNativeBundledOfficialStatus,
} from './studyNativeIpc';
import type { StudyDataSnapshot } from './studyTypes';

export type BundledOfficialPackageStatus =
  | { available: false }
  | { available: true; byteLength: number };

export type BundledOfficialBridge = {
  getStatus: () => Promise<BundledOfficialPackageStatus>;
  readPackageId: () => Promise<string>;
  readPackageText: () => Promise<string>;
};

export const defaultBundledOfficialBridge: BundledOfficialBridge = {
  getStatus: async () => {
    try {
      const status = await studyNativeBundledOfficialStatus();
      if (!status?.available) return { available: false };
      return { available: true, byteLength: status.byte_length };
    } catch {
      return { available: false };
    }
  },
  readPackageId: async () => (await studyNativeBundledOfficialPackageId()).id,
  readPackageText: () => studyNativeBundledOfficialPackageText(),
};

/**
 * True when the snapshot holds no official imports. Fresh native databases
 * seed sample Study content, so "genuinely empty" here means empty of
 * official imports — the additive import core never touches seeded or
 * user-authored records, and the Install action refuses otherwise.
 */
export const hasExistingOfficialImports = (data: StudyDataSnapshot): boolean =>
  data.legalDocuments.length > 0 || data.importHistory.length > 0;

/**
 * Parse + validate + preview bundled text against the current snapshot
 * using the existing official-content core. Throws on malformed text or
 * failed validation (fail-closed: callers install nothing).
 */
export const previewBundledPackageText = (
  packageText: string,
  snapshot: StudyDataSnapshot,
): OfficialContentPreview => {
  const contentPackage = parseOfficialContentPackage(packageText);
  const preview = previewOfficialContentPackage(snapshot, contentPackage);
  if (!preview.valid) throw new Error(preview.errors.join('\n'));
  return preview;
};
