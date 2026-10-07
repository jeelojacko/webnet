import { describe, expect, it } from 'vitest';
import { createCadHistoryState, type CadHistoryState } from '../src/engine/cad/cadUndoRedo';
import type { CadArcEntity, CadEntity, CadLineEntity, CadProject } from '../src/engine/cad/cadTypes';
import { CAD_LINE_L1_COMMAND_KEYS } from '../src/hooks/surveyCad/useSurveyCadLineL1Keys';
import type { CadLineL1CommandKey } from '../src/hooks/surveyCad/useSurveyCadLineL1Keys';
import type {
  CadLineL1SessionState,
  CommandPoint,
} from '../src/hooks/surveyCad/useSurveyCadCommandTypes';
import {
  backstepCadLineL1Session,
  buildCadLineL1Preview,
  cadLineL1CanFinish,
  cadLineL1ExpectsPointPick,
  cadLineL1HelpText,
  cadLineL1Prompt,
  createCadLineL1Session,
  handleCadLineL1PointPick,
} from '../src/hooks/surveyCad/useSurveyCadLineL1Session';
import { handleSurveyCadLineL1Submit } from '../src/hooks/surveyCad/useSurveyCadLineL1Submit';
import {
  CAD_RIBBON_TOOL_FAMILIES,
  isCadRibbonVariantSelectable,
} from '../src/cad-app/shell/cadRibbonToolFamilies';
import {
  autocompleteShellCommands,
  resolveShellCommandText,
} from '../src/cad-app/shell/cadCommandRegistry';
import { buildCadLineL1Project, buildCadLineL1SurveyPoint } from './cadLineL1TestSupport';

const CRS_ID = 'CA_NAD83_CSRS_UTM_20N';

const surveyPoint = (id: string, x: number, y: number): CadEntity => buildCadLineL1SurveyPoint(id, x, y);

const line = (id: string, fromX: number, fromY: number, toX: number, toY: number): CadLineEntity => ({
  id,
  type: 'line',
  layerId: 'general',
  visible: true,
  locked: false,
  fromStationId: `${id}:from`,
  toStationId: `${id}:to`,
  fromX,
  fromY,
  toX,
  toY,
  sourceObservationIds: [],
  metadata: { entityName: id },
});

const arc = (id: string, cx: number, cy: number, radius: number): CadArcEntity => ({
  id,
  type: 'arc',
  layerId: 'general',
  visible: true,
  locked: false,
  centerX: cx,
  centerY: cy,
  radius,
  startAngleDeg: 0,
  endAngleDeg: 180,
});

const point = (x: number, y: number, label = ''): CommandPoint => ({ x, y, label });

interface Harness {
  history: () => CadHistoryState;
  submit: (_session: CadLineL1SessionState, _input: string) => CadLineL1SessionState | null;
  pick: (_session: CadLineL1SessionState, _value: CommandPoint) => CadLineL1SessionState | null;
  entities: () => CadEntity[];
  lines: () => CadLineEntity[];
}

const makeHarness = (project: CadProject): Harness => {
  let history = createCadHistoryState(project);
  let session: CadLineL1SessionState | null = null;
  const applyHistoryUpdate = (updater: (_history: CadHistoryState) => CadHistoryState) => {
    history = updater(history);
  };
  const replaceSession = (next: CadLineL1SessionState | null) => {
    session = next;
  };
  const submit = (current: CadLineL1SessionState, input: string) => {
    session = { ...current, inputValue: input };
    handleSurveyCadLineL1Submit({
      applyHistoryUpdate,
      project: history.present.project,
      replaceSession,
      session,
    });
    return session;
  };
  const pick = (current: CadLineL1SessionState, value: CommandPoint) => {
    session = current;
    handleCadLineL1PointPick({
      applyHistoryUpdate,
      current,
      point: value,
      project: history.present.project,
      replaceSession,
    });
    return session;
  };
  return {
    history: () => history,
    submit,
    pick,
    entities: () => history.present.project.entities,
    lines: () =>
      history.present.project.entities.filter(
        (entity): entity is CadLineEntity => entity.type === 'line',
      ),
  };
};

describe('L1 keys: registry, ribbon, autocomplete', () => {
  it('registers all 16 keys as session commands with no aliases and keeps LINE/L', () => {
    for (const key of CAD_LINE_L1_COMMAND_KEYS) {
      const def = resolveShellCommandText(key);
      expect(def?.key, key).toBe(key);
      expect(def?.kind, key).toBe('session');
      expect(def?.aliases, key).toEqual([]);
    }
    const lineDef = resolveShellCommandText('LINE');
    expect(lineDef?.key).toBe('LINE');
    expect(lineDef?.aliases).toContain('L');
  });

  it('activates all 17 Line ribbon rows with curated icons and full keys', () => {
    const family = CAD_RIBBON_TOOL_FAMILIES.find((entry) => entry.id === 'line');
    expect(family).toBeTruthy();
    if (!family) return;
    expect(family.variants).toHaveLength(17);
    expect(family.variants.filter((variant) => variant.planned === true)).toHaveLength(0);
    for (const variant of family.variants) {
      expect(variant.icon, variant.id).toBeTruthy();
      expect(variant.commandKey, variant.id).toBeTruthy();
      expect(isCadRibbonVariantSelectable(family, variant.id), variant.id).toBe(true);
    }
    const referenceKeys = family.variants
      .filter((variant) => variant.id !== 'line-create')
      .map((variant) => variant.commandKey);
    expect(referenceKeys).toEqual([...CAD_LINE_L1_COMMAND_KEYS]);
  });

  it('surfaces full LINE_* keys in idle autocomplete', () => {
    const suggestions = autocompleteShellCommands('LINE_', null, 32).map((def) => def.key);
    for (const key of CAD_LINE_L1_COMMAND_KEYS) {
      expect(suggestions, key).toContain(key);
    }
  });
});

