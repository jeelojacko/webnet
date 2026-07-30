/** @vitest-environment jsdom */
/* eslint-disable react-refresh/only-export-components */

import { readFileSync } from 'node:fs';
import React from 'react';
import SurveyCadWorkspace from '../../src/components/SurveyCadWorkspace';
import { buildSurveyCadSpikeProject } from '../../src/engine/cad/cadModel';
import { buildCadProjectSignature } from '../../src/engine/cad/cadProjectState';
export { default as SurveyCadWorkspace } from '../../src/components/SurveyCadWorkspace';
export { default as SurveyCadPreview } from '../../src/components/surveyCad/SurveyCadPreview';
export { buildSurveyCadSpikeProject } from '../../src/engine/cad/cadModel';
export { appendCadProjectEntities, buildCadProjectSignature } from '../../src/engine/cad/cadProjectState';
import type { SurveyCadPersistedState } from '../../src/engine/cad/cadTypes';
import type { ParseOptions } from '../../src/types';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

export const input = ['.2D', 'C A 0 0 0 ! !', 'C B 100 0 0 ! !', 'C C 60 40 0', 'D A-C 72.1110255 0.005', 'D B-C 56.5685425 0.005'].join('\n');
export const campInput = readFileSync('tests/fixtures/camp_design_preanalysis_input.dat', 'utf8');

export const parseOptions: ParseOptions = {
  units: 'm',
  coordMode: '2D',
  coordSystemMode: 'local',
  localDatumScheme: 'average-scale',
  averageScaleFactor: 1,
  commonElevation: 0,
  averageGeoidHeight: 0,
  observationMode: {
    bearing: 'grid',
    distance: 'measured',
    angle: 'measured',
    direction: 'measured',
  },
  gridBearingMode: 'grid',
  gridDistanceMode: 'measured',
  gridAngleMode: 'measured',
  gridDirectionMode: 'measured',
  runMode: 'adjustment',
  preanalysisMode: false,
  order: 'EN',
  angleStationOrder: 'atfromto',
  deltaMode: 'slope',
  mapMode: 'off',
  normalize: true,
  faceNormalizationMode: 'on',
  lonSign: 'west-negative',
};

export const campParseOptions: ParseOptions = {
  ...parseOptions,
  runMode: 'preanalysis',
  preanalysisMode: true,
};

export const mockElementRect = (element: Element): void => {
  Object.defineProperty(element, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      width: 900,
      height: 520,
      right: 900,
      bottom: 520,
      toJSON: () => ({}),
    }),
  });
};

export const projectWorldToPreviewScreen = (
  bounds: { minX: number; minY: number; maxX: number; maxY: number },
  worldPoint: { x: number; y: number },
): { clientX: number; clientY: number } => {
  const width = Math.max(bounds.maxX - bounds.minX, 1);
  const height = Math.max(bounds.maxY - bounds.minY, 1);
  const normalized = {
    minX: bounds.minX - width * 0.08,
    minY: bounds.minY - height * 0.08,
    maxX: bounds.maxX + width * 0.08,
    maxY: bounds.maxY + height * 0.08,
  };
  const scale = Math.min((900 - 36 * 2) / (normalized.maxX - normalized.minX), (520 - 36 * 2) / (normalized.maxY - normalized.minY));
  return {
    clientX: 36 + (worldPoint.x - normalized.minX) * scale,
    clientY: 520 - 36 - (worldPoint.y - normalized.minY) * scale,
  };
};

export const setTextInputValue = (inputElement: HTMLInputElement, value: string): void => {
  const setter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    'value',
  )?.set;
  setter?.call(inputElement, value);
  inputElement.dispatchEvent(new Event('input', { bubbles: true }));
};

export const setTextAreaValue = (inputElement: HTMLTextAreaElement, value: string): void => {
  const setter = Object.getOwnPropertyDescriptor(
    window.HTMLTextAreaElement.prototype,
    'value',
  )?.set;
  setter?.call(inputElement, value);
  inputElement.dispatchEvent(new Event('input', { bubbles: true }));
};

export const pressKey = (
  target: EventTarget,
  key: string,
  options?: { ctrlKey?: boolean; metaKey?: boolean; shiftKey?: boolean },
): void => {
  target.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key, ...options }));
};

export const dispatchSyntheticPointerEvent = (
  target: EventTarget,
  type: string,
  init: { pointerId?: number; button?: number; clientX?: number; clientY?: number },
): void => {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.assign(event, init);
  target.dispatchEvent(event);
};

