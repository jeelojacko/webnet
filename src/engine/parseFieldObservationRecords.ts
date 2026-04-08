import { SEC_TO_RAD } from './angles';
import type { SigmaToken } from './parseSigmaResolution';
import type {
  GpsObservation,
  GpsTopoCoordinateShot,
  Instrument,
  InstrumentLibrary,
  LevelObservation,
  Observation,
  ParseCompatibilityMode,
  ParseOptions,
  SigmaSource,
  StationMap,
} from '../types';

type ObservedParsedValue = {
  value: number;
  planned: boolean;
  valid: boolean;
};

type PendingGpsCovarianceObservation = {
  label?: string;
  sourceLine: number;
  from: string;
  to: string;
  dX: number;
  dY: number;
  dZ: number;
  cXX?: number;
  cYY?: number;
  cZZ?: number;
};

export type GpsCovarianceState = {
  pending?: PendingGpsCovarianceObservation;
};

type HandleFieldObservationRecordArgs = {
  code: string;
  parts: string[];
  lineNum: number;
  state: ParseOptions;
  stations: StationMap;
  instrumentLibrary: InstrumentLibrary;
  logs: string[];
  obsIdRef: { current: number };
  compatibilityMode: ParseCompatibilityMode;
  lastGpsObservationRef: { current: GpsObservation | undefined };
  gpsCovarianceStateRef: GpsCovarianceState;
  addCompatibilityDiagnostic: (
    _code: 'ROLE_AMBIGUITY',
    _line: number,
    _recordType: string,
    _message: string,
    _rewriteSuggestion?: string,
    _fallbackApplied?: boolean,
    _severity?: 'warning' | 'error',
  ) => void;
  rejectNumericStationTokens: (
    _recordType: string,
    _sourceLine: number,
    _stationTokens: Array<{ role: string; value: string }>,
  ) => boolean;
  parseSsStationTokens: (
    _parts: string[],
    _separator?: string,
  ) => {
    at: string;
    to: string;
    mode: 'legacy' | 'at-to' | 'at-from-to';
    angleTokenIndex: number;
    explicitBacksight?: string;
  } | null;
  parseAngleTokenRad: (
    _token: string,
    _state: ParseOptions,
    _fallbackMode: 'dms' | 'dd',
  ) => number;
  parseLinearMetersToken: (_token: string | undefined, _units: ParseOptions['units']) => number | null;
  parseObservedLinearToken: (_token: string | undefined, _toMeters: number) => ObservedParsedValue;
  parseSigmaToken: (_token?: string) => SigmaToken | null;
  extractSigmaTokens: (
    _tokens: string[],
    _count: number,
  ) => { sigmas: SigmaToken[]; rest: string[] };
  extractHiHt: (_tokens: string[]) => { hi?: number; ht?: number; rest: string[] };
  linearToMetersFactor: () => number;
  effectiveDistanceMode: () => 'slope' | 'horiz';
  looksLikeNumericMeasurement: (_token: string) => boolean;
  resolveLinearSigma: (
    _token: SigmaToken | undefined,
    _defaultSigma: number,
  ) => { sigma: number; source: SigmaSource };
  resolveAngularSigma: (
    _token: SigmaToken | undefined,
    _defaultSigma: number,
  ) => { sigma: number; source: SigmaSource };
  resolveLevelingSigma: (
    _token: SigmaToken | undefined,
    _inst: Instrument | undefined,
    _spanMeters: number,
    _contextCode: string,
    _sourceLine: number,
  ) => { sigma: number; source: SigmaSource };
  defaultDistanceSigma: (
    _inst: Instrument | undefined,
    _dist: number,
    _edmMode: ParseOptions['edmMode'],
    _fallback?: number,
  ) => number;
  defaultDirectionSigmaSec: (_inst: Instrument | undefined) => number;
  defaultZenithSigmaSec: (_inst: Instrument | undefined) => number;
  defaultElevDiffSigma: (_inst: Instrument | undefined, _distMeters: number) => number;
  applyPlanRotation: (_angleRad: number, _state: ParseOptions) => number;
  wrapTo2Pi: (_value: number) => number;
  pushObservation: (_observation: Observation) => void;
  ftPerM: number;
  traverseCtx: {
    occupy?: string;
    backsight?: string;
  };
};

