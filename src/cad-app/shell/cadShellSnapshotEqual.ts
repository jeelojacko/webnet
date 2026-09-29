/**
 * Phase 20F.3 — authoritative snapshot-equality contract for the CAD shell
 * link publish gate.
 *
 * `createCadShellLink().publish()` forwards a snapshot to chrome subscribers
 * only when `cadWorkspaceSnapshotsEqual` says the new one differs. A field
 * silently missing from the contract means stale chrome forever (the 18K
 * section and 20F.2 grading regressions); a missing nested field means a
 * stale subtree; a wrong-shaped comparator means ref-churn notifications.
 *
 * The contract is partitioned into three registries whose key sets must
 * together equal `keyof CadWorkspaceSnapshot` exactly once. The partition is
 * compile-time checked, so adding a snapshot key without a comparator fails
 * `npm run typecheck`, and an unknown key fails too. `SNAPSHOT_JSON_SUBTREE_KEYS`
 * is the authoritative list the publish-gate regression tests iterate.
 */
import type { CadWorkspaceSnapshot } from './cadShellTypes';

type SnapshotKey = keyof CadWorkspaceSnapshot;

/** One comparator per snapshot key, typed against that key's value type. */
type SnapshotComparator<K extends SnapshotKey> = (
  _a: CadWorkspaceSnapshot[K],
  _b: CadWorkspaceSnapshot[K],
) => boolean;

const same = <T>(a: T, b: T): boolean => a === b;

const stringArrayEqual = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && a.every((entry, index) => entry === b[index]);

const numberArrayEqual = (a: readonly number[], b: readonly number[]): boolean =>
  a.length === b.length && a.every((entry, index) => entry === b[index]);

/** Deterministic JSON compare for bounded derived subtrees (existing pattern). */
const jsonEqual = <T>(a: T, b: T): boolean => JSON.stringify(a) === JSON.stringify(b);

const countsEqual = (
  a: CadWorkspaceSnapshot['layerEntityCounts'],
  b: CadWorkspaceSnapshot['layerEntityCounts'],
): boolean => {
  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  return keysA.length === keysB.length && keysA.every((key) => a[key] === b[key]);
};

const boolRecordEqual = (
  a: CadWorkspaceSnapshot['snapPreferences'],
  b: CadWorkspaceSnapshot['snapPreferences'],
): boolean => {
  const keys = Object.keys(a) as Array<keyof typeof a>;
  return keys.length === Object.keys(b).length && keys.every((key) => a[key] === b[key]);
};

/** Scalars, string lists, and flat count/preference records. */
const SCALAR_COMPARATORS = {
  drawingId: same,
  drawingName: same,
  units: same,
  entityCount: same,
  selectionCount: same,
  selectedEntityIds: stringArrayEqual,
  layerEntityCounts: countsEqual,
  currentLayerId: same,
  activeCommandKey: same,
  commandPrompt: same,
  commandInputValue: same,
  canUndo: same,
  canRedo: same,
  historyDepth: same,
  redoDepth: same,
  snapPreferences: boolRecordEqual,
  snapStatusText: same,
  stationCount: same,
  dependencyStatus: same,
  availableCommands: stringArrayEqual,
} as const;

type PreviewEntry = CadWorkspaceSnapshot['selectionPreview'][number];
type LayerEntry = CadWorkspaceSnapshot['layers'][number];
type LineTypeEntry = CadWorkspaceSnapshot['lineTypes'][number];
type SheetEntry = CadWorkspaceSnapshot['sheets'][number];

// selectionPreview.type is consumed (survey-table source match, feature-line /
// grading shell pick), so a type change with equal id/label must publish.
const previewsEqual = (a: readonly PreviewEntry[], b: readonly PreviewEntry[]): boolean =>
  a.length === b.length &&
  a.every((entry, index) => {
    const other = b[index];
    return (
      other != null &&
      entry.id === other.id &&
      entry.type === other.type &&
      entry.label === other.label
    );
  });

// Every CadLayer field the LayerPanel/LayerManagerRow render, plus role and
// defaultStyleId carried for completeness (they are drawing semantics, not
// ref-churn: equal content never publishes).
const layersEqual = (a: readonly LayerEntry[], b: readonly LayerEntry[]): boolean =>
  a.length === b.length &&
  a.every((layer, index) => {
    const other = b[index];
    if (other == null) return false;
    return (
      layer.id === other.id &&
      layer.name === other.name &&
      layer.color === other.color &&
      layer.visible === other.visible &&
      layer.locked === other.locked &&
      layer.frozen === other.frozen &&
      layer.printable === other.printable &&
      layer.lineTypeId === other.lineTypeId &&
      layer.defaultStyleId === other.defaultStyleId &&
      layer.description === other.description &&
      (layer.transparency ?? 0) === (other.transparency ?? 0) &&
      layer.lineweightMm === other.lineweightMm &&
      layer.role === other.role
    );
  });

// Toolspace renders the linetype name + dash preview, so both must publish.
const lineTypesEqual = (a: readonly LineTypeEntry[], b: readonly LineTypeEntry[]): boolean =>
  a.length === b.length &&
  a.every((entry, index) => {
    const other = b[index];
    return (
      other != null &&
      entry.id === other.id &&
      entry.name === other.name &&
      numberArrayEqual(entry.dashPattern, other.dashPattern)
    );
  });

