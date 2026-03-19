import { SEC_TO_RAD } from './angles';
import type { SigmaToken } from './parseSigmaResolution';
import type {
  DirectionFaceSource,
  DirectionRejectDiagnostic,
  Instrument,
  InstrumentLibrary,
  Observation,
  ParseOptions,
  SigmaSource,
} from '../types';

type DirectionFace = 'face1' | 'face2';

type RawDirectionShotLike = {
  to: string;
  obs: number;
  stdDev: number;
  sigmaSource: SigmaSource;
  sourceLine: number;
  face: DirectionFace;
  faceSource: DirectionFaceSource;
  reliableFace: boolean;
};

type ObservedParsedValue = {
  value: number;
  planned: boolean;
  valid: boolean;
};

type DirectionTraverseContext = {
  occupy?: string;
  backsight?: string;
  dirSetId?: string;
  dirInstCode?: string;
  dirRawShots?: RawDirectionShotLike[];
};

type HandleDirectionSetRecordArgs = {
  code: string;
  parts: string[];
  lineNum: number;
  state: ParseOptions;
  instrumentLibrary: InstrumentLibrary;
  logs: string[];
  obsIdRef: { current: number };
  currentSourceFile: string;
  traverseCtx: DirectionTraverseContext;
  directionSetCountRef: { current: number };
  directionRejectDiagnostics: DirectionRejectDiagnostic[];
  parseObservedLinearToken: (_token: string | undefined, _toMeters: number) => ObservedParsedValue;
  parseObservedAngleToken: (
    _token: string | undefined,
    _fallbackMode: 'dms' | 'dd',
  ) => ObservedParsedValue;
  parseDirectionFaceHintToken: (_token: string | undefined) => DirectionFace | null;
  stripDirectionFaceHints: (_tokens: string[]) => { face: DirectionFace | null; tokens: string[] };
  inferFaceFromZenith: (
    _zenithRad?: number,
  ) => { face: DirectionFace; source: DirectionFaceSource } | null;
  isReliableFaceSource: (_source: DirectionFaceSource) => boolean;
  linearToMetersFactor: () => number;
  effectiveDistanceMode: () => 'slope' | 'horiz';
  extractSigmaTokens: (
    _tokens: string[],
    _count: number,
  ) => { sigmas: SigmaToken[]; rest: string[] };
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
  pushObservation: (_observation: Observation) => void;
  flushDirectionSet: (_reason: string) => void;
};

