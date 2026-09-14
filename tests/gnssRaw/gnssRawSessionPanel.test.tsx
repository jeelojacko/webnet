/** @vitest-environment jsdom */

/**
 * Phase 12J.9 Track D — session panel/review behavior tests (no WASM).
 *
 * Covers: panel intake inventory + STAR determinism + antenna banner via
 * real fixture uploads, no-ingest button absence, PARTIAL review banner,
 * no Accuracy column, and session export determinism. Extends the
 * gnssRawNoAdjustment isolation style to the session UI sources: no
 * adjustment/store coupling anywhere in the session review track.
 */
import { readFileSync } from 'node:fs';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { describe, expect, it } from 'vitest';
import {
  buildRawSession,
  buildRawSessionExport,
  sessionSemanticBytes,
  type BuildRawSessionInput,
} from '../../src/engine/gnssRawSessionExport';
import { SESSION_STOCHASTIC_FREEZE } from '../../src/engine/gnssRawSessionModel';
import type {
  ProcessedRawGnssBaseline,
  RawGnssFileMetadata,
} from '../../src/engine/gnssRawTypes';
import { GnssRawSessionPanel } from '../../src/components/gnss/GnssRawSessionPanel';
import { GnssRawSessionReview } from '../../src/components/gnss/GnssRawSessionReview';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const SESSION_UI = [
  'src/components/gnss/GnssRawSessionPanel.tsx',
  'src/components/gnss/GnssRawSessionPanel.utils.ts',
  'src/components/gnss/GnssRawSessionReview.tsx',
  'src/components/gnss/GnssRawSessionModal.tsx',
  'src/hooks/useGnssRawSession.ts',
  'src/engine/gnssRawSessionExport.ts',
];

const FORBIDDEN = [
  'useAppController',
  'useGnssBaselineWorker',
  'adjustmentWorker',
  'projectSession',
  'projectStorage',
  'runSession',
  'gnssBaselineAdjust',
  'runGnssBaseline',
  'importGnssBaseline',
  'GvxImport',
  'gvxImport',
  'raw adjustment',
  'Raw adjustment',
];

describe('session review isolation', () => {
  for (const file of SESSION_UI) {
    it(`${file} has no project/solve/ingest coupling`, () => {
      const text = readFileSync(file, 'utf8');
      for (const token of FORBIDDEN) {
        expect(text, `${file} must not contain ${JSON.stringify(token)}`).not.toContain(token);
      }
      expect(text).not.toMatch(/adjustment|store\//);
    });
  }
  it('session review has no Accuracy column wording', () => {
    for (const file of SESSION_UI) {
      const text = readFileSync(file, 'utf8');
      expect(text.toLowerCase(), `${file} must not mention accuracy`).not.toContain('accuracy');
    }
  });
});

const FX = 'tests/fixtures/gnssRaw';
const textOf = (name: string): string => readFileSync(`${FX}/${name}`, 'utf8');

const mount = (ui: React.ReactElement): { container: HTMLElement; root: Root } => {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(ui);
  });
  return { container, root };
};

