/**
 * Shared authoritative effective project parse helper.
 *
 * Resolves the same effective parse + packed parse options the direct
 * session solver consumes (profile context, cluster-merge normalization,
 * includeFiles + projectRunFiles wiring) so eligibility inspects the exact
 * effective content the solve would parse. Used by the direct solve core
 * (`runSessionSolver`) and by the preanalysis sparse auto-route
 * eligibility gate. No routing, tolerance, or semantics changes.
 */
import { parseInput } from './parseInputCore';
import {
  buildParseOptions,
  resolveProfileContext,
  type RunSessionProfileContext,
} from './runSessionProfile';
import type {
  RunSessionParseSettings,
  RunSessionRequest,
} from './runSessionTypes';
import { normalizeClusterApprovedMerges } from './solveEngine';
import type {
  ClusterApprovedMerge,
  ParseOptions,
  ParseResult,
} from '../types';

export interface EffectiveProjectParse {
  profileContext: RunSessionProfileContext;
  normalizedMerges: ClusterApprovedMerge[];
  parseOptions: Partial<ParseOptions>;
}

export interface ResolveEffectiveProjectParseArgs {
  parseOverride?: Partial<RunSessionParseSettings>;
  approvedClusterMerges?: ClusterApprovedMerge[];
  syntheticAdditionIds?: string[];
  sourceInputOverride?: string;
}

/**
 * Resolves the effective profile context plus the exact parse options the
 * direct solver passes to `parseInput`, including includeFiles and
 * projectRunFiles. `autoAdjustEnabled` stays forced off in the base
 * options (solver contract); an inline `.AUTOADJUST ON` directive in the
 * effective content still flips the parsed state, which eligibility must
 * inspect via `parseEffectiveProjectInput`.
 */
export const resolveEffectiveProjectParse = (
  request: RunSessionRequest,
  args: ResolveEffectiveProjectParseArgs = {},
): EffectiveProjectParse => {
  const mergedParse = {
    ...request.parseSettings,
    ...args.parseOverride,
    autoAdjustEnabled: false,
  };
  const profileContext = resolveProfileContext(
    mergedParse,
    request.projectInstruments,
    request.selectedInstrument,
  );
  const normalizedMerges = profileContext.effectiveParse.clusterDetectionEnabled
    ? normalizeClusterApprovedMerges(
        args.approvedClusterMerges ?? request.approvedClusterMerges,
      )
    : [];
  const parseOptions = buildParseOptions(
    request,
    {
      ...profileContext.effectiveParse,
      preanalysisSyntheticAdditionIds:
        args.syntheticAdditionIds ?? request.activePreanalysisAdditionIds ?? [],
    },
    profileContext.directionSetMode,
    profileContext.allowClusterFaceReliability,
    normalizedMerges,
    profileContext.currentInstrument,
    args.sourceInputOverride != null
      ? { sourceInputOverride: args.sourceInputOverride }
      : undefined,
  );
  return { profileContext, normalizedMerges, parseOptions };
};

/**
 * Parses the effective project content exactly as the direct solver would
 * (same input, instrument library, and parse options, so includes and
 * project run files expand identically). Throws on parse failure; callers
 * fail closed.
 */
export const parseEffectiveProjectInput = (
  request: RunSessionRequest,
  args: ResolveEffectiveProjectParseArgs = {},
): ParseResult => {
  const { profileContext, parseOptions } = resolveEffectiveProjectParse(request, args);
  return parseInput(
    request.input,
    profileContext.effectiveInstrumentLibrary,
    parseOptions,
  );
};
