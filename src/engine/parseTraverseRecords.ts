import { RAD_TO_DEG, SEC_TO_RAD } from './angles';
import type {
  Instrument,
  InstrumentLibrary,
  Observation,
  ParseOptions,
  SigmaSource,
} from '../types';

type ObservedParsedValue = {
  value: number;
  planned: boolean;
  valid: boolean;
};

type TraverseContext = {
  occupy?: string;
  backsight?: string;
  backsightRefAngle?: number;
};

type HandleTraverseRecordArgs = {
  code: string;
  parts: string[];
  lineNum: number;
  state: ParseOptions;
  instrumentLibrary: InstrumentLibrary;
  logs: string[];
  obsIdRef: { current: number };
  traverseCtx: TraverseContext;
  faceModeRef: { current: 'unknown' | 'face1' | 'face2' };
  parseAngleTokenRad: (
    _token: string | undefined,
    _state: ParseOptions,
    _fallbackMode?: 'dms' | 'dd',
  ) => number;
  parseObservedLinearToken: (_token: string | undefined, _toMeters: number) => ObservedParsedValue;
  parseObservedAngleToken: (
    _token: string | undefined,
    _fallbackMode: 'dms' | 'dd',
  ) => ObservedParsedValue;
  linearToMetersFactor: () => number;
  effectiveDistanceMode: () => 'slope' | 'horiz';
  extractSigmaTokens: (
    _tokens: string[],
    _count: number,
  ) => { sigmas: Array<unknown>; rest: string[] };
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
  applyPlanRotation: (_angleRad: number, _state: ParseOptions) => number;
  wrapTo2Pi: (_value: number) => number;
  pushObservation: (_observation: Observation) => void;
  face2Weight: number;
};

