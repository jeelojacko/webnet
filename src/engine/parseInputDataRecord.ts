import { handleConventionalPrimitiveRecord } from './parseConventionalObservationRecords';
import { handleControlRecord } from './parseControlRecords';
import { handleDirectionSetRecord } from './parseDirectionSetRecords';
import { handleFieldObservationRecord, type GpsCovarianceState } from './parseFieldObservationRecords';
import { handleTraverseRecord } from './parseTraverseRecords';
import { createDirectionSetWorkflow, type RawDirectionShot } from './parseDirectionSetWorkflow';
import { createParseSigmaResolvers, defaultAzimuthSigmaSec, defaultDirectionSigmaSec, defaultDistanceSigma, defaultElevDiffSigma, defaultHorizontalAngleSigmaSec, defaultZenithSigmaSec, extractSigmaTokens, parseSigmaToken } from './parseSigmaResolution';
import { AMODE_AUTO_MAX_DIR_RAD, AMODE_AUTO_MARGIN_RAD, FACE2_WEIGHT, FT_PER_M, activeCrsProjectionModel, applyFixities, applyPlanRotation, azimuthFromTo, clearStationConstraintComponent, extractHiHt, isNumericToken, parseAngleTokenRad, parseConstraintCorrToken, parseFixityTokens, parseFromTo, parseLinearMetersToken, parseSsStationTokens, resolveStationConstraintMode, setStationConstraintMode, splitStationPairToken, toDegrees, wrapToPi, wrapTo2Pi } from './parseTokenHelpers';
import type { ParseObservationHelpers } from './parseInputObservationHelpers';
import type { DirectionRejectDiagnostic, GpsObservation, Instrument, InstrumentLibrary, ParseCompatibilityMode, ParseOptions, StationMap } from '../types';

type ParsePosition = { lineNum: number; currentSourceFile: string; displayLineCount: number };

type HandleParseDataRecordOptions = {
  addCompatibilityDiagnostic: Parameters<typeof handleConventionalPrimitiveRecord>[0]['addCompatibilityDiagnostic'];
  code: string;
  compatibilityMode: ParseCompatibilityMode;
  directionRejectDiagnostics: DirectionRejectDiagnostic[];
  directionSetCount: number;
  directionSetWorkflow: ReturnType<typeof createDirectionSetWorkflow>;
  existingInstruments: InstrumentLibrary;
  faceMode: 'unknown' | 'face1' | 'face2';
  gpsCovarianceStateRef: GpsCovarianceState;
  helpers: ParseObservationHelpers;
  instrumentLibrary: InstrumentLibrary;
  lastGpsObservation: GpsObservation | undefined;
  logs: string[];
  obsIdRef: { current: number };
  parsePosition: ParsePosition;
  parts: string[];
  preanalysisMode: boolean;
  resolveAngularSigma: ReturnType<typeof createParseSigmaResolvers>['resolveAngularSigma'];
  resolveLevelingSigma: ReturnType<typeof createParseSigmaResolvers>['resolveLevelingSigma'];
  resolveLinearSigma: ReturnType<typeof createParseSigmaResolvers>['resolveLinearSigma'];
  state: ParseOptions;
  stations: StationMap;
  traverseCtx: { occupy?: string; backsight?: string; backsightRefAngle?: number; dirSetId?: string; dirInstCode?: string; dirRawShots?: RawDirectionShot[] };
};

