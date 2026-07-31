/** @vitest-environment jsdom */

import { describe, expect, it, vi } from 'vitest';

import {
  act,
  createRoot,
  IndustryOutputView,
  React,
  type ListingSortObservationsBy,
  type Root,
} from './industryOutputViewTestSupport';

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
});