export const handleTraverseRecord = ({
  code,
  parts,
  lineNum,
  state,
  instrumentLibrary,
  logs,
  obsIdRef,
  traverseCtx,
  faceModeRef,
  parseAngleTokenRad,
  parseObservedLinearToken,
  parseObservedAngleToken,
  linearToMetersFactor,
  effectiveDistanceMode,
  extractSigmaTokens,
  resolveLinearSigma,
  resolveAngularSigma,
  resolveLevelingSigma,
  defaultDistanceSigma,
  defaultHorizontalAngleSigmaSec,
  defaultAzimuthSigmaSec,
  defaultZenithSigmaSec,
  applyPlanRotation,
  wrapTo2Pi,
  pushObservation,
  face2Weight,
}: HandleTraverseRecordArgs): boolean => {
  if (code === 'TB') {
    if (state.mapMode !== 'off') {
      const token1 = parts[1];
      const token2 = parts[2];
      const token3 = parts[3];
      const maybeBackBearing = parseAngleTokenRad(token1, state, 'dd');
      if (state.mapMode === 'anglecalc' && Number.isFinite(maybeBackBearing) && token2) {
        traverseCtx.occupy = token3;
        traverseCtx.backsight = token2;
        traverseCtx.backsightRefAngle = wrapTo2Pi(maybeBackBearing);
        logs.push(
          `Map traverse start: occupy=${traverseCtx.occupy || '(pending)'} backsight=${traverseCtx.backsight} back-bearing=${(traverseCtx.backsightRefAngle * RAD_TO_DEG).toFixed(6)}deg`,
        );
      } else {
        traverseCtx.occupy = token1;
        traverseCtx.backsight = token2;
        traverseCtx.backsightRefAngle = Number.isFinite(parseAngleTokenRad(token3, state, 'dd'))
          ? wrapTo2Pi(parseAngleTokenRad(token3, state, 'dd'))
          : undefined;
        logs.push(
          `Map traverse start at ${traverseCtx.occupy || '(pending)'} backsight ${traverseCtx.backsight || '(none)'}`,
        );
      }
      faceModeRef.current = 'unknown';
      return true;
    }
    traverseCtx.occupy = parts[1];
    traverseCtx.backsight = parts[2];
    traverseCtx.backsightRefAngle = undefined;
    faceModeRef.current = 'unknown';
    logs.push(`Traverse start at ${traverseCtx.occupy} backsight ${traverseCtx.backsight}`);
    return true;
  }

  if (code !== 'T' && code !== 'TE') {
    return false;
  }

  const mapModeActive = state.mapMode !== 'off';
  if ((!mapModeActive && (!traverseCtx.occupy || !traverseCtx.backsight)) || (!traverseCtx.occupy && mapModeActive)) {
    logs.push(`Traverse context missing at line ${lineNum}, skipping ${code}`);
    return true;
  }
  if (code !== 'TE' && (traverseCtx.occupy === parts[1] || traverseCtx.backsight === parts[1])) {
    logs.push(`Traverse leg cannot occupy/backsight same as foresight at line ${lineNum}`);
    return true;
  }

  const to = parts[1];
  if (code === 'TE' && parts.length <= 2) {
    logs.push(`Traverse end to ${to}`);
    traverseCtx.occupy = undefined;
    traverseCtx.backsight = undefined;
    traverseCtx.backsightRefAngle = undefined;
    faceModeRef.current = 'unknown';
    return true;
  }

  const toMeters = linearToMetersFactor();
  const instCode = state.currentInstrument ?? '';
  const inst = instCode ? instrumentLibrary[instCode] : undefined;

  if (mapModeActive) {
    const bearingToken = parts[2];
    const bearingParsed = parseObservedAngleToken(bearingToken, 'dd');
    const distParsed =
      parts[3] == null
        ? { value: 0, planned: false, valid: true }
        : parseObservedLinearToken(parts[3], toMeters);
    const vert = parts[4];
    const vertParsed =
      vert == null
        ? null
        : state.deltaMode === 'horiz'
          ? parseObservedLinearToken(vert, toMeters)
          : parseObservedAngleToken(vert, 'dd');
    if (!bearingParsed.valid || !distParsed.valid || (vert && vertParsed && !vertParsed.valid)) {
      logs.push(`Invalid map traverse record at line ${lineNum}, skipping ${code}.`);
      return true;
    }
    const { sigmas } = extractSigmaTokens(parts.slice(5), 3);
    const bearingResolved = resolveAngularSigma(sigmas[0], defaultAzimuthSigmaSec(inst));
    const distResolved = resolveLinearSigma(
      sigmas[1],
      defaultDistanceSigma(
        inst,
        distParsed.planned ? 0 : Number.parseFloat(parts[3] || '0'),
        state.edmMode,
        0,
      ),
    );
    const vertResolved =
      state.deltaMode === 'horiz'
        ? resolveLevelingSigma(sigmas[2], inst, Math.abs(distParsed.value), code, lineNum)
        : resolveAngularSigma(sigmas[2], defaultZenithSigmaSec(inst));
    const bearingRad = applyPlanRotation(bearingParsed.value, state);
    pushObservation({
      id: obsIdRef.current++,
      type: 'bearing',
      instCode,
      from: traverseCtx.occupy as string,
      to,
      obs: bearingRad,
      planned: bearingParsed.planned,
      stdDev: bearingResolved.sigma * SEC_TO_RAD,
      sigmaSource: bearingResolved.source,
    });
    if (
      state.mapMode === 'anglecalc' &&
      traverseCtx.backsight &&
      Number.isFinite(traverseCtx.backsightRefAngle ?? Number.NaN)
    ) {
      const turned = wrapTo2Pi(bearingRad - (traverseCtx.backsightRefAngle as number));
      const angleResolved = resolveAngularSigma(sigmas[0], defaultHorizontalAngleSigmaSec(inst));
      pushObservation({
        id: obsIdRef.current++,
        type: 'angle',
        instCode,
        setId: code,
        at: traverseCtx.occupy as string,
        from: traverseCtx.backsight,
        to,
        obs: turned,
        planned: bearingParsed.planned,
        stdDev: angleResolved.sigma * SEC_TO_RAD,
        sigmaSource: angleResolved.source,
      });
    }
    if (distParsed.planned || distParsed.value > 0) {
      pushObservation({
        id: obsIdRef.current++,
        type: 'dist',
        subtype: 'ts',
        instCode,
        setId: code,
        from: traverseCtx.occupy as string,
        to,
        obs: distParsed.value,
        planned: distParsed.planned,
        stdDev: distResolved.sigma * toMeters,
        sigmaSource: distResolved.source,
        mode: 'horiz',
      });
    }
    if (vert) {
      if (state.deltaMode === 'horiz') {
        pushObservation({
          id: obsIdRef.current++,
          type: 'lev',
          instCode,
          setId: code,
          from: traverseCtx.occupy as string,
          to,
          obs: (vertParsed as { value: number }).value,
          planned: Boolean(vertParsed?.planned),
          lenKm: 0,
          stdDev: vertResolved.sigma * toMeters,
          sigmaSource: vertResolved.source,
        });
      } else if (state.threeReduceMode !== true) {
        pushObservation({
          id: obsIdRef.current++,
          type: 'zenith',
          instCode,
          setId: code,
          from: traverseCtx.occupy as string,
          to,
          obs: (vertParsed as { value: number }).value,
          planned: Boolean(vertParsed?.planned),
          stdDev: vertResolved.sigma * SEC_TO_RAD,
          sigmaSource: vertResolved.source,
        });
      }
    }
    traverseCtx.backsight = traverseCtx.occupy;
    traverseCtx.occupy = to;
    traverseCtx.backsightRefAngle = wrapTo2Pi(bearingRad + Math.PI);
  } else {
    const ang = parts[2];
    const angParsed = parseObservedAngleToken(ang, 'dms');
    const distParsed =
      parts[3] == null
        ? { value: 0, planned: false, valid: true }
        : parseObservedLinearToken(parts[3], toMeters);
    const vert = parts[4];
    const vertParsed =
      vert == null
        ? null
        : state.deltaMode === 'horiz'
          ? parseObservedLinearToken(vert, toMeters)
          : parseObservedAngleToken(vert, 'dd');
    if (!angParsed.valid || !distParsed.valid || (vert && vertParsed && !vertParsed.valid)) {
      logs.push(`Invalid traverse record at line ${lineNum}, skipping ${code}.`);
      return true;
    }
    const { sigmas } = extractSigmaTokens(parts.slice(5), 3);
    const angResolved = resolveAngularSigma(sigmas[0], defaultHorizontalAngleSigmaSec(inst));
    const distResolved = resolveLinearSigma(
      sigmas[1],
      defaultDistanceSigma(
        inst,
        distParsed.planned ? 0 : Number.parseFloat(parts[3] || '0'),
        state.edmMode,
        0,
      ),
    );
    const vertResolved =
      state.deltaMode === 'horiz'
        ? resolveLevelingSigma(sigmas[2], inst, Math.abs(distParsed.value), code, lineNum)
        : resolveAngularSigma(sigmas[2], defaultZenithSigmaSec(inst));
    const angRad = angParsed.value;
    const isFace2 = angRad >= Math.PI;
    if (state.normalize === false) {
      const thisFace = isFace2 ? 'face2' : 'face1';
      if (faceModeRef.current === 'unknown') faceModeRef.current = thisFace;
      if (faceModeRef.current !== thisFace) {
        logs.push(`Mixed face traverse angle rejected at line ${lineNum}`);
      } else {
        pushObservation({
          id: obsIdRef.current++,
          type: 'angle',
          instCode,
          setId: code,
          at: traverseCtx.occupy as string,
          from: traverseCtx.backsight as string,
          to,
          obs: angRad,
          planned: angParsed.planned,
          stdDev: angResolved.sigma * SEC_TO_RAD,
          sigmaSource: angResolved.source,
        });
      }
    } else {
      const angStd = angResolved.sigma * (isFace2 ? face2Weight : 1);
      pushObservation({
        id: obsIdRef.current++,
        type: 'angle',
        instCode,
        setId: code,
        at: traverseCtx.occupy as string,
        from: traverseCtx.backsight as string,
        to,
        obs: angRad,
        planned: angParsed.planned,
        stdDev: angStd * SEC_TO_RAD,
        sigmaSource: angResolved.source,
      });
    }
    if (distParsed.planned || distParsed.value > 0) {
      pushObservation({
        id: obsIdRef.current++,
        type: 'dist',
        subtype: 'ts',
        instCode,
        setId: code,
        from: traverseCtx.occupy as string,
        to,
        obs: distParsed.value,
        planned: distParsed.planned,
        stdDev: distResolved.sigma * toMeters,
        sigmaSource: distResolved.source,
        mode: effectiveDistanceMode(),
      });
    }
    if (vert) {
      if (state.deltaMode === 'horiz') {
        pushObservation({
          id: obsIdRef.current++,
          type: 'lev',
          instCode,
          setId: code,
          from: traverseCtx.occupy as string,
          to,
          obs: (vertParsed as { value: number }).value,
          planned: Boolean(vertParsed?.planned),
          lenKm: 0,
          stdDev: vertResolved.sigma * toMeters,
          sigmaSource: vertResolved.source,
        });
      } else if (state.threeReduceMode !== true) {
        pushObservation({
          id: obsIdRef.current++,
          type: 'zenith',
          instCode,
          setId: code,
          from: traverseCtx.occupy as string,
          to,
          obs: (vertParsed as { value: number }).value,
          planned: Boolean(vertParsed?.planned),
          stdDev: vertResolved.sigma * SEC_TO_RAD,
          sigmaSource: vertResolved.source,
        });
      }
    }
  }

  if (code === 'TE') {
    logs.push(`Traverse end to ${to}`);
    traverseCtx.occupy = undefined;
    traverseCtx.backsight = undefined;
    traverseCtx.backsightRefAngle = undefined;
    faceModeRef.current = 'unknown';
  } else {
    const prevOccupy = traverseCtx.occupy;
    traverseCtx.occupy = to;
    traverseCtx.backsight = prevOccupy;
    if (state.mapMode !== 'off' && traverseCtx.backsightRefAngle == null) {
      traverseCtx.backsightRefAngle = undefined;
    }
  }

  return true;
};
