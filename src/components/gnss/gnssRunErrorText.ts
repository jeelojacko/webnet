/**
 * Phase 12I.2 (Worker B) — user-facing text for free-network run failures.
 *
 * UI-ONLY mapping over backend error codes; no math, no preflight changes.
 * A mapped error renders the friendly text with the raw code/message kept
 * in an "Advanced details" disclosure — never color-only, always readable.
 */
import {
  GNSS_FREE_EXTRA_RANK_DEFECT,
  GNSS_FREE_NETWORK_MAX_STATIONS,
  GNSS_FREE_NETWORK_SIZE_LIMIT,
} from '../../engine/gnssFreeNetwork';

export interface GnssMappedRunError {
  /** User-facing message (screen-readable, never color-only). */
  readonly text: string;
  /** Raw backend message, kept for the advanced-details disclosure. */
  readonly detail: string;
}

const stationCountOf = (message: string): string | null => {
  const match = /has (\d+) stations/.exec(message);
  return match ? (match[1] as string) : null;
};

export const mapGnssRunError = (raw: string): GnssMappedRunError | null => {
  if (raw.includes(GNSS_FREE_NETWORK_SIZE_LIMIT)) {
    const count = stationCountOf(raw);
    return {
      text:
        `Free-network adjustment is currently limited to ${GNSS_FREE_NETWORK_MAX_STATIONS} stations. ` +
        (count
          ? `This network contains ${count} stations. `
          : 'This network exceeds that limit. ') +
        'Add real control so all components are constrained, or reduce the network.',
      detail: raw,
    };
  }
  if (raw.includes(GNSS_FREE_EXTRA_RANK_DEFECT)) {
    return {
      text:
        'The network has additional rank deficiency beyond the expected three translation datum ' +
        'freedoms. Check for isolated stations, self-only observations, disconnected geometry, ' +
        'or other insufficient network connections.',
      detail: raw,
    };
  }
  return null;
};
