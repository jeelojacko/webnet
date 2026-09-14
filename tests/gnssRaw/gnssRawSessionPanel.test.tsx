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
import {
  buildProcessedSession,
  buildSessionEdgeSpecs,
  duplicateMarkerBlocker,
  prepareAntexSubset,
  readSessionAntexEntry,
  suggestReplacementPair,
  type OccupationEntry,
} from '../../src/components/gnss/GnssRawSessionPanel.utils';
import { createAntexSubsetCache } from '../../src/engine/gnssAntexSubset';
import { buildStarGraph } from '../../src/engine/gnssRawSessionGraph';
import type { SessionGraph } from '../../src/engine/gnssRawSessionGraph';
import { DEFAULT_RAW_OPTIONS, type RawFileEntry } from '../../src/hooks/useGnssRawBaseline';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const SESSION_UI = [
  'src/components/gnss/GnssRawSessionPanel.tsx',
  'src/components/gnss/GnssRawSessionPanel.utils.ts',
  'src/components/gnss/GnssRawSessionReview.tsx',
  'src/components/gnss/GnssRawSessionModal.tsx',
  'src/components/gnss/RawGnssSessionIntake.tsx',
  'src/components/gnss/RawGnssSessionInventory.tsx',
  'src/components/gnss/RawGnssSessionGraphControls.tsx',
  'src/components/gnss/RawGnssSessionProgress.tsx',
  'src/hooks/useRawGnssSessionProcessing.ts',
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

/** File intake is fire-and-forget; poll until the async reader settles. */
const waitForText = async (container: HTMLElement, text: string): Promise<void> => {
  await act(async () => {
    for (let i = 0; i < 200; i += 1) {
      if (container.textContent?.includes(text)) return;
      await new Promise((r) => setTimeout(r, 10));
    }
  });
};

describe('GnssRawSessionPanel intake', () => {
  it('stages fixtures into inventory with a deterministic STAR tree', async () => {
    const { container, root } = mount(<GnssRawSessionPanel onRestart={() => {}} />);
    expect((byTestId(container, 'raw-session-process') as HTMLButtonElement).disabled).toBe(true);
    // Upload rover first: tree order must not follow upload order.
    await upload(container, 'raw-session-obs-input', ['rover.06o', 'base.06o']);
    await upload(container, 'raw-session-nav-input', ['nav.06n']);
    await waitForText(container, 'SYNB');
    await waitForText(container, 'SYNR');
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

/** Phase 12J.9 fix: ANTEX subset wired into the session panel util path. */
const tagged = (body: string, tag: string): string => `${body.padEnd(60, ' ')}${tag}`;

const rcvBlock = (serial: string, marker: string): string[] => [
  tagged('', 'START OF ANTENNA'),
  tagged(serial, 'TYPE / SERIAL NO'),
  tagged(marker, 'MARKER NAME'),
  tagged('G01', 'START OF FREQUENCY'),
  tagged('G01', 'END OF FREQUENCY'),
  tagged('', 'END OF ANTENNA'),
];

const ANTEX_SOURCE = [
  tagged('1.4', 'ANTEX VERSION / SYST'),
  tagged('', 'END OF HEADER'),
  ...rcvBlock('TRM59800.00 NONE', 'KEEP_A'),
  ...rcvBlock('LEIAR25.R4 LEIT', 'KEEP_B'),
  ...rcvBlock('ASH700936D_M NONE', 'DROP_ME'),
  tagged('', 'START OF ANTENNA'),
  tagged('BLOCK IIF G01 G063 2011-036A', 'TYPE / SERIAL NO'),
  tagged('G01', 'START OF FREQUENCY'),
  tagged('G01', 'END OF FREQUENCY'),
  tagged('', 'END OF ANTENNA'),
  tagged('', 'END OF FILE'),
].join('\n');

const occupationWithAntenna = (marker: string, antennaModel: string): OccupationEntry => ({
  meta: { ...stationFile(marker, 30), marker, antennaModel },
  epochCount: 120,
  fileName: `${marker}.06o`,
  bytes: new Uint8Array([1, 2, 3]),
});

const navEntry = (name: string): RawFileEntry => ({
  fileName: name,
  bytes: new Uint8Array([9]),
  text: 'nav',
  sha256: `sha-${name}`,
});

const starGraph = (): SessionGraph => ({
  kind: 'STAR',
  markers: ['A', 'B', 'C'],
  edges: ['B', 'C'].map((to) => ({
    from: 'A',
    to,
    deltaX: 0,
    deltaY: 0,
    deltaZ: 0,
    covariance: { xx: 0, xy: 0, xz: 0, yy: 0, yz: 0, zz: 0 },
    baseObsSha: 'sha-A',
    roverObsSha: `sha-${to}`,
    dependencyGroup: 'g1',
    stochastic: SESSION_STOCHASTIC_FREEZE,
  })),
  provenance: ['STAR hub=A'],
  stochastic: SESSION_STOCHASTIC_FREEZE,
});

describe('ANTEX subset session wiring', () => {
  it('generates one cached subset across edges and records hashes', async () => {
    const cache = createAntexSubsetCache();
    const occupations = [
      occupationWithAntenna('A', 'TRM59800.00 NONE'),
      occupationWithAntenna('B', 'LEIAR25.R4 LEIT'),
      occupationWithAntenna('C', 'TRM59800.00 NONE'),
    ];
    const plan = await prepareAntexSubset({
      sourceText: ANTEX_SOURCE,
      occupations,
      validAt: '2024-01-01T00:00:00.000Z',
      cache,
    });
    expect(plan.warning).toBeNull();
    expect(plan.result?.receiverSerials).toEqual(['LEIAR25.R4 LEIT', 'TRM59800.00 NONE']);
    // Repeat preparation reuses the cached instance (subset generated once).
    const again = await prepareAntexSubset({
      sourceText: ANTEX_SOURCE, occupations, validAt: '2024-01-01T00:00:00.000Z', cache,
    });
    expect(again.result).toBe(plan.result);

    const specs = buildSessionEdgeSpecs({
      graph: starGraph(),
      occupations,
      nav: [navEntry('nav.06n')],
      sp3: null,
      options: DEFAULT_RAW_OPTIONS,
      windowStart: '2024-01-01T00:00:00.000Z',
      windowStop: '2024-01-01T01:00:00.000Z',
      resolvedInterval: 30,
      antex: plan.result,
    });
    expect(specs).toHaveLength(2);
    for (const spec of specs) {
      expect(spec.job.options?.antexSubset?.subsetSha256).toBe(plan.result!.subsetSha256);
      expect(spec.job.options?.antexSubset?.sourceSha256).toBe(plan.result!.sourceSha256);
    }
    // Cache hit across edges: every job shares the same subset bytes object.
    expect(specs[0]!.job.options?.antexSubset?.bytes)
      .toBe(specs[1]!.job.options?.antexSubset?.bytes);

    const processed = buildProcessedSession({
      graph: starGraph(),
      occupations,
      markers: ['A', 'B', 'C'],
      stationFiles: [stationFile('A', 30), stationFile('B', 15), stationFile('C', 30)],
      baselines: [baseline('A', 'B', 'FIXED'), baseline('A', 'C', 'FIXED')],
      options: DEFAULT_RAW_OPTIONS,
      windowStart: '2024-01-01T00:00:00.000Z',
      windowStop: '2024-01-01T01:00:00.000Z',
      windowExplicit: false,
      intervalResolved: 30,
      treePolicy: 'STAR',
      antennaAssessment: partialInput().antennaAssessment,
      base: 'A',
      obsSha256: ['sha-A', 'sha-B', 'sha-C'],
      navSha256: ['sha-nav.06n'],
      sp3: null,
      failedCount: 0,
      antex: plan.result,
    });
    expect(processed?.provenance.antexSourceSha256).toBe(plan.result!.sourceSha256);
    expect(processed?.provenance.antexSubsetSha256).toBe(plan.result!.subsetSha256);
  });

  it('maps a missing identity to a PARTIAL warning, never a throw', async () => {
    const plan = await prepareAntexSubset({
      sourceText: ANTEX_SOURCE,
      occupations: [occupationWithAntenna('A', 'NOPE.X NONE'), occupationWithAntenna('B', '')],
      validAt: '2024-01-01T00:00:00.000Z',
    });
    expect(plan.result).toBeNull();
    expect(plan.warning).toMatch(/ANTENNA CALIBRATION INCOMPLETE/);

    // Legacy path stays byte-identical: no antexSubset key on the job options.
    const specs = buildSessionEdgeSpecs({
      graph: starGraph(),
      occupations: [occupationWithAntenna('A', ''), occupationWithAntenna('B', ''), occupationWithAntenna('C', '')],
      nav: [navEntry('nav.06n')],
      sp3: null,
      options: DEFAULT_RAW_OPTIONS,
      windowStart: '2024-01-01T00:00:00.000Z',
      windowStop: '2024-01-01T01:00:00.000Z',
      resolvedInterval: 30,
    });
    expect(specs).toHaveLength(2);
    for (const spec of specs) {
      expect('antexSubset' in (spec.job.options ?? {})).toBe(false);
    }
  });
});

describe('duplicate marker intake gate', () => {
  it('names the marker and both files', () => {
    const blocked = duplicateMarkerBlocker([
      occupationWithAntenna('A', 'TRM59800.00 NONE'),
      occupationWithAntenna('A', 'LEIAR25.R4 LEIT'),
    ]);
    expect(blocked).toMatch(/Duplicate marker A in files A\.06o, A\.06o/);
  });

  it('passes distinct markers', () => {
    expect(duplicateMarkerBlocker([
      occupationWithAntenna('A', 'TRM59800.00 NONE'),
      occupationWithAntenna('B', 'LEIAR25.R4 LEIT'),
    ])).toBeNull();
  });

  it('panel blocks Process fail-closed when two staged files share a marker', async () => {
    const { container, root } = mount(<GnssRawSessionPanel onRestart={() => {}} />);
    // One file per upload: addFiles is fire-and-forget, so each upload
    // settles separately before the next begins.
    await upload(container, 'raw-session-obs-input', ['base.06o']);
    await waitForText(container, 'SYNB');
    await upload(container, 'raw-session-obs-input', ['base.06o']);
    await upload(container, 'raw-session-nav-input', ['nav.06n']);
    await waitForText(container, 'Duplicate marker');
    expect(byTestId(container, 'raw-session-blocker')?.textContent)
      .toMatch(/Duplicate marker SYNB/);
    expect((byTestId(container, 'raw-session-process') as HTMLButtonElement).disabled).toBe(true);
    act(() => {
      root.unmount();
    });
  });
});

describe('NAV intake bound', () => {
  it('panel refuses the 5th NAV file before reading it', async () => {
    const { container, root } = mount(<GnssRawSessionPanel onRestart={() => {}} />);
    await upload(container, 'raw-session-obs-input', ['base.06o', 'rover.06o']);
    await waitForText(container, 'SYNR');
    for (let i = 0; i < 5; i += 1) {
      await upload(container, 'raw-session-nav-input', ['nav.06n']);
    }
    // The excess file is refused pre-read: a file error names the bound,
    // no 5-NAV blocker state is reachable, intake stays at 4 NAV.
    await waitForText(container, 'max 4 NAV files');
    expect(byTestId(container, 'raw-session-file-error')?.textContent)
      .toMatch(/max 4 NAV files/);
    expect(byTestId(container, 'raw-session-blocker')).toBeNull();
    act(() => {
      root.unmount();
    });
  });
});

describe('session ANTEX slot bound', () => {
  it('rejects uploads over 100 MiB naming the file and size', async () => {
    const huge = {
      name: 'huge.atx',
      size: 150 * 1024 * 1024,
      arrayBuffer: async () => new ArrayBuffer(0),
    } as unknown as File;
    await expect(readSessionAntexEntry(huge)).rejects.toThrow(
      /ANTEX huge\.atx exceeds the 100 MiB.*157286400 bytes/,
    );
  });

  it('panel accepts a 33 MiB ANTEX file above the 32 MiB staging cap', async () => {
    const { container, root } = mount(<GnssRawSessionPanel onRestart={() => {}} />);
    // Sparse zeros constructed in-test; no big fixture is committed.
    const bytes = new Uint8Array(33 * 1024 * 1024);
    const file = new File([bytes], 'big.atx');
    Object.defineProperty(file, 'arrayBuffer', {
      value: async () => bytes.buffer,
      configurable: true,
    });
    const input = container.querySelector('[data-testid="raw-session-antex-input"]') as HTMLInputElement;
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    await act(async () => {
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
    // 33 MiB of hashing/decoding outlives one act flush; poll to settle.
    await waitForText(container, 'big.atx');
    expect(byTestId(container, 'raw-session-file-error')).toBeNull();
    expect(container.textContent).toContain('big.atx');
    act(() => {
      root.unmount();
    });
  });
  it('removing the ANTEX source clears the staged file (12J.10 hook ownership)', async () => {
    const { container, root } = mount(<GnssRawSessionPanel onRestart={() => {}} />);
    await upload(container, 'raw-session-antex-input', ['synth.atx']);
    await waitForText(container, 'synth.atx');
    const remove = [...container.querySelectorAll('button')]
      .find((b) => b.textContent === 'remove');
    expect(remove).toBeDefined();
    await act(async () => {
      remove!.dispatchEvent(new Event('click', { bubbles: true }));
    });
    expect(container.textContent).not.toContain('synth.atx');
    act(() => {
      root.unmount();
    });
  });
});

describe('suggestReplacementPair', () => {
  it('prefills the lexicographically first reconnecting pair', () => {
    const graph = buildStarGraph(
      [occupationWithAntenna('A', ''), occupationWithAntenna('B', ''), occupationWithAntenna('C', '')],
      'A',
    );
    expect(suggestReplacementPair(graph, { from: 'A', to: 'B' })).toEqual({ from: 'B', to: 'C' });
  });

  it('returns null when no alternative pair exists', () => {
    const graph = buildStarGraph(
      [occupationWithAntenna('A', ''), occupationWithAntenna('B', '')],
      'A',
    );
    expect(suggestReplacementPair(graph, { from: 'A', to: 'B' })).toBeNull();
  });
});
