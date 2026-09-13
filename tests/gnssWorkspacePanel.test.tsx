/** @vitest-environment jsdom */

import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { describe, expect, it } from 'vitest';
import { GnssWorkspacePanel } from '../src/components/gnss/GnssWorkspacePanel';
import { GnssResultsPanel } from '../src/components/gnss/GnssResultsPanel';
import { buildGnssSampleNetwork } from '../src/engine/gnssSampleNetwork';
import { buildGnssSessionInput } from '../src/engine/gnssWorkspaceSession';
import { runGnssBaselineAdjustment, type GnssBaselineAdjustInput } from '../src/engine/gnssBaselineAdjust';
import type { GnssRunOutcome } from '../src/hooks/useGnssBaselineWorker';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mark = (id: string, x: number, y: number, z: number): string => `
   <POINT>
      <ID>${id}</ID>
      <NAME>STA-${id}</NAME>
      <COORDINATES>
         <REFERENCE_SYSTEM_ID>126</REFERENCE_SYSTEM_ID>
         <EPOCH>2020.0</EPOCH>
         <GEOCENTRIC_COORDINATES>
            <X>${x}</X>
            <Y>${y}</Y>
            <Z>${z}</Z>
         </GEOCENTRIC_COORDINATES>
      </COORDINATES>
   </POINT>`;

const vector = (
  id: string,
  from: string,
  to: string,
  dx: number,
  dy: number,
  dz: number,
  sdx = 0.005,
): string => `
   <GNSS_VECTOR>
      <ID>${id}</ID>
      <INITIAL_POINT_ID>${from}</INITIAL_POINT_ID>
      <TERMINAL_POINT_ID>${to}</TERMINAL_POINT_ID>
      <ECEF_DELTAS>
         <DX>${dx}</DX>
         <DY>${dy}</DY>
         <DZ>${dz}</DZ>
      </ECEF_DELTAS>
      <CORRELATION_MATRIX>
         <SDX>${sdx}</SDX>
         <SDY>0.005</SDY>
         <SDZ>0.008</SDZ>
         <PXY>0.3</PXY>
         <PXZ>0.1</PXZ>
         <PYZ>0.2</PYZ>
      </CORRELATION_MATRIX>
   </GNSS_VECTOR>`;

const GVX = `<?xml version="1.0" encoding="utf-8"?>\n<GVX VERSION="1.0">\n   <REFERENCE_SYSTEM>\n      <ID>126</ID>\n      <NAME>SYNTH-TEST-FRAME</NAME>\n      <LINEAR_UNIT><NAME>meters</NAME></LINEAR_UNIT>\n   </REFERENCE_SYSTEM>\n${mark('A', 4020000, 500000, 4900000)}${mark('B', 4021000, 501000, 4900500)}${mark('C', 4022500, 502500, 4899800)}${vector('V1', 'A', 'B', 1000.004, 999.997, 500.002)}${vector('V2', 'B', 'C', 1500.003, 1499.998, -699.995)}${vector('V3', 'A', 'C', 2500.006, 2499.995, -199.997)}\n</GVX>\n`;

const BAD_GVX = GVX.replace('<SDX>0.005</SDX>', '<SDX>0</SDX>');

const mountPanel = (runner?: (_input: GnssBaselineAdjustInput) => Promise<GnssRunOutcome>) => {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root: Root = createRoot(container);
  act(() => {
    root.render(React.createElement(GnssWorkspacePanel, runner ? { runner } : {}));
  });
  return {
    container,
    cleanup: () => {
      act(() => root.unmount());
      container.remove();
    },
  };
};

const openGvx = (fileName: string, text: string): void => {
  act(() => {
    window.dispatchEvent(new CustomEvent('webnet:open-gnss', { detail: { fileName, text } }));
  });
};

const mountPanelWithPendingImport = (fileName: string, text: string) => {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root: Root = createRoot(container);
  let consumed = 0;
  act(() => {
    root.render(
      React.createElement(GnssWorkspacePanel, {
        pendingExternalImport: { fileName, text },
        onConsumePendingImport: () => {
          consumed += 1;
        },
      }),
    );
  });
  return {
    container,
    wasConsumed: () => consumed > 0,
    cleanup: () => {
      act(() => root.unmount());
      container.remove();
    },
  };
};

const mountResults = (input: GnssBaselineAdjustInput, outcome: GnssRunOutcome) => {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root: Root = createRoot(container);
  act(() => {
    root.render(React.createElement(GnssResultsPanel, { input, outcome }));
  });
  return {
    container,
    cleanup: () => {
      act(() => root.unmount());
      container.remove();
    },
  };
};

