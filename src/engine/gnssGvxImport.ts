/**
 * Phase 12E0 — GVX 1.0 intake for static GNSS baseline networks.
 *
 * Vendor-neutral standards prep only: parses the open GVX 1.0 element set
 * (GNSS_VECTOR / POINT / REFERENCE_SYSTEM) into the canonical Phase 12B
 * observation (ECEF metres / m^2). No transforms, no datum invention, no
 * TBC-specific behavior. Syntax lives in gnssGvxSyntax.ts; this module
 * canonicalizes and validates. See docs/gnss/GVX_IMPORT.md.
 */
import type { StationMap } from '../types';
import type {
  GnssBaselineCovariance,
  GnssBaselineObservation,
} from './gnssBaselineTypes';
import { validateGnssBaselineCovariance } from './gnssBaselineCovariance';
import type {
  GnssDiagnostic,
  GnssFrameMetadata,
  GnssBaselineNetworkInput,
} from './gnssBaselineNetworkImport';
import {
  gvxFail,
  parseGvxSyntax,
  type GvxDocument,
  type GvxSourceMetadata,
} from './gnssGvxSyntax';

export interface GvxParseResult {
  readonly network: GnssBaselineNetworkInput | null;
  readonly diagnostics: GnssDiagnostic[];
  readonly source: GvxSourceMetadata | null;
};

/**
 * Parse GVX text into a canonical network: syntax, frame resolution,
 * canonicalization, and covariance validation. Endpoints enter as FREE
 * initial coordinates; datum control must be fixed downstream by the
 * operator (never inferred from GVX coordinates). Never throws for
 * document problems: errors are diagnostics and the network is null.
 */
export const parseGvx = (text: string, sourceFile?: string): GvxParseResult => {
  const syntax = parseGvxSyntax(text, sourceFile);
  if (!syntax.document || !syntax.source) {
    return { network: null, diagnostics: syntax.diagnostics, source: syntax.source };
  }
  const network = canonicalizeGvxDocument(syntax.document, syntax.source, syntax.diagnostics);
  if (!network) return { network: null, diagnostics: syntax.diagnostics, source: syntax.source };
  if (syntax.source.ignoredElements.length > 0) {
    syntax.diagnostics.push({
      severity: 'warning',
      code: 'GNSS_GVX_IGNORED_METADATA',
      message: `GVX/GVX: ignored ${syntax.source.ignoredElements.length} non-math extension element(s): ${syntax.source.ignoredElements.join(', ')}.`,
    });
  }
  return { network, diagnostics: syntax.diagnostics, source: syntax.source };
};

