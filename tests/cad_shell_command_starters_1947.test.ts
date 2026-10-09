/**
 * STRUCT-194.7 — pure contract for the extracted CAD shell starter registry.
 *
 * The former inline `shellStarters` literal in `SurveyCadWorkspace.tsx` is now
 * `createCadShellCommandStarters(context)`. This suite pins: full key set and
 * insertion order, the `SURVEYTABLE: undefined` gap, the conditional PASTE
 * closure over the clipboard snapshot, wrapper routing, and fresh-object-per-
 * call semantics. Fast + deterministic (no DOM), agent tier.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  createCadShellCommandStarters,
  type CadShellCommandStarterWorkspace,
} from '../src/components/surveyCad/cadShellCommandStarters';
import type { ActiveCommandKey } from '../src/cad-app/shell/cadShellTypes';

/**
 * Expected key insertion order — the exact order of the former inline literal
 * (and therefore `Object.keys(shellStarters)` / `availableCommands` order).
 */
const EXPECTED_KEYS: ActiveCommandKey[] = [
  'POINT', 'COGO_POINT', 'LINE',
  'LINE_POINT_RANGE', 'LINE_POINT_OBJECT', 'LINE_POINT_NAME', 'LINE_NE', 'LINE_GRID_NE',
  'LINE_LATLONG', 'LINE_BEARING', 'LINE_AZIMUTH', 'LINE_ANGLE', 'LINE_DEFLECTION',
  'LINE_STATION_OFFSET', 'LINE_SIDE_SHOT', 'LINE_EXTENSION', 'LINE_FROM_END',
  'LINE_TANGENT_POINT', 'LINE_PERP_POINT',
  'RECTANGLE', 'CIRCLE', 'CIRCLECD', 'CIRCLE2P', 'CIRCLE3P', 'CIRCLETTR', 'CIRCLETTT',
  'POLYGON', 'PLINE', 'PLINEINSERTVERTEX', 'PLINEDELETEVERTEX', 'TRAVERSE',
  'ARC_3PT', 'ARC_SCE', 'ARC_CSE', 'ARC_SCA', 'ARC_CSA', 'ARC_SCL', 'ARC_CSL', 'ARC_SEA',
  'ARC_SED', 'ARC_SER',
  'CONTINUE_CURVE', 'TANGENT_CURVE',
  'CURVE_BETWEEN_TWO_LINES', 'CURVE_ON_TWO_LINES', 'CURVE_THROUGH_POINT', 'MULTIPLE_CURVES',
  'CURVE_FROM_END', 'REVERSE_OR_COMPOUND',
  'BESTFITLINE', 'BESTFITARC', 'BESTFITPARABOLA',
  'INVERSE', 'MULTI_INVERSE', 'AREA', 'BEARING_REPORT', 'DISTANCE_REPORT', 'TURNED_POINT',
  'DEFLECT_POINT', 'POINT_ALONG_LINE', 'EXTEND_LINE', 'OFFSET_POINT',
  'ALIGNMENT_OFFSET_CREATE', 'ALIGNMENT_STATION_EQUATION', 'ALIGNMENT_OFFSET_POINT',
  'ALIGNMENT_INTERVAL_POINTS',
  'CURVE_SOLVER', 'RADIAL_BEARING', 'POINT_ON_CURVE', 'SUBDIVIDE_CURVE', 'OFFSET_CURVE',
  'PI_CURVE', 'CHORD_BEARING_CURVE', 'REVERSE_CURVE', 'COMPOUND_CURVE',
  'BEARING_BEARING_INTX', 'BEARING_DISTANCE_INTX', 'DISTANCE_DISTANCE_INTX',
  'LINE_CIRCLE_INTX', 'PERP_INTX', 'OFFSET_INTX', 'SKEW_INTX',
  'BATCH_COGO',
  'PARCEL_SPLIT_BEARING', 'PARCEL_SPLIT_AREA',
  'PARCELDESIGNATE', 'PARCELNUMBER', 'PARCELLINK', 'PARCELUNLINK', 'PARCELCHECK',
  'PARCELSCHEDULE', 'PARCELSHAREDEDIT',
  'LINETABLE', 'CURVETABLE', 'PARCELTABLE', 'POINTTABLE', 'PARCELREPORT', 'PARCELDESC',
  'SURVEYTABLE',
  'MTEXT', 'LEADER', 'DIM', 'DIMLINEAR', 'DIMALIGNED', 'DIMANGULAR', 'DIMRADIUS', 'DIMDIAMETER',
  'BDLABEL', 'CURVELABEL',
  'MOVE', 'COPY', 'ROTATE', 'SCALE', 'MIRROR', 'ALIGN2D', 'HELMERT2D', 'GRIDGROUND',
  'PROJECTTRANSFORM',
  'EXTEND', 'TRIM', 'FILLET',
  'PASTE',
];