export const handleFieldObservationRecord = ({
  code,
  parts,
  lineNum,
  state,
  stations,
  instrumentLibrary,
  logs,
  obsIdRef,
  compatibilityMode,
  lastGpsObservationRef,
  gpsCovarianceStateRef,
  addCompatibilityDiagnostic,
  rejectNumericStationTokens,
  parseSsStationTokens,
  parseAngleTokenRad,
  parseLinearMetersToken,
  parseObservedLinearToken,
  parseSigmaToken,
  extractSigmaTokens,
  extractHiHt,
  linearToMetersFactor,
  effectiveDistanceMode,
  looksLikeNumericMeasurement,
  resolveLinearSigma,
  resolveAngularSigma,
  resolveLevelingSigma,
  defaultDistanceSigma,
  defaultDirectionSigmaSec,
  defaultZenithSigmaSec,
  defaultElevDiffSigma: _defaultElevDiffSigma,
  applyPlanRotation,
  wrapTo2Pi,
  pushObservation,
  ftPerM,
  traverseCtx,
}: HandleFieldObservationRecordArgs): boolean => {
  const resetPendingGpsCovariance = (): void => {
    gpsCovarianceStateRef.pending = undefined;
  };

  const currentGpsVectorHorizontalFactor = Math.max(state.gpsVectorFactorHorizontal ?? 1, 1e-12);
  const currentGpsVectorVerticalFactor = Math.max(state.gpsVectorFactorVertical ?? 1, 1e-12);

  if (code === 'SS') {
    const stationTokens = parseSsStationTokens(parts, state.stationSeparator ?? '-');
    if (!stationTokens) {
      logs.push(`Invalid sideshot station token at line ${lineNum}, skipping`);
      return true;
    }
    const from = stationTokens.at;
    const to = stationTokens.to;
    const explicitBacksight =
      stationTokens.mode === 'at-from-to' ? stationTokens.explicitBacksight : undefined;
    const angleTokenIndex = stationTokens.angleTokenIndex;
    if (from === to || from === traverseCtx.backsight || to === traverseCtx.occupy) {
      logs.push(`Invalid sideshot occupy/backsight at line ${lineNum}, skipping`);
      return true;
    }
    if (traverseCtx.occupy && from !== traverseCtx.occupy) {
      logs.push(
        `Sideshot must originate from current occupy (${traverseCtx.occupy}) at line ${lineNum}`,
      );
      return true;
    }
    if (stations[to]?.fixed) {
      logs.push(`Sideshot cannot target fixed/control station (${to}) at line ${lineNum}`);
      return true;
    }
    const instCode = state.currentInstrument ?? '';
    const inst = instCode ? instrumentLibrary[instCode] : undefined;
    const firstTokenRaw = parts[angleTokenIndex] || '';
    const isAzPrefix = /^AZ=/i.test(firstTokenRaw) || firstTokenRaw.startsWith('@');
    const isHzPrefix = /^(HZ|HA|ANG)=/i.test(firstTokenRaw);
    const unprefixedAngleRad = parseAngleTokenRad(firstTokenRaw, state, 'dd');
    const hasUnprefixedAngle =
      !isAzPrefix && !isHzPrefix && Number.isFinite(unprefixedAngleRad);
    const isDmsAngle = firstTokenRaw.includes('-');
    const isSetupAngleByPattern =
      stationTokens.mode === 'legacy' &&
      hasUnprefixedAngle &&
      isDmsAngle &&
      Number.isFinite(parseFloat(parts[angleTokenIndex + 1] || '')) &&
      (!!traverseCtx.backsight || !!explicitBacksight);
    const angleMode: 'none' | 'az' | 'hz' = isAzPrefix
      ? 'az'
      : isHzPrefix
        ? 'hz'
        : stationTokens.mode === 'at-from-to' && hasUnprefixedAngle
          ? 'hz'
          : stationTokens.mode === 'at-to' && hasUnprefixedAngle
            ? 'az'
            : isSetupAngleByPattern
              ? 'hz'
              : 'none';
    let azimuthObs: number | undefined;
    let azimuthStdDev: number | undefined;
    let hzObs: number | undefined;
    let hzStdDev: number | undefined;
    let distIndex = angleTokenIndex;
    let vertIndex = angleTokenIndex + 1;
    let sigmaIndex = angleTokenIndex + 2;
    const resolvedBacksight = explicitBacksight ?? traverseCtx.backsight;
    if (angleMode === 'hz' && !resolvedBacksight) {
      logs.push(`Sideshot setup-angle mode requires a backsight at line ${lineNum}, skipping`);
      return true;
    }
    if (
      explicitBacksight &&
      traverseCtx.backsight &&
      explicitBacksight !== traverseCtx.backsight
    ) {
      logs.push(
        `Sideshot at line ${lineNum}: explicit backsight ${explicitBacksight} differs from active backsight ${traverseCtx.backsight}; explicit backsight used.`,
      );
    }
    if (angleMode !== 'none') {
      const cleanAngle = firstTokenRaw.replace(/^(AZ|HZ|HA|ANG)=/i, '').replace(/^@/, '');
      const angleRad = parseAngleTokenRad(cleanAngle, state, 'dd');
      if (!Number.isFinite(angleRad)) {
        logs.push(`Invalid sideshot horizontal angle/azimuth at line ${lineNum}, skipping`);
        return true;
      }
      if (angleMode === 'az') {
        azimuthObs = applyPlanRotation(angleRad, state);
      } else {
        hzObs = angleRad;
      }
      distIndex = angleTokenIndex + 1;
      vertIndex = angleTokenIndex + 2;
      sigmaIndex = angleTokenIndex + 3;
    }
    const dist = parseFloat(parts[distIndex] || '0');
    const vert = parts[vertIndex];
    if (!Number.isFinite(dist) || dist <= 0) {
      logs.push(`Invalid sideshot distance at line ${lineNum}, skipping`);
      return true;
    }
    const { sigmas, rest } = extractSigmaTokens(parts.slice(sigmaIndex), 3);
    let sigmaAzToken: SigmaToken | undefined;
    let sigmaDistToken: SigmaToken | undefined;
    let sigmaVertToken: SigmaToken | undefined;
    if (angleMode !== 'none') {
      if (vert) {
        if (sigmas.length >= 3) {
          sigmaAzToken = sigmas[0];
          sigmaDistToken = sigmas[1];
          sigmaVertToken = sigmas[2];
        } else if (sigmas.length === 2) {
          sigmaDistToken = sigmas[0];
          sigmaVertToken = sigmas[1];
        } else if (sigmas.length === 1) {
          sigmaDistToken = sigmas[0];
        }
      } else if (sigmas.length >= 2) {
        sigmaAzToken = sigmas[0];
        sigmaDistToken = sigmas[1];
      } else if (sigmas.length === 1) {
        sigmaDistToken = sigmas[0];
      }
      const hzResolved = resolveAngularSigma(sigmaAzToken, defaultDirectionSigmaSec(inst));
      if (angleMode === 'az') {
        azimuthStdDev = hzResolved.sigma * SEC_TO_RAD;
      } else {
        hzStdDev = hzResolved.sigma * SEC_TO_RAD;
      }
    } else {
      sigmaDistToken = sigmas[0];
      sigmaVertToken = sigmas[1];
    }
    const distResolved = resolveLinearSigma(
      sigmaDistToken,
      defaultDistanceSigma(inst, dist, state.edmMode, 0),
    );
    const { hi, ht } = extractHiHt(rest);
    const toMeters = linearToMetersFactor();
    pushObservation({
      id: obsIdRef.current++,
      type: 'dist',
      subtype: 'ts',
      instCode,
      setId: 'SS',
      from,
      to,
      obs: dist * toMeters,
      stdDev: distResolved.sigma * toMeters,
      sigmaSource: distResolved.source,
      mode: effectiveDistanceMode(),
      hi: hi != null ? hi * toMeters : undefined,
      ht: ht != null ? ht * toMeters : undefined,
      calc: {
        sideshot: true,
        azimuthObs,
        azimuthStdDev,
        hzObs,
        hzStdDev,
        backsightId: hzObs != null ? resolvedBacksight : undefined,
        azimuthSource: azimuthObs != null ? 'explicit' : hzObs != null ? 'setup' : 'target',
      },
    });
    if (vert) {
      if (state.deltaMode === 'horiz') {
        const dh = parseFloat(vert) * toMeters;
        const dhResolved = resolveLevelingSigma(
          sigmaVertToken,
          inst,
          dist * toMeters,
          'SS',
          lineNum,
        );
        pushObservation({
          id: obsIdRef.current++,
          type: 'lev',
          instCode,
          from,
          to,
          obs: dh,
          lenKm: 0,
          stdDev: dhResolved.sigma * toMeters,
          sigmaSource: dhResolved.source,
          calc: { sideshot: true },
        });
      } else {
        const zenRad = parseAngleTokenRad(vert, state, 'dd');
        const zenResolved = resolveAngularSigma(sigmaVertToken, defaultZenithSigmaSec(inst));
        pushObservation({
          id: obsIdRef.current++,
          type: 'zenith',
          instCode,
          from,
          to,
          obs: zenRad,
          stdDev: zenResolved.sigma * SEC_TO_RAD,
          sigmaSource: zenResolved.source,
          hi: hi != null ? hi * toMeters : undefined,
          ht: ht != null ? ht * toMeters : undefined,
          calc: { sideshot: true },
        });
      }
    }
    return true;
  }

  if (code === 'GS') {
    const pointId = parts[1];
    if (!pointId) {
      logs.push(`Invalid GS record at line ${lineNum}, missing point identifier.`);
      return true;
    }
    const payload = parts.slice(2);
    let fromId: string | undefined;
    const numericTokens: string[] = [];
    payload.forEach((token) => {
      if (/^FROM=/i.test(token)) {
        const candidate = token.split('=').slice(1).join('=').trim();
        if (candidate) fromId = candidate;
        return;
      }
      numericTokens.push(token);
    });
    if (numericTokens.length < 2) {
      logs.push(`Invalid GS record at line ${lineNum}, expected at least E/N coordinates.`);
      return true;
    }
    const c1 = parseFloat(numericTokens[0]);
    const c2 = parseFloat(numericTokens[1]);
    if (!Number.isFinite(c1) || !Number.isFinite(c2)) {
      logs.push(`Invalid GS coordinate token(s) at line ${lineNum}, skipping.`);
      return true;
    }
    const tail = numericTokens.slice(2).map((token) => parseFloat(token));
    if (tail.some((value) => !Number.isFinite(value))) {
      logs.push(`Invalid GS numeric payload at line ${lineNum}, skipping.`);
      return true;
    }
    const toMeters = linearToMetersFactor();
    const east = state.order === 'EN' ? c1 * toMeters : c2 * toMeters;
    const north = state.order === 'EN' ? c2 * toMeters : c1 * toMeters;
    let height: number | undefined;
    let sigma1: number | undefined;
    let sigma2: number | undefined;
    let sigmaH: number | undefined;
    if (tail.length === 1) {
      height = tail[0] * toMeters;
    } else if (tail.length === 2) {
      sigma1 = tail[0] * toMeters;
      sigma2 = tail[1] * toMeters;
    } else if (tail.length === 3) {
      height = tail[0] * toMeters;
      sigma1 = tail[1] * toMeters;
      sigma2 = tail[2] * toMeters;
    } else if (tail.length >= 4) {
      height = tail[0] * toMeters;
      sigma1 = tail[1] * toMeters;
      sigma2 = tail[2] * toMeters;
      sigmaH = tail[3] * toMeters;
      if (tail.length > 4) {
        logs.push(`Warning: extra GS tokens ignored at line ${lineNum} (expected up to sigmaH).`);
      }
    }
    const sigmaE = state.order === 'EN' ? sigma1 : sigma2;
    const sigmaN = state.order === 'EN' ? sigma2 : sigma1;
    const shot: GpsTopoCoordinateShot = {
      pointId,
      east,
      north,
      height,
      sigmaE,
      sigmaN,
      sigmaH,
      fromId,
      sourceLine: lineNum,
    };
    state.gpsTopoShots?.push(shot);
    return true;
  }

  if (code === 'G0') {
    const label = parts.slice(1).join(' ').trim().replace(/^'+/, '');
    if (gpsCovarianceStateRef.pending) {
      logs.push(
        `Warning: GNSS covariance vector block at line ${gpsCovarianceStateRef.pending.sourceLine} was incomplete before G0 line ${lineNum}; pending block discarded.`,
      );
      resetPendingGpsCovariance();
    }
    gpsCovarianceStateRef.pending = {
      label,
      sourceLine: lineNum,
      from: '',
      to: '',
      dX: 0,
      dY: 0,
      dZ: 0,
    };
    return true;
  }

  if (code === 'G1') {
    const pairToken = parts[1] ?? '';
    const [from, to] = pairToken.split('-', 2);
    const dX = Number.parseFloat(parts[2] || '');
    const dY = Number.parseFloat(parts[3] || '');
    const dZ = Number.parseFloat(parts[4] || '');
    if (!from || !to || !Number.isFinite(dX) || !Number.isFinite(dY) || !Number.isFinite(dZ)) {
      logs.push(`Invalid GNSS covariance vector (G1) at line ${lineNum}, skipping.`);
      resetPendingGpsCovariance();
      return true;
    }
    const pending = gpsCovarianceStateRef.pending ?? {
      sourceLine: lineNum,
      from: '',
      to: '',
      dX: 0,
      dY: 0,
      dZ: 0,
    };
    gpsCovarianceStateRef.pending = {
      ...pending,
      sourceLine: lineNum,
      from,
      to,
      dX,
      dY,
      dZ,
    };
    return true;
  }

  if (code === 'G2') {
    const pending = gpsCovarianceStateRef.pending;
    if (!pending || !pending.from || !pending.to) {
      logs.push(`Warning: GNSS covariance row (G2) at line ${lineNum} has no active G1 vector; ignored.`);
      return true;
    }
    const cXX = Number.parseFloat(parts[1] || '');
    const cYY = Number.parseFloat(parts[2] || '');
    const cZZ = Number.parseFloat(parts[3] || '');
    if (!Number.isFinite(cXX) || !Number.isFinite(cYY) || !Number.isFinite(cZZ)) {
      logs.push(`Invalid GNSS covariance diagonal (G2) at line ${lineNum}, skipping pending block.`);
      resetPendingGpsCovariance();
      return true;
    }
    gpsCovarianceStateRef.pending = {
      ...pending,
      dX: pending.dX,
      dY: pending.dY,
      dZ: pending.dZ,
      label: pending.label,
      sourceLine: pending.sourceLine,
      from: pending.from,
      to: pending.to,
    };
    gpsCovarianceStateRef.pending.cXX = cXX;
    gpsCovarianceStateRef.pending.cYY = cYY;
    gpsCovarianceStateRef.pending.cZZ = cZZ;
    return true;
  }

  if (code === 'G3') {
    const pending = gpsCovarianceStateRef.pending;
    if (!pending || !pending.from || !pending.to) {
      logs.push(`Warning: GNSS covariance row (G3) at line ${lineNum} has no active G1 vector; ignored.`);
      return true;
    }
    const cXY = Number.parseFloat(parts[1] || '');
    const cXZ = Number.parseFloat(parts[2] || '');
    const cYZ = Number.parseFloat(parts[3] || '');
    if (
      !Number.isFinite(pending.cXX) ||
      !Number.isFinite(pending.cYY) ||
      !Number.isFinite(pending.cZZ) ||
      !Number.isFinite(cXY) ||
      !Number.isFinite(cXZ) ||
      !Number.isFinite(cYZ)
    ) {
      logs.push(`Invalid GNSS covariance block ending at line ${lineNum}, skipping pending vector.`);
      resetPendingGpsCovariance();
      return true;
    }
    const horizontalFactorSquared = currentGpsVectorHorizontalFactor * currentGpsVectorHorizontalFactor;
    const verticalFactorSquared = currentGpsVectorVerticalFactor * currentGpsVectorVerticalFactor;
    const obs: GpsObservation = {
      id: obsIdRef.current++,
      type: 'gps',
      gpsMode: state.gpsVectorMode ?? 'network',
      gpsWeightingMode: 'covariance',
      gnssVectorFrame: 'ecefDelta',
      gnssFrameConfirmed: state.gnssFrameConfirmed ?? false,
      gpsVectorLabel: pending.label,
      gpsVectorHorizontalFactor: currentGpsVectorHorizontalFactor,
      gpsVectorVerticalFactor: currentGpsVectorVerticalFactor,
      instCode: '',
      from: pending.from,
      to: pending.to,
      obs: {
        dE: pending.dX,
        dN: pending.dY,
        dU: pending.dZ,
      },
      stdDev: Math.sqrt(
        Math.max(
          0,
          (pending.cXX ?? 0) * horizontalFactorSquared +
            (pending.cYY ?? 0) * horizontalFactorSquared +
            (pending.cZZ ?? 0) * verticalFactorSquared,
        ) / 3,
      ),
      sigmaSource: 'explicit',
      gpsCovariance3d: {
        cXX: (pending.cXX ?? 0) * horizontalFactorSquared,
        cYY: (pending.cYY ?? 0) * horizontalFactorSquared,
        cZZ: (pending.cZZ ?? 0) * verticalFactorSquared,
        cXY: cXY * horizontalFactorSquared,
        cXZ: cXZ * currentGpsVectorHorizontalFactor * currentGpsVectorVerticalFactor,
        cYZ: cYZ * currentGpsVectorHorizontalFactor * currentGpsVectorVerticalFactor,
      },
      sourceLine: pending.sourceLine,
    };
    pushObservation(obs);
    lastGpsObservationRef.current = obs;
    resetPendingGpsCovariance();
    return true;
  }

  if (code === 'G') {
    const toMeters = linearToMetersFactor();
    const candidates: Array<{
      instCode: string;
      from: string;
      to: string;
      explicitForm: boolean;
      numericStart: number;
      dEParsed: ObservedParsedValue;
      dNParsed: ObservedParsedValue;
    }> = [];
    const pushGpsCandidate = (
      instCode: string,
      from: string,
      to: string,
      numericStart: number,
      explicitForm: boolean,
    ) => {
      if (!from || !to) return;
      const dEParsed = parseObservedLinearToken(parts[numericStart], toMeters);
      const dNParsed = parseObservedLinearToken(parts[numericStart + 1], toMeters);
      if (!dEParsed.valid || !dNParsed.valid) return;
      candidates.push({
        instCode,
        from,
        to,
        explicitForm,
        numericStart,
        dEParsed,
        dNParsed,
      });
    };
    pushGpsCandidate(parts[1] ?? '', parts[2] ?? '', parts[3] ?? '', 4, true);
    pushGpsCandidate('', parts[1] ?? '', parts[2] ?? '', 3, false);
    if (candidates.length === 0) {
      logs.push(`Invalid GPS vector at line ${lineNum}, skipping.`);
      return true;
    }
    const scored = candidates.map((candidate) => {
      let score = 0;
      if (stations[candidate.from]) score += 2;
      if (stations[candidate.to]) score += 2;
      if (candidate.explicitForm) score += 1;
      if (candidate.instCode && instrumentLibrary[candidate.instCode]) score += 2;
      if (candidate.explicitForm && candidate.instCode && !stations[candidate.instCode]) {
        score += 1;
      }
      if (
        looksLikeNumericMeasurement(candidate.from) ||
        looksLikeNumericMeasurement(candidate.to)
      ) {
        score -= 12;
      }
      return { candidate, score };
    });
    scored.sort((a, b) => b.score - a.score);
    const best = scored[0];
    const tie = scored.length > 1 && scored[1].score === best.score;
    if (tie) {
      const rewrite =
        'Use explicit form: G <inst?> <from> <to> <dE> <dN> [sigmaE sigmaN [corr]].';
      if (compatibilityMode === 'strict') {
        addCompatibilityDiagnostic(
          'ROLE_AMBIGUITY',
          lineNum,
          'G',
          'multiple valid G-record interpretations were found.',
          rewrite,
          false,
          'error',
        );
        return true;
      }
      addCompatibilityDiagnostic(
        'ROLE_AMBIGUITY',
        lineNum,
        'G',
        'multiple valid G-record interpretations were found; applied legacy fallback.',
        rewrite,
        true,
      );
    }
    const chosen = best.candidate;
    const instCode = chosen.instCode;
    const from = chosen.from;
    const to = chosen.to;
    if (
      rejectNumericStationTokens('G', lineNum, [
        { role: 'FROM', value: from },
        { role: 'TO', value: to },
      ])
    ) {
      return true;
    }
    const { sigmas, rest } = extractSigmaTokens(parts.slice(chosen.numericStart + 2), 2);
    const corrRaw = parseFloat(rest[0] || '');
    const inst = instrumentLibrary[instCode];
    const defaultStd = inst?.gpsStd_xy ?? 0;
    const sigmaEResolved = resolveLinearSigma(sigmas[0], defaultStd);
    const sigmaNResolved = resolveLinearSigma(sigmas[1], sigmaEResolved.sigma);
    let sigmaE = sigmaEResolved.sigma;
    let sigmaN = sigmaNResolved.sigma;
    const corr = Number.isNaN(corrRaw) ? 0 : Math.max(-0.999, Math.min(0.999, corrRaw));

    if (inst && inst.gpsStd_xy > 0) {
      sigmaE = Math.sqrt(sigmaE * sigmaE + inst.gpsStd_xy * inst.gpsStd_xy);
      sigmaN = Math.sqrt(sigmaN * sigmaN + inst.gpsStd_xy * inst.gpsStd_xy);
    }
    const sigmaMean = Math.sqrt((sigmaE * sigmaE + sigmaN * sigmaN) / 2);

    const obs: GpsObservation = {
      id: obsIdRef.current++,
      type: 'gps',
      gpsMode: state.gpsVectorMode ?? 'network',
      gnssVectorFrame: state.gnssVectorFrameDefault ?? 'gridNEU',
      gnssFrameConfirmed: state.gnssFrameConfirmed ?? false,
      gpsAntennaHiM: state.gpsAddHiHtEnabled ? (state.gpsAddHiHtHiM ?? 0) : undefined,
      gpsAntennaHtM: state.gpsAddHiHtEnabled ? (state.gpsAddHiHtHtM ?? 0) : undefined,
      instCode,
      from,
      to,
      planned: chosen.dEParsed.planned || chosen.dNParsed.planned,
      obs: {
        dE: chosen.dEParsed.value,
        dN: chosen.dNParsed.value,
      },
      stdDev: state.units === 'ft' ? sigmaMean / ftPerM : sigmaMean,
      stdDevE: state.units === 'ft' ? sigmaE / ftPerM : sigmaE,
      stdDevN: state.units === 'ft' ? sigmaN / ftPerM : sigmaN,
      sigmaSourceE: sigmaEResolved.source,
      sigmaSourceN: sigmaNResolved.source,
      corrEN: corr,
      sigmaSource:
        sigmaEResolved.source === sigmaNResolved.source
          ? sigmaEResolved.source
          : sigmaEResolved.source === 'fixed' || sigmaNResolved.source === 'fixed'
            ? 'fixed'
            : sigmaEResolved.source === 'explicit' || sigmaNResolved.source === 'explicit'
              ? 'explicit'
              : sigmaEResolved.source === 'float' || sigmaNResolved.source === 'float'
                ? 'float'
                : 'default',
    };
    pushObservation(obs);
    lastGpsObservationRef.current = obs;
    return true;
  }

  if (code === 'G4') {
    const lastGpsObservation = lastGpsObservationRef.current;
    if (!lastGpsObservation) {
      logs.push(
        `Warning: GPS rover offset (G4) at line ${lineNum} has no preceding G vector; ignored.`,
      );
      return true;
    }
    const azimuth = parseAngleTokenRad(parts[1], state, 'dms');
    const distanceM = parseLinearMetersToken(parts[2], state.units);
    const zenith = parseAngleTokenRad(parts[3], state, 'dms');
    if (
      !Number.isFinite(azimuth) ||
      !Number.isFinite(distanceM ?? Number.NaN) ||
      !Number.isFinite(zenith)
    ) {
      logs.push(
        `Warning: invalid GPS rover offset (G4) at line ${lineNum}; expected azimuth, distance, and zenith.`,
      );
      return true;
    }
    if (parts.length > 4) {
      logs.push(
        `Warning: extra GPS rover offset (G4) tokens ignored at line ${lineNum}; expected azimuth, distance, and zenith only.`,
      );
    }
    const horizDistance = (distanceM as number) * Math.sin(zenith);
    const deltaH = (distanceM as number) * Math.cos(zenith);
    const deltaE = horizDistance * Math.sin(azimuth);
    const deltaN = horizDistance * Math.cos(azimuth);
    if (lastGpsObservation.gpsOffsetDistanceM != null) {
      logs.push(
        `Warning: GPS rover offset (G4) at line ${lineNum} replaced an earlier offset on ${lastGpsObservation.from}-${lastGpsObservation.to}.`,
      );
    }
    lastGpsObservation.gpsOffsetAzimuthRad = wrapTo2Pi(azimuth);
    lastGpsObservation.gpsOffsetDistanceM = distanceM as number;
    lastGpsObservation.gpsOffsetZenithRad = zenith;
    lastGpsObservation.gpsOffsetDeltaE = deltaE;
    lastGpsObservation.gpsOffsetDeltaN = deltaN;
    lastGpsObservation.gpsOffsetDeltaH = deltaH;
    lastGpsObservation.gpsOffsetSourceLine = lineNum;
    logs.push(
      `GPS rover offset attached to ${lastGpsObservation.from}-${lastGpsObservation.to}: dE=${deltaE.toFixed(4)} m, dN=${deltaN.toFixed(4)} m, dH=${deltaH.toFixed(4)} m`,
    );
    return true;
  }

  if (code === 'L') {
    const toMeters = linearToMetersFactor();
    const differentialLevelSigmaFromKm = (mmPerRootKm: number | undefined, lenKm: number): number =>
      mmPerRootKm != null && Number.isFinite(mmPerRootKm) && mmPerRootKm > 0 && lenKm > 0
        ? (mmPerRootKm * Math.sqrt(lenKm)) / 1000
        : 0;
    const candidates: Array<{
      instCode: string;
      from: string;
      to: string;
      explicitForm: boolean;
      valueStart: number;
      dHParsed: ObservedParsedValue;
    }> = [];
    const pushLevelCandidate = (
      instCode: string,
      from: string,
      to: string,
      valueStart: number,
      explicitForm: boolean,
    ) => {
      if (!from || !to) return;
      const dHParsed = parseObservedLinearToken(parts[valueStart], toMeters);
      if (!dHParsed.valid) return;
      candidates.push({ instCode, from, to, explicitForm, valueStart, dHParsed });
    };
    const pushHyphenLevelCandidate = (
      instCode: string,
      stationPairToken: string,
      valueStart: number,
      explicitForm: boolean,
    ) => {
      const separator = state.stationSeparator ?? '-';
      const separatorIndex = stationPairToken.indexOf(separator);
      if (separatorIndex <= 0 || separatorIndex >= stationPairToken.length - separator.length) {
        return;
      }
      const from = stationPairToken.slice(0, separatorIndex).trim();
      const to = stationPairToken.slice(separatorIndex + separator.length).trim();
      pushLevelCandidate(instCode, from, to, valueStart, explicitForm);
    };
    pushLevelCandidate(parts[1] ?? '', parts[2] ?? '', parts[3] ?? '', 4, true);
    pushLevelCandidate(state.currentInstrument ?? '', parts[1] ?? '', parts[2] ?? '', 3, false);
    pushHyphenLevelCandidate(parts[1] ?? '', parts[2] ?? '', 3, true);
    pushHyphenLevelCandidate(state.currentInstrument ?? '', parts[1] ?? '', 2, false);
    if (candidates.length === 0) {
      logs.push(`Invalid leveling observation at line ${lineNum}, skipping.`);
      return true;
    }
    const scored = candidates.map((candidate) => {
      let score = 0;
      if (stations[candidate.from]) score += 2;
      if (stations[candidate.to]) score += 2;
      if (candidate.explicitForm) score += 1;
      if (candidate.instCode && instrumentLibrary[candidate.instCode]) score += 2;
      if (candidate.explicitForm && candidate.instCode && !stations[candidate.instCode]) {
        score += 1;
      }
      if (
        looksLikeNumericMeasurement(candidate.from) ||
        looksLikeNumericMeasurement(candidate.to)
      ) {
        score -= 12;
      }
      return { candidate, score };
    });
    scored.sort((a, b) => b.score - a.score);
    const best = scored[0];
    const tie = scored.length > 1 && scored[1].score === best.score;
    if (tie) {
      const rewrite = 'Use explicit form: L <inst?> <from> <to> <dH> <length> [sigma].';
      if (compatibilityMode === 'strict') {
        addCompatibilityDiagnostic(
          'ROLE_AMBIGUITY',
          lineNum,
          'L',
          'multiple valid L-record interpretations were found.',
          rewrite,
          false,
          'error',
        );
        return true;
      }
      addCompatibilityDiagnostic(
        'ROLE_AMBIGUITY',
        lineNum,
        'L',
        'multiple valid L-record interpretations were found; applied legacy fallback.',
        rewrite,
        true,
      );
    }
    const chosen = best.candidate;
    const instCode = chosen.instCode;
    const from = chosen.from;
    const to = chosen.to;
    if (
      rejectNumericStationTokens('L', lineNum, [
        { role: 'FROM', value: from },
        { role: 'TO', value: to },
      ])
    ) {
      return true;
    }
    const lenRaw = parseFloat(parts[chosen.valueStart + 1] || '0');
    const lenKm =
      Number.isFinite(lenRaw) && lenRaw > 0
        ? state.units === 'ft'
          ? lenRaw / ftPerM / 1000
          : lenRaw / 1000
        : 0;
    const sigmaToken = parseSigmaToken(parts[chosen.valueStart + 2]) ?? undefined;
    const baseStd = differentialLevelSigmaFromKm(state.levelWeight, lenKm);
    const hasExplicitSigma = sigmaToken != null;
    if (!hasExplicitSigma && state.levelWeight != null) {
      logs.push(`.LWEIGHT applied for leveling at line ${lineNum}: ${state.levelWeight} mm/km`);
    }

    const inst = instrumentLibrary[instCode];
    const projectDefaultInst = state.projectDefaultInstrument
      ? instrumentLibrary[state.projectDefaultInstrument]
      : undefined;
    const levelResolved = resolveLinearSigma(sigmaToken, baseStd);
    let sigma = levelResolved.sigma;
    if (!hasExplicitSigma && inst && inst.levStd_mmPerKm > 0) {
      const lib = differentialLevelSigmaFromKm(inst.levStd_mmPerKm, lenKm);
      sigma = Math.sqrt(sigma * sigma + lib * lib);
    } else if (
      !hasExplicitSigma &&
      (!inst || !(inst.levStd_mmPerKm > 0)) &&
      projectDefaultInst &&
      projectDefaultInst.levStd_mmPerKm > 0
    ) {
      const lib = differentialLevelSigmaFromKm(projectDefaultInst.levStd_mmPerKm, lenKm);
      sigma = Math.sqrt(sigma * sigma + lib * lib);
    }

    const obs: LevelObservation = {
      id: obsIdRef.current++,
      type: 'lev',
      instCode,
      from,
      to,
      obs: chosen.dHParsed.value,
      planned: chosen.dHParsed.planned,
      lenKm,
      stdDev: sigma,
      sigmaSource: levelResolved.source,
    };
    pushObservation(obs);
    return true;
  }

  return false;
};