const upload = async (
  container: HTMLElement, testId: string, names: string[],
): Promise<void> => {
  const input = container.querySelector(`[data-testid="${testId}"]`) as HTMLInputElement;
  const files = names.map((n) => {
    const text = textOf(n);
    const file = new File([text], n);
    // jsdom File lacks arrayBuffer; browsers provide it natively.
    Object.defineProperty(file, 'arrayBuffer', {
      value: async () => new TextEncoder().encode(text).buffer,
      configurable: true,
    });
    return file;
  });
  Object.defineProperty(input, 'files', { value: files, configurable: true });
  await act(async () => {
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
};

const byTestId = (container: HTMLElement, id: string): HTMLElement | null =>
  container.querySelector(`[data-testid="${id}"]`);

describe('GnssRawSessionPanel intake', () => {
  it('stages fixtures into inventory with a deterministic STAR tree', async () => {
    const { container, root } = mount(<GnssRawSessionPanel onRestart={() => {}} />);
    expect((byTestId(container, 'raw-session-process') as HTMLButtonElement).disabled).toBe(true);
    // Upload rover first: tree order must not follow upload order.
    await upload(container, 'raw-session-obs-input', ['rover.06o', 'base.06o']);
    await upload(container, 'raw-session-nav-input', ['nav.06n']);
    const inventory = byTestId(container, 'raw-session-inventory')?.textContent ?? '';
    expect(inventory).toContain('SYNB');
    expect(inventory).toContain('SYNR');
    expect(byTestId(container, 'raw-session-edges')?.textContent).toBe('STAR · SYNB→SYNR');
    expect((container.querySelector('[data-testid="raw-session-policy"]') as HTMLSelectElement).value)
      .toBe('STAR');
    // No ANTEX bundle: calibration banner is expected, never a block.
    expect(byTestId(container, 'raw-session-antenna-banner')?.textContent).toMatch(/NONE/);
    expect((byTestId(container, 'raw-session-process') as HTMLButtonElement).disabled).toBe(false);
    act(() => {
      root.unmount();
    });
  });

  it('exposes no ingest buttons', async () => {
    const { container, root } = mount(<GnssRawSessionPanel onRestart={() => {}} />);
    await upload(container, 'raw-session-obs-input', ['base.06o', 'rover.06o']);
    await upload(container, 'raw-session-nav-input', ['nav.06n']);
    const buttons = [...container.querySelectorAll('button')].map((b) => b.textContent ?? '');
    expect(buttons.join(' | ')).not.toMatch(/add to network|adjustment|accept as|send to/i);
    expect(container.textContent).not.toMatch(/Add to Network/);
    act(() => {
      root.unmount();
    });
  });
});

const baseline = (
  from: string, to: string, status: 'FIXED' | 'FLOAT',
): ProcessedRawGnssBaseline => ({
  status,
  acceptance: 'PROCESSING_ACCEPTED',
  acceptanceNotes: [],
  from,
  to,
  deltaX: 1,
  deltaY: 2,
  deltaZ: 3,
  baselineLength: Math.hypot(1, 2, 3),
  covariance: { xx: 1e-6, xy: 0, xz: 0, yy: 1e-6, yz: 0, zz: 1e-6 },
  covarianceAssessment: { model: 'RTKLIB_FORMAL', calibration: 'UNCALIBRATED', status: 'FORMAL_UNCALIBRATED', finite: true, spd: true },
  coordinateReference: 'MARKER_TO_MARKER_ECEF',
  referenceFrame: 'WGS84(G1150)-class/broadcast',
  start: '2024-01-01T00:00:00.000Z',
  stop: '2024-01-01T00:06:00.000Z',
  solutionQuality: { ratio: status === 'FLOAT' ? 1.5 : 9, fixedEpochs: 5, usedEpochs: 8, satellites: 6 },
  antennaAssessment: {
    base: { marker: from, model: '', calibration: 'CALIBRATION_UNAVAILABLE', height: 0, east: 0, north: 0 },
    rover: { marker: to, model: '', calibration: 'CALIBRATION_UNAVAILABLE', height: 0, east: 0, north: 0 },
    overall: 'NONE',
    warning: null,
  },
  provenance: {
    processor: 'rnx2rtkp 2.5.1 @62d4677',
    emccVersion: 'emcc-test',
    compileFlags: [],
    baseObsSha256: `sha-${from}`,
    roverObsSha256: `sha-${to}`,
    navSha256: ['nav'],
    sp3Sha256: null,
    optionsHash: 'fnv1a-0',
    intervalRequested: 'AUTO',
    intervalResolved: 30,
    elevationMaskResolved: 10,
    ephemerisRequested: 'BROADCAST',
    ephemerisUsed: 'BROADCAST',
    processedAt: '2024-01-01T00:07:00.000Z',
  },
  diagnostics: [],
});

const stationFile = (marker: string, interval: number): RawGnssFileMetadata => ({
  role: 'BASE', fileName: `${marker}.06o`, sha256: `sha-${marker}`, rinexVersion: '2.10',
  marker, approxXyz: [0, 0, 0], antennaModel: '', antennaHeight: 0, antennaEast: 0,
  antennaNorth: 0, receiverModel: 'SYNTHRCV', firstEpoch: '2024-01-01T00:00:00.000Z',
  lastEpoch: '2024-01-01T01:00:00.000Z', intervalSeconds: interval,
  constellations: ['G'], signals: ['L1', 'L2'],
});

const partialInput = (): BuildRawSessionInput => ({
  sessionId: 'test-session',
  stations: ['A', 'B', 'C'],
  commonWindow: { start: '2024-01-01T00:00:00.000Z', stop: '2024-01-01T01:00:00.000Z' },
  options: {
    elevationMaskDegrees: 10, intervalRequested: 'AUTO', ephemerisRequested: 'BROADCAST',
    windowStart: null, windowStop: null,
  },
  graph: {
    kind: 'STAR', markers: ['A', 'B', 'C'],
    edges: [
      {
        from: 'A', to: 'B', deltaX: 0, deltaY: 0, deltaZ: 0,
        covariance: { xx: 0, xy: 0, xz: 0, yy: 0, yz: 0, zz: 0 },
        baseObsSha: 'sha-A', roverObsSha: 'sha-B', dependencyGroup: 'g1',
        stochastic: SESSION_STOCHASTIC_FREEZE,
      },
      {
        from: 'A', to: 'C', deltaX: 0, deltaY: 0, deltaZ: 0,
        covariance: { xx: 0, xy: 0, xz: 0, yy: 0, yz: 0, zz: 0 },
        baseObsSha: 'sha-A', roverObsSha: 'sha-C', dependencyGroup: 'g1',
        stochastic: SESSION_STOCHASTIC_FREEZE,
      },
    ],
    provenance: ['STAR hub=A'],
    stochastic: SESSION_STOCHASTIC_FREEZE,
  },
  baselines: [baseline('A', 'B', 'FLOAT')],
  dependencyGroups: [{ edge: 'A->B', group: 'g1' }],
  antennaAssessment: {
    stations: [
      { marker: 'A', model: '', status: 'UNKNOWN', stochastic: SESSION_STOCHASTIC_FREEZE },
      { marker: 'B', model: 'SYN-GENX00 NONE', status: 'UNAVAILABLE', stochastic: SESSION_STOCHASTIC_FREEZE },
    ],
    overall: 'PARTIAL',
    baselineNotes: [],
    stochastic: SESSION_STOCHASTIC_FREEZE,
  },
  ephemerisAssessment: { requested: 'BROADCAST', used: 'BROADCAST', sp3Label: null },
  stationFiles: [stationFile('A', 30), stationFile('B', 15)],
  status: 'PARTIAL',
  provenance: {
    obsSha256: ['sha-A', 'sha-B'], navSha256: ['nav'], sp3Sha256: null,
    antexSourceSha256: null, antexSubsetSha256: null, processor: 'rnx2rtkp 2.5.1 @62d4677',
    optionsHash: 'fnv1a-0', treePolicy: 'STAR', base: 'A',
    windowStart: '2024-01-01T00:00:00.000Z', windowStop: '2024-01-01T01:00:00.000Z',
    intervalResolved: 30,
  },
});

describe('GnssRawSessionReview', () => {
  it('banners PARTIAL/FLOAT/weak-ratio/mixed-interval warnings without an Accuracy column', () => {
    const { container, root } = mount(<GnssRawSessionReview session={buildRawSession(partialInput())} />);
    const banner = byTestId(container, 'raw-session-warnings')?.textContent ?? '';
    expect(banner).toMatch(/PARTIAL/);
    expect(banner).toMatch(/FLOAT/);
    expect(banner).toMatch(/weak ratio/);
    expect(banner).toMatch(/mixed intervals/);
    expect(banner).toMatch(/partial calibration/);
    expect(banner).toMatch(/failed edge A->C/);
    const header = byTestId(container, 'raw-session-baselines')?.querySelector('thead')?.textContent ?? '';
    expect(header).not.toMatch(/accuracy/i);
    const buttons = [...container.querySelectorAll('button')].map((b) => b.textContent ?? '');
    expect(buttons.join(' | ')).not.toMatch(/add to network|adjustment|accept as|send to/i);
    act(() => {
      root.unmount();
    });
  });

  it('produces deterministic export bytes', () => {
    const input = partialInput();
    const a = sessionSemanticBytes(buildRawSessionExport(buildRawSession(input)));
    const reordered: BuildRawSessionInput = {
      ...input,
      stations: [...input.stations].reverse(),
      stationFiles: [...input.stationFiles].reverse(),
    };
    const b = sessionSemanticBytes(buildRawSessionExport(buildRawSession(reordered)));
    expect(a).toBe(b);
  });
});
