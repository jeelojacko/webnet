/** @vitest-environment jsdom */

/**
 * Phase 12J.10 §28 — raw-session inventory renders at 2/4/10/20 stations
 * with no interaction change after the panel split (same table markup).
 */
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it } from 'vitest';
import { RawGnssSessionInventory } from '../../src/components/gnss/RawGnssSessionInventory';
import type { OccupationEntry } from '../../src/components/gnss/GnssRawSessionPanel.utils';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const occ = (marker: string): OccupationEntry => ({
  meta: {
    role: 'ROVER', fileName: `${marker}.06o`, sha256: `sha-${marker}`,
    rinexVersion: '3.04', marker, approxXyz: [0, 0, 0], antennaModel: '',
    antennaHeight: null, antennaEast: null, antennaNorth: null,
    receiverModel: null,
    firstEpoch: '2024-01-01T00:00:00.000Z', lastEpoch: '2024-01-01T01:00:00.000Z',
    intervalSeconds: 30, constellations: ['G'], signals: ['C1C', 'L1C'],
  },
  epochCount: 120, fileName: `${marker}.06o`, bytes: new Uint8Array([1]),
});

const windowResult = {
  ok: true as const,
  start: '2024-01-01T00:00:00.000Z',
  stop: '2024-01-01T01:00:00.000Z',
};

describe('RawGnssSessionInventory scale', () => {
  for (const n of [2, 4, 10, 20]) {
    it(`renders ${n} inventory rows with coverage`, () => {
      const container = document.createElement('div');
      document.body.appendChild(container);
      const root = createRoot(container);
      const occupations = Array.from({ length: n }, (_, i) => occ(`S${String(i).padStart(2, '0')}`));
      act(() => {
        root.render(
          <RawGnssSessionInventory occupations={occupations} windowResult={windowResult} duplicates={[]} />,
        );
      });
      const rows = container.querySelectorAll('[data-testid="raw-session-inventory"] tbody tr');
      expect(rows.length).toBe(n);
      expect(container.textContent).toContain('100%');
      act(() => {
        root.unmount();
      });
      container.remove();
    });
  }
});
