/** @vitest-environment jsdom */

/**
 * Phase 14F micro-fix HIGH — QC overview cross-navigation race.
 *
 * The jump clears report filters, then must scroll to the target observation
 * row. The row only mounts after the parent re-renders with filters cleared
 * (and the section expanded), so a fixed setTimeout can fire before the row
 * exists. The component now scrolls in a post-render effect (with a
 * MutationObserver fallback while the row is still unmounted).
 *
 * This test renders the card with filters active (row absent), clicks the
 * observation link, and asserts the scroll happens synchronously inside act
 * — no timers, no sleeps. Against the old setTimeout implementation the
 * scroll spy is never called within act, so this test pins the fix.
 */
import React, { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';

import { QcOverviewSection } from '../src/components/report/QcOverviewSection';
import type { AdjustmentResult } from '../src/types';

const OBS_ID = 7;

const result = {
  chiSquare: { pass95: false, T: 9.5, dof: 2, p: 0.008 },
  observations: [
    { id: OBS_ID, type: 'dist', localTest: { pass: false, critical: 3.29, statistic: 4.1 } },
  ],
  localTestSummary: { testCount: 1 },
} as unknown as AdjustmentResult;

const Harness: React.FC<{
  onJumpToSection: (_id: string) => void;
  onSelectObservation: (_id: number) => void;
}> = ({ onJumpToSection, onSelectObservation }) => {
  // Filters active hides the target row; clearing them mounts it — the same
  // ordering as the production report (filter state lives in the parent).
  const [filtersActive, setFiltersActive] = useState(true);
  return (
    <div>
      <QcOverviewSection
        isDataCheck={false}
        isPreanalysis={false}
        isSpecialRunMode={false}
        result={result}
        onJumpToSection={onJumpToSection as never}
        onSelectObservation={onSelectObservation}
        onClearFilters={() => setFiltersActive(false)}
      />
      {!filtersActive && (
        <table>
          <tbody>
            <tr data-report-observation-row={String(OBS_ID)}>
              <td>obs 7</td>
            </tr>
          </tbody>
        </table>
      )}
    </div>
  );
};

describe('QC overview jump with filters active', () => {
  it('clears filters, selects, jumps to the section, and scrolls to the row without timers', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root: Root = createRoot(container);
    const onJumpToSection = vi.fn();
    const onSelectObservation = vi.fn();
    const scrollSpy = vi.fn();
    const originalScrollIntoView = HTMLElement.prototype.scrollIntoView;
    HTMLElement.prototype.scrollIntoView = scrollSpy;

    try {
      await act(async () => {
        root.render(
          <Harness onJumpToSection={onJumpToSection} onSelectObservation={onSelectObservation} />,
        );
      });

      // Row starts hidden behind the active filter.
      expect(
        container.querySelector(`[data-report-observation-row="${OBS_ID}"]`),
      ).toBeNull();

      const link = container.querySelector(
        'button[title*="jump to observation"]',
      ) as HTMLButtonElement;
      expect(link).toBeTruthy();

      await act(async () => {
        link.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      });

      expect(onSelectObservation).toHaveBeenCalledWith(OBS_ID);
      expect(onJumpToSection).toHaveBeenCalledWith('distances-ts');
      // The row mounted after the filter clear, and the post-render effect
      // scrolled to it — synchronously within act, no timeout involved.
      const row = container.querySelector(
        `[data-report-observation-row="${OBS_ID}"]`,
      ) as HTMLElement;
      expect(row).toBeTruthy();
      expect(scrollSpy).toHaveBeenCalledTimes(1);
      expect(scrollSpy.mock.instances[0] as unknown).toBe(row);
    } finally {
      HTMLElement.prototype.scrollIntoView = originalScrollIntoView;
      await act(async () => {
        root.unmount();
      });
      container.remove();
    }
  });
});