describe('L1 sessions: per-key starter, prompt, help, availability', () => {
  it('creates a distinct session for every key with non-empty text', () => {
    for (const key of CAD_LINE_L1_COMMAND_KEYS) {
      const session = createCadLineL1Session(key);
      expect(session.key).toBe(key);
      expect(session.lineSegments).toEqual([]);
      expect(cadLineL1Prompt(session).toLowerCase()).toContain('active');
      expect(cadLineL1HelpText(session).length).toBeGreaterThan(10);
      expect(typeof cadLineL1ExpectsPointPick(session)).toBe('boolean');
      expect(typeof cadLineL1CanFinish(session)).toBe('boolean');
    }
  });

  it('previews typed-free fresh sessions as null and draft segments as primitives', () => {
    const fresh = createCadLineL1Session('LINE_POINT_OBJECT');
    expect(buildCadLineL1Preview(fresh, null)).toBeNull();
    const drafted: CadLineL1SessionState = {
      ...fresh,
      lineAnchor: point(10, 0, 'L1'),
      lineSegments: [
        { start: { x: 0, y: 0, label: 'L1' }, end: { x: 10, y: 0, label: 'L2' } },
      ],
    };
    const preview = buildCadLineL1Preview(drafted, { x: 20, y: 0 });
    expect(preview?.kind).toBe('primitives');
    expect(preview?.primitives.length).toBeGreaterThanOrEqual(2);
  });

  it('treats range/name/object/ne as pick-capable and station-offset as typed-only', () => {
    for (const key of ['LINE_POINT_RANGE', 'LINE_POINT_OBJECT', 'LINE_POINT_NAME', 'LINE_NE'] as CadLineL1CommandKey[]) {
      expect(cadLineL1ExpectsPointPick(createCadLineL1Session(key)), key).toBe(true);
    }
    expect(cadLineL1ExpectsPointPick(createCadLineL1Session('LINE_STATION_OFFSET'))).toBe(false);
  });

  it('backsteps chain drafts without mutating the drawing', () => {
    const session: CadLineL1SessionState = {
      ...createCadLineL1Session('LINE_POINT_OBJECT'),
      lineAnchor: point(10, 0, 'L2'),
      lineSegments: [{ start: { x: 0, y: 0, label: 'L1' }, end: { x: 10, y: 0, label: 'L2' } }],
    };
    const stepped = backstepCadLineL1Session(session);
    expect(stepped.lineSegments).toEqual([]);
    expect(stepped.lineAnchor).toBeNull();
    expect(backstepCadLineL1Session(stepped).resultText).toContain('Nothing to undo');
  });
});

describe('L1 typed submit: range / name / NE / grid / latlong', () => {
  it('commits a point-number range atomically as one undo entry', () => {
    const project = buildCadLineL1Project({
      entities: [surveyPoint('1', 0, 0), surveyPoint('2', 10, 0), surveyPoint('3', 20, 5)],
    });
    const harness = makeHarness(project);
    const next = harness.submit(createCadLineL1Session('LINE_POINT_RANGE'), '1-3');
    expect(next).toBeNull();
    expect(harness.lines()).toHaveLength(2);
    expect(harness.history().undoStack).toHaveLength(1);
    expect(harness.lines()[0]!.metadata?.createdBy).toBe('LINE_POINT_RANGE');
  });

  it('commits an exact point-name list and rejects a missing id without mutation', () => {
    const project = buildCadLineL1Project({
      entities: [surveyPoint('10', 0, 0), surveyPoint('20', 5, 5)],
    });
    const harness = makeHarness(project);
    expect(harness.submit(createCadLineL1Session('LINE_POINT_NAME'), '10,20')).toBeNull();
    expect(harness.lines()).toHaveLength(1);

    const missing = makeHarness(project);
    const session = missing.submit(createCadLineL1Session('LINE_POINT_NAME'), '10,99');
    expect(session?.resultText).toContain('No drawing point');
    expect(missing.entities().filter((entity) => entity.type === 'line')).toHaveLength(0);
    expect(missing.history().undoStack).toHaveLength(0);
  });

  it('treats Northing,Easting asymmetrically (N first)', () => {
    const harness = makeHarness(buildCadLineL1Project());
    let session = harness.submit(createCadLineL1Session('LINE_NE'), '0,0');
    expect(session?.lineAnchor).toMatchObject({ x: 0, y: 0 });
    session = harness.submit(session!, '100,50');
    expect(session?.lineAnchor).toMatchObject({ x: 50, y: 100 });
    session = harness.submit(session!, '');
    expect(session).toBeNull();
    const created = harness.lines()[0]!;
    expect({ fromX: created.fromX, fromY: created.fromY, toX: created.toX, toY: created.toY }).toEqual({
      fromX: 0,
      fromY: 0,
      toX: 50,
      toY: 100,
    });
  });

  it('fails GRID_NE and LATLONG closed without a drawing CRS context', () => {
    const harness = makeHarness(buildCadLineL1Project());
    const grid = harness.submit(createCadLineL1Session('LINE_GRID_NE'), '500000,5000000');
    expect(grid?.resultText).toContain('grid');
    expect(harness.entities()).toHaveLength(0);
    const latlong = harness.submit(createCadLineL1Session('LINE_LATLONG'), '45,-75');
    expect(latlong?.resultText).toContain('grid');
    expect(harness.history().undoStack).toHaveLength(0);
  });

  it('resolves GRID_NE and LATLONG with a drawing CRS', () => {
    const gridHarness = makeHarness(
      buildCadLineL1Project({ coordinateContext: { crsId: CRS_ID } }),
    );
    let gridSession = gridHarness.submit(createCadLineL1Session('LINE_GRID_NE'), '-445748.66307161,5053500.026238931');
    gridSession = gridHarness.submit(gridSession!, '-445700,5053400');
    expect(gridHarness.submit(gridSession!, '')).toBeNull();
    expect(gridHarness.lines()).toHaveLength(1);

    const latHarness = makeHarness(buildCadLineL1Project({ coordinateContext: { crsId: CRS_ID } }));
    let latSession = latHarness.submit(createCadLineL1Session('LINE_LATLONG'), '45,-75');
    latSession = latHarness.submit(latSession!, '45.01,-75');
    expect(latHarness.submit(latSession!, '')).toBeNull();
    expect(latHarness.lines()).toHaveLength(1);
  });
});

