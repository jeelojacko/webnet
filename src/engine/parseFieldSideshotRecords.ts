import { SEC_TO_RAD } from './angles';
import type { HandleFieldObservationRecordArgs } from './parseFieldObservationRecords.types';
import type { SigmaToken } from './parseSigmaResolution';

export const handleFieldSideshotRecord = ({
  code,
  parts,
  lineNum,
  state,
  stations,
  instrumentLibrary,
  logs,
  obsIdRef,
  parseSsStationTokens,
  parseAngleTokenRad,
  extractSigmaTokens,
  extractHiHt,
  linearToMetersFactor,
  effectiveDistanceMode,
  resolveLinearSigma,
  resolveAngularSigma,
  resolveLevelingSigma,
  defaultDistanceSigma,
  defaultDirectionSigmaSec,
  defaultZenithSigmaSec,
  applyPlanRotation,
  pushObservation,
  traverseCtx,
}: HandleFieldObservationRecordArgs): boolean => {
  if (code !== 'SS') return false;

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
    logs.push(`Sideshot must originate from current occupy (${traverseCtx.occupy}) at line ${lineNum}`);
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
  const hasUnprefixedAngle = !isAzPrefix && !isHzPrefix && Number.isFinite(unprefixedAngleRad);
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
  if (explicitBacksight && traverseCtx.backsight && explicitBacksight !== traverseCtx.backsight) {
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
      const dhResolved = resolveLevelingSigma(sigmaVertToken, inst, dist * toMeters, 'SS', lineNum);
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
};
