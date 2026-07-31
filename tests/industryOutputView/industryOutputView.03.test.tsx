/** @vitest-environment jsdom */

import { describe, expect, it } from 'vitest';

import {
  act,
  createRoot,
  IndustryOutputView,
  type Root,
} from './industryOutputViewTestSupport';

describe('IndustryOutputView heading detection', () => {
  it('detects standalone adjusted-observation and convergence headings and strips unit suffixes', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root: Root = createRoot(container);

    await act(async () => {
      root.render(
        <IndustryOutputView
          text={[
            'Adjusted Measured Distance Observations (Meters)',
            '',
            'Adjusted Zenith Observations (DMS)',
            '',
            'Adjusted Measured Direction Observations (DMS)',
            '',
            'Convergence Angles (DMS) and Grid Factors at Stations',
          ].join('\n')}
          listingSortObservationsBy={'stdResidual'}
          onChangeListingSortObservationsBy={() => {}}
        />,
      );
    });

    const viewport = container.querySelector('[data-industry-output-viewport]') as HTMLDivElement;
    await act(async () => {
      viewport.dispatchEvent(
        new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 30, clientY: 30 }),
      );
    });
    await act(async () => {
      (container.querySelector('[data-industry-output-menu-go-to]') as HTMLButtonElement).dispatchEvent(
        new Event('pointerdown', { bubbles: true }),
      );
    });

    const sectionButtons = Array.from(
      container.querySelectorAll('[data-industry-output-section-target]'),
    ) as HTMLButtonElement[];
    const sectionLabels = sectionButtons.map((button) => button.textContent?.trim() ?? '');
    expect(sectionLabels).toContain('Adjusted Measured Distance Observations');
    expect(sectionLabels).toContain('Adjusted Zenith Observations');
    expect(sectionLabels).toContain('Adjusted Measured Direction Observations');
    expect(sectionLabels).toContain('Convergence Angles and Grid Factors at Stations');
    expect(sectionLabels).not.toContain('Adjusted Zenith Observations (DMS)');

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });
});