describe('L1 typed submit: directional, angle, deflection, offset, side shot', () => {
  it('creates a bearing line from a tapped start', () => {
    const harness = makeHarness(buildCadLineL1Project());
    let session = harness.submit(createCadLineL1Session('LINE_BEARING'), '0,0');
    session = harness.submit(session!, 'N90-00-00E,100');
    expect(harness.submit(session!, '')).toBeNull();
    const created = harness.lines()[0]!;
    expect(created.toX).toBeCloseTo(100, 6);
    expect(created.toY).toBeCloseTo(0, 6);
  });

  it('creates an azimuth line (0 = North, clockwise)', () => {
    const harness = makeHarness(buildCadLineL1Project());
    let session = harness.submit(createCadLineL1Session('LINE_AZIMUTH'), '0,0');
    session = harness.submit(session!, '90,100');
    expect(harness.submit(session!, '')).toBeNull();
    const created = harness.lines()[0]!;
    expect(created.toX).toBeCloseTo(100, 6);
    expect(created.toY).toBeCloseTo(0, 6);
  });

  it('rejects direction input before a start point without mutation', () => {
    const harness = makeHarness(buildCadLineL1Project());
    const session = harness.submit(createCadLineL1Session('LINE_BEARING'), 'N90-00-00E,100');
    expect(session?.resultText).toContain('Capture the start');
    expect(harness.entities()).toHaveLength(0);
  });

  it('creates a turned-angle line from a reference course', () => {
    const harness = makeHarness(buildCadLineL1Project());
    let session: CadLineL1SessionState | null = createCadLineL1Session('LINE_ANGLE', {
      referenceStart: point(0, 0, 'A'),
      referenceEnd: point(0, 100, 'B'),
    });
    session = harness.pick(session!, point(0, 0, 'A'));
    expect(session?.lineAnchor).toMatchObject({ x: 0, y: 0 });
    session = harness.submit(session!, 'R90,100');
    expect(harness.submit(session!, '')).toBeNull();
    const created = harness.lines()[0]!;
    expect(created.toX).toBeCloseTo(100, 6);
    expect(created.toY).toBeCloseTo(0, 6);
  });

  it('creates a deflection line from the forward end of a reference course', () => {
    const harness = makeHarness(buildCadLineL1Project());
    const startSession = createCadLineL1Session('LINE_DEFLECTION', {
      referenceStart: point(0, 0, 'A'),
      referenceEnd: point(100, 0, 'B'),
    });
    const session = harness.submit(startSession, 'R90,100');
    expect(harness.submit(session!, '')).toBeNull();
    const created = harness.lines()[0]!;
    expect(created.fromX).toBeCloseTo(100, 6);
    expect(created.toX).toBeCloseTo(100, 6);
    expect(created.toY).toBeCloseTo(-100, 6);
  });

  it('creates station/offset points on a selected alignment', () => {
    const alignment: CadEntity = {
      id: 'align:1',
      type: 'alignment',
      layerId: 'general',
      visible: true,
      locked: false,
      name: 'A1',
      startStation: 0,
      elements: [{ kind: 'line', start: { x: 0, y: 0 }, end: { x: 100, y: 0 } }],
    };
    const harness = makeHarness(buildCadLineL1Project({ entities: [alignment] }));
    let session = harness.submit({ ...createCadLineL1Session('LINE_STATION_OFFSET'), lineAlignmentId: 'align:1' }, '0,5');
    session = harness.submit(session!, '50,5');
    expect(harness.submit(session!, '')).toBeNull();
    expect(harness.lines()).toHaveLength(1);
  });

  it('rejects station/offset without a selected alignment', () => {
    const harness = makeHarness(buildCadLineL1Project());
    const session = harness.submit(createCadLineL1Session('LINE_STATION_OFFSET'), '0,5');
    expect(session?.resultText).toContain('alignment');
    expect(harness.entities()).toHaveLength(0);
  });

  it('creates fixed-origin side shots and backsteps the newest shot', () => {
    const harness = makeHarness(buildCadLineL1Project());
    let session: CadLineL1SessionState | null = createCadLineL1Session('LINE_SIDE_SHOT');
    session = harness.pick(session!, point(0, 0, 'OCC'));
    session = harness.pick(session!, point(0, 100, 'REF'));
    session = harness.submit(session!, 'AZ90,50');
    session = harness.submit(session!, 'AZ180,25');
    expect(session?.lineSegments).toHaveLength(2);
    session = harness.submit(session!, 'U');
    expect(session?.lineSegments).toHaveLength(1);
    expect(harness.submit(session!, '')).toBeNull();
    const created = harness.lines()[0]!;
    expect(created.fromX).toBeCloseTo(0, 6);
    expect(created.toX).toBeCloseTo(50, 6);
    expect(created.toY).toBeCloseTo(0, 6);
  });

  it('preserves the fixed occupy through SIDE_SHOT backstep (U drops the newest shot only)', () => {
    const harness = makeHarness(buildCadLineL1Project());
    let session: CadLineL1SessionState | null = createCadLineL1Session('LINE_SIDE_SHOT');
    session = harness.pick(session!, point(0, 0, 'OCC'));
    session = harness.pick(session!, point(0, 100, 'REF'));
    session = harness.submit(session!, 'AZ90,50');
    session = harness.submit(session!, 'AZ180,25');
    expect(session?.lineSegments).toHaveLength(2);

    // U drops only the newest shot; occupy + reference direction are untouched.
    session = harness.submit(session!, 'U');
    expect(session?.lineSegments).toHaveLength(1);
    expect(session?.lineAnchor).toMatchObject({ x: 0, y: 0 });
    expect(session?.lineReferenceStart).toMatchObject({ x: 0, y: 100 });

    // A shot entered after U still originates at the fixed occupy.
    session = harness.submit(session!, 'AZ270,30');
    expect(session?.lineSegments).toHaveLength(2);
    expect(session?.lineSegments[0]?.start).toMatchObject({ x: 0, y: 0 });
    expect(session?.lineSegments[1]?.start).toMatchObject({ x: 0, y: 0 });

    // U-to-empty keeps the occupy, so another shot can still be entered.
    session = harness.submit(session!, 'U');
    session = harness.submit(session!, 'U');
    expect(session?.lineSegments).toEqual([]);
    expect(session?.lineAnchor).toMatchObject({ x: 0, y: 0 });
    expect(session?.lineReferenceStart).toMatchObject({ x: 0, y: 100 });
    session = harness.submit(session!, 'AZ0,10');
    expect(session?.lineSegments).toHaveLength(1);
    expect(session?.lineSegments[0]?.start).toMatchObject({ x: 0, y: 0 });

    // Commit remains one atomic undo entry.
    expect(harness.submit(session!, '')).toBeNull();
    expect(harness.lines()).toHaveLength(1);
    expect(harness.history().undoStack).toHaveLength(1);
    const created = harness.lines()[0]!;
    expect(created.fromX).toBeCloseTo(0, 6);
    expect(created.fromY).toBeCloseTo(0, 6);
    expect(created.toX).toBeCloseTo(0, 6);
    expect(created.toY).toBeCloseTo(10, 6);
  });
});

