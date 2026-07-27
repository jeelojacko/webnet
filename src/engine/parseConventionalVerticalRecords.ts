import { SEC_TO_RAD } from './angles';
import type { HandleConventionalPrimitiveRecordArgs } from './parseConventionalObservationRecords.types';
import type { LevelObservation } from '../types';

export const handleConventionalVerticalRecord = ({
  code,
  parts,
  lineNum,
  state,
  instrumentLibrary,
  logs,
  obsIdRef,
  parseFromTo,
  extractSigmaTokens,
  parseObservedLinearToken,
  parseObservedAngleToken,
  linearToMetersFactor,
  resolveAngularSigma,
  resolveLevelingSigma,
  defaultZenithSigmaSec,
  pushObservation,
}: HandleConventionalPrimitiveRecordArgs): boolean => {
  if (code !== 'V') return false;

  const { from, to, nextIndex } = parseFromTo(parts, 1, state.stationSeparator ?? '-');
  const valToken = parts[nextIndex];
  const stdTokens = parts.slice(nextIndex + 1);
  const { sigmas } = extractSigmaTokens(stdTokens, 1);
  const toMeters = linearToMetersFactor();
  const inst = state.currentInstrument ? instrumentLibrary[state.currentInstrument] : undefined;
  if (state.deltaMode === 'horiz') {
    const dhParsed = parseObservedLinearToken(valToken, toMeters);
    if (!dhParsed.valid) {
      logs.push(`Invalid vertical difference at line ${lineNum}, skipping V record.`);
      return true;
    }
    const resolved = resolveLevelingSigma(sigmas[0], inst, 0, 'V', lineNum);
    const obs: LevelObservation = {
      id: obsIdRef.current++,
      type: 'lev',
      instCode: state.currentInstrument ?? '',
      from,
      to,
      obs: dhParsed.value,
      planned: dhParsed.planned,
      lenKm: 0,
      stdDev: resolved.sigma * toMeters,
      sigmaSource: resolved.source,
    };
    pushObservation(obs);
  } else {
    const zenParsed = parseObservedAngleToken(valToken, 'dd');
    if (!zenParsed.valid) {
      logs.push(`Invalid zenith at line ${lineNum}, skipping V record.`);
      return true;
    }
    if (state.threeReduceMode) {
      logs.push(
        `3REDUCE active at line ${lineNum}: V zenith record parsed for traceability and excluded from equations.`,
      );
      return true;
    }
    const base = defaultZenithSigmaSec(inst);
    const resolved = resolveAngularSigma(sigmas[0], base);
    pushObservation({
      id: obsIdRef.current++,
      type: 'zenith',
      instCode: state.currentInstrument ?? '',
      from,
      to,
      obs: zenParsed.value,
      planned: zenParsed.planned,
      stdDev: resolved.sigma * SEC_TO_RAD,
      sigmaSource: resolved.source,
    });
  }
  return true;
};

