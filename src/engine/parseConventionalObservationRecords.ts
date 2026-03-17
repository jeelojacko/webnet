import { RAD_TO_DEG, SEC_TO_RAD } from './angles';
import type {
  AngleObservation,
  DirObservation,
  DistanceObservation,
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

type DistanceCandidate = {
  from: string;
  to: string;
  nextIndex: number;
  instCode: string;
  setId: string;
  explicitInst: boolean;
};

type AngleCandidate = {
  instCode: string;
  setId: string;
  s1: string;
  s2: string;
  s3: string;
  stdTokenIndex: number;
  explicitInst: boolean;
  angleParsed: ObservedParsedValue;
};

type HandleConventionalPrimitiveRecordArgs = {
  code: string;
  parts: string[];
  lineNum: number;
  state: ParseOptions;
  stations: StationMap;
  instrumentLibrary: InstrumentLibrary;
  logs: string[];
  obsIdRef: { current: number };
  compatibilityMode: ParseCompatibilityMode;
  preanalysisMode: boolean;
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
  parseFromTo: (
    _parts: string[],
    _startIndex: number,
    _separator?: string,
  ) => { from: string; to: string; nextIndex: number };
  splitStationPairToken: (_token: string, _separator?: string) => string[];
  extractSigmaTokens: (
    _tokens: string[],
    _count: number,
  ) => { sigmas: Array<unknown>; rest: string[] };
  extractHiHt: (_tokens: string[]) => { hi?: number; ht?: number; rest: string[] };
  parseObservedLinearToken: (_token: string | undefined, _toMeters: number) => ObservedParsedValue;
  parseObservedAngleToken: (
    _token: string | undefined,
    _fallbackMode: 'dms' | 'dd',
  ) => ObservedParsedValue;
  linearToMetersFactor: () => number;
  effectiveDistanceMode: () => 'slope' | 'horiz';
  scoreDistanceCandidate: (_candidate: {
    instCode: string;
    from: string;
    to: string;
    distToken: string;
    setId: string;
    explicitInst: boolean;
  }) => number;
  looksLikeNumericMeasurement: (_token: string) => boolean;
  resolveLinearSigma: (
    _token: unknown,
    _defaultSigma: number,
  ) => { sigma: number; source: SigmaSource };
  resolveAngularSigma: (
    _token: unknown,
    _defaultSigma: number,
  ) => { sigma: number; source: SigmaSource };
  resolveLevelingSigma: (
    _token: unknown,
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
  defaultHorizontalAngleSigmaSec: (_inst: Instrument | undefined) => number;
  defaultAzimuthSigmaSec: (_inst: Instrument | undefined) => number;
  defaultZenithSigmaSec: (_inst: Instrument | undefined) => number;
  azimuthFromTo: (
    _stations: StationMap,
    _from: string,
    _to: string,
  ) => { az: number; dist: number } | null;
  wrapToPi: (_value: number) => number;
  applyPlanRotation: (_angleRad: number, _state: ParseOptions) => number;
  pushObservation: (_observation: Observation) => void;
  face2Weight: number;
  amodeAutoMaxDirRad: number;
  amodeAutoMarginRad: number;
};

export const handleConventionalPrimitiveRecord = ({
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
  resolveLevelingSigma,
  defaultDistanceSigma,
  defaultHorizontalAngleSigmaSec,
  defaultAzimuthSigmaSec,
  defaultZenithSigmaSec,
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
    pushAngleCandidate(
      state.currentInstrument ?? '',
      '',
      parts[1] ?? '',
      parts[2] ?? '',
      parts[3] ?? '',
      parts[4],
      5,
      false,
    );
    pushAngleCandidate(
      parts[1] ?? '',
      '',
      parts[2] ?? '',
      parts[3] ?? '',
      parts[4] ?? '',
      parts[5],
      6,
      true,
    );
    pushAngleCandidate(
      parts[1] ?? '',
      parts[2] ?? '',
      parts[3] ?? '',
      parts[4] ?? '',
      parts[5] ?? '',
      parts[6],
      7,
      true,
    );

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

  if (code === 'V') {
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
  }

  if (code === 'DV') {
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
  }

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
    let sigBear: unknown;
    let sigDist: unknown;
    let sigVert: unknown;
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
