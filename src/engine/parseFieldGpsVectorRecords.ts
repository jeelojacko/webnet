import type {
  HandleFieldObservationRecordArgs,
  ObservedParsedValue,
} from './parseFieldObservationRecords.types';
import type { GpsObservation } from '../types';

const resetPendingGpsCovariance = ({
  gpsCovarianceStateRef,
}: HandleFieldObservationRecordArgs): void => {
  gpsCovarianceStateRef.pending = undefined;
};

export const handleFieldGpsVectorRecord = (args: HandleFieldObservationRecordArgs): boolean => {
  const {
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
    parseAngleTokenRad,
    parseLinearMetersToken,
    parseObservedLinearToken,
    extractSigmaTokens,
    linearToMetersFactor,
    looksLikeNumericMeasurement,
    resolveLinearSigma,
    pushObservation,
    ftPerM,
    wrapTo2Pi,
  } = args;

  const currentGpsVectorHorizontalFactor = Math.max(state.gpsVectorFactorHorizontal ?? 1, 1e-12);
  const currentGpsVectorVerticalFactor = Math.max(state.gpsVectorFactorVertical ?? 1, 1e-12);

  if (code === 'G0') {
    const label = parts.slice(1).join(' ').trim().replace(/^'+/, '');
    if (gpsCovarianceStateRef.pending) {
      logs.push(
        `Warning: GNSS covariance vector block at line ${gpsCovarianceStateRef.pending.sourceLine} was incomplete before G0 line ${lineNum}; pending block discarded.`,
      );
      resetPendingGpsCovariance(args);
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
      resetPendingGpsCovariance(args);
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
      resetPendingGpsCovariance(args);
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
      resetPendingGpsCovariance(args);
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
    resetPendingGpsCovariance(args);
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
      if (looksLikeNumericMeasurement(candidate.from) || looksLikeNumericMeasurement(candidate.to)) {
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
      logs.push(`Warning: GPS rover offset (G4) at line ${lineNum} has no preceding G vector; ignored.`);
      return true;
    }
    const azimuth = parseAngleTokenRad(parts[1], state, 'dms');
    const distanceM = parseLinearMetersToken(parts[2], state.units);
    const zenith = parseAngleTokenRad(parts[3], state, 'dms');
    if (!Number.isFinite(azimuth) || !Number.isFinite(distanceM ?? Number.NaN) || !Number.isFinite(zenith)) {
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

  return false;
};
