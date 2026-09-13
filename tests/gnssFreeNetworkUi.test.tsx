/** @vitest-environment jsdom */

/**
 * Phase 12I.2 (Worker B) — free-network result/report/station presentation.
 * UI-ONLY: backend is authoritative; asserts render result.datumSummary.
 */
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { describe, expect, it } from 'vitest';
import { GnssResultsPanel } from '../src/components/gnss/GnssResultsPanel';
import { GnssStationTable } from '../src/components/gnss/GnssStationTable';
import { mapGnssRunError } from '../src/components/gnss/gnssRunErrorText';
import { runGnssBaselineAdjustment, type GnssBaselineAdjustInput } from '../src/engine/gnssBaselineAdjust';
import {
  GNSS_FREE_EXTRA_RANK_DEFECT,
  GNSS_FREE_NETWORK_SIZE_LIMIT,
} from '../src/engine/gnssFreeNetwork';
import type { GnssRunOutcome } from '../src/hooks/useGnssBaselineWorker';
import { setStationFixed } from '../src/engine/gnssWorkspaceSession';
import { triangle, twoFree } from './gnssBaseline/gnssFreeNetworkTestSupport';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mount = (node: React.ReactElement) => {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root: Root = createRoot(container);
  act(() => {
    root.render(node);
  });
  return {
    container,
    cleanup: () => {
      act(() => root.unmount());
      container.remove();
    },
  };
};

const freeOutcome = (input: GnssBaselineAdjustInput): GnssRunOutcome => ({
  result: runGnssBaselineAdjustment({ ...input, datumMode: 'allow-free' }),
  route: 'typescript',
  reasons: ['test'],
  workerBacked: false,
});

const textOf = (container: HTMLDivElement): string => container.textContent ?? '';

describe('gnss free-network result presentation', () => {
  it('shows a FREE inner-constrained datum banner with distinct rows and anchor-free components', () => {
    const net = triangle();
    const input = { stations: net.stations, baselines: net.baselines };
    const { container, cleanup } = mount(
      React.createElement(GnssResultsPanel, { input, outcome: freeOutcome(input) }),
    );
    try {
      const text = textOf(container);
      expect(text).toContain('FREE — INNER CONSTRAINED');
      expect(text).toContain('Zero-mean ECEF coordinate corrections per free component');
      expect(text).toContain('Datum defect: 3 per free component');
      expect(text).toContain('requested mode: allow-free');
      expect(text).toContain('Coordinate parameters');
      expect(text).toContain('Datum defect');
      expect(text).toContain('Estimable rank');
      expect(text).toContain('Scalar observations');
      expect(text).toContain('Degrees of freedom');
      expect(text).toContain('Component 1 — free, inner constrained');
      expect(text).toContain('Inner-constrained precision');
      // Computational gauge anchor (P01) is never named in ordinary UI.
      expect(text).not.toContain('computational-gauge');
      const datumSection = container.querySelector('[aria-label="Datum definition"]');
      expect(datumSection).not.toBeNull();
      expect(datumSection!.textContent ?? '').not.toContain('P01');
      // No absolute-accuracy wording.
      expect(text).not.toMatch(/absolute coordinate accuracy/i);
    } finally {
      cleanup();
    }
  });

  it('shows MIXED with per-component control attribution and no anchor names', () => {
    const net = twoFree();
    const stations = setStationFixed(
      Object.fromEntries(Object.entries(net.stations).map(([id, station]) => [id, { ...station }])),
      'A01',
      true,
    );
    const input = { stations, baselines: net.baselines };
    const { container, cleanup } = mount(
      React.createElement(GnssResultsPanel, { input, outcome: freeOutcome(input) }),
    );
    try {
      const text = textOf(container);
      expect(text).toContain('MIXED');
      expect(text).toContain('constrained by A01');
      expect(text).toContain('free, inner constrained');
    } finally {
      cleanup();
    }
  });

  it('leaves constrained presentation unchanged (Unknowns row, no banner)', () => {
    const net = triangle();
    const first = [...net.ids].sort()[0] as string;
    const stations = setStationFixed(
      Object.fromEntries(Object.entries(net.stations).map(([id, station]) => [id, { ...station }])),
      first,
      true,
    );
    const input = { stations, baselines: net.baselines };
    const outcome: GnssRunOutcome = {
      result: runGnssBaselineAdjustment(input),
      route: 'typescript',
      reasons: ['test'],
      workerBacked: false,
    };
    expect(outcome.result.datumSummary).toBeUndefined();
    const { container, cleanup } = mount(React.createElement(GnssResultsPanel, { input, outcome }));
    try {
      const text = textOf(container);
      expect(text).toContain('Unknowns');
      expect(text).not.toContain('INNER CONSTRAINED');
      expect(text).not.toContain('Inner-constrained precision');
    } finally {
      cleanup();
    }
  });

  it('renders an optional datum column in the station table only when provided', () => {
    const net = triangle();
    const noop = (): void => undefined;
    const plain = mount(React.createElement(GnssStationTable, { stations: net.stations, onToggleFixed: noop }));
    try {
      expect(textOf(plain.container)).not.toContain('Datum');
    } finally {
      plain.cleanup();
    }
    const withDatum = mount(
      React.createElement(GnssStationTable, {
        stations: net.stations,
        onToggleFixed: noop,
        datumByStation: { P01: 'free', P02: 'free', P03: 'free' },
      }),
    );
    try {
      expect(textOf(withDatum.container)).toContain('free, inner constrained');
    } finally {
      withDatum.cleanup();
    }
  });
});

describe('gnss free-network run error text', () => {
  it('maps the size limit with the station count and keeps the code in details', () => {
    const raw = `${GNSS_FREE_NETWORK_SIZE_LIMIT}: free network has 300 stations (certified max 250; fail-closed).`;
    const mapped = mapGnssRunError(raw);
    expect(mapped).not.toBeNull();
    expect(mapped!.text).toContain('currently limited to 250 stations');
    expect(mapped!.text).toContain('contains 300 stations');
    expect(mapped!.text).toContain('Add real control');
    expect(mapped!.detail).toBe(raw);
  });

  it('maps the extra rank defect without blaming the ordinary F-bridge path', () => {
    const raw = `${GNSS_FREE_EXTRA_RANK_DEFECT}: gauged free network still rank-deficient: singular.`;
    const mapped = mapGnssRunError(raw);
    expect(mapped).not.toBeNull();
    expect(mapped!.text).toContain('additional rank deficiency beyond the expected three translation datum freedoms');
    expect(mapped!.text).toContain('isolated stations');
  });

  it('leaves ordinary errors (incl. F-bridge) unmapped', () => {
    expect(mapGnssRunError('F-BRIDGE: whatever')).toBeNull();
    expect(mapGnssRunError('some other failure')).toBeNull();
  });
});