export const canonicalizeGvxDocument = (
  document: GvxDocument,
  source: GvxSourceMetadata,
  diagnostics: GnssDiagnostic[],
): GnssBaselineNetworkInput | null => {
  const frame: GnssFrameMetadata = {
    vectorFrame: 'ecef',
    referenceFrame: source.pointFrame.name,
    epoch: source.pointFrame.epoch,
  };
  const stations: StationMap = {};
  document.marks.forEach((mark) => {
    stations[mark.id] = {
      x: mark.x,
      y: mark.y,
      h: mark.z,
      fixed: false,
      fixedX: false,
      fixedY: false,
      fixedH: false,
    };
  });
  const baselines: GnssBaselineObservation[] = [];
  const provenance: GnssBaselineNetworkInput['provenance'] = [];
  let failed = false;
  document.vectors.forEach((vector, index) => {
    const path = `GVX/GNSS_VECTOR[${index + 1}]`;
    for (const [name, value] of [
      ['SDX', vector.sdx],
      ['SDY', vector.sdy],
      ['SDZ', vector.sdz],
      ['PXY', vector.pxy],
      ['PXZ', vector.pxz],
      ['PYZ', vector.pyz],
    ] as const) {
      if (!Number.isFinite(value)) {
        gvxFail(diagnostics, 'GNSS_GVX_BAD_COVARIANCE', `${path}/CORRELATION_MATRIX: ${name} is not finite.`, vector.line, {
          baselineId: vector.id,
        });
        failed = true;
        return;
      }
    }
    if (vector.sdx <= 0 || vector.sdy <= 0 || vector.sdz <= 0) {
      gvxFail(
        diagnostics,
        'GNSS_GVX_BAD_COVARIANCE',
        `${path}/CORRELATION_MATRIX: stddevs must be positive (SDX=${vector.sdx}, SDY=${vector.sdy}, SDZ=${vector.sdz}).`,
        vector.line,
        { baselineId: vector.id },
      );
      failed = true;
      return;
    }
    const covariance: GnssBaselineCovariance = {
      xx: vector.sdx * vector.sdx,
      yy: vector.sdy * vector.sdy,
      zz: vector.sdz * vector.sdz,
      xy: vector.pxy * vector.sdx * vector.sdy,
      xz: vector.pxz * vector.sdx * vector.sdz,
      yz: vector.pyz * vector.sdy * vector.sdz,
    };
    try {
      validateGnssBaselineCovariance(covariance, `${vector.from}->${vector.to}`);
    } catch (failure) {
      gvxFail(
        diagnostics,
        'GNSS_GVX_BAD_COVARIANCE',
        `${path}/CORRELATION_MATRIX: ${failure instanceof Error ? failure.message : String(failure)}`,
        vector.line,
        { baselineId: vector.id },
      );
      failed = true;
      return;
    }
    const observed = { x: vector.dx, y: vector.dy, z: vector.dz };
    provenance.push({
      baselineId: index + 1,
      baselineCode: vector.id,
      line: vector.line,
      originalVector: { ...observed },
      originalUnits: 'm',
      stochasticForm: 'SIGCORR',
      inputFrame: 'ecef',
      rotationApplied: false,
      canonicalVector: { ...observed },
      canonicalCovariance: { ...covariance },
    });
    baselines.push({
      type: 'gnssBaseline',
      id: index + 1,
      from: vector.from,
      to: vector.to,
      vector: observed,
      covariance,
      frame: 'ecef',
      referenceFrame: frame.referenceFrame,
      epoch: frame.epoch,
      solutionId: vector.id,
      sourceLine: vector.line,
      sourceFile: document.sourceFile,
    });
  });
  if (failed) return null;
  return {
    stations,
    baselines,
    frame,
    inputUnits: 'm',
    provenance,
    sourceFile: document.sourceFile,
  };
};

/**
 * Full GVX import: parseGvx plus import-policy checks. Repeated endpoint
 * pairs are independent solutions (warned, never deduplicated); a
 * self-baseline (FROM == TO) is a hard error. Datum policy is unchanged:
 * endpoints stay FREE, control is fixed downstream by the operator.
 */
export const importGnssBaselineGvx = (
  text: string,
  sourceFile?: string,
): GvxParseResult => {
  const parsed = parseGvx(text, sourceFile);
  if (!parsed.network) return parsed;
  const diagnostics = [...parsed.diagnostics];
  const endpointCounts = new Map<string, number>();
  parsed.network.baselines.forEach((baseline) => {
    if (baseline.from === baseline.to) {
      diagnostics.push({
        severity: 'error',
        code: 'GNSS_GVX_BAD_XML',
        message: `GVX/GNSS_VECTOR: self-baseline '${baseline.from}->${baseline.to}' (FROM == TO).`,
        line: baseline.sourceLine,
        baselineId: baseline.solutionId,
      });
    }
    const key = `${baseline.from}->${baseline.to}`;
    endpointCounts.set(key, (endpointCounts.get(key) ?? 0) + 1);
  });
  endpointCounts.forEach((count, key) => {
    if (count > 1) {
      diagnostics.push({
        severity: 'warning',
        code: 'GNSS_GVX_REPEATED_BASELINE',
        message: `GVX/GNSS_VECTOR: endpoints ${key} appear in ${count} independent solutions (kept distinct).`,
      });
    }
  });
  if (diagnostics.some((diagnostic) => diagnostic.severity === 'error')) {
    return { network: null, diagnostics, source: parsed.source };
  }
  return { network: parsed.network, diagnostics, source: parsed.source };
};
