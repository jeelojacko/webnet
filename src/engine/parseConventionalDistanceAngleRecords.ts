import { RAD_TO_DEG, SEC_TO_RAD } from './angles';
import type {
  AngleCandidate,
  DistanceCandidate,
  HandleConventionalPrimitiveRecordArgs,
} from './parseConventionalObservationRecords.types';
import type { AngleObservation, DirObservation, DistanceObservation } from '../types';

export const handleConventionalDistanceOrAngleRecord = ({
  code,
  parts,
  lineNum,
  state,
  stations,
  instrumentLibrary,
  logs,
  obsIdRef,
  compatibilityMode,
  preanalysisMode,
  addCompatibilityDiagnostic,
  rejectNumericStationTokens,
  parseFromTo,
  splitStationPairToken,
  extractSigmaTokens,
  extractHiHt,
  parseObservedLinearToken,
  parseObservedAngleToken,
  linearToMetersFactor,
  effectiveDistanceMode,
  scoreDistanceCandidate,
  looksLikeNumericMeasurement,
  resolveLinearSigma,
  resolveAngularSigma,
  defaultDistanceSigma,
  defaultHorizontalAngleSigmaSec,
  azimuthFromTo,
  wrapToPi,
  applyPlanRotation,
  pushObservation,
  face2Weight,
  amodeAutoMaxDirRad,
  amodeAutoMarginRad,
}: HandleConventionalPrimitiveRecordArgs): boolean => {
  if (code === 'D') {
    const explicitInstKnown = parts[1] && instrumentLibrary[parts[1]] ? parts[1] : '';
    const toMeters = linearToMetersFactor();
    const candidates: DistanceCandidate[] = [];
    const pushDistanceCandidate = (
      instCode: string,
      setId: string,
      startIndex: number,
      candidateExplicitInst: boolean,
    ) => {
      const parsedFromTo = parseFromTo(parts, startIndex, state.stationSeparator ?? '-');
      if (!parsedFromTo.from || !parsedFromTo.to) return;
      const distToken = parts[parsedFromTo.nextIndex];
      const distParsed = parseObservedLinearToken(distToken, toMeters);
      if (!distParsed.valid) return;
      candidates.push({
        from: parsedFromTo.from,
        to: parsedFromTo.to,
        nextIndex: parsedFromTo.nextIndex,
        instCode,
        setId,
        explicitInst: candidateExplicitInst,
      });
    };

    if (explicitInstKnown) {
      pushDistanceCandidate(explicitInstKnown, '', 2, true);
      if (parts[2]) {
        pushDistanceCandidate(explicitInstKnown, parts[2], 3, true);
      }
    }

    pushDistanceCandidate(state.currentInstrument ?? '', '', 1, false);

    if (!explicitInstKnown && parts[1]) {
      pushDistanceCandidate(parts[1], '', 2, true);
      if (parts[2]) {
        pushDistanceCandidate(parts[1], parts[2], 3, true);
      }
    }

    if (candidates.length === 0) {
      logs.push(`Invalid distance at line ${lineNum}, skipping D record.`);
      return true;
    }

    const scored = candidates.map((candidate) => {
      const distToken = parts[candidate.nextIndex] ?? '';
      return {
        candidate,
        score: scoreDistanceCandidate({
          instCode: candidate.instCode,
          from: candidate.from,
          to: candidate.to,
          distToken,
          setId: candidate.setId,
          explicitInst: candidate.explicitInst,
        }),
      };
    });
    scored.sort((a, b) => b.score - a.score);
    const best = scored[0];
    const tie = scored.length > 1 && scored[1].score === best.score;
    if (tie) {
      const rewrite = 'Use explicit form: D <inst?> <set?> <from> <to> <distance> [sigma] [HI/HT].';
      if (compatibilityMode === 'strict') {
        addCompatibilityDiagnostic(
          'ROLE_AMBIGUITY',
          lineNum,
          'D',
          'multiple valid D-record interpretations were found.',
          rewrite,
          false,
          'error',
        );
        return true;
      }
      addCompatibilityDiagnostic(
        'ROLE_AMBIGUITY',
        lineNum,
        'D',
        'multiple valid D-record interpretations were found; applied legacy fallback.',
        rewrite,
        true,
      );
    }

    const chosen = best.candidate;
    if (
      rejectNumericStationTokens('D', lineNum, [
        { role: 'FROM', value: chosen.from },
        { role: 'TO', value: chosen.to },
      ])
    ) {
      return true;
    }
    const distToken = parts[chosen.nextIndex];
    const restTokens = parts.slice(chosen.nextIndex + 1);
    const { sigmas, rest } = extractSigmaTokens(restTokens, 1);
    const { hi, ht } = extractHiHt(rest);
    const distParsed = parseObservedLinearToken(distToken, toMeters);
    if (!distParsed.valid) {
      logs.push(`Invalid distance at line ${lineNum}, skipping D record.`);
      return true;
    }

    const inst = chosen.instCode ? instrumentLibrary[chosen.instCode] : undefined;
    const defaultSigma = defaultDistanceSigma(
      inst,
      distParsed.planned ? 0 : Number.parseFloat(distToken),
      state.edmMode,
      0,
    );
    const { sigma, source } = resolveLinearSigma(sigmas[0], defaultSigma);

    const obs: DistanceObservation = {
      id: obsIdRef.current++,
      type: 'dist',
      subtype: 'ts',
      instCode: chosen.instCode,
      setId: chosen.setId,
      from: chosen.from,
      to: chosen.to,
      obs: distParsed.value,
      planned: distParsed.planned,
      stdDev: sigma * toMeters,
      sigmaSource: source,
      hi: hi != null ? hi * toMeters : undefined,
      ht: ht != null ? ht * toMeters : undefined,
      mode: effectiveDistanceMode(),
    };
    pushObservation(obs);
    return true;
  }

  if (code === 'A') {
    const stationOrder = state.angleStationOrder ?? 'atfromto';
    const angleCandidates: AngleCandidate[] = [];
    const pushAngleCandidate = (
      instCode: string,
      setId: string,
      s1: string,
      s2: string,
      s3: string,
      angToken: string | undefined,
      stdTokenIndex: number,
      explicitInst: boolean,
    ) => {
      if (!s1 || !s2 || !s3 || stdTokenIndex < 0) return;
      if (!angToken && !preanalysisMode) return;
      const angleParsed = parseObservedAngleToken(angToken, 'dms');
      if (!angleParsed.valid) return;
      angleCandidates.push({
        instCode,
        setId,
        s1,
        s2,
        s3,
        stdTokenIndex,
        explicitInst,
        angleParsed,
      });
    };

    const inlineTriplet = parts[1]?.includes(state.stationSeparator ?? '-')
      ? splitStationPairToken(parts[1], state.stationSeparator ?? '-')
      : [];
    if (inlineTriplet.length === 3) {
      pushAngleCandidate(
        state.currentInstrument ?? '',
        '',
        inlineTriplet[0],
        inlineTriplet[1],
        inlineTriplet[2],
        parts[2],
        3,
        false,
      );
    }
    pushAngleCandidate(state.currentInstrument ?? '', '', parts[1] ?? '', parts[2] ?? '', parts[3] ?? '', parts[4], 5, false);
    pushAngleCandidate(parts[1] ?? '', '', parts[2] ?? '', parts[3] ?? '', parts[4] ?? '', parts[5], 6, true);
    pushAngleCandidate(parts[1] ?? '', parts[2] ?? '', parts[3] ?? '', parts[4] ?? '', parts[5] ?? '', parts[6], 7, true);

    if (angleCandidates.length === 0) {
      logs.push(`Invalid angle at line ${lineNum}, skipping A record.`);
      return true;
    }
    const scored = angleCandidates.map((candidate) => {
      let score = 0;
      if (stations[candidate.s1]) score += 2;
      if (stations[candidate.s2]) score += 2;
      if (stations[candidate.s3]) score += 2;
      if (candidate.explicitInst) score += 1;
      if (candidate.setId) score += 1;
      if (candidate.instCode && instrumentLibrary[candidate.instCode]) score += 2;
      if (
        looksLikeNumericMeasurement(candidate.s1) ||
        looksLikeNumericMeasurement(candidate.s2) ||
        looksLikeNumericMeasurement(candidate.s3)
      ) {
        score -= 12;
      }
      return { candidate, score };
    });
    scored.sort((a, b) => b.score - a.score);
    const best = scored[0];
    const tie = scored.length > 1 && scored[1].score === best.score;
    if (tie) {
      const rewrite = 'Use explicit form: A <inst?> <set?> <at> <from> <to> <angle> [sigma].';
      if (compatibilityMode === 'strict') {
        addCompatibilityDiagnostic(
          'ROLE_AMBIGUITY',
          lineNum,
          'A',
          'multiple valid A-record interpretations were found.',
          rewrite,
          false,
          'error',
        );
        return true;
      }
      addCompatibilityDiagnostic(
        'ROLE_AMBIGUITY',
        lineNum,
        'A',
        'multiple valid A-record interpretations were found; applied legacy fallback.',
        rewrite,
        true,
      );
    }

    const chosen = best.candidate;
    const instCode = chosen.instCode;
    const setId = chosen.setId;
    const s1 = chosen.s1;
    const s2 = chosen.s2;
    const s3 = chosen.s3;
    const at = stationOrder === 'atfromto' ? s1 : s2;
    const from = stationOrder === 'atfromto' ? s2 : s1;
    const to = s3;
    if (
      rejectNumericStationTokens('A', lineNum, [
        { role: 'AT', value: at },
        { role: 'FROM', value: from },
        { role: 'TO', value: to },
      ])
    ) {
      return true;
    }
    const angleParsed = chosen.angleParsed;
    const angleRad = angleParsed.value;
    const { sigmas } = extractSigmaTokens(parts.slice(chosen.stdTokenIndex), 1);

    const inst = instCode ? instrumentLibrary[instCode] : undefined;
    const defaultSigma = defaultHorizontalAngleSigmaSec(inst);
    const resolved = resolveAngularSigma(sigmas[0], defaultSigma);
    let sigmaSec = resolved.sigma;
    if (angleRad >= Math.PI) sigmaSec *= face2Weight;

    let useDir = state.angleMode === 'dir';
    if (state.angleMode === 'auto' && !angleParsed.planned) {
      const azTo = azimuthFromTo(stations, at, to);
      const azFrom = azimuthFromTo(stations, at, from);
      if (azTo && azFrom) {
        let predAngle = azTo.az - azFrom.az;
        if (predAngle < 0) predAngle += 2 * Math.PI;
        const rAngle = Math.abs(wrapToPi(angleRad - predAngle));

        const predDir = azTo.az;
        const r0 = wrapToPi(angleRad - predDir);
        const r1 = wrapToPi(angleRad + Math.PI - predDir);
        const rDir = Math.abs(r0) <= Math.abs(r1) ? Math.abs(r0) : Math.abs(r1);

        const clearlyDir = rDir <= amodeAutoMaxDirRad && rAngle - rDir >= amodeAutoMarginRad;
        useDir = clearlyDir;
        if (!useDir && rDir < rAngle && rDir <= amodeAutoMaxDirRad) {
          logs.push(
            `A record ambiguous at line ${lineNum}; kept ANGLE (rDir=${(rDir * RAD_TO_DEG * 3600).toFixed(1)}", rAng=${(rAngle * RAD_TO_DEG * 3600).toFixed(1)}"). Use ".AMODE DIR" for azimuth mode.`,
          );
        }
      }
    }

    if (useDir) {
      const rotatedDir = applyPlanRotation(angleRad, state);
      const obs: DirObservation = {
        id: obsIdRef.current++,
        type: 'dir',
        instCode,
        setId,
        from: at,
        to,
        obs: rotatedDir,
        planned: angleParsed.planned,
        stdDev: sigmaSec * SEC_TO_RAD,
        sigmaSource: resolved.source,
        flip180: true,
      };
      pushObservation(obs);
      logs.push(`A record classified as DIR at line ${lineNum} (${at}-${to})`);
    } else {
      const obs: AngleObservation = {
        id: obsIdRef.current++,
        type: 'angle',
        instCode,
        setId,
        at,
        from,
        to,
        obs: angleRad,
        planned: angleParsed.planned,
        stdDev: sigmaSec * SEC_TO_RAD,
        sigmaSource: resolved.source,
      };
      pushObservation(obs);
    }
    return true;
  }

  return false;
};
