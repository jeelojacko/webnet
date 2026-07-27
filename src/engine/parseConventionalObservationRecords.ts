import { SEC_TO_RAD } from './angles';
import { handleConventionalDistanceOrAngleRecord } from './parseConventionalDistanceAngleRecords';
import type { HandleConventionalPrimitiveRecordArgs } from './parseConventionalObservationRecords.types';
import type { SigmaToken } from './parseSigmaResolution';
import {
  handleConventionalDistanceVerticalRecord,
  handleConventionalVerticalRecord,
} from './parseConventionalVerticalRecords';

export const handleConventionalPrimitiveRecord = (
  args: HandleConventionalPrimitiveRecordArgs,
): boolean => {
  if (handleConventionalDistanceOrAngleRecord(args)) return true;
  if (handleConventionalVerticalRecord(args)) return true;
  if (handleConventionalDistanceVerticalRecord(args)) return true;

  const {
    code,
    parts,
    lineNum,
    state,
    instrumentLibrary,
    logs,
    obsIdRef,
    parseFromTo,
    splitStationPairToken,
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
    defaultHorizontalAngleSigmaSec,
    defaultAzimuthSigmaSec,
    defaultZenithSigmaSec,
    applyPlanRotation,
    pushObservation,
    face2Weight,
  } = args;
  if (code === 'BM') {
    const from = parts[1];
    const to = parts[2];
    const bearing = parts[3];
    const toMeters = linearToMetersFactor();
    const distParsed = parseObservedLinearToken(parts[4], toMeters);
    const bearingParsed = parseObservedAngleToken(bearing, 'dd');
    const vert = parts[5];
    if (!distParsed.valid || !bearingParsed.valid) {
      logs.push(`Invalid BM record at line ${lineNum}, skipping.`);
      return true;
    }

    const instCode = state.currentInstrument ?? '';
    const inst = instCode ? instrumentLibrary[instCode] : undefined;
    const { sigmas } = extractSigmaTokens(parts.slice(6), 3);
    let sigBear: SigmaToken | undefined;
    let sigDist: SigmaToken | undefined;
    let sigVert: SigmaToken | undefined;
    if (sigmas.length === 1) {
      sigDist = sigmas[0];
    } else {
      sigBear = sigmas[0];
      sigDist = sigmas[1];
      sigVert = sigmas[2];
    }
    const distDefault = defaultDistanceSigma(
      inst,
      distParsed.planned ? 0 : Number.parseFloat(parts[4]),
      state.edmMode,
      0,
    );
    const distResolved = resolveLinearSigma(sigDist, distDefault);
    const bmZenParsed =
      state.deltaMode === 'horiz' || !vert ? null : parseObservedAngleToken(vert, 'dd');
    let bmDistObs = distParsed.value;
    let bmDistStdDev = distResolved.sigma * toMeters;
    let bmDistMode: 'slope' | 'horiz' = effectiveDistanceMode();
    if (state.threeReduceMode && state.deltaMode === 'slope' && bmZenParsed?.valid) {
      const zenSigmaSec = resolveAngularSigma(sigVert, defaultZenithSigmaSec(inst)).sigma;
      const sigmaZ = zenSigmaSec * SEC_TO_RAD;
      bmDistObs = distParsed.value * Math.sin(bmZenParsed.value);
      bmDistStdDev = Math.sqrt(
        (Math.sin(bmZenParsed.value) * distResolved.sigma * toMeters) ** 2 +
          (distParsed.value * Math.cos(bmZenParsed.value) * sigmaZ) ** 2,
      );
      bmDistMode = 'horiz';
    }
    pushObservation({
      id: obsIdRef.current++,
      type: 'dist',
      subtype: 'ts',
      instCode,
      setId: '',
      from,
      to,
      obs: bmDistObs,
      planned: distParsed.planned,
      stdDev: bmDistStdDev,
      sigmaSource: distResolved.source,
      mode: bmDistMode,
    });
    if (state.deltaMode === 'horiz' && vert) {
      const dhParsed = parseObservedLinearToken(vert, toMeters);
      if (!dhParsed.valid) {
        logs.push(`Invalid BM vertical difference at line ${lineNum}, skipping vertical component.`);
      } else {
        const dhResolved = resolveLevelingSigma(sigVert, inst, Math.abs(distParsed.value), 'BM', lineNum);
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
      }
    } else if (vert && !state.threeReduceMode) {
      const zenParsed = bmZenParsed ?? parseObservedAngleToken(vert, 'dd');
      if (!zenParsed.valid) {
        logs.push(`Invalid BM zenith at line ${lineNum}, skipping vertical component.`);
      } else {
        const zenResolved = resolveAngularSigma(sigVert, defaultZenithSigmaSec(inst));
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
        });
      }
    } else if (vert && state.threeReduceMode) {
      logs.push(`3REDUCE active at line ${lineNum}: BM zenith component excluded from equations.`);
    }
    const bearingRad = applyPlanRotation(bearingParsed.value, state);
    const bearResolved = resolveAngularSigma(sigBear, defaultAzimuthSigmaSec(inst));
    pushObservation({
      id: obsIdRef.current++,
      type: 'bearing',
      instCode,
      from,
      to,
      obs: bearingRad,
      planned: bearingParsed.planned,
      stdDev: bearResolved.sigma * SEC_TO_RAD,
      sigmaSource: bearResolved.source,
    });
    return true;
  }

  if (code === 'M') {
    const stationTriplet = splitStationPairToken(parts[1], state.stationSeparator ?? '-');
    if (stationTriplet.length !== 3) {
      logs.push(`M record malformed at line ${lineNum}`);
      return true;
    }

    const stationOrder = state.angleStationOrder ?? 'atfromto';
    const s1 = stationTriplet[0];
    const s2 = stationTriplet[1];
    const s3 = stationTriplet[2];
    const at = stationOrder === 'atfromto' ? s1 : s2;
    const from = stationOrder === 'atfromto' ? s2 : s1;
    const to = s3;
    const ang = parts[2];
    const toMeters = linearToMetersFactor();
    const angParsed = parseObservedAngleToken(ang, 'dms');
    const distParsed = parseObservedLinearToken(parts[3], toMeters);
    const vert = parts[4];
    const hasVerticalToken =
      state.coordMode !== '2D'
        ? Boolean(vert)
        : state.deltaMode === 'slope' &&
          Boolean(vert) &&
          (String(vert).includes('-') ||
            Math.abs((parseObservedAngleToken(String(vert), 'dd').value * 180) / Math.PI) > 45);
    const vertParsed =
      hasVerticalToken && vert
        ? state.deltaMode === 'horiz'
          ? parseObservedLinearToken(vert, toMeters)
          : parseObservedAngleToken(vert, 'dd')
        : null;
    if (!angParsed.valid || !distParsed.valid || (vert && vertParsed && !vertParsed.valid)) {
      logs.push(`Invalid M record at line ${lineNum}, skipping.`);
      return true;
    }

    const sigmaStart = hasVerticalToken ? 5 : 4;
    const restTokens = parts.slice(sigmaStart);
    const { sigmas, rest } = extractSigmaTokens(restTokens, hasVerticalToken ? 3 : 2);
    const { hi, ht } = extractHiHt(rest);
    const instCode = state.currentInstrument ?? '';
    const inst = instCode ? instrumentLibrary[instCode] : undefined;
    const angResolved = resolveAngularSigma(sigmas[0], defaultHorizontalAngleSigmaSec(inst));
    const distResolved = resolveLinearSigma(
      sigmas[1],
      defaultDistanceSigma(
        inst,
        distParsed.planned ? 0 : Number.parseFloat(parts[3]),
        state.edmMode,
        0,
      ),
    );
    const vertResolved =
      state.deltaMode === 'horiz'
        ? resolveLevelingSigma(sigmas[2], inst, Math.abs(distParsed.value), 'M', lineNum)
        : resolveAngularSigma(sigmas[2], defaultZenithSigmaSec(inst));
    const angRad = angParsed.value;
    const faceWeight = angRad >= Math.PI ? angResolved.sigma * face2Weight : angResolved.sigma;
    let distObs = distParsed.value;
    let distStdDev = distResolved.sigma * toMeters;
    let distMode: 'slope' | 'horiz' = effectiveDistanceMode();
    if (
      (state.coordMode === '2D' || state.threeReduceMode) &&
      state.deltaMode === 'slope' &&
      vert &&
      vertParsed &&
      vertParsed.valid
    ) {
      const zen = vertParsed.value;
      const sigmaZ = vertResolved.sigma * SEC_TO_RAD;
      distObs = distParsed.value * Math.sin(zen);
      distStdDev = Math.sqrt(
        (Math.sin(zen) * distResolved.sigma * toMeters) ** 2 +
          (distParsed.value * Math.cos(zen) * sigmaZ) ** 2,
      );
      distMode = 'horiz';
    }
    pushObservation({
      id: obsIdRef.current++,
      type: 'angle',
      instCode,
      setId: '',
      at,
      from,
      to,
      obs: angRad,
      planned: angParsed.planned,
      stdDev: faceWeight * SEC_TO_RAD,
      sigmaSource: angResolved.source,
    });
    pushObservation({
      id: obsIdRef.current++,
      type: 'dist',
      subtype: 'ts',
      instCode,
      setId: '',
      from: at,
      to,
      obs: distObs,
      planned: distParsed.planned,
      stdDev: distStdDev,
      sigmaSource: distResolved.source,
      hi: hi != null ? hi * toMeters : undefined,
      ht: ht != null ? ht * toMeters : undefined,
      mode: distMode,
    });
    if (state.coordMode === '2D') {
      return true;
    }
    if (state.deltaMode === 'horiz' && vert) {
      pushObservation({
        id: obsIdRef.current++,
        type: 'lev',
        instCode,
        from: at,
        to,
        obs: (vertParsed as { value: number }).value,
        planned: Boolean(vertParsed?.planned),
        lenKm: 0,
        stdDev: vertResolved.sigma * toMeters,
        sigmaSource: vertResolved.source,
      });
    } else if (vert && !state.threeReduceMode) {
      pushObservation({
        id: obsIdRef.current++,
        type: 'zenith',
        instCode,
        from: at,
        to,
        obs: (vertParsed as { value: number }).value,
        planned: Boolean(vertParsed?.planned),
        stdDev: vertResolved.sigma * SEC_TO_RAD,
        sigmaSource: vertResolved.source,
        hi: hi != null ? hi * toMeters : undefined,
        ht: ht != null ? ht * toMeters : undefined,
      });
    } else if (vert && state.threeReduceMode) {
      logs.push(`3REDUCE active at line ${lineNum}: M zenith component excluded from equations.`);
    }
    return true;
  }

  if (code === 'B') {
    const { from, to, nextIndex } = parseFromTo(parts, 1, state.stationSeparator ?? '-');
    const bearingToken = parts[nextIndex];
    const instCode = state.currentInstrument ?? '';
    const inst = instCode ? instrumentLibrary[instCode] : undefined;
    const { sigmas } = extractSigmaTokens(parts.slice(nextIndex + 1), 1);
    const resolved = resolveAngularSigma(sigmas[0], defaultAzimuthSigmaSec(inst));
    const bearingParsed = parseObservedAngleToken(bearingToken, 'dd');
    if (!bearingParsed.valid) {
      logs.push(`Invalid bearing at line ${lineNum}, skipping B record.`);
      return true;
    }
    const bearingRad = applyPlanRotation(bearingParsed.value, state);
    pushObservation({
      id: obsIdRef.current++,
      type: 'bearing',
      instCode,
      from,
      to,
      obs: bearingRad,
      planned: bearingParsed.planned,
      stdDev: resolved.sigma * SEC_TO_RAD,
      sigmaSource: resolved.source,
    });
    return true;
  }

  return false;
};