export const handleParseDataRecord = ({
  addCompatibilityDiagnostic,
  code,
  compatibilityMode,
  directionRejectDiagnostics,
  directionSetCount,
  directionSetWorkflow,
  existingInstruments,
  faceMode,
  gpsCovarianceStateRef,
  helpers,
  instrumentLibrary,
  lastGpsObservation,
  logs,
  obsIdRef,
  parsePosition,
  parts,
  preanalysisMode,
  resolveAngularSigma,
  resolveLevelingSigma,
  resolveLinearSigma,
  state,
  stations,
  traverseCtx,
}: HandleParseDataRecordOptions): {
  directionSetCount: number;
  faceMode: 'unknown' | 'face1' | 'face2';
  lastGpsObservation: GpsObservation | undefined;
} => {
  const {
    assignStationCoordClass,
    effectiveDistanceMode,
    linearToMetersFactor,
    looksLikeNumericMeasurement,
    parseObservedAngleToken,
    parseObservedLinearToken,
    pushObservation,
    rejectNumericStationTokens,
    scoreDistanceCandidate,
  } = helpers;
  const flushDirectionSet = (reason: string): void => {
    directionSetWorkflow.flushDirectionSet(traverseCtx, reason);
    faceMode = 'unknown';
  };
  const isReliableFaceSource = directionSetWorkflow.isReliableFaceSource;
  const parseDirectionFaceHintToken = directionSetWorkflow.parseDirectionFaceHintToken;
  const stripDirectionFaceHints = directionSetWorkflow.stripDirectionFaceHints;
  const inferFaceFromZenith = directionSetWorkflow.inferFaceFromZenith;
  try {
      if (code === 'I') {
        const instCode = parts[1];
        if (state.preferExternalInstruments && instCode && existingInstruments[instCode]) {
          return { directionSetCount, faceMode, lastGpsObservation };
        }
        if (!instCode) return { directionSetCount, faceMode, lastGpsObservation };
      const instrumentTokens = parts.slice(2);
      const numericStart = instrumentTokens.findIndex((token) => isNumericToken(token));
      const numericTokens =
        numericStart >= 0 ? instrumentTokens.slice(numericStart) : ([] as string[]);
      const descTokens =
        numericStart >= 0 ? instrumentTokens.slice(0, numericStart) : instrumentTokens;
      let desc = descTokens.join(' ').trim();
      if (
        (desc.startsWith('"') && desc.endsWith('"')) ||
        (desc.startsWith("'") && desc.endsWith("'"))
      ) {
        desc = desc.slice(1, -1);
      }
      desc = desc.replace(/-/g, ' ');
      const numeric = numericTokens
        .filter((token) => isNumericToken(token))
        .map((token) => parseFloat(token));
      const legacy = numeric.length > 0 && numeric.length < 6;
      const edmConst = legacy ? (numeric[1] ?? 0) : (numeric[0] ?? 0);
      const edmPpm = legacy ? (numeric[0] ?? 0) : (numeric[1] ?? 0);
      const hzPrec = legacy ? (numeric[2] ?? 0) : (numeric[2] ?? 0);
      const vaPrec = legacy ? (numeric[2] ?? 0) : (numeric[3] ?? 0);
      const instCentr = legacy ? 0 : (numeric[4] ?? 0);
      const tgtCentr = legacy ? 0 : (numeric[5] ?? 0);
      const gpsStd = legacy ? (numeric[3] ?? 0) : (numeric[6] ?? 0);
      const levStd = legacy ? (numeric[4] ?? 0) : (numeric[7] ?? 0);
      const dirPrec = numeric[8] ?? hzPrec;
      const azPrec = numeric[9] ?? dirPrec;
      const vertCentr = numeric[10] ?? 0;
      const elevDiffConst = numeric[11] ?? 0;
      const elevDiffPpm = numeric[12] ?? 0;
      const inst: Instrument = {
        code: instCode,
        desc,
        edm_const: edmConst,
        edm_ppm: edmPpm,
        hzPrecision_sec: hzPrec,
        dirPrecision_sec: dirPrec,
        azBearingPrecision_sec: azPrec,
        vaPrecision_sec: vaPrec,
        instCentr_m: instCentr,
        tgtCentr_m: tgtCentr,
        vertCentr_m: vertCentr,
        elevDiff_const_m: elevDiffConst,
        elevDiff_ppm: elevDiffPpm,
        gpsStd_xy: gpsStd,
        levStd_mmPerKm: levStd,
      };
      instrumentLibrary[instCode] = inst;
    } else if (
      handleControlRecord({
        code,
        parts,
        lineNum: parsePosition.lineNum,
        state,
        stations,
        logs,
        parseFixityTokens,
        parseConstraintCorrToken,
        applyFixities,
        clearStationConstraintComponent,
        setStationConstraintMode,
        resolveStationConstraintMode,
        assignStationCoordClass,
        linearToMetersFactor,
        toDegrees,
        activeCrsProjectionModel,
      })
    ) {
      // handled by parseControlRecords.ts
    } else {
      const handledConventionalPrimitive = handleConventionalPrimitiveRecord({
        code,
        parts,
        lineNum: parsePosition.lineNum,
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
        resolveLinearSigma: (token, defaultSigma) =>
          resolveLinearSigma(token, defaultSigma),
        resolveAngularSigma: (token, defaultSigma) =>
          resolveAngularSigma(token, defaultSigma),
        resolveLevelingSigma: (token, inst, spanMeters, contextCode, sourceLine) =>
          resolveLevelingSigma(
            token,
            inst,
            spanMeters,
            contextCode,
            sourceLine,
          ),
        defaultDistanceSigma,
        defaultHorizontalAngleSigmaSec,
        defaultAzimuthSigmaSec,
        defaultZenithSigmaSec,
        azimuthFromTo,
        wrapToPi,
        applyPlanRotation,
        pushObservation,
        face2Weight: FACE2_WEIGHT,
        amodeAutoMaxDirRad: AMODE_AUTO_MAX_DIR_RAD,
        amodeAutoMarginRad: AMODE_AUTO_MARGIN_RAD,
      });
      if (!handledConventionalPrimitive) {
        const faceModeRef = { current: faceMode };
        const handledTraverse = handleTraverseRecord({
          code,
          parts,
          lineNum: parsePosition.lineNum,
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
          resolveLinearSigma: (token, defaultSigma) =>
            resolveLinearSigma(token, defaultSigma),
          resolveAngularSigma: (token, defaultSigma) =>
            resolveAngularSigma(token, defaultSigma),
          resolveLevelingSigma: (token, inst, spanMeters, contextCode, sourceLine) =>
            resolveLevelingSigma(
              token,
              inst,
              spanMeters,
              contextCode,
              sourceLine,
            ),
          defaultDistanceSigma,
          defaultHorizontalAngleSigmaSec,
          defaultAzimuthSigmaSec,
          defaultZenithSigmaSec,
          applyPlanRotation,
          wrapTo2Pi,
          pushObservation,
          face2Weight: FACE2_WEIGHT,
        });
        if (handledTraverse) {
          faceMode = faceModeRef.current;
        } else {
          const directionSetCountRef = { current: directionSetCount };
          const handledDirectionSet = handleDirectionSetRecord({
            code,
            parts,
            lineNum: parsePosition.lineNum,
            state,
            instrumentLibrary,
            logs,
            obsIdRef,
            currentSourceFile: parsePosition.currentSourceFile,
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
            extractHiHt,
            resolveLinearSigma: (token, defaultSigma) =>
              resolveLinearSigma(token, defaultSigma),
            resolveAngularSigma: (token, defaultSigma) =>
              resolveAngularSigma(token, defaultSigma),
            resolveLevelingSigma: (token, inst, spanMeters, contextCode, sourceLine) =>
              resolveLevelingSigma(
                token,
                inst,
                spanMeters,
                contextCode,
                sourceLine,
              ),
            defaultDistanceSigma,
            defaultDirectionSigmaSec,
            defaultZenithSigmaSec,
            pushObservation,
            flushDirectionSet,
          });
          if (handledDirectionSet) {
            directionSetCount = directionSetCountRef.current;
            if (code === 'DB') faceMode = 'unknown';
          } else {
            const lastGpsObservationRef = { current: lastGpsObservation };
            const handledFieldObservation = handleFieldObservationRecord({
              code,
              parts,
              lineNum: parsePosition.lineNum,
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
              resolveLinearSigma: (token, defaultSigma) =>
                resolveLinearSigma(token, defaultSigma),
              resolveAngularSigma: (token, defaultSigma) =>
                resolveAngularSigma(token, defaultSigma),
              resolveLevelingSigma: (token, inst, spanMeters, contextCode, sourceLine) =>
                resolveLevelingSigma(
                  token,
                  inst,
                  spanMeters,
                  contextCode,
                  sourceLine,
                ),
              defaultDistanceSigma,
              defaultDirectionSigmaSec,
              defaultZenithSigmaSec,
              defaultElevDiffSigma,
              applyPlanRotation,
              wrapTo2Pi,
              pushObservation,
              ftPerM: FT_PER_M,
              traverseCtx,
            });
            if (handledFieldObservation) {
              lastGpsObservation = lastGpsObservationRef.current;
            } else {
              logs.push(`Unrecognized code "${code}" at line ${parsePosition.lineNum}, skipping`);
            }
          }
        }
      }
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    logs.push(`Error on line ${parsePosition.lineNum}: ${msg}`);
  }

  return { directionSetCount, faceMode, lastGpsObservation };
};
