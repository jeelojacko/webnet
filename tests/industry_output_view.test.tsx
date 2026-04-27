/** @vitest-environment jsdom */

import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import IndustryOutputView from '../src/components/IndustryOutputView';
import type { ListingSortObservationsBy } from '../src/listingSortObservations';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('IndustryOutputView context menu', () => {
  it('makes File:Line entries clickable and emits source-line jump', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root: Root = createRoot(container);
    const onJumpToSourceLine = vi.fn();

    await act(async () => {
      root.render(
        <IndustryOutputView
          text={[
            'Adjusted Measured Distance Observations (Meters)',
            '',
            'From       To              Distance      Residual   StdErr StdRes File:Line',
            'PITA       129              114.9610        0.0087   0.0039   2.2    1:1725',
          ].join('\n')}
          listingSortObservationsBy={'stdResidual'}
          onChangeListingSortObservationsBy={() => {}}
          onJumpToSourceLine={onJumpToSourceLine}
        />,
      );
    });

    const sourceLink = container.querySelector(
      '[data-industry-output-source-line-link="1:1725"]',
    ) as HTMLButtonElement;
    expect(sourceLink).toBeTruthy();

    await act(async () => {
      sourceLink.click();
    });

    expect(onJumpToSourceLine).toHaveBeenCalledWith(1725);

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it('opens right-click menu and emits sort selections', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root: Root = createRoot(container);
    const onChangeSort = vi.fn();

    await act(async () => {
      root.render(
        <IndustryOutputView
          text={'Section A\n=========\n\nrow'}
          listingSortObservationsBy={'stdResidual'}
          onChangeListingSortObservationsBy={onChangeSort}
        />,
      );
    });

    const viewport = container.querySelector('[data-industry-output-viewport]') as HTMLDivElement;
    await act(async () => {
      viewport.dispatchEvent(
        new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 30, clientY: 30 }),
      );
    });

    expect(container.querySelector('[data-industry-output-menu-go-to]')).toBeTruthy();
    expect(container.querySelector('[data-industry-output-menu-sort-by]')).toBeTruthy();

    await act(async () => {
      (container.querySelector('[data-industry-output-menu-sort-by]') as HTMLButtonElement).dispatchEvent(
        new Event('pointerdown', { bubbles: true }),
      );
    });

    const stdErrorButton = container.querySelector(
      '[data-industry-output-sort-option="stdError"]',
    ) as HTMLButtonElement;
    expect(stdErrorButton).toBeTruthy();

    await act(async () => {
      stdErrorButton.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    });

    expect(onChangeSort).toHaveBeenCalledWith('stdError');

    await act(async () => {
      viewport.dispatchEvent(
        new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 34, clientY: 34 }),
      );
    });
    expect(container.querySelector('[data-industry-output-menu-sort-by]')).toBeTruthy();

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it('auto-detects section headings and scrolls to selected section', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root: Root = createRoot(container);
    const onChangeSort = vi.fn();
    const scrollSpy = vi.fn();
    const originalScrollIntoView = HTMLElement.prototype.scrollIntoView;
    HTMLElement.prototype.scrollIntoView = scrollSpy;

    await act(async () => {
      root.render(
        <IndustryOutputView
          text={[
            'Main Summary',
            '============',
            '',
            'value row',
            '',
            'Adjusted Distance Observations (Meters)',
            '=======================================',
            '',
            'A B 100.0000',
          ].join('\n')}
          listingSortObservationsBy={'input'}
          onChangeListingSortObservationsBy={onChangeSort}
        />,
      );
    });

    const viewport = container.querySelector('[data-industry-output-viewport]') as HTMLDivElement;
    await act(async () => {
      viewport.dispatchEvent(
        new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 25, clientY: 25 }),
      );
    });

    await act(async () => {
      (container.querySelector('[data-industry-output-menu-go-to]') as HTMLButtonElement).dispatchEvent(
        new Event('pointerdown', { bubbles: true }),
      );
    });

    const sectionTarget = container.querySelector(
      '[data-industry-output-section-target="section-6"]',
    ) as HTMLButtonElement;
    expect(sectionTarget).toBeTruthy();

    await act(async () => {
      sectionTarget.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    });

    expect(scrollSpy).toHaveBeenCalled();

    HTMLElement.prototype.scrollIntoView = originalScrollIntoView;
    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it('highlights currently active sort option in submenu', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root: Root = createRoot(container);

    const Harness: React.FC = () => {
      const [sortMode, setSortMode] = React.useState<ListingSortObservationsBy>('residual');
      return (
        <IndustryOutputView
          text={'Summary\n=======\n'}
          listingSortObservationsBy={sortMode}
          onChangeListingSortObservationsBy={setSortMode}
        />
      );
    };

    await act(async () => {
      root.render(<Harness />);
    });

    const viewport = container.querySelector('[data-industry-output-viewport]') as HTMLDivElement;
    await act(async () => {
      viewport.dispatchEvent(
        new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 20, clientY: 20 }),
      );
    });

    await act(async () => {
      (container.querySelector('[data-industry-output-menu-sort-by]') as HTMLButtonElement).dispatchEvent(
        new Event('pointerdown', { bubbles: true }),
      );
    });

    const activeOption = container.querySelector(
      '[data-industry-output-sort-option="residual"]',
    ) as HTMLButtonElement;
    expect(activeOption.className).toContain('text-cyan-300');

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it('can be reopened repeatedly and flips submenu to the left near right edge', async () => {
    const container = document.createElement('div');
    container.style.width = '400px';
    container.style.height = '300px';
    document.body.appendChild(container);
    const root: Root = createRoot(container);
    const onChangeSort = vi.fn();

    await act(async () => {
      root.render(
        <IndustryOutputView
          text={'Summary\n=======\n\nAdjusted Distance Observations (Meters)\n=======================================\n'}
          listingSortObservationsBy={'stdResidual'}
          onChangeListingSortObservationsBy={onChangeSort}
        />,
      );
    });

    const viewport = container.querySelector('[data-industry-output-viewport]') as HTMLDivElement;
    if (!viewport) throw new Error('Viewport missing.');
    Object.defineProperty(viewport, 'clientWidth', { value: 220, configurable: true });
    Object.defineProperty(viewport, 'clientHeight', { value: 180, configurable: true });
    viewport.getBoundingClientRect = () =>
      ({
        left: 0,
        top: 0,
        right: 220,
        bottom: 180,
        width: 220,
        height: 180,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      }) as DOMRect;

    await act(async () => {
      viewport.dispatchEvent(
        new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 210, clientY: 30 }),
      );
    });

    await act(async () => {
      (container.querySelector('[data-industry-output-menu-sort-by]') as HTMLButtonElement).dispatchEvent(
        new Event('pointerdown', { bubbles: true }),
      );
    });

    const submenuSide = container
      .querySelector('[data-industry-output-sort-submenu-side]')
      ?.getAttribute('data-industry-output-sort-submenu-side');
    expect(submenuSide).toBe('left');

    await act(async () => {
      (container.querySelector('[data-industry-output-sort-option="name"]') as HTMLButtonElement).dispatchEvent(
        new Event('pointerdown', { bubbles: true }),
      );
    });
    expect(onChangeSort).toHaveBeenCalledWith('name');

    await act(async () => {
      viewport.dispatchEvent(
        new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 200, clientY: 50 }),
      );
    });
    expect(container.querySelector('[data-industry-output-menu]')).toBeTruthy();

    await act(async () => {
      (container.querySelector('[data-industry-output-menu-go-to]') as HTMLButtonElement).dispatchEvent(
        new Event('pointerdown', { bubbles: true }),
      );
    });
    expect(container.querySelector('[data-industry-output-section-target]')).toBeTruthy();

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it('anchors context menu to clicked viewport area when scrolled', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root: Root = createRoot(container);

    await act(async () => {
      root.render(
        <IndustryOutputView
          text={Array.from({ length: 200 }, (_, index) => `line ${index + 1}`).join('\n')}
          listingSortObservationsBy={'stdResidual'}
          onChangeListingSortObservationsBy={() => {}}
        />,
      );
    });

    const viewport = container.querySelector('[data-industry-output-viewport]') as HTMLDivElement;
    if (!viewport) throw new Error('Viewport missing.');
    Object.defineProperty(viewport, 'clientWidth', { value: 300, configurable: true });
    Object.defineProperty(viewport, 'clientHeight', { value: 200, configurable: true });
    viewport.getBoundingClientRect = () =>
      ({
        left: 0,
        top: 0,
        right: 300,
        bottom: 200,
        width: 300,
        height: 200,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      }) as DOMRect;
    Object.defineProperty(viewport, 'scrollTop', { value: 600, configurable: true, writable: true });
    Object.defineProperty(viewport, 'scrollLeft', { value: 20, configurable: true, writable: true });

    await act(async () => {
      viewport.dispatchEvent(
        new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 120, clientY: 80 }),
      );
    });

    const menu = container.querySelector('[data-industry-output-menu]') as HTMLDivElement;
    expect(menu).toBeTruthy();
    expect(menu.style.top).toBe('680px');
    expect(menu.style.left).toBe('122px');

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it('preserves viewport scroll position when sort changes', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root: Root = createRoot(container);

    const Harness: React.FC = () => {
      const [sortMode, setSortMode] = React.useState<ListingSortObservationsBy>('stdResidual');
      const [text, setText] = React.useState(
        Array.from({ length: 220 }, (_, index) => `initial line ${index + 1}`).join('\n'),
      );
      return (
        <IndustryOutputView
          text={text}
          listingSortObservationsBy={sortMode}
          onChangeListingSortObservationsBy={(next) => {
            setSortMode(next);
            setText(Array.from({ length: 220 }, (_, index) => `${next} line ${index + 1}`).join('\n'));
          }}
        />
      );
    };

    await act(async () => {
      root.render(<Harness />);
    });

    const viewport = container.querySelector('[data-industry-output-viewport]') as HTMLDivElement;
    if (!viewport) throw new Error('Viewport missing.');
    Object.defineProperty(viewport, 'clientWidth', { value: 320, configurable: true });
    Object.defineProperty(viewport, 'clientHeight', { value: 220, configurable: true });
    viewport.getBoundingClientRect = () =>
      ({
        left: 0,
        top: 0,
        right: 320,
        bottom: 220,
        width: 320,
        height: 220,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      }) as DOMRect;
    viewport.scrollTop = 540;
    viewport.scrollLeft = 14;

    await act(async () => {
      viewport.dispatchEvent(
        new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 100, clientY: 80 }),
      );
    });
    await act(async () => {
      (container.querySelector('[data-industry-output-menu-sort-by]') as HTMLButtonElement).dispatchEvent(
        new Event('pointerdown', { bubbles: true }),
      );
    });
    await act(async () => {
      (container.querySelector('[data-industry-output-sort-option="name"]') as HTMLButtonElement).dispatchEvent(
        new Event('pointerdown', { bubbles: true }),
      );
    });
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    });

    expect(viewport.scrollTop).toBe(540);
    expect(viewport.scrollLeft).toBe(14);

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it('restores the last visible section after sort change', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root: Root = createRoot(container);
    const scrollSpy = vi.fn();
    const originalScrollIntoView = HTMLElement.prototype.scrollIntoView;
    HTMLElement.prototype.scrollIntoView = scrollSpy;

    const Harness: React.FC = () => {
      const [sortMode, setSortMode] = React.useState<ListingSortObservationsBy>('stdResidual');
      const [text, setText] = React.useState(
        [
          'Section Alpha',
          '=============',
          '',
          'a',
          'a',
          'a',
          'Section Beta',
          '============',
          '',
          'b',
          'b',
          'b',
        ].join('\n'),
      );
      return (
        <IndustryOutputView
          text={text}
          listingSortObservationsBy={sortMode}
          onChangeListingSortObservationsBy={(next) => {
            setSortMode(next);
            setText(
              [
                'Section Alpha',
                '=============',
                '',
                'a2',
                'a2',
                'a2',
                'Section Beta',
                '============',
                '',
                'b2',
                'b2',
                'b2',
              ].join('\n'),
            );
          }}
        />
      );
    };

    await act(async () => {
      root.render(<Harness />);
    });

    const viewport = container.querySelector('[data-industry-output-viewport]') as HTMLDivElement;
    if (!viewport) throw new Error('Viewport missing.');
    Object.defineProperty(viewport, 'clientWidth', { value: 320, configurable: true });
    Object.defineProperty(viewport, 'clientHeight', { value: 220, configurable: true });
    viewport.getBoundingClientRect = () =>
      ({
        left: 0,
        top: 0,
        right: 320,
        bottom: 220,
        width: 320,
        height: 220,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      }) as DOMRect;

    const alphaHeading = container.querySelector('[data-industry-section-id="section-1"]') as HTMLDivElement;
    const betaHeading = container.querySelector('[data-industry-section-id="section-7"]') as HTMLDivElement;
    Object.defineProperty(alphaHeading, 'offsetTop', { value: 0, configurable: true });
    Object.defineProperty(betaHeading, 'offsetTop', { value: 500, configurable: true });
    viewport.scrollTop = 520;

    await act(async () => {
      viewport.dispatchEvent(
        new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 120, clientY: 60 }),
      );
    });
    await act(async () => {
      (container.querySelector('[data-industry-output-menu-sort-by]') as HTMLButtonElement).dispatchEvent(
        new Event('pointerdown', { bubbles: true }),
      );
    });
    await act(async () => {
      (container.querySelector('[data-industry-output-sort-option="name"]') as HTMLButtonElement).dispatchEvent(
        new Event('pointerdown', { bubbles: true }),
      );
    });
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    });

    expect(scrollSpy).toHaveBeenCalled();

    HTMLElement.prototype.scrollIntoView = originalScrollIntoView;
    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it('waits through transient reset text and restores section after rebuilt output arrives', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root: Root = createRoot(container);
    const scrollSpy = vi.fn();
    const originalScrollIntoView = HTMLElement.prototype.scrollIntoView;
    HTMLElement.prototype.scrollIntoView = scrollSpy;

    const Harness: React.FC = () => {
      const [sortMode, setSortMode] = React.useState<ListingSortObservationsBy>('stdResidual');
      const [text, setText] = React.useState(
        [
          'Section One',
          '===========',
          '',
          'row',
          '',
          'Section Two',
          '===========',
          '',
          'row',
        ].join('\n'),
      );
      return (
        <IndustryOutputView
          text={text}
          listingSortObservationsBy={sortMode}
          onChangeListingSortObservationsBy={(next) => {
            setSortMode(next);
            setText('');
            window.setTimeout(() => {
              setText(
                [
                  'Section One',
                  '===========',
                  '',
                  'row2',
                  '',
                  'Section Two',
                  '===========',
                  '',
                  'row2',
                ].join('\n'),
              );
            }, 0);
          }}
        />
      );
    };

    await act(async () => {
      root.render(<Harness />);
    });

    const viewport = container.querySelector('[data-industry-output-viewport]') as HTMLDivElement;
    if (!viewport) throw new Error('Viewport missing.');
    Object.defineProperty(viewport, 'clientWidth', { value: 320, configurable: true });
    Object.defineProperty(viewport, 'clientHeight', { value: 220, configurable: true });
    viewport.getBoundingClientRect = () =>
      ({
        left: 0,
        top: 0,
        right: 320,
        bottom: 220,
        width: 320,
        height: 220,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      }) as DOMRect;

    const sectionOneHeading = container.querySelector(
      '[data-industry-section-id="section-1"]',
    ) as HTMLDivElement;
    const sectionTwoHeading = container.querySelector(
      '[data-industry-section-id="section-6"]',
    ) as HTMLDivElement;
    Object.defineProperty(sectionOneHeading, 'offsetTop', { value: 0, configurable: true });
    Object.defineProperty(sectionTwoHeading, 'offsetTop', { value: 500, configurable: true });
    viewport.scrollTop = 520;

    await act(async () => {
      viewport.dispatchEvent(
        new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 100, clientY: 70 }),
      );
    });
    await act(async () => {
      (container.querySelector('[data-industry-output-menu-sort-by]') as HTMLButtonElement).dispatchEvent(
        new Event('pointerdown', { bubbles: true }),
      );
    });
    await act(async () => {
      (container.querySelector('[data-industry-output-sort-option="name"]') as HTMLButtonElement).dispatchEvent(
        new Event('pointerdown', { bubbles: true }),
      );
    });
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 10));
    });

    expect(scrollSpy).toHaveBeenCalled();

    HTMLElement.prototype.scrollIntoView = originalScrollIntoView;
    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

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