describe('L1 backstep rewinds reference state', () => {
  it('angle: backstep then continue uses the restored segment as the reference', () => {
    const harness = makeHarness(buildCadLineL1Project());
    let session: CadLineL1SessionState | null = createCadLineL1Session('LINE_ANGLE', {
      referenceStart: point(0, 0, 'A'),
      referenceEnd: point(0, 100, 'B'),
    });
    session = harness.pick(session!, point(0, 0, 'A'));
    session = harness.submit(session!, 'R90,100');
    session = harness.submit(session!, 'R90,100');
    expect(session?.lineSegments).toHaveLength(2);
    expect(session?.lineAnchor?.x).toBeCloseTo(100, 6);
    expect(session?.lineAnchor?.y).toBeCloseTo(100, 6);

    session = harness.submit(session!, 'U');
    expect(session?.lineSegments).toHaveLength(1);
    expect(session?.lineAnchor?.x).toBeCloseTo(100, 6);
    expect(session?.lineAnchor?.y).toBeCloseTo(0, 6);
    expect(session?.lineReferenceStart?.x).toBeCloseTo(100, 6);
    expect(session?.lineReferenceStart?.y).toBeCloseTo(0, 6);
    expect(session?.lineReferenceEnd?.x).toBeCloseTo(0, 6);
    expect(session?.lineReferenceEnd?.y).toBeCloseTo(0, 6);

    // Continuing from the restored occupy/backsight reproduces the dropped segment.
    session = harness.submit(session!, 'R90,100');
    expect(harness.submit(session!, '')).toBeNull();
    expect(harness.lines()).toHaveLength(2);
    expect(harness.lines()[1]!.toX).toBeCloseTo(100, 6);
    expect(harness.lines()[1]!.toY).toBeCloseTo(100, 6);
  });

  it('deflection: backstep then continue uses the restored segment as the forward course', () => {
    const harness = makeHarness(buildCadLineL1Project());
    let session: CadLineL1SessionState | null = createCadLineL1Session('LINE_DEFLECTION', {
      referenceStart: point(0, 0, 'A'),
      referenceEnd: point(100, 0, 'B'),
    });
    session = harness.submit(session!, 'R90,100');
    session = harness.submit(session!, 'R90,100');
    expect(session?.lineSegments).toHaveLength(2);
    expect(session?.lineAnchor?.x).toBeCloseTo(0, 6);
    expect(session?.lineAnchor?.y).toBeCloseTo(-100, 6);

    session = harness.submit(session!, 'U');
    expect(session?.lineSegments).toHaveLength(1);
    expect(session?.lineAnchor?.x).toBeCloseTo(100, 6);
    expect(session?.lineAnchor?.y).toBeCloseTo(-100, 6);
    expect(session?.lineReferenceStart?.x).toBeCloseTo(100, 6);
    expect(session?.lineReferenceStart?.y).toBeCloseTo(0, 6);
    expect(session?.lineReferenceEnd?.x).toBeCloseTo(100, 6);
    expect(session?.lineReferenceEnd?.y).toBeCloseTo(-100, 6);

    session = harness.submit(session!, 'R90,100');
    expect(harness.submit(session!, '')).toBeNull();
    expect(harness.lines()).toHaveLength(2);
    expect(harness.lines()[1]!.toX).toBeCloseTo(0, 6);
    expect(harness.lines()[1]!.toY).toBeCloseTo(-100, 6);
  });

  it('backstep-to-empty clears angle/deflection references and prompts for a recapture', () => {
    const angle = makeHarness(buildCadLineL1Project());
    let angleSession: CadLineL1SessionState | null = createCadLineL1Session('LINE_ANGLE', {
      referenceStart: point(0, 0, 'A'),
      referenceEnd: point(0, 100, 'B'),
    });
    angleSession = angle.pick(angleSession!, point(0, 0, 'A'));
    angleSession = angle.submit(angleSession!, 'R90,100');
    angleSession = angle.submit(angleSession!, 'U');
    expect(angleSession?.lineSegments).toEqual([]);
    expect(angleSession?.lineAnchor).toBeNull();
    expect(angleSession?.lineReferenceStart).toBeNull();
    expect(angleSession?.lineReferenceEnd).toBeNull();
    expect(cadLineL1Prompt(angleSession!)).toMatch(/reference/i);

    const deflection = makeHarness(buildCadLineL1Project());
    let defSession: CadLineL1SessionState | null = createCadLineL1Session('LINE_DEFLECTION', {
      referenceStart: point(0, 0, 'A'),
      referenceEnd: point(100, 0, 'B'),
    });
    defSession = deflection.submit(defSession!, 'R90,100');
    defSession = deflection.submit(defSession!, 'U');
    expect(defSession?.lineSegments).toEqual([]);
    expect(defSession?.lineReferenceStart).toBeNull();
    expect(defSession?.lineReferenceEnd).toBeNull();
    expect(cadLineL1Prompt(defSession!)).toMatch(/reference/i);
  });
});

