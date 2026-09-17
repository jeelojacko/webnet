/**
 * Phase 17E — draft/sheet derived-label dependency evaluator (pure).
 *
 * Draft labels live in `document.draft` (`DraftDocumentLabel`). A label with
 * a non-empty `sourceEntityId` is derived from a model entity; static text
 * (no source) stays MANUAL. A derived label goes STALE only when its source
 * is missing or carries a broken dependency (STALE / SOURCE_MISSING /
 * UNKNOWN_LEGACY). A MANUAL source has no adjustment dependency, so the
 * label cannot go stale from it — this keeps MANUAL_ONLY drawings
 * exportable. Label text is never rewritten here.
 */
import {
  evaluateCadEntityDependency,
  type CadDependencyEvaluation,
  type CadDependencyEvalOptions,
  type CadDependencyReasonCode,
} from './cadAdjustmentDependency';
import type { DraftDocumentLabel } from './cadDraftTypes';
import type { CadEntity } from './cadTypes';
import type { ResultDependencyIdentity } from '../resultIntegrity';

export type DraftLabelDependencyStatus = 'CURRENT' | 'STALE' | 'MANUAL';

export interface DraftLabelDependency {
  labelId: string;
  status: DraftLabelDependencyStatus;
  reason: Extract<CadDependencyReasonCode, 'CAD_CURRENT' | 'CAD_DERIVED_LABEL_STALE' | 'CAD_NO_DEPENDENCY'>;
}

export type EntityStatusLookup =
  | ReadonlyMap<string, CadDependencyEvaluation>
  | Record<string, CadDependencyEvaluation | undefined>;

const lookupStatus = (
  lookup: EntityStatusLookup,
  entityId: string,
): CadDependencyEvaluation | undefined => {
  if (typeof (lookup as ReadonlyMap<string, CadDependencyEvaluation>).get === 'function') {
    return (lookup as ReadonlyMap<string, CadDependencyEvaluation>).get(entityId);
  }
  return (lookup as Record<string, CadDependencyEvaluation | undefined>)[entityId];
};

const isDerivedSource = (label: DraftDocumentLabel): string | null =>
  typeof label.sourceEntityId === 'string' && label.sourceEntityId.length > 0
    ? label.sourceEntityId
    : null;

/** Build the per-entity status map callers feed into the label evaluator. */
export const buildDraftLabelEntityStatusMap = (
  entities: readonly CadEntity[],
  current: ResultDependencyIdentity | null,
  opts?: CadDependencyEvalOptions,
): Map<string, CadDependencyEvaluation> => {
  const map = new Map<string, CadDependencyEvaluation>();
  for (const entity of entities) {
    map.set(entity.id, evaluateCadEntityDependency(entity, current, opts));
  }
  return map;
};

const isBrokenSource = (evaluation: CadDependencyEvaluation | undefined): boolean =>
  evaluation === undefined ||
  evaluation.status === 'STALE' ||
  evaluation.status === 'SOURCE_MISSING' ||
  evaluation.status === 'UNKNOWN_LEGACY';

export const evaluateDraftLabelDependencies = (
  labels: readonly DraftDocumentLabel[],
  entityStatus: EntityStatusLookup,
): DraftLabelDependency[] =>
  labels.map((label) => {
    const source = isDerivedSource(label);
    if (source === null) {
      return { labelId: label.id, status: 'MANUAL', reason: 'CAD_NO_DEPENDENCY' } as DraftLabelDependency;
    }
    if (isBrokenSource(lookupStatus(entityStatus, source))) {
      return { labelId: label.id, status: 'STALE', reason: 'CAD_DERIVED_LABEL_STALE' } as DraftLabelDependency;
    }
    return { labelId: label.id, status: 'CURRENT', reason: 'CAD_CURRENT' } as DraftLabelDependency;
  });

export const hasStaleDerivedDraftLabel = (evaluated: readonly DraftLabelDependency[]): boolean =>
  evaluated.some((entry) => entry.status === 'STALE');