export const handleDirectionSetRecord = ({
  code,
  parts,
  lineNum,
  state,
  instrumentLibrary,
  logs,
  obsIdRef,
  currentSourceFile,
  traverseCtx,
  directionSetCountRef,
  directionRejectDiagnostics,
  parseObservedLinearToken,
  parseObservedAngleToken,
  parseDirectionFaceHintToken,
  stripDirectionFaceHints,
  inferFaceFromZenith,
  isReliableFaceSource,
  linearToMetersFactor,
  effectiveDistanceMode,
  extractSigmaTokens,
  resolveLinearSigma,
  resolveAngularSigma,
  resolveLevelingSigma,
  defaultDistanceSigma,
  defaultDirectionSigmaSec,
  defaultZenithSigmaSec,
  pushObservation,
  flushDirectionSet,
}: HandleDirectionSetRecordArgs): boolean => {
  if (code === 'DB') {
    if (traverseCtx.dirSetId) {
      flushDirectionSet('new DB');
    }
    const hasInst = parts[1] && instrumentLibrary[parts[1]];
    const instCode = hasInst ? parts[1] : (state.currentInstrument ?? '');
    const occupy = hasInst ? parts[2] : parts[1];
    const backsight = hasInst ? parts[3] : parts[2];

    traverseCtx.occupy = occupy;
    traverseCtx.backsight = backsight;
    traverseCtx.dirInstCode = instCode;
    traverseCtx.dirRawShots = [];
    directionSetCountRef.current += 1;
    traverseCtx.dirSetId = `${occupy || 'SET'}#${directionSetCountRef.current}`;

    if (backsight) {
      logs.push(
        `Direction set start at ${traverseCtx.occupy} backsight ${backsight}${instCode ? ` (inst ${instCode})` : ''}`,
      );
    } else {
      logs.push(`Direction set start at ${traverseCtx.occupy}${instCode ? ` (inst ${instCode})` : ''}`);
    }
    return true;
  }

  if (code === 'DN' || code === 'DM') {
    if (!traverseCtx.occupy || !traverseCtx.dirSetId) {
      logs.push(`Direction context missing at line ${lineNum}, skipping ${code}`);
      directionRejectDiagnostics.push({
        setId: 'UNKNOWN',
        occupy: 'UNKNOWN',
        sourceLine: lineNum,
        sourceFile: currentSourceFile,
        recordType: code,
        reason: 'missing-context',
        detail: `Direction context missing at line ${lineNum}`,
      });
      return true;
    }

    const to = parts[1];
    const ang = parts[2];
    const angParsed = parseObservedAngleToken(ang, 'dms');
    if (!angParsed.valid) {
      logs.push(`Invalid direction angle at line ${lineNum}, skipping ${code}.`);
      return true;
    }
    const angRad = angParsed.value;

    const toMeters = linearToMetersFactor();
    const distParsed = code === 'DM' ? parseObservedLinearToken(parts[3], toMeters) : null;
    let vert: string | undefined;
    let tailTokens: string[] = [];
    if (code === 'DM') {
      const candidate = parts[4];
      const candidateIsFace = parseDirectionFaceHintToken(candidate) != null;
      vert = candidate && !candidateIsFace ? candidate : undefined;
      tailTokens = parts.slice(vert ? 5 : 4);
    } else {
      tailTokens = parts.slice(3);
    }
    const strippedFaceHints = stripDirectionFaceHints(tailTokens);
    tailTokens = strippedFaceHints.tokens;
    const vertParsed =
      code === 'DM' && vert
        ? state.deltaMode === 'horiz'
          ? parseObservedLinearToken(vert, toMeters)
          : parseObservedAngleToken(vert, 'dd')
        : null;
    if ((distParsed && !distParsed.valid) || (vert && vertParsed && !vertParsed.valid)) {
      logs.push(`Invalid direction-measure record at line ${lineNum}, skipping ${code}.`);
      return true;
    }
    const sigmaCount = code === 'DM' ? 3 : 1;
    const { sigmas } = extractSigmaTokens(tailTokens, sigmaCount);

    const inst = traverseCtx.dirInstCode ? instrumentLibrary[traverseCtx.dirInstCode] : undefined;
    const dirResolved = resolveAngularSigma(sigmas[0], defaultDirectionSigmaSec(inst));
    const stdAng = dirResolved.sigma;

    const zenithCandidate =
      code === 'DM' &&
      state.deltaMode !== 'horiz' &&
      vertParsed != null &&
      !(vertParsed as { planned?: boolean }).planned
        ? (vertParsed as { value: number }).value
        : undefined;
    const inferredFace = inferFaceFromZenith(zenithCandidate);
    const fallbackFace: DirectionFace = angRad >= Math.PI ? 'face2' : 'face1';
    const explicitFace = strippedFaceHints.face;
    const thisFace: DirectionFace = explicitFace ?? inferredFace?.face ?? fallbackFace;
    const faceSource: DirectionFaceSource =
      explicitFace != null ? 'metadata' : inferredFace?.source ?? 'fallback';
    const raw: RawDirectionShotLike = {
      to,
      obs: angRad,
      stdDev: stdAng * SEC_TO_RAD,
      sigmaSource: dirResolved.source,
      sourceLine: lineNum,
      face: thisFace,
      faceSource,
      reliableFace: isReliableFaceSource(faceSource),
    };
    const existing = traverseCtx.dirRawShots ?? [];
    existing.push(raw);
    traverseCtx.dirRawShots = existing;

    if (code === 'DM' && distParsed && (distParsed.planned || distParsed.value > 0)) {
      const distResolved = resolveLinearSigma(
        sigmas[1],
        defaultDistanceSigma(
          inst,
          distParsed.planned ? 0 : Number.parseFloat(parts[3] || '0'),
          state.edmMode,
          0,
        ),
      );
      pushObservation({
        id: obsIdRef.current++,
        type: 'dist',
        subtype: 'ts',
        instCode: traverseCtx.dirInstCode ?? '',
        setId: code,
        from: traverseCtx.occupy,
        to,
        obs: distParsed.value,
        planned: distParsed.planned,
        stdDev: distResolved.sigma * toMeters,
        sigmaSource: distResolved.source,
        mode: effectiveDistanceMode(),
      });
      if (vert) {
        if (state.deltaMode === 'horiz') {
          const dhResolved = resolveLevelingSigma(sigmas[2], inst, Math.abs(distParsed.value), 'DM', lineNum);
          pushObservation({
            id: obsIdRef.current++,
            type: 'lev',
            instCode: traverseCtx.dirInstCode ?? '',
            setId: code,
            from: traverseCtx.occupy,
            to,
            obs: (vertParsed as { value: number }).value,
            planned: Boolean(vertParsed?.planned),
            lenKm: 0,
            stdDev: dhResolved.sigma * toMeters,
            sigmaSource: dhResolved.source,
          });
        } else if (!state.threeReduceMode) {
          const zenResolved = resolveAngularSigma(sigmas[2], defaultZenithSigmaSec(inst));
          pushObservation({
            id: obsIdRef.current++,
            type: 'zenith',
            instCode: traverseCtx.dirInstCode ?? '',
            setId: code,
            from: traverseCtx.occupy,
            to,
            obs: (vertParsed as { value: number }).value,
            planned: Boolean(vertParsed?.planned),
            stdDev: zenResolved.sigma * SEC_TO_RAD,
            sigmaSource: zenResolved.source,
          });
        } else {
          logs.push(`3REDUCE active at line ${lineNum}: DM zenith component excluded from equations.`);
        }
      }
    }
    return true;
  }

  if (code === 'DE') {
    if (traverseCtx.dirSetId) flushDirectionSet('DE');
    logs.push('Direction set end');
    return true;
  }

  return false;
};