describe('L1 typed submit: extension and from-end', () => {
  it('extends a line in place via GRIP_EDIT preserving id/labels', () => {
    const harness = makeHarness(buildCadLineL1Project({ entities: [line('line:1', 0, 0, 100, 0)] }));
    let session: CadLineL1SessionState | null = createCadLineL1Session('LINE_EXTENSION');
    session = harness.pick(session!, { ...point(100, 0, 'to'), snapSourceEntityId: 'line:1' });
    expect(session?.lineSourceEntityId).toBe('line:1');
    session = harness.submit(session!, '+50');
    expect(session).toBeNull();
    const updated = harness.lines().find((entity) => entity.id === 'line:1')!;
    expect(updated.toX).toBeCloseTo(150, 6);
    expect(updated.fromX).toBeCloseTo(0, 6);
    expect(updated.fromStationId).toBe('line:1:from');
    expect(updated.toStationId).toBe('line:1:to');
    expect(harness.lines()).toHaveLength(1);
    expect(harness.history().undoStack).toHaveLength(1);
  });

  it('creates a collinear from-end line without touching the source', () => {
    const harness = makeHarness(buildCadLineL1Project({ entities: [line('line:1', 0, 0, 100, 0)] }));
    let session: CadLineL1SessionState | null = createCadLineL1Session('LINE_FROM_END');
    session = harness.pick(session!, { ...point(100, 0, 'to'), snapSourceEntityId: 'line:1' });
    expect(session?.lineSourceEndpoint).toBe('end');
    session = harness.submit(session!, '25');
    expect(session).toBeNull();
    expect(harness.lines()).toHaveLength(2);
    const created = harness.lines().find((entity) => entity.id !== 'line:1')!;
    expect(created.fromX).toBeCloseTo(100, 6);
    expect(created.toX).toBeCloseTo(125, 6);
    const source = harness.lines().find((entity) => entity.id === 'line:1')!;
    expect(source.toX).toBeCloseTo(100, 6);
  });
});

