/**
 * Phase 12C — generic delimited (CSV/TSV) static GNSS baseline importer.
 *
 * Header-driven mapping over explicit aliases (no fuzzy matching).
 * Frame identity, units, epoch, ellipsoid, and ENU origin come from typed
 * import options — never guessed from filenames. Produces the same
 * canonical GnssBaselineNetworkInput as the native text parser.
 *
 * No dedicated proprietary profile: no real TBC sample exists in-repo, so
 * only the 'generic' profile ships. A documented TBC mapping seam is the
 * COLUMN_ALIASES table plus GnssCsvImportOptions below (12E work).
 */
import type { StationMap } from '../types';
import {
  canonicalizeRawNetwork,
  parseGnssStrictNumber,
  validateGnssBaselineNetwork,
  type GnssBaselineNetworkInput,
  type GnssDiagnostic,
  type GnssFrameMetadata,
  type GnssInputUnits,
} from './gnssBaselineNetworkImport';

export interface GnssCsvImportOptions {
  delimiter?: string;
  units: GnssInputUnits | string;
  vectorFrame: 'ecef' | 'enu' | string;
  referenceFrame: string;
  epoch?: string;
  ellipsoid?: string;
  originLatDeg?: number;
  originLonDeg?: number;
  sourceFile?: string;
}

export interface GnssCsvImportResult {
  network: GnssBaselineNetworkInput | null;
  diagnostics: GnssDiagnostic[];
}

/** Bounded alias table: header (lowercased, trimmed) -> canonical field. */
const COLUMN_ALIASES: Record<string, string> = {
  from: 'from',
  'from point': 'from',
  frompoint: 'from',
  'from station': 'from',
  fromid: 'from',
  'from id': 'from',
  to: 'to',
  'to point': 'to',
  topoint: 'to',
  'to station': 'to',
  toid: 'to',
  'to id': 'to',
  dx: 'dx',
  'delta x': 'dx',
  'deltax': 'dx',
  'delta-x': 'dx',
  'x component': 'dx',
  dy: 'dy',
  'delta y': 'dy',
  'deltay': 'dy',
  'delta-y': 'dy',
  'y component': 'dy',
  dz: 'dz',
  'delta z': 'dz',
  'deltaz': 'dz',
  'delta-z': 'dz',
  'z component': 'dz',
  de: 'dx',
  dn: 'dy',
  du: 'dz',
  cxx: 'cxx',
  'cov xx': 'cxx',
  'c_xx': 'cxx',
  varx: 'cxx',
  'variance x': 'cxx',
  cxy: 'cxy',
  'cov xy': 'cxy',
  'c_xy': 'cxy',
  cxz: 'cxz',
  'cov xz': 'cxz',
  'c_xz': 'cxz',
  cyy: 'cyy',
  'cov yy': 'cyy',
  'c_yy': 'cyy',
  vary: 'cyy',
  'variance y': 'cyy',
  cyz: 'cyz',
  'cov yz': 'cyz',
  'c_yz': 'cyz',
  czz: 'czz',
  'cov zz': 'czz',
  'c_zz': 'czz',
  varz: 'czz',
  'variance z': 'czz',
  sx: 'sx',
  sigmax: 'sx',
  'sigma x': 'sx',
  'std x': 'sx',
  stdx: 'sx',
  sy: 'sy',
  sigmay: 'sy',
  'sigma y': 'sy',
  'std y': 'sy',
  stdy: 'sy',
  sz: 'sz',
  sigmaz: 'sz',
  'sigma z': 'sz',
  'std z': 'sz',
  stdz: 'sz',
  rho_xy: 'rhoXY',
  rhoxy: 'rhoXY',
  'corr xy': 'rhoXY',
  'correlation xy': 'rhoXY',
  rho_xz: 'rhoXZ',
  rhoxz: 'rhoXZ',
  'corr xz': 'rhoXZ',
  'correlation xz': 'rhoXZ',
  rho_yz: 'rhoYZ',
  rhoyz: 'rhoYZ',
  'corr yz': 'rhoYZ',
  'correlation yz': 'rhoYZ',
  id: 'id',
  baselineid: 'id',
  'baseline id': 'id',
  session: 'session',
  sessionid: 'session',
  'session id': 'session',
  solution: 'solution',
  solutionid: 'solution',
  source: 'source',
  frame: 'frame',
  referenceframe: 'frame',
  'reference frame': 'frame',
  epoch: 'epoch',
  ellipsoid: 'ellipsoid',
};

