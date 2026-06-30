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
        tables: [
          {
            title: 'Generated Parcels',
            columns: ['Name', 'Role', 'Area (m2)', 'Perimeter (m)', 'Closure (m)'],
            rows: [
              ['Parcel 2', 'Lot', '1350.000', '106.000', '0.000000'],
              ['Parcel 3', 'Lot', '1350.000', '106.000', '0.000000'],
            ],
          },
        ],
      },
      warnings: [],
      alternatives: [],
      createdEntityIds: ['parcel:2', 'parcel:3', 'parcel:4', 'parcel:5'],
      updatedEntityIds: [],
      removedEntityIds: ['parcel:1'],
    };

    const createdEntities: CadEntity[] = [];

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
    expect(container.querySelector('[data-survey-cad-cogo-panel-created-parcels]')?.textContent).toContain(
      '0.000000',
    );

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });
});