describe('L1 corrected TANGENT/PERP: source → on-source start → signed ray', () => {
  const lineSource = () => line('line:1', 0, 0, 100, 0);

  it('perp: line source, interior on-source start, positive = LEFT normal', () => {
    const harness = makeHarness(buildCadLineL1Project({ entities: [lineSource()] }));
    let session: CadLineL1SessionState | null = createCadLineL1Session('LINE_PERP_POINT');
    session = harness.pick(session!, { ...point(50, 0, 'body'), snapSourceEntityId: 'line:1' });
    expect(session?.lineSourceEntityId).toBe('line:1');
    expect(session?.lineSourceOnPoint).toBeNull();
    session = harness.pick(session!, point(50, 0, 'on'));
    expect(session?.lineSourceOnPoint).toMatchObject({ x: 50, y: 0 });
    expect(session?.lineSourceRayDirection).toMatchObject({ x: 0, y: 1 });
    session = harness.submit(session!, '25');
    expect(session).toBeNull();
    const created = harness.lines().find((entity) => entity.id !== 'line:1')!;
    expect(created.fromX).toBeCloseTo(50, 6);
    expect(created.fromY).toBeCloseTo(0, 6);
    expect(created.toX).toBeCloseTo(50, 6);
    expect(created.toY).toBeCloseTo(25, 6);
    const source = harness.lines().find((entity) => entity.id === 'line:1')!;
    expect({ fromX: source.fromX, fromY: source.fromY, toX: source.toX, toY: source.toY }).toEqual({
      fromX: 0,
      fromY: 0,
      toX: 100,
      toY: 0,
    });
    expect(harness.lines()).toHaveLength(2);
    expect(harness.history().undoStack).toHaveLength(1);
  });

  it('perp: negative signed distance travels RIGHT of from→to', () => {
    const harness = makeHarness(buildCadLineL1Project({ entities: [lineSource()] }));
    let session: CadLineL1SessionState | null = createCadLineL1Session('LINE_PERP_POINT');
    session = harness.pick(session!, { ...point(20, 0, 'body'), snapSourceEntityId: 'line:1' });
    session = harness.pick(session!, point(20, 0, 'on'));
    session = harness.submit(session!, '-25');
    expect(session).toBeNull();
    const created = harness.lines().find((entity) => entity.id !== 'line:1')!;
    expect(created.toX).toBeCloseTo(20, 6);
    expect(created.toY).toBeCloseTo(-25, 6);
  });

  it('tangent: line source, interior start, positive distance is collinear forward', () => {
    const harness = makeHarness(buildCadLineL1Project({ entities: [lineSource()] }));
    let session: CadLineL1SessionState | null = createCadLineL1Session('LINE_TANGENT_POINT');
    session = harness.pick(session!, { ...point(40, 0, 'body'), snapSourceEntityId: 'line:1' });
    session = harness.pick(session!, point(40, 0, 'on'));
    session = harness.submit(session!, '30');
    expect(session).toBeNull();
    const created = harness.lines().find((entity) => entity.id !== 'line:1')!;
    expect(created.fromX).toBeCloseTo(40, 6);
    expect(created.fromY).toBeCloseTo(0, 6);
    expect(created.toX).toBeCloseTo(70, 6);
    expect(created.toY).toBeCloseTo(0, 6);
    // Collinear with the source: cross product of the two directions ≈ 0.
    expect((created.toX - created.fromX) * 0 - (created.toY - created.fromY) * 1).toBeCloseTo(0, 9);
  });

  it('tangent: arc source projects onto the sweep and is perpendicular to the radius', () => {
    const harness = makeHarness(buildCadLineL1Project({ entities: [arc('arc:1', 0, 0, 50)] }));
    let session: CadLineL1SessionState | null = createCadLineL1Session('LINE_TANGENT_POINT');
    session = harness.pick(session!, { ...point(0, 50, 'body'), snapSourceEntityId: 'arc:1' });
    session = harness.pick(session!, point(0, 50, 'on'));
    session = harness.submit(session!, '20');
    expect(session).toBeNull();
    const created = harness.lines()[0]!;
    // Sweep 0→180 is CCW, so forward at 90° is −x.
    expect(Math.hypot(created.fromX, created.fromY)).toBeCloseTo(50, 6);
    expect(created.toX).toBeCloseTo(-20, 6);
    expect(created.toY).toBeCloseTo(50, 6);
    const radial = { x: created.fromX, y: created.fromY };
    const tangent = { x: created.toX - created.fromX, y: created.toY - created.fromY };
    expect(radial.x * tangent.x + radial.y * tangent.y).toBeCloseTo(0, 6);
  });

  it('perp: arc source uses the outward radial (positive) and inward (negative)', () => {
    const outward = makeHarness(buildCadLineL1Project({ entities: [arc('arc:1', 0, 0, 50)] }));
    const outwardBody = outward.pick(createCadLineL1Session('LINE_PERP_POINT'), {
      ...point(0, 50, 'body'),
      snapSourceEntityId: 'arc:1',
    });
    const outwardOnPoint = outward.pick(outwardBody!, point(0, 50, 'on'));
    expect(outward.submit(outwardOnPoint!, '20')).toBeNull();
    const outLine = outward.lines()[0]!;
    expect(outLine.toX).toBeCloseTo(0, 6);
    expect(outLine.toY).toBeCloseTo(70, 6);

    const inward = makeHarness(buildCadLineL1Project({ entities: [arc('arc:1', 0, 0, 50)] }));
    const inwardBody = inward.pick(createCadLineL1Session('LINE_PERP_POINT'), {
      ...point(0, 50, 'body'),
      snapSourceEntityId: 'arc:1',
    });
    const inwardOnPoint = inward.pick(inwardBody!, point(0, 50, 'on'));
    expect(inward.submit(inwardOnPoint!, '-20')).toBeNull();
    const inLine = inward.lines()[0]!;
    expect(inLine.toY).toBeCloseTo(30, 6);
  });

  it('perp: circle source uses the outward radial convention', () => {
    const circle: CadEntity = {
      id: 'circle:1',
      type: 'circle',
      layerId: 'general',
      visible: true,
      locked: false,
      centerX: 0,
      centerY: 0,
      radius: 50,
    };
    const harness = makeHarness(buildCadLineL1Project({ entities: [circle] }));
    let session: CadLineL1SessionState | null = createCadLineL1Session('LINE_PERP_POINT');
    session = harness.pick(session!, { ...point(50, 0, 'body'), snapSourceEntityId: 'circle:1' });
    session = harness.pick(session!, point(50, 0, 'on'));
    session = harness.submit(session!, '15');
    expect(session).toBeNull();
    const created = harness.lines()[0]!;
    expect(created.toX).toBeCloseTo(65, 6);
    expect(created.toY).toBeCloseTo(0, 6);
  });

  it('rejects an off-sweep arc start without mutating the drawing', () => {
    const harness = makeHarness(buildCadLineL1Project({ entities: [arc('arc:1', 0, 0, 50)] }));
    let session: CadLineL1SessionState | null = createCadLineL1Session('LINE_TANGENT_POINT');
    session = harness.pick(session!, { ...point(0, 50, 'body'), snapSourceEntityId: 'arc:1' });
    session = harness.pick(session!, point(0, -50, 'off'));
    expect(session).not.toBeNull();
    expect(session?.resultText).toMatch(/off the finite source arc sweep/i);
    expect(session?.lineSourceOnPoint).toBeNull();
    expect(harness.lines()).toHaveLength(0);
    expect(harness.history().undoStack).toHaveLength(0);
  });

  it('constrains an endpoint click to the nearest ray and commits', () => {
    const harness = makeHarness(buildCadLineL1Project({ entities: [lineSource()] }));
    let session: CadLineL1SessionState | null = createCadLineL1Session('LINE_PERP_POINT');
    session = harness.pick(session!, { ...point(50, 0, 'body'), snapSourceEntityId: 'line:1' });
    session = harness.pick(session!, point(50, 0, 'on'));
    session = harness.pick(session!, point(80, 12, 'end'));
    expect(session).toBeNull();
    const created = harness.lines().find((entity) => entity.id !== 'line:1')!;
    expect(created.toX).toBeCloseTo(50, 6);
    expect(created.toY).toBeCloseTo(12, 6);
  });

  it('fails closed on an on-bisector endpoint click', () => {
    const harness = makeHarness(buildCadLineL1Project({ entities: [lineSource()] }));
    let session: CadLineL1SessionState | null = createCadLineL1Session('LINE_PERP_POINT');
    session = harness.pick(session!, { ...point(50, 0, 'body'), snapSourceEntityId: 'line:1' });
    session = harness.pick(session!, point(50, 0, 'on'));
    session = harness.pick(session!, point(80, 0, 'tie'));
    expect(session).not.toBeNull();
    expect(session?.resultText).toMatch(/equidistant/i);
    expect(harness.lines()).toHaveLength(1);
    expect(harness.history().undoStack).toHaveLength(0);
  });

  it('rejects tiny/zero/non-finite typed distances without mutation', () => {
    for (const input of ['0', '1e-12', 'abc']) {
      const harness = makeHarness(buildCadLineL1Project({ entities: [lineSource()] }));
      let session: CadLineL1SessionState | null = createCadLineL1Session('LINE_TANGENT_POINT');
      session = harness.pick(session!, { ...point(50, 0, 'body'), snapSourceEntityId: 'line:1' });
      session = harness.pick(session!, point(50, 0, 'on'));
      const next = harness.submit(session!, input);
      expect(next, input).not.toBeNull();
      expect(harness.lines()).toHaveLength(1);
      expect(harness.history().undoStack).toHaveLength(0);
    }
  });

  it('requires the on-source start before accepting a typed distance', () => {
    const harness = makeHarness(buildCadLineL1Project({ entities: [lineSource()] }));
    let session: CadLineL1SessionState | null = createCadLineL1Session('LINE_PERP_POINT');
    session = harness.pick(session!, { ...point(50, 0, 'body'), snapSourceEntityId: 'line:1' });
    const next = harness.submit(session!, '25');
    expect(next?.resultText).toMatch(/click the start point on the source/i);
    expect(harness.lines()).toHaveLength(1);
  });

  it('rejects an unsupported source body without mutating state', () => {
    const harness = makeHarness(
      buildCadLineL1Project({ entities: [surveyPoint('1', 0, 0), surveyPoint('2', 10, 0)] }),
    );
    const session = harness.pick(createCadLineL1Session('LINE_TANGENT_POINT'), {
      ...point(0, 0, '1'),
      snapSourceEntityId: 'point:1',
      snapKind: 'point-node',
    });
    expect(session?.lineSourceEntityId).toBeNull();
    expect(session?.resultText).toMatch(/line, arc, or circle/i);
  });

  it('uses the pick-time viewport tolerance (zoom-then-click must not leak a stale value)', () => {
    // 100 km source would give a ~1 km extent fraction; the tolerance is the
    // viewport value supplied on each pick, computed at click time.
    const project = buildCadLineL1Project({ entities: [line('line:1', 0, 0, 100_000, 0)] });
    const pickOnSource = (toleranceWorld: number, pick: CommandPoint) => {
      let history = createCadHistoryState(project);
      let session: CadLineL1SessionState | null = createCadLineL1Session('LINE_PERP_POINT');
      const applyHistoryUpdate = (updater: (_h: CadHistoryState) => CadHistoryState) => {
        history = updater(history);
      };
      const replaceSession = (next: CadLineL1SessionState | null) => {
        session = next;
      };
      handleCadLineL1PointPick({
        applyHistoryUpdate,
        current: session!,
        point: { ...point(50_000, 0, 'body'), snapSourceEntityId: 'line:1' },
        project: history.present.project,
        replaceSession,
        pickToleranceWorld: toleranceWorld,
      });
      handleCadLineL1PointPick({
        applyHistoryUpdate,
        current: session!,
        point: pick,
        project: history.present.project,
        replaceSession,
        pickToleranceWorld: toleranceWorld,
      });
      return session;
    };

    // Zoomed in (1 m snap tolerance): a 3 m off pick rejects.
    expect(pickOnSource(1, point(50_000, 3, 'fine'))?.lineSourceOnPoint).toBeNull();
    // Zoomed out (5 m snap tolerance): the same 3 m off pick accepts at the new scale.
    expect(pickOnSource(5, point(50_000, 3, 'coarse'))?.lineSourceOnPoint).toMatchObject({
      x: 50_000,
      y: 0,
    });
    // A far pick still rejects against the coarse tolerance.
    expect(pickOnSource(5, point(50_000, 30, 'far'))?.lineSourceOnPoint).toBeNull();
  });

  it('rejects a point-range with any invalid token atomically (no silent discard)', () => {
    const harness = makeHarness(
      buildCadLineL1Project({
        entities: [surveyPoint('1', 0, 0), surveyPoint('2', 10, 0), surveyPoint('3', 20, 0)],
      }),
    );
    const session = harness.submit(createCadLineL1Session('LINE_POINT_RANGE'), '1-3,foo,7');
    expect(session?.resultText).toMatch(/neither an integer/i);
    expect(harness.entities()).toHaveLength(3);
    expect(harness.history().undoStack).toHaveLength(0);
  });
});

