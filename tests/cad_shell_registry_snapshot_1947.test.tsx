/** @vitest-environment jsdom */
/**
 * STRUCT-194.7 — real-root contract for the extracted starter registry and the
 * extracted shell-snapshot builder.
 *
 * Mounts the production `SurveyCadWorkspace` with a real `CadShellLink` so the
 * shell-facing keyset/order, PASTE clipboard gating, command routing, and the
 * memoized `availableCommands` reference are exercised end-to-end (not through
 * the pure factory alone). Fast + deterministic (no worker), agent tier.
 */
import React, { act, StrictMode, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';

import SurveyCadWorkspace from '../src/components/SurveyCadWorkspace';
import { createCadShellLink, type CadShellLink } from '../src/cad-app/shell/cadShellLink';
import type { ActiveCommandKey } from '../src/cad-app/shell/cadShellTypes';
import { createBlankCadDrawingDocument } from '../src/engine/cad/cadDrawingFile';
import {
  appendCadProjectEntities,
  buildCadProjectSignature,
} from '../src/engine/cad/cadProjectState';
import type { CadProject, CadSurveyPointEntity, SurveyCadPersistedState } from '../src/engine/cad/cadTypes';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const NOOP_PERSIST: React.Dispatch<React.SetStateAction<SurveyCadPersistedState | null>> = () => {};

/** The exact starter order (the former inline literal) minus the two gaps. */
const EXPECTED_AVAILABLE = [
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
  'MTEXT', 'LEADER', 'DIM', 'DIMLINEAR', 'DIMALIGNED', 'DIMANGULAR', 'DIMRADIUS', 'DIMDIAMETER',
  'BDLABEL', 'CURVELABEL',
  'MOVE', 'COPY', 'ROTATE', 'SCALE', 'MIRROR', 'ALIGN2D', 'HELMERT2D', 'GRIDGROUND',
  'PROJECTTRANSFORM',
  'EXTEND', 'TRIM', 'FILLET',
];

const point = (id: string, stationId: string, x: number, y: number): CadSurveyPointEntity => ({
  id,
  type: 'survey-point',
  layerId: 'points',
  visible: true,
  locked: false,
  stationId,
  x,
  y,
  z: 0,
  pointClass: 'free',
  source: 'parsed-input',
});

const buildPersisted = (): SurveyCadPersistedState => {
  const drawing = createBlankCadDrawingDocument({ name: 'Registry 1947', units: 'm' });
  const base = { ...drawing.project, id: drawing.project.id, name: 'Registry 1947' };
  const project: CadProject = appendCadProjectEntities(base, [
    point('sp:e1', 'P1', 0, 0),
    point('sp:e2', 'P2', 10, 0),
  ]);
  return { version: 1, sourceSignature: buildCadProjectSignature(project), project };
};

interface HarnessApi {
  bump: () => void;
  tick: () => number;
}

const Harness: React.FC<{
  link: CadShellLink;
  apiRef: { current: HarnessApi | null };
  strict?: boolean;
}> = ({ link, apiRef, strict }) => {
  const [persisted] = useState(buildPersisted);
  const [tick, setTick] = useState(0);
  React.useImperativeHandle(apiRef, () => ({ bump: () => setTick((value) => value + 1), tick: () => tick }));
  const tree = (
    <div>
      <span data-tick>{tick}</span>
      <SurveyCadWorkspace
        input=""
        instrumentLibrary={{}}
        units="m"
        result={null}
        persistedState={persisted}
        onPersistedStateChange={NOOP_PERSIST}
        shellLink={link}
        shellChrome
      />
    </div>
  );
  return strict ? <StrictMode>{tree}</StrictMode> : tree;
};

interface Mounted {
  container: HTMLElement;
  root: Root;
  link: CadShellLink;
  api: HarnessApi;
  snapshot: () => ReturnType<CadShellLink['getSnapshot']>;
}

const mounted: Mounted[] = [];

const mount = async (options: { strict?: boolean } = {}): Promise<Mounted> => {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  const link = createCadShellLink();
  const apiRef: { current: HarnessApi | null } = { current: null };
  await act(async () => {
    root.render(<Harness link={link} apiRef={apiRef} strict={options.strict} />);
  });
  await act(async () => {
    await Promise.resolve();
  });
  const view: Mounted = {
    container,
    root,
    link,
    api: { bump: () => apiRef.current!.bump(), tick: () => apiRef.current!.tick() },
    snapshot: () => link.getSnapshot(),
  };
  mounted.push(view);
  return view;
};

afterEach(async () => {
  for (const view of mounted.splice(0)) {
    await act(async () => {
      view.root.unmount();
    });
    view.container.remove();
  }
});

describe('STRUCT-194.7 real-root starter registry', () => {
  it('publishes the full starter key set in order with the SURVEYTABLE/PASTE gaps', async () => {
    const view = await mount();
    expect(view.snapshot()?.availableCommands).toEqual(EXPECTED_AVAILABLE);
    expect(view.snapshot()?.availableCommands).not.toContain('SURVEYTABLE');
    expect(view.snapshot()?.availableCommands).not.toContain('PASTE');
  });

  it('routes known keys true and unknown / undefined-starter keys false', async () => {
    const view = await mount();
    await act(async () => {
      expect(view.link.actions!.startCommand('LINE')).toBe(true);
      expect(view.link.actions!.startCommand('SURVEYTABLE')).toBe(false);
      expect(view.link.actions!.startCommand('NOT_A_COMMAND' as ActiveCommandKey)).toBe(false);
      expect(view.link.actions!.startCommand('ARC_SEA')).toBe(true);
    });
    expect(view.snapshot()?.activeCommandKey).toBe('ARC_SEA');
  });

  it('gates PASTE on a non-empty clipboard and routes it once enabled', async () => {
    const view = await mount();
    expect(view.snapshot()?.availableCommands).not.toContain('PASTE');

    await act(async () => {
      view.link.actions!.selectEntities(['sp:e1']);
    });
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'c', ctrlKey: true, bubbles: true }));
    });
    expect(view.snapshot()?.availableCommands).toContain('PASTE');
    await act(async () => {
      expect(view.link.actions!.startCommand('PASTE')).toBe(true);
    });
    expect(view.snapshot()?.activeCommandKey).toBe('PASTE');
  });

  it('keeps the availableCommands memo reference stable across an unrelated rerender', async () => {
    const view = await mount();
    const before = view.snapshot()?.availableCommands;
    const snapshotBefore = view.snapshot();
    await act(async () => {
      view.api.bump();
    });
    expect(view.api.tick()).toBe(1);
    expect(view.snapshot()?.availableCommands).toBe(before);
    expect(view.snapshot()).toBe(snapshotBefore);
  });

  it('stays mounted with the full 97-handler channel under StrictMode', async () => {
    const view = await mount({ strict: true });
    expect(view.link.actions).not.toBeNull();
    expect(Object.keys(view.link.actions!).length).toBe(97);
    await act(async () => {
      expect(view.link.actions!.startCommand('LINE')).toBe(true);
    });
    expect(view.snapshot()?.availableCommands).toEqual(EXPECTED_AVAILABLE);
  });
});
