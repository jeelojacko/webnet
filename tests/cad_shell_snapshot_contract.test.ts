/**
 * Phase 20F.3 §11 — exhaustive shell-snapshot equality contract regression.
 *
 * Pure publish-gate tests (no DOM): the authoritative comparator contract in
 * `src/cad-app/shell/cadShellSnapshotEqual.ts` must cover every
 * `CadWorkspaceSnapshot` key exactly once, and the real
 * `createCadShellLink().publish()` gate must publish on every shell-consumed
 * change (including the 20F.3 nested gaps) while staying silent on equal
 * content and isolating the cursor channel.
 */
import { describe, expect, it } from 'vitest';
import type { CadLayer } from '../src/engine/cad/cadTypes';
import type { DraftSheet } from '../src/engine/cad/cadDraftTypes';
import type { CadWorkspaceSnapshot } from '../src/cad-app/shell/cadShellTypes';
import { createCadShellLink } from '../src/cad-app/shell/cadShellLink';
import {
  SNAPSHOT_CONTRACT_EXACT,
  SNAPSHOT_JSON_SUBTREE_KEYS,
  SNAPSHOT_SCALAR_KEYS,
  SNAPSHOT_STRUCTURED_KEYS,
} from '../src/cad-app/shell/cadShellSnapshotEqual';

// ---------------------------------------------------------------------------
// Compile-time exactness proof (§11 B). If a future CadWorkspaceSnapshot key
// is added without a comparator, `MissingKeys` is no longer `never` and the
// assignment below fails `npm run typecheck`; an unknown key fails `UnknownKeys`.
// ---------------------------------------------------------------------------
type ContractedKeys =
  | (typeof SNAPSHOT_SCALAR_KEYS)[number]
  | (typeof SNAPSHOT_STRUCTURED_KEYS)[number]
  | (typeof SNAPSHOT_JSON_SUBTREE_KEYS)[number];
type MissingKeys = Exclude<keyof CadWorkspaceSnapshot, ContractedKeys>;
type UnknownKeys = Exclude<ContractedKeys, keyof CadWorkspaceSnapshot>;
const _noMissingKeys: MissingKeys extends never ? true : never = true;
const _noUnknownKeys: UnknownKeys extends never ? true : never = true;
// @ts-expect-error — a key not covered by any comparator partition must fail.
const _futureKeyFails: ContractedKeys = 'futureSnapshotKey';

// ---------------------------------------------------------------------------
// Fresh-graph stub: every call returns new objects, so semantic equal compares
// exercise the full comparator set instead of the same-reference fast path.
// ---------------------------------------------------------------------------
const makeLayer = (): CadLayer => ({
  id: 'l1',
  name: 'Points',
  color: '#ffffff',
  visible: true,
  locked: false,
  frozen: false,
  printable: true,
  lineTypeId: 'continuous',
  defaultStyleId: 'st-survey-point',
  description: '',
  transparency: 0,
  lineweightMm: 0.25,
  role: 'points',
});

const makeSheet = (): DraftSheet => ({
  id: 's1',
  name: 'A-101',
  widthMm: 841,
  heightMm: 594,
  orientation: 'landscape',
  margins: { topMm: 10, bottomMm: 10, leftMm: 12, rightMm: 12 },
  viewports: [
    {
      id: 'vp1',
      name: 'Viewport 1',
      modelCenterX: 0,
      modelCenterY: 0,
      scaleDenominator: 100,
      paperXmm: 20,
      paperYmm: 20,
      paperWidthMm: 400,
      paperHeightMm: 250,
      rotationDeg: 0,
    },
  ],
  titleBlockId: 'tb1',
  titleBlockFields: { DRAWN_BY: 'A' },
  sheetObjects: [
    { id: 'so1', kind: 'north-arrow', layerId: 'l1', paperXmm: 10, paperYmm: 10, viewportId: 'vp1', sizeMm: 10 },
  ],
});

