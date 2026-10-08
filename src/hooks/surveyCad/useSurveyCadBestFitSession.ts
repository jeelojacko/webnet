import { runCadCommand, type CadHistoryState } from '../../engine/cad/cadUndoRedo';
import type { CadCogoComputation } from '../../engine/cad/cadCogoTypes';
import type { CadProject } from '../../engine/cad/cadTypes';
import type { CommandPoint, CommandSession } from './useSurveyCadCommandTypes';
import { parseInputPoint } from './useSurveyCadCommandPointParsing';

export type BestFitSessionKey = 'BESTFITLINE' | 'BESTFITARC' | 'BESTFITPARABOLA';

export type BestFitCommandSession = Extract<CommandSession, { key: BestFitSessionKey }>;

type ReplaceBestFitSession = (_nextSession: CommandSession | null) => void;
type ApplyBestFitHistoryUpdate = (
  _updater: (_history: CadHistoryState) => CadHistoryState,
) => void;
type ConsumeBestFitPoint = (_point: CommandPoint) => void;

/** Minimum distinct samples per fit (Worker A fail-closed gates). */
export const BEST_FIT_MIN_SAMPLES: Record<BestFitSessionKey, number> = {
  BESTFITLINE: 2,
  BESTFITARC: 3,
  BESTFITPARABOLA: 5,
};

export const BEST_FIT_ENGINE_KEYS = {
  BESTFITLINE: 'BEST_FIT_LINE',
  BESTFITARC: 'BEST_FIT_ARC',
  BESTFITPARABOLA: 'BEST_FIT_PARABOLA',
} as const;

const BEST_FIT_DUPLICATE_TOLERANCE = 1e-9;

export const isBestFitSessionKey = (key: string): key is BestFitSessionKey =>
  key === 'BESTFITLINE' || key === 'BESTFITARC' || key === 'BESTFITPARABOLA';

export const isBestFitSession = (session: CommandSession | null): session is BestFitCommandSession =>
  session != null && isBestFitSessionKey(session.key);

export const bestFitMinSamples = (key: BestFitSessionKey): number => BEST_FIT_MIN_SAMPLES[key];

const nextBestFitSampleOrdinal = (samples: readonly CommandPoint[]): number => {
  let maxOrdinal = 0;
  for (const sample of samples) {
    const match = /^P(\d+)$/i.exec(sample.label);
    if (match) maxOrdinal = Math.max(maxOrdinal, Number.parseInt(match[1] ?? '0', 10));
  }
  return maxOrdinal + 1;
};

const hasExplicitLabel = (label: string): boolean => !/^-?\d/.test(label.trim()) && label.trim().length > 0;

const resolveBestFitLabel = (
  point: CommandPoint,
  samples: readonly CommandPoint[],
  stationLabel: string | null,
): { label: string; labelIsStationId: boolean } => {
  if (stationLabel != null) return { label: stationLabel, labelIsStationId: true };
  if (point.labelIsStationId === true) return { label: point.label, labelIsStationId: true };
  const explicit = (point.label ?? '').trim();
  if (explicit.length > 0 && hasExplicitLabel(explicit) && !explicit.includes(',')) {
    return { label: explicit, labelIsStationId: false };
  }
  return { label: `P${nextBestFitSampleOrdinal(samples)}`, labelIsStationId: false };
};

const findSurveyStationLabel = (
  project: CadProject,
  sourceEntityId: string | null | undefined,
): string | null => {
  if (sourceEntityId == null) return null;
  const entity = project.entities.find((entry) => entry.id === sourceEntityId) ?? null;
  if (entity?.type !== 'survey-point') return null;
  return entity.stationId;
};

const isNearDuplicateSample = (
  samples: readonly CommandPoint[],
  point: { x: number; y: number },
): boolean =>
  samples.some(
    (sample) =>
      Math.abs(sample.x - point.x) <= BEST_FIT_DUPLICATE_TOLERANCE &&
      Math.abs(sample.y - point.y) <= BEST_FIT_DUPLICATE_TOLERANCE,
  );