describe('L1 typed submit: fail-closed guards', () => {
  it('rejects an out-of-range alignment station/offset without mutation', () => {
    const alignment: CadEntity = {
      id: 'align:1',
      type: 'alignment',
      layerId: 'general',
      visible: true,
      locked: false,
      name: 'A1',
      startStation: 0,
      elements: [{ kind: 'line', start: { x: 0, y: 0 }, end: { x: 100, y: 0 } }],
    };
    const harness = makeHarness(buildCadLineL1Project({ entities: [alignment] }));
    const session = harness.submit(
      { ...createCadLineL1Session('LINE_STATION_OFFSET'), lineAlignmentId: 'align:1' },
      '5000,5',
    );
    expect(session?.resultText).toContain('outside the alignment range');
    expect(harness.entities()).toHaveLength(1);
    expect(harness.history().undoStack).toHaveLength(0);
  });

  it('rejects GRID_NE outside the drawing CRS without mutation', () => {
    const harness = makeHarness(
      buildCadLineL1Project({ coordinateContext: { crsId: 'EPSG:999999' } }),
    );
    const session = harness.submit(createCadLineL1Session('LINE_GRID_NE'), '1,2');
    expect(session?.resultText).toMatch(/could not be interpreted/i);
    expect(harness.entities()).toHaveLength(0);
    expect(harness.history().undoStack).toHaveLength(0);
  });
});

