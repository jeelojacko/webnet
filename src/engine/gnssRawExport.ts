/**
 * Phase 12J.4 — authoritative JSON export for reviewed raw baselines.
 *
 * The export is the full ProcessedRawGnssBaseline plus the file metadata
 * and options that produced it, so it is re-readable: every
 * provenance/status/covariance field survives a JSON round-trip.
 *
 * There is deliberately NO native BL export: the BL text syntax cannot
 * preserve FORMAL_UNCALIBRATED covariance semantics, so emitting BL would
 * silently promote a formal-precision estimate to survey weighting.
 */
import type {
  ProcessedRawGnssBaseline,
  RawGnssFileMetadata,
  RawGnssProcessingOptions,
} from './gnssRawTypes';

export const RAW_BASELINE_EXPORT_KIND = 'webnet-raw-static-baseline/1' as const;

export interface RawBaselineExport {
  readonly kind: typeof RAW_BASELINE_EXPORT_KIND;
  readonly exportedAt: string;
  readonly files: {
    readonly base: RawGnssFileMetadata;
    readonly rover: RawGnssFileMetadata;
    readonly navSha256: readonly string[];
    readonly sp3Sha256: string | null;
  };
  readonly options: RawGnssProcessingOptions;
  readonly result: ProcessedRawGnssBaseline;
}

export const buildRawBaselineExport = (
  base: RawGnssFileMetadata,
  rover: RawGnssFileMetadata,
  options: RawGnssProcessingOptions,
  result: ProcessedRawGnssBaseline,
): RawBaselineExport => ({
  kind: RAW_BASELINE_EXPORT_KIND,
  exportedAt: new Date().toISOString(),
  files: {
    base,
    rover,
    navSha256: [...result.provenance.navSha256],
    sp3Sha256: result.provenance.sp3Sha256,
  },
  options,
  result,
});

export const serializeRawBaselineExport = (doc: RawBaselineExport): string =>
  JSON.stringify(doc, null, 2);

/** Re-read an export; throws fail-closed on kind mismatch or missing core. */
export const parseRawBaselineExport = (text: string): RawBaselineExport => {
  const doc = JSON.parse(text) as Partial<RawBaselineExport>;
  if (doc.kind !== RAW_BASELINE_EXPORT_KIND) {
    throw new Error(`Not a raw static-baseline export (kind ${String(doc.kind)}).`);
  }
  if (!doc.result || !doc.files || !doc.options) {
    throw new Error('Raw static-baseline export is missing result/files/options.');
  }
  return doc as RawBaselineExport;
};

/** Authoritative export is FIXED-only; FAILED never exports. */
export const isAuthoritativeExportable = (result: ProcessedRawGnssBaseline): boolean =>
  result.status === 'FIXED';

/** FLOAT results allow a diagnostic JSON copy, never a survey baseline. */
export const isDiagnosticExportable = (result: ProcessedRawGnssBaseline): boolean =>
  result.status === 'FLOAT';

export const downloadTextFile = (fileName: string, text: string): void => {
  const blob = new Blob([text], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
};
