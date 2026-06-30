/** @vitest-environment jsdom */

import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { describe, expect, it } from 'vitest';
import SurveyCadCogoPanel from '../src/components/surveyCad/SurveyCadCogoPanel';
import type { CadCogoComputation } from '../src/engine/cad/cadCogoTypes';
import type { CadEntity } from '../src/engine/cad/cadTypes';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('SurveyCadCogoPanel', () => {
  it('shows generated parcel table for automatic parcel layout results', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root: Root = createRoot(container);

    const computation: CadCogoComputation = {
      id: 'cogo:auto-layout',
      toolKey: 'PARCEL_LAYOUT_AUTO',
      provenance: {
        id: 'cogo:auto-layout',
        toolKey: 'PARCEL_LAYOUT_AUTO',
        inputs: {},
        resultSummary: 'Automatic parcel layout created 4 parcels from Parcel 1.',
      },
      report: {
        title: 'Automatic Parcel Layout',
        summary: 'Automatic parcel layout created 4 parcels from Parcel 1.',
        rows: [
          { label: 'Mode', value: 'Fill parent' },
          { label: 'Remainder', value: 'Redistribute remainder' },
          { label: 'Generated lots', value: '3' },
          { label: 'Remainder parcel', value: 'No' },
        ],
      },
      warnings: [],
      alternatives: [],
      createdEntityIds: ['parcel:2', 'parcel:3', 'parcel:4', 'parcel:5'],
      updatedEntityIds: [],
      removedEntityIds: ['parcel:1'],
    };

    const createdEntities: CadEntity[] = [
      {
        id: 'parcel:2',
        type: 'parcel',
        layerId: 'parcels',
        styleId: 'style-parcel',
        visible: true,
        locked: false,
        parcelName: 'Parcel 2',
        vertices: [],
        vertexLabels: [],
        areaSquareMeters: 1350,
        perimeterMeters: 106,
        closureDeltaX: 0,
        closureDeltaY: 0,
        closureDistanceMeters: 0,
        metadata: { createdBy: 'PARCEL_LAYOUT_AUTO', role: 'lot' },
      },
      {
        id: 'parcel:3',
        type: 'parcel',
        layerId: 'parcels',
        styleId: 'style-parcel',
        visible: true,
        locked: false,
        parcelName: 'Parcel 3',
        vertices: [],
        vertexLabels: [],
        areaSquareMeters: 1350,
        perimeterMeters: 106,
        closureDeltaX: 0,
        closureDeltaY: 0,
        closureDistanceMeters: 0,
        metadata: { createdBy: 'PARCEL_LAYOUT_AUTO', role: 'lot' },
      },
    ];

    await act(async () => {
      root.render(
        <SurveyCadCogoPanel
          computation={computation}
          createdEntities={createdEntities}
          sourceLabel="latest"
        />,
      );
    });

    expect(container.querySelector('[data-survey-cad-cogo-panel-created-parcels]')?.textContent).toContain(
      'Generated Parcels',
    );
    expect(container.querySelector('[data-survey-cad-cogo-panel-created-parcels]')?.textContent).toContain(
      'Parcel 2',
    );
    expect(container.querySelector('[data-survey-cad-cogo-panel-created-parcels]')?.textContent).toContain(
      'Lot',
    );

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });
});