export const handleConventionalDistanceVerticalRecord = ({
  code,
  parts,
  lineNum,
  state,
  instrumentLibrary,
  logs,
  obsIdRef,
  parseFromTo,
  extractSigmaTokens,
  extractHiHt,
  parseObservedLinearToken,
  parseObservedAngleToken,
  linearToMetersFactor,
  effectiveDistanceMode,
  resolveLinearSigma,
  resolveAngularSigma,
  resolveLevelingSigma,
  defaultDistanceSigma,
  defaultZenithSigmaSec,
  pushObservation,
}: HandleConventionalPrimitiveRecordArgs): boolean => {
  if (code !== 'DV') return false;

  const { from, to, nextIndex } = parseFromTo(parts, 1, state.stationSeparator ?? '-');
  const toMeters = linearToMetersFactor();
  const instCode = state.currentInstrument ?? '';
  const inst = instCode ? instrumentLibrary[instCode] : undefined;
  if (state.deltaMode === 'horiz') {
    const distParsed = parseObservedLinearToken(parts[nextIndex], toMeters);
    const dhParsed = parseObservedLinearToken(parts[nextIndex + 1], toMeters);
    if (!distParsed.valid || !dhParsed.valid) {
      logs.push(`Invalid DV horizontal record at line ${lineNum}, skipping.`);
      return true;
    }
    const restTokens = parts.slice(nextIndex + 2);
    const { sigmas, rest } = extractSigmaTokens(restTokens, 2);
    const { hi, ht } = extractHiHt(rest);
    const defaultDist = defaultDistanceSigma(
      inst,
      distParsed.planned ? 0 : Number.parseFloat(parts[nextIndex]),
      state.edmMode,
      0,
    );
    const distResolved = resolveLinearSigma(sigmas[0], defaultDist);
    const dhResolved = resolveLevelingSigma(sigmas[1], inst, Math.abs(distParsed.value), 'DV', lineNum);
    pushObservation({
      id: obsIdRef.current++,
      type: 'dist',
      subtype: 'ts',
      instCode,
      setId: '',
      from,
      to,
      obs: distParsed.value,
      planned: distParsed.planned,
      stdDev: distResolved.sigma * toMeters,
      sigmaSource: distResolved.source,
      hi: hi != null ? hi * toMeters : undefined,
      ht: ht != null ? ht * toMeters : undefined,
      mode: 'horiz',
    });
    pushObservation({
      id: obsIdRef.current++,
      type: 'lev',
      instCode,
      from,
      to,
      obs: dhParsed.value,
      planned: dhParsed.planned,
      lenKm: 0,
      stdDev: dhResolved.sigma * toMeters,
      sigmaSource: dhResolved.source,
    });
  } else {
    const distParsed = parseObservedLinearToken(parts[nextIndex], toMeters);
    const zen = parts[nextIndex + 1];
    const zenParsed = parseObservedAngleToken(zen, 'dd');
    if (!distParsed.valid || !zenParsed.valid) {
      logs.push(`Invalid DV slope record at line ${lineNum}, skipping.`);
      return true;
    }
    const restTokens = parts.slice(nextIndex + 2);
    const { sigmas, rest } = extractSigmaTokens(restTokens, 2);
    const { hi, ht } = extractHiHt(rest);
    const defaultDist = defaultDistanceSigma(
      inst,
      distParsed.planned ? 0 : Number.parseFloat(parts[nextIndex]),
      state.edmMode,
      0,
    );
    const distResolved = resolveLinearSigma(sigmas[0], defaultDist);
    const zenResolved = resolveAngularSigma(sigmas[1], defaultZenithSigmaSec(inst));
    let distObs = distParsed.value;
    let distStdDev = distResolved.sigma * toMeters;
    let distMode: 'slope' | 'horiz' = effectiveDistanceMode();
    if (state.threeReduceMode) {
      const sigmaZ = zenResolved.sigma * SEC_TO_RAD;
      distObs = distParsed.value * Math.sin(zenParsed.value);
      distStdDev = Math.sqrt(
        (Math.sin(zenParsed.value) * distResolved.sigma * toMeters) ** 2 +
          (distParsed.value * Math.cos(zenParsed.value) * sigmaZ) ** 2,
      );
      distMode = 'horiz';
    }
    pushObservation({
      id: obsIdRef.current++,
      type: 'dist',
      subtype: 'ts',
      instCode,
      setId: '',
      from,
      to,
      obs: distObs,
      planned: distParsed.planned,
      stdDev: distStdDev,
      sigmaSource: distResolved.source,
      hi: hi != null ? hi * toMeters : undefined,
      ht: ht != null ? ht * toMeters : undefined,
      mode: distMode,
    });
    if (!state.threeReduceMode) {
      pushObservation({
        id: obsIdRef.current++,
        type: 'zenith',
        instCode,
        from,
        to,
        obs: zenParsed.value,
        planned: zenParsed.planned,
        stdDev: zenResolved.sigma * SEC_TO_RAD,
        sigmaSource: zenResolved.source,
        hi: hi != null ? hi * toMeters : undefined,
        ht: ht != null ? ht * toMeters : undefined,
      });
    }
  }
  return true;
};