export const clickButton = (container: HTMLElement, label: string): HTMLButtonElement => {
  const button = Array.from(container.querySelectorAll('button')).find(
    (entry) => entry.textContent?.trim() === label,
  ) as HTMLButtonElement | undefined;
  if (!button) throw new Error(`Button ${label} not found`);
  button.click();
  return button;
};

export const ParentBackedWorkspace: React.FC = () => {
  const [persistedState, setPersistedState] = React.useState<SurveyCadPersistedState | null>(null);

  return (
    <SurveyCadWorkspace
      input={input}
      instrumentLibrary={{}}
      parseOptions={{ ...parseOptions }}
      units="m"
      result={null}
      persistedState={persistedState}
      onPersistedStateChange={setPersistedState}
    />
  );
};

export const ParentBackedCampWorkspace: React.FC = () => {
  const baseProject = React.useMemo(
    () =>
      buildSurveyCadSpikeProject({
        input: campInput,
        instrumentLibrary: {},
        parseOptions: campParseOptions,
        units: 'm',
        result: null,
      }),
    [],
  );
  const [persistedState, setPersistedState] = React.useState<SurveyCadPersistedState | null>({
    version: 1,
    sourceSignature: buildCadProjectSignature(baseProject),
    project: baseProject,
  });

  return (
    <SurveyCadWorkspace
      input={campInput}
      instrumentLibrary={{}}
      parseOptions={{ ...campParseOptions }}
      units="m"
      result={null}
      persistedState={persistedState}
      onPersistedStateChange={setPersistedState}
    />
  );
};

export const ParentBackedParcelLayoutWorkspace: React.FC = () => {
  const baseProject = React.useMemo(
    () =>
      buildSurveyCadSpikeProject({
        input,
        instrumentLibrary: {},
        parseOptions,
        units: 'm',
        result: null,
      }),
    [],
  );
  const persistedProject = React.useMemo(
    () => ({
      ...baseProject,
      entities: [
        {
          id: 'parcel:source',
          type: 'parcel' as const,
          layerId: 'parcels',
          styleId: 'style-parcel',
          visible: true,
          locked: false,
          parcelName: 'Parcel 1',
          vertices: [
            { x: 0, y: 0 },
            { x: 25, y: 0 },
            { x: 25, y: 15 },
          ],
          vertexLabels: ['A', 'P1', 'P2'],
          areaSquareMeters: 187.5,
          perimeterMeters: 69.154759,
          closureDeltaX: 0,
          closureDeltaY: 0,
          closureDistanceMeters: 0,
        },
      ],
      bounds: { minX: 0, minY: 0, maxX: 25, maxY: 15 },
    }),
    [baseProject],
  );
  const [persistedState, setPersistedState] = React.useState<SurveyCadPersistedState | null>({
    version: 1,
    sourceSignature: buildCadProjectSignature(baseProject),
    project: persistedProject,
    parcelLayout: {
      open: true,
      collapsed: false,
      dock: 'floating',
      floatingLeftPx: 24,
      floatingTopPx: 112,
      floatingWidthPx: 304,
      floatingHeightPx: 600,
      activeParentParcelId: null,
      activeFrontageEntityId: null,
      settings: {
        minAreaSquareMeters: 1000,
        minFrontageMeters: 30,
        useFrontageAtOffset: false,
        frontageOffsetMeters: 10,
        minWidthMeters: 20,
        minDepthMeters: 20,
        useMaxDepth: false,
        maxDepthMeters: 150,
        solutionPreference: 'shortest_frontage',
        automaticMode: 'off',
        remainderDistribution: 'place_remainder_in_last_parcel',
      },
    },
    showParcelLabels: true,
  });

  return (
    <SurveyCadWorkspace
      input={input}
      instrumentLibrary={{}}
      parseOptions={{ ...parseOptions }}
      units="m"
      result={null}
      persistedState={persistedState}
      onPersistedStateChange={setPersistedState}
    />
  );
};

export const createPersistedStateCapture = () => {
  let captured: SurveyCadPersistedState | null = null;
  const onPersistedStateChange = (
    update:
      | ((_previous: SurveyCadPersistedState | null) => SurveyCadPersistedState | null)
      | SurveyCadPersistedState
      | null,
  ) => {
    captured =
      typeof update === 'function'
        ? update(captured)
        : update;
  };
  return {
    read: () => captured,
    onPersistedStateChange,
  };
};