const hasDuplicateSource = (
  samples: readonly CommandPoint[],
  sourceEntityId: string | null | undefined,
): boolean =>
  sourceEntityId != null &&
  samples.some((sample) => sample.snapSourceEntityId === sourceEntityId);

/**
 * Preseed law: the current selection seeds the collector only when every
 * selected entity is a survey point. Mixed/empty selections start empty —
 * never a partial preseed, never a fabricated station label.
 */
export const buildBestFitPreseedSamples = (
  project: CadProject,
  selectedEntityIds: readonly string[],
): { samples: CommandPoint[]; skippedNonPointSelection: boolean } => {
  if (selectedEntityIds.length === 0) return { samples: [], skippedNonPointSelection: false };
  const entities = selectedEntityIds.map(
    (id) => project.entities.find((entry) => entry.id === id) ?? null,
  );
  const allSurveyPoints = entities.every((entity) => entity?.type === 'survey-point');
  if (!allSurveyPoints) return { samples: [], skippedNonPointSelection: true };
  return {
    samples: entities.map((entity) => {
      const point = entity as Extract<CadProject['entities'][number], { type: 'survey-point' }>;
      return {
        x: point.x,
        y: point.y,
        label: point.stationId,
        labelIsStationId: true,
        snapSourceEntityId: point.id,
        snapKind: 'point-node' as const,
      } satisfies CommandPoint;
    }),
    skippedNonPointSelection: false,
  };
};

/**
 * Append one sample. Survey-point snaps resolve to the station id through
 * the live project (never inferred from label text); every other pick keeps
 * its coordinates with a P<n> free label. Duplicate sources and near-XY
 * repeats are refused; the session is returned unchanged on refusal.
 */
export const appendBestFitSample = (
  session: BestFitCommandSession,
  point: CommandPoint,
  project: CadProject,
): BestFitCommandSession => {
  const sourceEntityId = point.snapSourceEntityId ?? null;
  const stationLabel = findSurveyStationLabel(project, sourceEntityId);
  if (hasDuplicateSource(session.samples, sourceEntityId)) {
    return {
      ...session,
      inputValue: '',
      resultText: `${session.key} ignored a repeated sample from the same source. Pick a distinct point or type U to backstep.`,
    };
  }
  if (isNearDuplicateSample(session.samples, point)) {
    return {
      ...session,
      inputValue: '',
      resultText: `${session.key} ignored a duplicate sample at the same location. Pick a distinct point or type U to backstep.`,
    };
  }
  const resolved = resolveBestFitLabel(point, session.samples, stationLabel);
  return {
    ...session,
    samples: [
      ...session.samples,
      {
        x: point.x,
        y: point.y,
        label: resolved.label,
        labelIsStationId: resolved.labelIsStationId,
        ...(sourceEntityId != null
          ? {
              snapSourceEntityId: sourceEntityId,
              ...(point.snapKind != null ? { snapKind: point.snapKind } : {}),
            }
          : {}),
      },
    ],
    inputValue: '',
    resultText: undefined,
  };
};

export const backstepBestFitSample = (session: BestFitCommandSession): BestFitCommandSession => {
  if (session.samples.length === 0) {
    return {
      ...session,
      inputValue: '',
      resultText: `${session.key} nothing to undo.`,
    };
  }
  const removed = session.samples[session.samples.length - 1]!;
  return {
    ...session,
    samples: session.samples.slice(0, -1),
    inputValue: '',
    resultText: `${session.key} removed sample ${removed.label}.`,
  };
};

export const bestFitPromptForSession = (session: BestFitCommandSession): string => {
  const minimum = bestFitMinSamples(session.key);
  const count = session.samples.length;
  const base =
    count === 0
      ? `${session.key} active. Click or type the first sample point (minimum ${minimum}).`
      : `${session.key} active. ${count} sample${count === 1 ? '' : 's'} (minimum ${minimum}). Click or type the next sample; U undoes, Enter commits, Esc cancels.`;
  return session.resultText ? `${session.resultText} ${base}` : base;
};

