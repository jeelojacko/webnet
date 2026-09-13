/**
 * Phase 12H.1 — production multi-file GNSS feature flag (DEFAULT OFF).
 * 12H.2 may enable later. Follows the R2B kill-switch pattern.
 * OFF = Phase 12G single-session behavior byte-identical.
 */
let gnssMultifileEnabled = false;

/** Enables/disables the multi-file GNSS production workflow. */
export const setGnssMultifileEnabled = (enabled: boolean): void => {
  gnssMultifileEnabled = enabled;
};

/** Reports the multi-file GNSS flag state (default OFF). */
export const isGnssMultifileEnabled = (): boolean => gnssMultifileEnabled;