describe('L1 point-object pick verification', () => {
  it('rejects a non-survey-point pick even when its label matches a station id', () => {
    const harness = makeHarness(
      buildCadLineL1Project({
        entities: [surveyPoint('1', 0, 0), surveyPoint('2', 10, 0), line('line:1', 0, 0, 10, 0)],
      }),
    );
    const session = harness.pick(createCadLineL1Session('LINE_POINT_OBJECT'), {
      ...point(0, 0, '1'),
      snapSourceEntityId: 'line:1',
      snapKind: 'endpoint',
    });
    expect(session?.resultText).toContain('not a survey point');
    expect(session?.lineSegments).toEqual([]);
    expect(session?.lineAnchor).toBeNull();
  });

  it('resolves a verified survey-point pick by its entity station id, not the snap label', () => {
    const harness = makeHarness(
      buildCadLineL1Project({ entities: [surveyPoint('1', 0, 0), surveyPoint('2', 10, 0)] }),
    );
    const session = harness.pick(createCadLineL1Session('LINE_POINT_OBJECT'), {
      ...point(0, 0, 'unrelated-label'),
      snapSourceEntityId: 'point:1',
      snapKind: 'point-node',
    });
    expect(session?.lineAnchor).toMatchObject({ x: 0, y: 0, label: '1' });
  });
});

describe('L1 free-endpoint labels', () => {
  it('preserves real numeric station ids instead of rewriting them to L<n>', () => {
    const harness = makeHarness(
      buildCadLineL1Project({ entities: [surveyPoint('1', 0, 0), surveyPoint('2', 10, 0)] }),
    );
    let session = harness.pick(createCadLineL1Session('LINE_POINT_OBJECT'), {
      ...point(0, 0, '1'),
      snapSourceEntityId: 'point:1',
      snapKind: 'point-node',
    });
    session = harness.pick(session!, {
      ...point(10, 0, '2'),
      snapSourceEntityId: 'point:2',
      snapKind: 'point-node',
    });
    expect(session?.lineSegments[0]?.start.label).toBe('1');
    expect(session?.lineSegments[0]?.end.label).toBe('2');
  });

  it('keeps a real CAD1/CAD2 station id from a point-object pick (provenance, not regex)', () => {
    const harness = makeHarness(
      buildCadLineL1Project({ entities: [surveyPoint('CAD1', 0, 0), surveyPoint('CAD2', 10, 0)] }),
    );
    let session = harness.pick(createCadLineL1Session('LINE_POINT_OBJECT'), {
      ...point(0, 0, 'CAD1'),
      snapSourceEntityId: 'point:CAD1',
      snapKind: 'point-node',
    });
    session = harness.pick(session!, {
      ...point(10, 0, 'CAD2'),
      snapSourceEntityId: 'point:CAD2',
      snapKind: 'point-node',
    });
    expect(session?.lineSegments[0]?.start.label).toBe('CAD1');
    expect(session?.lineSegments[0]?.end.label).toBe('CAD2');
  });

  it('keeps a real tp2 station id from a typed point-name list', () => {
    const harness = makeHarness(
      buildCadLineL1Project({ entities: [surveyPoint('tp2', 0, 0), surveyPoint('tp3', 10, 0)] }),
    );
    expect(harness.submit(createCadLineL1Session('LINE_POINT_NAME'), 'tp2,tp3')).toBeNull();
    const created = harness.lines()[0]!;
    expect(created.fromStationId).toBe('tp2');
    expect(created.toStationId).toBe('tp3');
  });

  it('generates unique, sequential free-endpoint labels (no From L1 / To L1)', () => {
    const harness = makeHarness(buildCadLineL1Project());
    let session = harness.submit(createCadLineL1Session('LINE_NE'), '0,0');
    session = harness.submit(session!, '100,50');
    expect(session?.lineSegments[0]?.start.label).toBe('L1');
    expect(session?.lineSegments[0]?.end.label).toBe('L2');

    // A third point continues the sequence rather than repeating L2.
    session = harness.submit(session!, '100,100');
    expect(session?.lineSegments.map((segment) => [segment.start.label, segment.end.label])).toEqual([
      ['L1', 'L2'],
      ['L2', 'L3'],
    ]);
  });

  it('labels a typed directional start and its endpoint sequentially', () => {
    const harness = makeHarness(buildCadLineL1Project());
    let session = harness.submit(createCadLineL1Session('LINE_BEARING'), '0,0');
    session = harness.submit(session!, 'N90-00-00E,100');
    expect(session?.lineSegments[0]?.start.label).toBe('L1');
    expect(session?.lineSegments[0]?.end.label).toBe('L2');
  });
});
