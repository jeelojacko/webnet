/** @vitest-environment jsdom */

import React, { act, useMemo } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/industryParityCases', async () => {
  const actual = await vi.importActual<typeof import('../src/industryParityCases')>(
    '../src/industryParityCases',
  );
  return {
    ...actual,
    ACTIVE_INDUSTRY_PARITY_CASE: {
      id: 'test-default',
      fixtureInputPath: '',
      fixtureOutputPath: '',
      normalizationRules: [],
      startupDefaults: undefined,
    },
  };
});

import App from '../src/App';
import {
  getLatestUiPerfSnapshot,
} from '../src/hooks/useUiPerfMonitor';
import { useSequentialTabPrewarm } from '../src/hooks/useHeavyTabHydration';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const waitForCondition = async (
  predicate: () => boolean,
  timeoutMs: number,
  failureMessage: string,
) => {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (predicate()) return;
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 20));
    });
  }
  throw new Error(failureMessage);
};

const clickByText = async (container: HTMLElement, text: string) => {
  const button = Array.from(container.querySelectorAll('button')).find((entry) =>
    entry.textContent?.includes(text),
  ) as HTMLButtonElement | undefined;
  if (!button) throw new Error(`Button "${text}" not found.`);
  await act(async () => {
    button.click();
  });
};

describe('post-adjustment UI responsiveness', () => {
  it(
    'records report readiness before deferred QA timing completes on a real app run',
    async () => {
      const container = document.createElement('div');
      document.body.appendChild(container);
      const root: Root = createRoot(container);

      await act(async () => {
        root.render(<App />);
      });

      await clickByText(container, 'Adjust');
      await waitForCondition(
        () => container.textContent?.includes('Observations & Residuals') === true,
        15000,
        'Expected report output after running adjustment.',
      );

      await waitForCondition(
        () => {
          const snapshot = getLatestUiPerfSnapshot();
          return Boolean(
            snapshot?.stages.resultCommitComplete &&
              snapshot?.stages.reportReady &&
              snapshot?.stages.buildQaDerivedResult,
          );
        },
        10000,
        'Expected UI perf stages after solve.',
      );

      const snapshot = getLatestUiPerfSnapshot();
      expect(snapshot).not.toBeNull();
      expect(snapshot?.stages.resultCommitComplete?.atMs ?? Number.POSITIVE_INFINITY).toBeLessThan(
        snapshot?.stages.buildQaDerivedResult?.atMs ?? 0,
      );
      expect(snapshot?.stages.reportReady).toBeDefined();

      await act(async () => {
        root.unmount();
      });
      container.remove();
    },
    30000,
  );

  it(
    'shows staged fallback before mounting cold heavy tabs after a solve',
    async () => {
      const container = document.createElement('div');
      document.body.appendChild(container);
      const root: Root = createRoot(container);

      await act(async () => {
        root.render(<App />);
      });

      await clickByText(container, 'Adjust');
      await waitForCondition(
        () => container.textContent?.includes('Observations & Residuals') === true,
        15000,
        'Expected report output after running adjustment.',
      );

      await clickByText(container, 'Processing Summary');
      await waitForCondition(
        () =>
          (getLatestUiPerfSnapshot()?.tabClickLatencyMs['processing-summary'] ?? 0) > 0 ||
          getLatestUiPerfSnapshot()?.readyTabs['processing-summary'] != null,
        1000,
        'Expected processing summary tab to record deferred readiness metrics.',
      );
      await waitForCondition(
        () => container.textContent?.includes('Network Processing Completed') === true,
        10000,
        'Expected processing summary after staged hydration.',
      );

      await clickByText(container, 'Industry Standard Output');
      await waitForCondition(
        () =>
          (getLatestUiPerfSnapshot()?.tabClickLatencyMs['industry-output'] ?? 0) > 0 ||
          getLatestUiPerfSnapshot()?.readyTabs['industry-output'] != null,
        1000,
        'Expected industry output tab to record deferred readiness metrics.',
      );

      await act(async () => {
        root.unmount();
      });
      container.remove();
    },
    30000,
  );

  it('prewarms heavy tabs sequentially instead of in parallel', async () => {
    vi.useFakeTimers();
    const callOrder: string[] = [];
    let inFlight = 0;
    let maxInFlight = 0;

    const Harness: React.FC = () => {
      const preloaders = useMemo(
        () =>
          ['summary', 'listing', 'map'].map(
            (label) => () =>
              new Promise<void>((resolve) => {
                callOrder.push(label);
                inFlight += 1;
                maxInFlight = Math.max(maxInFlight, inFlight);
                window.setTimeout(() => {
                  inFlight -= 1;
                  resolve();
                }, 5);
              }),
          ),
        [],
      );
      useSequentialTabPrewarm({ ok: true }, preloaders);
      return null;
    };

    const container = document.createElement('div');
    document.body.appendChild(container);
    const root: Root = createRoot(container);

    await act(async () => {
      root.render(<Harness />);
    });

      await act(async () => {
      await vi.runAllTimersAsync();
      });

    expect(callOrder).toEqual(['summary', 'listing', 'map']);
    expect(maxInFlight).toBe(1);

    await act(async () => {
      root.unmount();
    });
    container.remove();
    vi.useRealTimers();
  });
});
