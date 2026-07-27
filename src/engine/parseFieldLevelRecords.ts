import type {
  HandleFieldObservationRecordArgs,
  ObservedParsedValue,
} from './parseFieldObservationRecords.types';
import type { LevelObservation } from '../types';

const differentialLevelSigmaFromKm = (mmPerRootKm: number | undefined, lenKm: number): number =>
  mmPerRootKm != null && Number.isFinite(mmPerRootKm) && mmPerRootKm > 0 && lenKm > 0
    ? (mmPerRootKm * Math.sqrt(lenKm)) / 1000
    : 0;

export const handleFieldLevelRecord = ({
  code,
  parts,
  lineNum,
  state,
  stations,
  instrumentLibrary,
  logs,
  obsIdRef,
  compatibilityMode,
  addCompatibilityDiagnostic,
  rejectNumericStationTokens,
  parseObservedLinearToken,
  parseSigmaToken,
  linearToMetersFactor,
  looksLikeNumericMeasurement,
  resolveLinearSigma,
  pushObservation,
  ftPerM,
}: HandleFieldObservationRecordArgs): boolean => {
  if (code !== 'L') return false;

  const toMeters = linearToMetersFactor();
  const candidates: Array<{
    instCode: string;
    from: string;
    to: string;
    explicitForm: boolean;
    valueStart: number;
    dHParsed: ObservedParsedValue;
  }> = [];
  const pushLevelCandidate = (
    instCode: string,
    from: string,
    to: string,
    valueStart: number,
    explicitForm: boolean,
  ) => {
    if (!from || !to) return;
    const dHParsed = parseObservedLinearToken(parts[valueStart], toMeters);
    if (!dHParsed.valid) return;
    candidates.push({ instCode, from, to, explicitForm, valueStart, dHParsed });
  };
  const pushHyphenLevelCandidate = (
    instCode: string,
    stationPairToken: string,
    valueStart: number,
    explicitForm: boolean,
  ) => {
    const separator = state.stationSeparator ?? '-';
    const separatorIndex = stationPairToken.indexOf(separator);
    if (separatorIndex <= 0 || separatorIndex >= stationPairToken.length - separator.length) {
      return;
    }
    const from = stationPairToken.slice(0, separatorIndex).trim();
    const to = stationPairToken.slice(separatorIndex + separator.length).trim();
    pushLevelCandidate(instCode, from, to, valueStart, explicitForm);
  };
  pushLevelCandidate(parts[1] ?? '', parts[2] ?? '', parts[3] ?? '', 4, true);
  pushLevelCandidate(state.currentInstrument ?? '', parts[1] ?? '', parts[2] ?? '', 3, false);
  pushHyphenLevelCandidate(parts[1] ?? '', parts[2] ?? '', 3, true);
  pushHyphenLevelCandidate(state.currentInstrument ?? '', parts[1] ?? '', 2, false);
  if (candidates.length === 0) {
    logs.push(`Invalid leveling observation at line ${lineNum}, skipping.`);
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
    const rewrite = 'Use explicit form: L <inst?> <from> <to> <dH> <length> [sigma].';
    if (compatibilityMode === 'strict') {
      addCompatibilityDiagnostic(
        'ROLE_AMBIGUITY',
        lineNum,
        'L',
        'multiple valid L-record interpretations were found.',
        rewrite,
        false,
        'error',
      );
      return true;
    }
    addCompatibilityDiagnostic(
      'ROLE_AMBIGUITY',
      lineNum,
      'L',
      'multiple valid L-record interpretations were found; applied legacy fallback.',
      rewrite,
      true,
    );
  }
  const chosen = best.candidate;
  const instCode = chosen.instCode;
  const from = chosen.from;
  const to = chosen.to;
  if (
    rejectNumericStationTokens('L', lineNum, [
      { role: 'FROM', value: from },
      { role: 'TO', value: to },
    ])
  ) {
    return true;
  }
  const lenRaw = parseFloat(parts[chosen.valueStart + 1] || '0');
  const lenKm =
    Number.isFinite(lenRaw) && lenRaw > 0
      ? state.units === 'ft'
        ? lenRaw / ftPerM / 1000
        : lenRaw / 1000
      : 0;
  const sigmaToken = parseSigmaToken(parts[chosen.valueStart + 2]) ?? undefined;
  const baseStd = differentialLevelSigmaFromKm(state.levelWeight, lenKm);
  const hasExplicitSigma = sigmaToken != null;
  if (!hasExplicitSigma && baseStd > 0) {
    logs.push(`.LWEIGHT applied for leveling at line ${lineNum}: ${state.levelWeight} mm/km`);
  }

  const inst = instrumentLibrary[instCode];
  const projectDefaultInst = state.projectDefaultInstrument
    ? instrumentLibrary[state.projectDefaultInstrument]
    : undefined;
  const instrumentFallbackStd =
    inst && inst.levStd_mmPerKm > 0
      ? differentialLevelSigmaFromKm(inst.levStd_mmPerKm, lenKm)
      : projectDefaultInst && projectDefaultInst.levStd_mmPerKm > 0
        ? differentialLevelSigmaFromKm(projectDefaultInst.levStd_mmPerKm, lenKm)
        : 0;
  const fallbackStd = baseStd > 0 ? baseStd : instrumentFallbackStd;
  const levelResolved = resolveLinearSigma(sigmaToken, fallbackStd);
  const sigma = levelResolved.sigma;

  const obs: LevelObservation = {
    id: obsIdRef.current++,
    type: 'lev',
    instCode,
    from,
    to,
    obs: chosen.dHParsed.value,
    planned: chosen.dHParsed.planned,
    lenKm,
    stdDev: sigma,
    sigmaSource: levelResolved.source,
  };
  pushObservation(obs);
  return true;
};