const marginsEqual = (
  a: SheetEntry['margins'] | undefined,
  b: SheetEntry['margins'] | undefined,
): boolean =>
  a === b ||
  (a != null &&
    b != null &&
    a.topMm === b.topMm &&
    a.bottomMm === b.bottomMm &&
    a.leftMm === b.leftMm &&
    a.rightMm === b.rightMm);

// Sheet geometry/title-block/viewports drive the sheet tabs, page setup, and
// paper properties; nested arrays compare semantically (bounded, no ref churn).
const sheetsEqual = (a: readonly SheetEntry[], b: readonly SheetEntry[]): boolean =>
  a.length === b.length &&
  a.every((sheet, index) => {
    const other = b[index];
    if (other == null) return false;
    return (
      sheet.id === other.id &&
      sheet.name === other.name &&
      sheet.widthMm === other.widthMm &&
      sheet.heightMm === other.heightMm &&
      sheet.orientation === other.orientation &&
      marginsEqual(sheet.margins, other.margins) &&
      (sheet.titleBlockId ?? null) === (other.titleBlockId ?? null) &&
      jsonEqual(sheet.titleBlockFields ?? null, other.titleBlockFields ?? null) &&
      jsonEqual(sheet.viewports, other.viewports) &&
      jsonEqual(sheet.sheetObjects, other.sheetObjects)
    );
  });

/** Structured values with dedicated bounded semantic comparators. */
const STRUCTURED_COMPARATORS = {
  selectionPreview: previewsEqual,
  layers: layersEqual,
  lineTypes: lineTypesEqual,
  sheets: sheetsEqual,
  properties: jsonEqual,
} as const;

/** Derived subtrees compared whole-value by deterministic JSON stringify. */
const JSON_SUBTREE_COMPARATORS = {
  survey: jsonEqual,
  surface: jsonEqual,
  volume: jsonEqual,
  analysis: jsonEqual,
  profile: jsonEqual,
  section: jsonEqual,
  f2f: jsonEqual,
  blocks: jsonEqual,
  annotation: jsonEqual,
  surveyTable: jsonEqual,
  parcel: jsonEqual,
  featureLine: jsonEqual,
  grading: jsonEqual,
  gradingGroups: jsonEqual,
} as const;

type ScalarKey = keyof typeof SCALAR_COMPARATORS;
type StructuredKey = keyof typeof STRUCTURED_COMPARATORS;
type JsonSubtreeKey = keyof typeof JSON_SUBTREE_COMPARATORS;
type CoveredKey = ScalarKey | StructuredKey | JsonSubtreeKey;

/**
 * Compile-time exactness: the three partitions cover every snapshot key once.
 * Tuple slots are [missing, unknown, double-counted]; each must be `never`.
 */
type SnapshotContractGaps = [
  Exclude<SnapshotKey, CoveredKey>,
  Exclude<CoveredKey, SnapshotKey>,
  Extract<ScalarKey, StructuredKey | JsonSubtreeKey> | Extract<StructuredKey, JsonSubtreeKey>,
];
export const SNAPSHOT_CONTRACT_EXACT: SnapshotContractGaps extends [never, never, never]
  ? true
  : never = true;

type ComparatorShape<Keys extends SnapshotKey> = {
  readonly [K in Keys]: SnapshotComparator<K>;
};
// Each registry's comparator must accept its key's real value type.
const _scalarShape: ComparatorShape<ScalarKey> = SCALAR_COMPARATORS;
const _structuredShape: ComparatorShape<StructuredKey> = STRUCTURED_COMPARATORS;
const _jsonShape: ComparatorShape<JsonSubtreeKey> = JSON_SUBTREE_COMPARATORS;

const SNAPSHOT_COMPARATORS: ComparatorShape<SnapshotKey> = {
  ...SCALAR_COMPARATORS,
  ...STRUCTURED_COMPARATORS,
  ...JSON_SUBTREE_COMPARATORS,
};

export const SNAPSHOT_SCALAR_KEYS: ReadonlyArray<ScalarKey> = Object.keys(
  SCALAR_COMPARATORS,
) as ScalarKey[];
export const SNAPSHOT_STRUCTURED_KEYS: ReadonlyArray<StructuredKey> = Object.keys(
  STRUCTURED_COMPARATORS,
) as StructuredKey[];
/** Authoritative subtree list for regression tests (exactly the JSON-compared set). */
export const SNAPSHOT_JSON_SUBTREE_KEYS: ReadonlyArray<JsonSubtreeKey> = Object.keys(
  JSON_SUBTREE_COMPARATORS,
) as JsonSubtreeKey[];

const compareKey = <K extends SnapshotKey>(
  key: K,
  a: CadWorkspaceSnapshot,
  b: CadWorkspaceSnapshot,
): boolean => SNAPSHOT_COMPARATORS[key](a[key], b[key]);

/**
 * True when two snapshots are semantically identical for every shell-consumed
 * field. Same-reference is the fast path; null handling mirrors the publish
 * gate (null publishes to/from a snapshot always count as a change).
 */
export const cadWorkspaceSnapshotsEqual = (
  a: CadWorkspaceSnapshot | null,
  b: CadWorkspaceSnapshot | null,
): boolean => {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    SNAPSHOT_SCALAR_KEYS.every((key) => compareKey(key, a, b)) &&
    SNAPSHOT_STRUCTURED_KEYS.every((key) => compareKey(key, a, b)) &&
    SNAPSHOT_JSON_SUBTREE_KEYS.every((key) => compareKey(key, a, b))
  );
};