const makeSnapshot = (overrides: Partial<CadWorkspaceSnapshot> = {}): CadWorkspaceSnapshot => ({
  drawingId: 'd1',
  drawingName: 'Contract-Test',
  units: 'm',
  entityCount: 3,
  selectionCount: 1,
  selectedEntityIds: ['e1'],
  selectionPreview: [{ id: 'e1', type: 'survey-point', label: 'P1' }],
  layers: [makeLayer()],
  layerEntityCounts: { l1: 3 },
  currentLayerId: 'l1',
  lineTypes: [{ id: 'continuous', name: 'Continuous', dashPattern: [] }],
  sheets: [makeSheet()],
  properties: null,
  activeCommandKey: null,
  commandPrompt: 'Idle.',
  commandInputValue: '',
  canUndo: false,
  canRedo: false,
  historyDepth: 0,
  redoDepth: 0,
  snapPreferences: { endpoint: true, midpoint: false } as CadWorkspaceSnapshot['snapPreferences'],
  snapStatusText: 'SNAP: endpoint',
  stationCount: 1,
  dependencyStatus: 'MANUAL_ONLY',
  survey: null,
  surface: null,
  volume: null,
  analysis: null,
  profile: null,
  section: null,
  f2f: null,
  blocks: null,
  annotation: null,
  surveyTable: null,
  parcel: null,
  featureLine: null,
  grading: null,
  gradingGroups: null,
  availableCommands: ['LINE'],
  ...overrides,
});

const counter = (): { link: ReturnType<typeof createCadShellLink>; notifications: () => number } => {
  const link = createCadShellLink();
  let notifications = 0;
  link.subscribe(() => {
    notifications += 1;
  });
  return { link, notifications: () => notifications };
};

describe('shell snapshot comparator contract', () => {
  it('covers every top-level snapshot key exactly once (§11 A)', () => {
    const keys = [
      ...SNAPSHOT_SCALAR_KEYS,
      ...SNAPSHOT_STRUCTURED_KEYS,
      ...SNAPSHOT_JSON_SUBTREE_KEYS,
    ] as string[];
    expect(new Set(keys).size).toBe(keys.length); // no double-counted key
    expect([...keys].sort()).toEqual(Object.keys(makeSnapshot()).sort());
    expect(SNAPSHOT_CONTRACT_EXACT).toBe(true);
    expect(_noMissingKeys && _noUnknownKeys).toBe(true);
    expect(typeof _futureKeyFails).toBe('string');
  });

  it.each(SNAPSHOT_JSON_SUBTREE_KEYS)('publishes when only the %s subtree changes (§11 C)', (key) => {
    const { link, notifications } = counter();
    link.publish(makeSnapshot());
    expect(notifications()).toBe(1);
    link.publish(makeSnapshot());
    expect(notifications()).toBe(1);
    link.publish(makeSnapshot({ [key]: { marker: 'v1' } } as Partial<CadWorkspaceSnapshot>));
    expect(notifications()).toBe(2);
    link.publish(makeSnapshot({ [key]: { marker: 'v2' } } as Partial<CadWorkspaceSnapshot>));
    expect(notifications()).toBe(3);
  });
});

