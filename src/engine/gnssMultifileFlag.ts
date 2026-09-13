/**
 * Phase 12H.2 — production multi-file GNSS feature flag (DEFAULT ON).
 * Kill switch retained: call setGnssMultifileEnabled(false) to restore
 * Phase 12G single-session behavior. Follows the R2B kill-switch pattern.
 * OFF = Phase 12G single-session behavior byte-identical.
 */
let gnssMultifileEnabled = true;

/** Enables/disables the multi-file GNSS production workflow. */
export const setGnssMultifileEnabled = (enabled: boolean): void => {
  gnssMultifileEnabled = enabled;
};

/** Reports the multi-file GNSS flag state (default ON). */
export const isGnssMultifileEnabled = (): boolean => gnssMultifileEnabled;
