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

describe('IndustryOutputView scroll restoration', () => {
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
});