const fmtCov = (cov: { xx: number; xy: number; xz: number; yy: number; yz: number; zz: number }): string =>
  `[[${cov.xx.toExponential(3)}, ${cov.xy.toExponential(3)}, ${cov.xz.toExponential(3)}], ` +
  `[${cov.xy.toExponential(3)}, ${cov.yy.toExponential(3)}, ${cov.yz.toExponential(3)}], ` +
  `[${cov.xz.toExponential(3)}, ${cov.yz.toExponential(3)}, ${cov.zz.toExponential(3)}]]`;

const textOf = (container: HTMLDivElement): string => container.textContent ?? '';

describe('gnss workspace panel flow', () => {
  it('loads GVX text to a summary, then adjusts through the injected runner to results', async () => {
    const seen: string[] = [];
    const runner = async (input: GnssBaselineAdjustInput): Promise<GnssRunOutcome> => {
      seen.push(Object.keys(input.stations).sort().join(','));
      const result = runGnssBaselineAdjustment(input);
      return { result, route: 'typescript', reasons: ['test runner'], workerBacked: false };
    };
    const { container, cleanup } = mountPanel(runner);
    try {
      openGvx('sample.gvx', GVX);
      expect(textOf(container)).toContain('Import summary');
      expect(textOf(container)).toContain('SYNTH-TEST-FRAME');
      expect(textOf(container)).toContain('3 in 1 component(s)');

      const toggle = container.querySelector<HTMLButtonElement>('button[aria-label="A control: free"]');
      expect(toggle).not.toBeNull();
      act(() => {
        toggle!.click();
      });
      expect(textOf(container)).toContain('FIXED-XYZ');

      const adjust = [...container.querySelectorAll<HTMLButtonElement>('button')].find((button) =>
        button.textContent?.includes('Adjust (production route)'),
      );
      expect(adjust).not.toBeUndefined();
      await act(async () => {
        adjust!.click();
        await Promise.resolve();
      });
      expect(seen.length).toBe(1);
      expect(textOf(container)).toContain('Adjusted ECEF stations');
      expect(textOf(container)).toContain('Loop QC');
      expect(textOf(container)).toContain('Removal impact');
      expect(textOf(container)).toContain('Export text report');
    } finally {
      cleanup();
    }
  });

  it('surfaces invalid-covariance GVX as a blocking diagnostic', () => {
    const { container, cleanup } = mountPanel();
    try {
      openGvx('bad.gvx', BAD_GVX);
      const alert = container.querySelector('[role="alert"]');
      expect(alert).not.toBeNull();
      expect(alert!.textContent).toMatch(/stddevs must be positive|covariance/i);
    } finally {
      cleanup();
    }
  });

  it('blocks adjustment while no station is fixed (missing datum)', async () => {
    const { container, cleanup } = mountPanel(async () => {
      throw new Error('runner must not run without datum');
    });
    try {
      openGvx('sample.gvx', GVX);
      const adjust = [...container.querySelectorAll<HTMLButtonElement>('button')].find((button) =>
        button.textContent?.includes('Adjust (production route)'),
      );
      await act(async () => {
        adjust!.click();
        await Promise.resolve();
      });
      const alert = container.querySelector('[role="alert"]');
      expect(alert).not.toBeNull();
      expect(alert!.textContent).toMatch(/fully fixed/);
    } finally {
      cleanup();
    }
  });

  it('loads a pending external import provided at mount without any window event (closed-modal start)', () => {
    const { container, wasConsumed, cleanup } = mountPanelWithPendingImport('dropped.gvx', GVX);
    try {
      expect(textOf(container)).toContain('Import summary');
      expect(textOf(container)).toContain('SYNTH-TEST-FRAME');
      expect(textOf(container)).toContain('3 in 1 component(s)');
      expect(wasConsumed()).toBe(true);
    } finally {
      cleanup();
    }
  });

  it('shows the effective (raw + setup) covariance in the baseline detail when setup is active', async () => {
    const network = buildGnssSampleNetwork();
    const sessionInput = buildGnssSessionInput(network, {
      setup: { horizontalCenteringSigma: 0.002, antennaHeightSigma: 0.003 },
    });
    const result = runGnssBaselineAdjustment(sessionInput);
    const contribution = result.setupContributions?.find((entry) => entry.baselineId === 1);
    expect(contribution).toBeDefined();
    expect(contribution!.effectiveCovariance.xx).not.toBeCloseTo(contribution!.rawCovariance.xx, 12);
    const outcome: GnssRunOutcome = { result, route: 'typescript', reasons: ['test'], workerBacked: false };
    const { container, cleanup } = mountResults(sessionInput, outcome);
    try {
      const row = container.querySelector<HTMLElement>('[aria-label^="Baseline 1 "]');
      expect(row).not.toBeNull();
      await act(async () => {
        row!.click();
        await Promise.resolve();
      });
      const detail = container.querySelector('[aria-label="Baseline detail"]');
      expect(detail).not.toBeNull();
      expect(detail!.textContent).toContain(fmtCov(contribution!.effectiveCovariance));
    } finally {
      cleanup();
    }
  });
});