const REQUIRED_VECTOR = ['from', 'to', 'dx', 'dy', 'dz'];
const COV_FIELDS = ['cxx', 'cxy', 'cxz', 'cyy', 'cyz', 'czz'];
const SIGCORR_FIELDS = ['sx', 'sy', 'sz', 'rhoXY', 'rhoXZ', 'rhoYZ'];

const sniffDelimiter = (headerLine: string): string => {
  const counts = [',', ';', '\t'].map(
    (delimiter) => headerLine.split(delimiter).length - 1,
  );
  const best = counts.indexOf(Math.max(...counts));
  return [',', ';', '\t'][best] ?? ',';
};

/** Minimal RFC4180 field split: quotes, embedded delimiters, "" escapes. */
const splitDelimitedLine = (line: string, delimiter: string): string[] | null => {
  const fields: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i] ?? '';
    if (inQuotes) {
      if (char === '"') {
        if (line[i + 1] === '"') {
          current += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        current += char;
      }
    } else if (char === '"') {
      inQuotes = true;
    } else if (char === delimiter) {
      fields.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  if (inQuotes) return null;
  fields.push(current);
  return fields;
};

const normalizeHeader = (header: string): string | null => {
  const key = header.trim().toLowerCase();
  return COLUMN_ALIASES[key] ?? null;
};

/**
 * Import baselines from delimited text. Stations/control come from the
 * native GX syntax or importGnssControlCsv; this importer maps baseline
 * rows only and resolves them against supplied stations.
 */
export const importGnssBaselineDelimited = (
  text: string,
  stations: StationMap,
  options: GnssCsvImportOptions,
): GnssCsvImportResult => {
  const diagnostics: GnssDiagnostic[] = [];
  const fail = (code: string, message: string, row?: number): GnssCsvImportResult => {
    diagnostics.push({ severity: 'error', code, message, row });
    return { network: null, diagnostics };
  };

  const unit = options.units.toLowerCase();
  if (unit !== 'm' && unit !== 'mm' && unit !== 'cm') {
    return fail('GNSS_UNSUPPORTED_UNITS', `CSV import units must be M, MM, or CM; got '${options.units}'.`);
  }
  const vectorFrame = options.vectorFrame.toLowerCase();
  if (vectorFrame !== 'ecef' && vectorFrame !== 'enu') {
    return fail('GNSS_BAD_FRAME', `CSV import vectorFrame must be ecef or enu; got '${options.vectorFrame}'.`);
  }
  if (!options.referenceFrame?.trim()) {
    return fail('GNSS_MISSING_FRAME', 'CSV import requires options.referenceFrame.');
  }
  if (vectorFrame === 'enu' && (options.originLatDeg === undefined || options.originLonDeg === undefined)) {
    return fail('GNSS_ENU_ORIGIN_MISSING', 'CSV import with vectorFrame enu requires originLatDeg and originLonDeg.');
  }

  const rawLines = text.split('\n').map((line) => line.replace(/\r$/, ''));
  const dataLines = rawLines.filter((line) => line.trim() !== '' && !line.trim().startsWith('#'));
  if (dataLines.length === 0) {
    return fail('GNSS_NO_BASELINES', 'CSV import found no header/data rows.');
  }
  const delimiter = options.delimiter ?? sniffDelimiter(dataLines[0] ?? '');
  const headerFields = splitDelimitedLine(dataLines[0] ?? '', delimiter);
  if (!headerFields) {
    return fail('GNSS_MALFORMED_CSV', 'CSV header has an unterminated quoted field.');
  }
  const mapping = new Map<string, number>();
  for (let i = 0; i < headerFields.length; i += 1) {
    const canonical = normalizeHeader(headerFields[i] ?? '');
    if (!canonical) continue;
    if ([...mapping.keys()].includes(canonical)) {
      return fail('GNSS_AMBIGUOUS_CSV_MAPPING', `CSV header maps '${canonical}' from more than one column.`);
    }
    mapping.set(canonical, i);
  }
  const missingVector = REQUIRED_VECTOR.filter((field) => !mapping.has(field));
  if (missingVector.length > 0) {
    return fail('GNSS_CSV_MISSING_HEADERS', `CSV header is missing required columns: ${missingVector.join(', ')}.`);
  }
  const hasCov = COV_FIELDS.every((field) => mapping.has(field));
  const hasSigCorr = SIGCORR_FIELDS.every((field) => mapping.has(field));
  if (!hasCov && !hasSigCorr) {
    return fail(
      'GNSS_CSV_MISSING_HEADERS',
      'CSV header must carry a full stochastic set: cxx/cxy/cxz/cyy/cyz/czz or sx/sy/sz/rho_xy/rho_xz/rho_yz.',
    );
  }
  const partialCov = COV_FIELDS.some((field) => mapping.has(field));
  const partialSig = SIGCORR_FIELDS.some((field) => mapping.has(field));
  if ((partialCov && !hasCov) || (partialSig && !hasSigCorr)) {
    return fail('GNSS_CSV_PARTIAL_STOCHASTIC', 'CSV header carries a partial stochastic set; supply all six covariance or all six sigma/correlation columns.');
  }
  // Prefer covariance when both complete sets are present (deterministic).
  const useCov = hasCov;

  const frame: GnssFrameMetadata = {
    vectorFrame: vectorFrame as 'ecef' | 'enu',
    referenceFrame: options.referenceFrame.trim(),
    epoch: options.epoch,
    ellipsoid: options.ellipsoid,
    originLatDeg: options.originLatDeg,
    originLonDeg: options.originLonDeg,
  };
  const rawBaselines: {
    from: string;
    to: string;
    vector: { x: number; y: number; z: number };
    covariance: import('./gnssBaselineTypes').GnssBaselineCovariance;
    stochasticForm: 'COV' | 'SIGCORR';
    sessionId?: string;
    solutionId?: string;
    sourceTag?: string;
    baselineCode?: string;
    line: number;
  }[] = [];
  const seenCodes = new Set<string>();

  for (let rowIndex = 1; rowIndex < dataLines.length; rowIndex += 1) {
    const row = rowIndex + 1;
    const fields = splitDelimitedLine(dataLines[rowIndex] ?? '', delimiter);
    if (!fields) {
      return fail('GNSS_MALFORMED_CSV', `CSV row ${row} has an unterminated quoted field.`, row);
    }
    const get = (field: string): string => (fields[mapping.get(field) ?? -1] ?? '').trim();
    try {
      const from = get('from');
      const to = get('to');
      if (!from || !to) throw new Error(`CSV row ${row}: from/to must be non-empty.`);
      if (['__proto__', 'prototype', 'constructor'].includes(from)) {
        throw new Error(`CSV row ${row}: invalid from id.`);
      }
      if (['__proto__', 'prototype', 'constructor'].includes(to)) {
        throw new Error(`CSV row ${row}: invalid to id.`);
      }
      const vector = {
        x: parseGnssStrictNumber(get('dx'), 'dx', row),
        y: parseGnssStrictNumber(get('dy'), 'dy', row),
        z: parseGnssStrictNumber(get('dz'), 'dz', row),
      };
      const covariance = useCov
        ? {
            xx: parseGnssStrictNumber(get('cxx'), 'cxx', row),
            xy: parseGnssStrictNumber(get('cxy'), 'cxy', row),
            xz: parseGnssStrictNumber(get('cxz'), 'cxz', row),
            yy: parseGnssStrictNumber(get('cyy'), 'cyy', row),
            yz: parseGnssStrictNumber(get('cyz'), 'cyz', row),
            zz: parseGnssStrictNumber(get('czz'), 'czz', row),
          }
        : (() => {
            const sx = parseGnssStrictNumber(get('sx'), 'sx', row);
            const sy = parseGnssStrictNumber(get('sy'), 'sy', row);
            const sz = parseGnssStrictNumber(get('sz'), 'sz', row);
            const rhoXY = parseGnssStrictNumber(get('rhoXY'), 'rho_xy', row);
            const rhoXZ = parseGnssStrictNumber(get('rhoXZ'), 'rho_xz', row);
            const rhoYZ = parseGnssStrictNumber(get('rhoYZ'), 'rho_yz', row);
            if (sx <= 0 || sy <= 0 || sz <= 0) {
              throw new Error(`CSV row ${row}: sigmas must be positive.`);
            }
            for (const [name, rho] of [['rho_xy', rhoXY], ['rho_xz', rhoXZ], ['rho_yz', rhoYZ]] as const) {
              if (rho < -1 || rho > 1) throw new Error(`CSV row ${row}: ${name}=${rho} outside [-1, 1].`);
            }
            return {
              xx: sx * sx,
              yy: sy * sy,
              zz: sz * sz,
              xy: rhoXY * sx * sy,
              xz: rhoXZ * sx * sz,
              yz: rhoYZ * sy * sz,
            };
          })();
      // Per-row frame columns must resolve to the declared import frame.
      const rowFrame = mapping.has('frame') ? get('frame') : '';
      if (rowFrame && rowFrame !== frame.referenceFrame) {
        return fail('GNSS_FRAME_MISMATCH', `CSV row ${row} frame '${rowFrame}' does not match import frame '${frame.referenceFrame}'.`, row);
      }
      const rowEpoch = mapping.has('epoch') ? get('epoch') : '';
      if (mapping.has('epoch') && !rowEpoch) {
        return fail('GNSS_EPOCH_MISMATCH', `CSV row ${row} has an empty epoch while the epoch column is present.`, row);
      }
      if (rowEpoch && frame.epoch !== undefined && rowEpoch !== frame.epoch) {
        return fail('GNSS_EPOCH_MISMATCH', `CSV row ${row} epoch '${rowEpoch}' does not match import epoch '${frame.epoch}'.`, row);
      }
      if (mapping.has('epoch') && frame.epoch === undefined) {
        frame.epoch = rowEpoch || undefined;
      }
      const rowEllipsoid = mapping.has('ellipsoid') ? get('ellipsoid') : '';
      if (mapping.has('ellipsoid') && !rowEllipsoid) {
        return fail('GNSS_ELLIPSOID_MISMATCH', `CSV row ${row} has an empty ellipsoid while the ellipsoid column is present.`, row);
      }
      if (rowEllipsoid && frame.ellipsoid !== undefined && rowEllipsoid !== frame.ellipsoid) {
        return fail('GNSS_ELLIPSOID_MISMATCH', `CSV row ${row} ellipsoid mismatch.`, row);
      }
      if (mapping.has('ellipsoid') && frame.ellipsoid === undefined) {
        frame.ellipsoid = rowEllipsoid || undefined;
      }
      const baselineCode = mapping.has('id') ? get('id') : undefined;
      if (baselineCode) {
        if (seenCodes.has(baselineCode)) {
          return fail('GNSS_DUPLICATE_ID', `CSV row ${row}: duplicate baseline id '${baselineCode}'.`, row);
        }
        seenCodes.add(baselineCode);
      }
      rawBaselines.push({
        from,
        to,
        vector,
        covariance,
        stochasticForm: useCov ? 'COV' : 'SIGCORR',
        sessionId: mapping.has('session') ? get('session') || undefined : undefined,
        solutionId: mapping.has('solution') ? get('solution') || undefined : undefined,
        sourceTag: mapping.has('source') ? get('source') || undefined : undefined,
        baselineCode: baselineCode || undefined,
        line: row,
      });
    } catch (failure) {
      const message = failure instanceof Error ? failure.message : String(failure);
      if (/strict decimal|not finite/i.test(message)) {
        return fail('GNSS_MALFORMED_NUMERIC', message, row);
      }
      if (/sigmas must be positive|outside \[-1, 1\]/i.test(message)) {
        return fail('GNSS_BAD_SIGCORR', message, row);
      }
      return fail('GNSS_MALFORMED_RECORD', message, row);
    }
  }

  if (rawBaselines.length === 0) {
    return fail('GNSS_NO_BASELINES', 'CSV import found a header but no data rows.');
  }

  // Endpoint/covariance structural checks mirror the native parser.
  for (const raw of rawBaselines) {
    if (raw.from === raw.to) {
      return fail('GNSS_SELF_BASELINE', `CSV row ${raw.line}: self-baseline ${raw.from}->${raw.to}.`, raw.line);
    }
    if (!stations[raw.from]) {
      return fail('GNSS_UNKNOWN_STATION', `CSV row ${raw.line}: unknown FROM station '${raw.from}'.`, raw.line);
    }
    if (!stations[raw.to]) {
      return fail('GNSS_UNKNOWN_STATION', `CSV row ${raw.line}: unknown TO station '${raw.to}'.`, raw.line);
    }
  }

  try {
    // Stations arrive as canonical metres (control CSV normalizes on
    // import); only baseline vectors/covariances carry the CSV units, so
    // station records bypass the unit scale here.
    const network = canonicalizeRawNetwork(
      new Map(
        Object.keys(stations)
          .sort()
          .map((id) => {
            const station = stations[id];
            return [
              id,
              {
                id,
                x: station?.x ?? 0,
                y: station?.y ?? 0,
                z: station?.h ?? 0,
                fixed: !!(station?.fixedX && station?.fixedY && station?.fixedH),
                line: 0,
              },
            ];
          }),
      ),
      rawBaselines,
      frame,
      unit as GnssInputUnits,
      options.sourceFile,
      1,
    );
    const validation = validateGnssBaselineNetwork(network);
    const errors = validation.filter((diagnostic) => diagnostic.severity === 'error');
    if (errors.length > 0) {
      return { network: null, diagnostics: [...diagnostics, ...validation] };
    }
    return { network, diagnostics };
  } catch (failure) {
    return fail('GNSS_CANONICALIZE_FAILED', failure instanceof Error ? failure.message : String(failure));
  }
};

/**
 * Station/control CSV: id,X,Y,Z,fixed with file-level import metadata.
 * Coordinates are interpreted in the declared units and stored canonical.
 */
export const importGnssControlCsv = (
  text: string,
  options: Pick<GnssCsvImportOptions, 'delimiter' | 'units' | 'sourceFile'>,
): { stations: StationMap | null; diagnostics: GnssDiagnostic[] } => {
  const diagnostics: GnssDiagnostic[] = [];
  const fail = (code: string, message: string, row?: number): { stations: null; diagnostics: GnssDiagnostic[] } => {
    diagnostics.push({ severity: 'error', code, message, row });
    return { stations: null, diagnostics };
  };
  const unit = options.units.toLowerCase();
  const scale = unit === 'm' ? 1 : unit === 'mm' ? 0.001 : unit === 'cm' ? 0.01 : Number.NaN;
  if (!Number.isFinite(scale)) {
    return fail('GNSS_UNSUPPORTED_UNITS', `Control CSV units must be M, MM, or CM; got '${options.units}'.`);
  }
  const rawLines = text.split('\n').map((line) => line.replace(/\r$/, ''));
  const dataLines = rawLines.filter((line) => line.trim() !== '' && !line.trim().startsWith('#'));
  if (dataLines.length === 0) {
    return fail('GNSS_NO_BASELINES', 'Control CSV found no header/data rows.');
  }
  const delimiter = options.delimiter ?? sniffDelimiter(dataLines[0] ?? '');
  const headerFields = splitDelimitedLine(dataLines[0] ?? '', delimiter);
  if (!headerFields) {
    return fail('GNSS_MALFORMED_CSV', 'Control CSV header has an unterminated quoted field.');
  }
  const controlAliases: Record<string, string> = {
    id: 'id',
    station: 'id',
    stationid: 'id',
    'station id': 'id',
    point: 'id',
    name: 'id',
    x: 'x',
    easting: 'x',
    y: 'y',
    northing: 'y',
    z: 'z',
    h: 'z',
    height: 'z',
    up: 'z',
    fixed: 'fixed',
    control: 'fixed',
    isfixed: 'fixed',
    constrained: 'fixed',
  };
  const mapping = new Map<string, number>();
  headerFields.forEach((header, index) => {
    const canonical = controlAliases[header.trim().toLowerCase()] ?? null;
    if (canonical && !mapping.has(canonical)) mapping.set(canonical, index);
  });
  for (const required of ['id', 'x', 'y', 'z']) {
    if (!mapping.has(required)) {
      return fail('GNSS_CSV_MISSING_HEADERS', `Control CSV header is missing required column '${required}'.`);
    }
  }
  const stations: StationMap = {};
  for (let rowIndex = 1; rowIndex < dataLines.length; rowIndex += 1) {
    const row = rowIndex + 1;
    const fields = splitDelimitedLine(dataLines[rowIndex] ?? '', delimiter);
    if (!fields) {
      return fail('GNSS_MALFORMED_CSV', `Control CSV row ${row} has an unterminated quoted field.`, row);
    }
    const get = (field: string): string => (fields[mapping.get(field) ?? -1] ?? '').trim();
    const id = get('id');
    if (!id || id.length > 64 || ['__proto__', 'prototype', 'constructor'].includes(id)) {
      return fail('GNSS_MALFORMED_STATION', `Control CSV row ${row}: invalid station id.`, row);
    }
    if (stations[id]) {
      return fail('GNSS_DUPLICATE_STATION', `Control CSV row ${row}: duplicate station '${id}'.`, row);
    }
    try {
      const x = parseGnssStrictNumber(get('x'), 'X', row);
      const y = parseGnssStrictNumber(get('y'), 'Y', row);
      const z = parseGnssStrictNumber(get('z'), 'Z', row);
      const flag = (get('fixed') || 'free').toLowerCase();
      const fixed = ['fixed', 'true', '1', 'yes', 'constrained'].includes(flag);
      if (get('fixed') && !fixed && !['free', 'false', '0', 'no', ''].includes(flag)) {
        return fail('GNSS_MALFORMED_STATION', `Control CSV row ${row}: fixed flag must be FIXED or FREE.`, row);
      }
      stations[id] = {
        x: x * scale,
        y: y * scale,
        h: z * scale,
        fixed,
        fixedX: fixed,
        fixedY: fixed,
        fixedH: fixed,
      };
    } catch (failure) {
      return fail('GNSS_MALFORMED_NUMERIC', failure instanceof Error ? failure.message : String(failure), row);
    }
  }
  void options.sourceFile;
  return { stations, diagnostics };
};
