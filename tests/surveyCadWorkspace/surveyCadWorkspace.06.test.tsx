/** @vitest-environment jsdom */

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { describe, expect, it } from 'vitest';
import {
  SurveyCadWorkspace,
  SurveyCadPreview,
  buildSurveyCadSpikeProject,
  buildCadProjectSignature,
  input,
  campInput,
  parseOptions,
  campParseOptions,
  mockElementRect,
  projectWorldToPreviewScreen,
  clickButton,
} from './surveyCadWorkspaceTestSupport';

describe('SurveyCadWorkspace', () => {
  it('preserves the hovered midpoint snap when LINE starts so immediate clicks keep startup parallel scope local', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root: Root = createRoot(container);

    const baseProject = buildSurveyCadSpikeProject({
      input: campInput,
      instrumentLibrary: {},
      parseOptions: campParseOptions,
      units: 'm',
      result: null,
    });
    const persistedProject = baseProject;
    const startLine = persistedProject.entities.find(
      (entity) => entity.type === 'line' && entity.id === 'line:GPS2|GPS5',
    );
    const remoteLine = persistedProject.entities.find(
      (entity) => entity.type === 'line' && entity.id === 'line:119|120',
    );
    if (!startLine || startLine.type !== 'line' || !remoteLine || remoteLine.type !== 'line') {
      throw new Error('Expected startup linework not found');
    }

    await act(async () => {
      root.render(
        <SurveyCadWorkspace
          input={campInput}
          instrumentLibrary={{}}
          parseOptions={campParseOptions}
          units="m"
          result={null}
          persistedState={{
            version: 1,
            sourceSignature: buildCadProjectSignature(baseProject),
            project: persistedProject,
          }}
        />,
      );
    });

    const preview = container.querySelector('[data-survey-cad-preview]') as SVGElement | null;
    if (!preview) throw new Error('Preview not found');
    mockElementRect(preview);

    const midpointScreen = projectWorldToPreviewScreen(persistedProject.bounds!, {
      x: (startLine.fromX + startLine.toX) / 2,
      y: (startLine.fromY + startLine.toY) / 2,
    });
    await act(async () => {
      preview.dispatchEvent(
        new MouseEvent('mousemove', {
          bubbles: true,
          clientX: midpointScreen.clientX,
          clientY: midpointScreen.clientY,
        }),
      );
    });
    expect(container.querySelector('[data-survey-cad-snap-badge]')?.textContent).toContain('Midpoint');
    expect(container.querySelector('[data-survey-cad-snap-badge]')?.textContent).toContain('GPS2-GPS5');

    await act(async () => {
      const snapMenuButton = container.querySelector('[data-survey-cad-snap-menu-button]') as HTMLButtonElement | null;
      if (!snapMenuButton) throw new Error('Snap menu button not found');
      snapMenuButton.click();
    });
    await act(async () => {
      (container.querySelector('[data-survey-cad-snap-toggle="point-node"]') as HTMLInputElement | null)?.click();
      (container.querySelector('[data-survey-cad-snap-toggle="midpoint"]') as HTMLInputElement | null)?.click();
      (container.querySelector('[data-survey-cad-snap-toggle="center"]') as HTMLInputElement | null)?.click();
      (container.querySelector('[data-survey-cad-snap-toggle="arc-midpoint"]') as HTMLInputElement | null)?.click();
      (container.querySelector('[data-survey-cad-snap-toggle="quadrant"]') as HTMLInputElement | null)?.click();
      (container.querySelector('[data-survey-cad-snap-toggle="intersection"]') as HTMLInputElement | null)?.click();
      (container.querySelector('[data-survey-cad-snap-toggle="apparent-intersection"]') as HTMLInputElement | null)?.click();
      (container.querySelector('[data-survey-cad-snap-toggle="extension"]') as HTMLInputElement | null)?.click();
      (container.querySelector('[data-survey-cad-snap-toggle="perpendicular"]') as HTMLInputElement | null)?.click();
      (container.querySelector('[data-survey-cad-snap-toggle="tangent"]') as HTMLInputElement | null)?.click();
      (container.querySelector('[data-survey-cad-snap-toggle="nearest"]') as HTMLInputElement | null)?.click();
    });

    await act(async () => {
      clickButton(container, 'LINE');
      preview.dispatchEvent(
        new MouseEvent('click', {
          bubbles: true,
          clientX: midpointScreen.clientX,
          clientY: midpointScreen.clientY,
        }),
      );
    });

    const remoteScreen = projectWorldToPreviewScreen(persistedProject.bounds!, {
      x: (remoteLine.fromX + remoteLine.toX) / 2,
      y: (remoteLine.fromY + remoteLine.toY) / 2,
    });
    await act(async () => {
      preview.dispatchEvent(
        new MouseEvent('mousemove', {
          bubbles: true,
          clientX: remoteScreen.clientX,
          clientY: remoteScreen.clientY,
        }),
      );
    });

    const badgeText = container.querySelector('[data-survey-cad-snap-badge]')?.textContent ?? '';
    expect(badgeText).not.toContain('119-120');
    expect(badgeText).not.toContain('120-119');

    await act(async () => {
      root.unmount();
    });
    container.remove();
  }, 10000);

  it('uses the clicked line body as the LINE start seed so parallel preview does not fall back to remote lines', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root: Root = createRoot(container);

    const baseProject = buildSurveyCadSpikeProject({
      input,
      instrumentLibrary: {},
      parseOptions,
      units: 'm',
      result: null,
    });
    const persistedProject = {
      ...baseProject,
      entities: [
        {
          id: 'line:base',
          type: 'line' as const,
          layerId: 'observation-lines',
          styleId: 'style-observation-line',
          visible: true,
          locked: false,
          fromStationId: 'L1',
          toStationId: 'L2',
          fromX: 0,
          fromY: 0,
          toX: 10,
          toY: 0,
          sourceObservationIds: [],
        },
        {
          id: 'line:local',
          type: 'line' as const,
          layerId: 'observation-lines',
          styleId: 'style-observation-line',
          visible: true,
          locked: false,
          fromStationId: 'L2',
          toStationId: 'L3',
          fromX: 10,
          fromY: 0,
          toX: 10,
          toY: 10,
          sourceObservationIds: [],
        },
        {
          id: 'line:remote',
          type: 'line' as const,
          layerId: 'observation-lines',
          styleId: 'style-observation-line',
          visible: true,
          locked: false,
          fromStationId: 'R1',
          toStationId: 'R2',
          fromX: 35,
          fromY: -10,
          toX: 35,
          toY: 10,
          sourceObservationIds: [],
        },
      ],
    };

    await act(async () => {
      root.render(
        <SurveyCadWorkspace
          input={input}
          instrumentLibrary={{}}
          parseOptions={parseOptions}
          units="m"
          result={null}
          persistedState={{
            version: 1,
            sourceSignature: buildCadProjectSignature(baseProject),
            project: persistedProject,
          }}
        />,
      );
    });

    const preview = container.querySelector('[data-survey-cad-preview]') as SVGElement | null;
    if (!preview) throw new Error('Preview not found');
    mockElementRect(preview);

    await act(async () => {
      const snapMenuButton = container.querySelector('[data-survey-cad-snap-menu-button]') as HTMLButtonElement | null;
      if (!snapMenuButton) throw new Error('Snap menu button not found');
      snapMenuButton.click();
    });
    await act(async () => {
      (container.querySelector('[data-survey-cad-snap-toggle="point-node"]') as HTMLInputElement | null)?.click();
      (container.querySelector('[data-survey-cad-snap-toggle="endpoint"]') as HTMLInputElement | null)?.click();
      (container.querySelector('[data-survey-cad-snap-toggle="midpoint"]') as HTMLInputElement | null)?.click();
      (container.querySelector('[data-survey-cad-snap-toggle="center"]') as HTMLInputElement | null)?.click();
      (container.querySelector('[data-survey-cad-snap-toggle="arc-midpoint"]') as HTMLInputElement | null)?.click();
      (container.querySelector('[data-survey-cad-snap-toggle="quadrant"]') as HTMLInputElement | null)?.click();
      (container.querySelector('[data-survey-cad-snap-toggle="intersection"]') as HTMLInputElement | null)?.click();
      (container.querySelector('[data-survey-cad-snap-toggle="apparent-intersection"]') as HTMLInputElement | null)?.click();
      (container.querySelector('[data-survey-cad-snap-toggle="extension"]') as HTMLInputElement | null)?.click();
      (container.querySelector('[data-survey-cad-snap-toggle="perpendicular"]') as HTMLInputElement | null)?.click();
      (container.querySelector('[data-survey-cad-snap-toggle="tangent"]') as HTMLInputElement | null)?.click();
      (container.querySelector('[data-survey-cad-snap-toggle="nearest"]') as HTMLInputElement | null)?.click();
    });

    const baseLineScreen = projectWorldToPreviewScreen(persistedProject.bounds!, { x: 5.2, y: 0.1 });
    await act(async () => {
      clickButton(container, 'LINE');
      preview.dispatchEvent(
        new MouseEvent('click', {
          bubbles: true,
          clientX: baseLineScreen.clientX,
          clientY: baseLineScreen.clientY,
        }),
      );
    });

    const remoteScreen = projectWorldToPreviewScreen(persistedProject.bounds!, { x: 35.1, y: 0.2 });
    await act(async () => {
      preview.dispatchEvent(
        new MouseEvent('mousemove', {
          bubbles: true,
          clientX: remoteScreen.clientX,
          clientY: remoteScreen.clientY,
        }),
      );
    });

    const badgeText = container.querySelector('[data-survey-cad-snap-badge]')?.textContent ?? '';
    expect(badgeText).not.toContain('R1-R2');

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it('renders tangent snap badge text and styling when tangent snap is active', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root: Root = createRoot(container);

    await act(async () => {
      root.render(
        <SurveyCadPreview
          scene={{ primitives: [], bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 } }}
          viewBounds={{ minX: 0, minY: 0, maxX: 10, maxY: 10 }}
          selectedEntityIds={[]}
          selectedParcelReport={null}
          activeSnap={{
            id: 'tangent:arc:tangent-test',
            kind: 'tangent',
            sourceEntityId: 'arc:tangent-test',
            x: 8.660254,
            y: 5,
            distance: 0.1,
            label: 'arc:tangent-test tangent',
            guideSegments: [
              [{ x: 0, y: 20 }, { x: 8.660254, y: 5 }],
              [{ x: 0, y: 0 }, { x: 8.660254, y: 5 }],
            ],
          }}
          commandPreviewPrimitives={[]}
          commandStatusText=""
          commandHelpText=""
          commandModifierHint=""
          constructionHint=""
          snapPreferences={{
            'point-node': true,
            endpoint: true,
            midpoint: true,
            center: true,
            'arc-midpoint': true,
            quadrant: true,
            intersection: true,
            'apparent-intersection': true,
            extension: true,
            perpendicular: true,
            parallel: true,
            direction: true,
            tangent: true,
            nearest: true,
          }}
          commandInputValue=""
          commandInputPlaceholder=""
          commandInputEnabled={false}
          viewport={{ zoom: 1, panX: 0, panY: 0 }}
          commandActive={false}
          commandPointInputActive={false}
          onViewportChange={() => null}
          onSelectEntity={() => null}
          onSelectEntities={() => null}
          onConsumeInteractionPoint={() => null}
          onPointerWorldPointChange={() => null}
          onSnapPreferenceChange={() => null}
          onCommandInputChange={() => null}
          onCommandInputEnter={() => null}
          onCommandInputEscape={() => null}
          onZoomExtents={() => null}
        />,
      );
    });

    expect(container.querySelector('[data-survey-cad-snap-badge]')?.textContent).toContain('Tangent');
    expect(container.querySelector('[data-survey-cad-snap-badge]')?.textContent).toContain('arc:tangent-test');
    expect(container.querySelector('[data-survey-cad-snap-badge]')?.getAttribute('style')).toContain(
      'border-color',
    );
    expect(container.querySelectorAll('[data-survey-cad-snap-guide]')).toHaveLength(2);

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

});
