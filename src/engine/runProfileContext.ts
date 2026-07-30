import type { ParseSettings, SolveProfile } from '../appStateTypes';
import type {
  DirectionSetMode,
  FaceNormalizationMode,
  Instrument,
  InstrumentLibrary,
  ParseCompatibilityMode,
  RobustMode,
  RunMode,
} from '../types';

export interface ProfileContext {
  parity: boolean;
  effectiveParse: ParseSettings;
  directionSetMode: DirectionSetMode;
  allowClusterFaceReliability: boolean;
  effectiveInstrumentLibrary: InstrumentLibrary;
  currentInstrument?: string;
}

interface ResolveProfileContextArgs {
  base: ParseSettings;
  projectInstruments: InstrumentLibrary;
  selectedInstrument: string;
  defaultIndustryInstrumentCode: string;
  defaultIndustryInstrument: Instrument;
  normalizeSolveProfile: (_profile: SolveProfile) => SolveProfile;
}

export const resolveRunProfileContext = ({
  base,
  projectInstruments,
  selectedInstrument,
  defaultIndustryInstrumentCode,
  defaultIndustryInstrument,
  normalizeSolveProfile,
}: ResolveProfileContextArgs): ProfileContext => {
  const solveProfile = normalizeSolveProfile(base.solveProfile);
  const parity = solveProfile !== 'webnet';
  const requestedRunMode: RunMode =
    base.runMode ?? (base.preanalysisMode ? 'preanalysis' : 'adjustment');
  const defaultParseCompatibilityMode: ParseCompatibilityMode =
    solveProfile === 'legacy-compat' ? 'legacy' : parity ? 'strict' : 'legacy';
  const defaultFaceNormalizationMode: FaceNormalizationMode =
    solveProfile === 'industry-parity-current'
      ? 'on'
      : solveProfile === 'industry-parity-legacy'
        ? 'off'
        : solveProfile === 'legacy-compat'
          ? 'auto'
          : (base.faceNormalizationMode ?? (base.normalize ? 'on' : 'off'));
  const normalizedBase: ParseSettings = {
    ...base,
    solveProfile,
    runMode: requestedRunMode,
    preanalysisMode: requestedRunMode === 'preanalysis',
    parseCompatibilityMode: base.parseCompatibilityMode ?? defaultParseCompatibilityMode,
    faceNormalizationMode: base.faceNormalizationMode ?? defaultFaceNormalizationMode,
  };
  normalizedBase.normalize = normalizedBase.faceNormalizationMode !== 'off';
  const parityParse = parity
    ? {
        ...normalizedBase,
        geometryDependentSigmaReference: 'initial' as const,
        robustMode: 'none' as RobustMode,
        tsCorrelationEnabled: false,
        tsCorrelationRho: 0,
      }
    : {
        ...normalizedBase,
        geometryDependentSigmaReference:
          normalizedBase.geometryDependentSigmaReference ?? 'current',
      };
  const effectiveParse =
    requestedRunMode === 'preanalysis'
      ? {
          ...parityParse,
          robustMode: 'none' as RobustMode,
          autoAdjustEnabled: false,
          preanalysisMode: true,
        }
      : {
          ...parityParse,
          preanalysisMode: false,
        };
  const directionSetMode: DirectionSetMode = parity ? 'raw' : 'reduced';
  const allowClusterFaceReliability = solveProfile === 'legacy-compat';
  const effectiveInstrumentLibrary = parity
    ? {
        ...projectInstruments,
        ...(projectInstruments[defaultIndustryInstrumentCode]
          ? {}
          : { [defaultIndustryInstrumentCode]: defaultIndustryInstrument }),
      }
    : projectInstruments;
  const currentInstrument = parity
    ? selectedInstrument && effectiveInstrumentLibrary[selectedInstrument]
      ? selectedInstrument
      : defaultIndustryInstrumentCode
    : selectedInstrument || undefined;
  return {
    parity,
    effectiveParse,
    directionSetMode,
    allowClusterFaceReliability,
    effectiveInstrumentLibrary,
    currentInstrument,
  };
};