export const handleBestFitPointPick = ({
  current,
  point,
  project,
  replaceSession,
}: {
  current: CommandSession;
  point: CommandPoint;
  project: CadProject;
  replaceSession: ReplaceBestFitSession;
}): boolean => {
  if (!isBestFitSession(current)) return false;
  replaceSession(appendBestFitSample(current, point, project));
  return true;
};

const BEST_FIT_OPTION_UNDO = new Set(['U', 'UNDO', 'BACKSTEP']);

/**
 * Typed input: U/UNDO/BACKSTEP backsteps (no model history); anything else
 * parses as a coordinate through the normal parser (absolute, or relative
 * to the last sample) and flows through the same attribution/duplicate law
 * as viewport picks via consumePoint.
 */
export const handleBestFitTypedSubmit = ({
  consumePoint,
  replaceSession,
  session,
}: {
  consumePoint: ConsumeBestFitPoint;
  replaceSession: ReplaceBestFitSession;
  session: CommandSession;
}): boolean => {
  if (!isBestFitSession(session)) return false;
  const raw = session.inputValue.trim();
  if (BEST_FIT_OPTION_UNDO.has(raw.toUpperCase())) {
    replaceSession(backstepBestFitSample({ ...session, inputValue: '' }));
    return true;
  }
  const base = session.samples[session.samples.length - 1] ?? null;
  const parsed = parseInputPoint(session.inputValue, base);
  if (!parsed) {
    replaceSession({
      ...session,
      inputValue: '',
      resultText: `${session.key} sample invalid. Use \`x,y\`, \`LABEL=x,y\`, \`@azimuth,distance\`, or survey bearing-distance like \`N45-00-00E,100\`. U undoes, Esc cancels.`,
    });
    return true;
  }
  consumePoint(parsed);
  return true;
};

/**
 * Commit: re-solve from the stored samples in ONE runCadCommand entry.
 * Below-minimum refuses and stays active; a failed solve stays active with
 * the reason and zero mutation (runCadCommand returns the state untouched).
 */
export const commitBestFitSession = ({
  applyHistoryUpdate,
  replaceSession,
  reportComputation,
  session,
}: {
  applyHistoryUpdate: ApplyBestFitHistoryUpdate;
  replaceSession: ReplaceBestFitSession;
  reportComputation?: (_computation: CadCogoComputation) => void;
  session: BestFitCommandSession;
}): boolean => {
  const minimum = bestFitMinSamples(session.key);
  if (session.samples.length < minimum) {
    replaceSession({
      ...session,
      inputValue: '',
      resultText: `${session.key} needs at least ${minimum} samples (${session.samples.length} captured). Add more samples or press Esc to cancel.`,
    });
    return false;
  }
  const engineKey = BEST_FIT_ENGINE_KEYS[session.key];
  let committed = false;
  let computation: CadCogoComputation | null = null;
  applyHistoryUpdate((existing) => {
    const next = runCadCommand(existing, {
      key: engineKey,
      samples: session.samples.map((sample) => ({
        x: sample.x,
        y: sample.y,
        label: sample.label,
        ...(sample.snapSourceEntityId != null
          ? { sourceEntityId: sample.snapSourceEntityId }
          : {}),
      })),
    });
    committed = next !== existing;
    if (committed) {
      const computations = next.present.project.cogoComputations ?? [];
      computation = computations[computations.length - 1] ?? null;
    }
    return next;
  });
  if (!committed) {
    replaceSession({
      ...session,
      inputValue: '',
      resultText: `${session.key} could not fit those samples (degenerate geometry). Adjust the samples with U, add more, or press Esc to cancel.`,
    });
    return false;
  }
  // Surface the stored residual report so the operator reviews the fit. The
  // panel shows the engine-appended computation (never a synthetic second).
  if (computation != null) reportComputation?.(computation);
  replaceSession(null);
  return true;
};