describe('shell snapshot nested-gap publishes (§11 D)', () => {
  const publishChange = (mutate: (_snapshot: CadWorkspaceSnapshot) => void): number => {
    const { link, notifications } = counter();
    link.publish(makeSnapshot());
    expect(notifications()).toBe(1);
    const changed = makeSnapshot();
    mutate(changed);
    link.publish(changed);
    return notifications();
  };

  it('publishes on selectionPreview.type with equal id/label', () => {
    expect(publishChange((s) => { s.selectionPreview[0]!.type = 'line'; })).toBe(2);
  });

  it('publishes on layers[].role', () => {
    expect(publishChange((s) => { s.layers[0]!.role = 'parcels'; })).toBe(2);
  });

  it('publishes on a shell-rendered layer prop (color)', () => {
    expect(publishChange((s) => { s.layers[0]!.color = '#ff0000'; })).toBe(2);
  });

  it('publishes on lineTypes name', () => {
    expect(publishChange((s) => { s.lineTypes[0]!.name = 'Dashed'; })).toBe(2);
  });

  it('publishes on a lineTypes dash-only change', () => {
    expect(publishChange((s) => { s.lineTypes[0]!.dashPattern = [4, 2]; })).toBe(2);
  });

  it('publishes on sheet width dimension', () => {
    expect(publishChange((s) => { s.sheets[0]!.widthMm = 900; })).toBe(2);
  });

  it('publishes on sheet margin', () => {
    expect(publishChange((s) => { s.sheets[0]!.margins.leftMm = 20; })).toBe(2);
  });

  it('publishes on sheet orientation', () => {
    expect(publishChange((s) => { s.sheets[0]!.orientation = 'portrait'; })).toBe(2);
  });

  it('publishes on a sheet viewport change', () => {
    expect(publishChange((s) => { s.sheets[0]!.viewports[0]!.scaleDenominator = 200; })).toBe(2);
  });

  it('publishes on a sheet title-block field change', () => {
    expect(publishChange((s) => { s.sheets[0]!.titleBlockFields!['DRAWN_BY'] = 'B'; })).toBe(2);
  });

  it('publishes on a sheet object change', () => {
    expect(publishChange((s) => { s.sheets[0]!.sheetObjects[0]!.paperXmm = 25; })).toBe(2);
  });

  it('stays silent for fresh nested graphs with equal content', () => {
    const { link, notifications } = counter();
    link.publish(makeSnapshot());
    link.publish(makeSnapshot());
    expect(notifications()).toBe(1);
  });
});

describe('shell snapshot publish semantics (§11 E-I)', () => {
  it('stays silent on a deep-equal clone (§11 E)', () => {
    const { link, notifications } = counter();
    link.publish(makeSnapshot());
    link.publish(makeSnapshot());
    expect(notifications()).toBe(1);
  });

  it('fires zero notifications for repeated equal publishes (§11 F)', () => {
    const { link, notifications } = counter();
    link.publish(makeSnapshot());
    for (let i = 0; i < 50; i += 1) link.publish(makeSnapshot());
    expect(notifications()).toBe(1);
  });

  it('keeps the cursor channel separate from the snapshot channel (§11 G)', () => {
    const link = createCadShellLink();
    let snapshotNotifications = 0;
    let cursorNotifications = 0;
    link.subscribe(() => { snapshotNotifications += 1; });
    link.subscribeCursor(() => { cursorNotifications += 1; });
    link.publishCursor({ x: 1, y: 2, label: 'a' });
    expect(snapshotNotifications).toBe(0);
    expect(cursorNotifications).toBe(1);
    link.publish(makeSnapshot());
    expect(snapshotNotifications).toBe(1);
    expect(cursorNotifications).toBe(1);
    link.publishCursor({ x: 1, y: 2, label: 'a' }); // equal cursor: suppressed
    expect(cursorNotifications).toBe(1);
    link.publishCursor({ x: 3, y: 4, label: 'b' });
    expect(cursorNotifications).toBe(2);
  });

  it('republishes grading UNBUILT -> BUILDING -> CURRENT (§11 H)', () => {
    const { link, notifications } = counter();
    const state = (marker: string): CadWorkspaceSnapshot =>
      makeSnapshot({
        grading: { marker } as unknown as CadWorkspaceSnapshot['grading'],
        gradingGroups: { marker } as unknown as CadWorkspaceSnapshot['gradingGroups'],
      });
    link.publish(state('UNBUILT'));
    link.publish(state('BUILDING'));
    link.publish(state('CURRENT'));
    link.publish(state('CURRENT')); // identical: suppressed
    expect(notifications()).toBe(3);
  });

  it('republishes FAILED stale evidence and suppresses its identical repeat (§11 I)', () => {
    const { link, notifications } = counter();
    const state = (marker: string, stale: boolean): CadWorkspaceSnapshot =>
      makeSnapshot({
        grading: { marker, stale } as unknown as CadWorkspaceSnapshot['grading'],
      });
    link.publish(state('CURRENT', false));
    link.publish(state('FAILED', true)); // stale evidence reaches the shell
    expect(notifications()).toBe(2);
    link.publish(state('FAILED', true)); // identical repeat: suppressed
    expect(notifications()).toBe(2);
  });
});