const recordingWorkspace = (): {
  workspace: CadShellCommandStarterWorkspace;
  calls: string[];
} => {
  const calls: string[] = [];
  const workspace = new Proxy({} as CadShellCommandStarterWorkspace, {
    get: (_target, property: string) =>
      (...args: unknown[]) => {
        calls.push(args.length > 0 ? `${property}:${String(args[0])}` : property);
      },
  });
  return { workspace, calls };
};

describe('STRUCT-194.7 starter registry — keyset and order', () => {
  it('exposes every ActiveCommandKey in the exact former insertion order', () => {
    const { workspace } = recordingWorkspace();
    const starters = createCadShellCommandStarters({
      workspace,
      copiedEntityIds: [],
      startPasteFromClipboard: vi.fn(),
    });
    expect(Object.keys(starters)).toEqual(EXPECTED_KEYS);
    expect(Object.keys(starters)).toHaveLength(122);
  });

  it('leaves SURVEYTABLE undefined and reports it as unavailable', () => {
    const { workspace } = recordingWorkspace();
    const starters = createCadShellCommandStarters({
      workspace,
      copiedEntityIds: [],
      startPasteFromClipboard: vi.fn(),
    });
    expect(starters.SURVEYTABLE).toBeUndefined();
    expect(typeof (starters as Record<string, unknown>).NOT_A_KEY).toBe('undefined');
  });

  it('returns a fresh object every call (no static registry / global cache)', () => {
    const { workspace } = recordingWorkspace();
    const first = createCadShellCommandStarters({
      workspace,
      copiedEntityIds: [],
      startPasteFromClipboard: vi.fn(),
    });
    const second = createCadShellCommandStarters({
      workspace,
      copiedEntityIds: [],
      startPasteFromClipboard: vi.fn(),
    });
    expect(first).not.toBe(second);
    expect(Object.keys(first)).toEqual(Object.keys(second));
  });
});

describe('STRUCT-194.7 starter registry — wrappers', () => {
  it('routes direct entries to the workspace method and L1 entries through startLineL1Command', () => {
    const { workspace, calls } = recordingWorkspace();
    const starters = createCadShellCommandStarters({
      workspace,
      copiedEntityIds: [],
      startPasteFromClipboard: vi.fn(),
    });
    starters.POINT!();
    starters.CIRCLE!();
    starters.LINE_POINT_RANGE!();
    starters.LINE_BEARING!();
    starters.PARCELSHAREDEDIT!();
    expect(calls).toEqual([
      'startPointCommand',
      'startCircleCommand',
      'startLineL1Command:LINE_POINT_RANGE',
      'startLineL1Command:LINE_BEARING',
      'startParcelSharedEditCommand',
    ]);
  });

  it('leaves every non-SURVEYTABLE entry a live function', () => {
    const { workspace } = recordingWorkspace();
    const starters = createCadShellCommandStarters({
      workspace,
      copiedEntityIds: [],
      startPasteFromClipboard: vi.fn(),
    });
    for (const [key, starter] of Object.entries(starters)) {
      if (key === 'SURVEYTABLE' || key === 'PASTE') {
        expect(starter).toBeUndefined();
      } else {
        expect(typeof starter).toBe('function');
      }
    }
  });
});

describe('STRUCT-194.7 starter registry — PASTE gating', () => {
  it('leaves PASTE undefined while the clipboard is empty', () => {
    const { workspace } = recordingWorkspace();
    const paste = vi.fn();
    const starters = createCadShellCommandStarters({
      workspace,
      copiedEntityIds: [],
      startPasteFromClipboard: paste,
    });
    expect(starters.PASTE).toBeUndefined();
    expect(paste).not.toHaveBeenCalled();
  });

  it('enables PASTE once the clipboard is non-empty and forwards the captured ids', () => {
    const { workspace } = recordingWorkspace();
    const paste = vi.fn();
    const starters = createCadShellCommandStarters({
      workspace,
      copiedEntityIds: ['e1', 'e2'],
      startPasteFromClipboard: paste,
    });
    expect(typeof starters.PASTE).toBe('function');
    starters.PASTE!();
    expect(paste).toHaveBeenCalledTimes(1);
    expect(paste).toHaveBeenCalledWith(['e1', 'e2']);
  });
});
