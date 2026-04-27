/** @vitest-environment jsdom */

import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';

import MapView from '../src/components/MapView';
import type { Station } from '../src/types';
import { LSAEngine } from '../src/engine/adjust';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const VIEW_W = 1000;
const VIEW_H = 700;

const input = [
  '.2D',
  'C A 0 0 0 ! !',
  'C B 100 0 0 ! !',
  'C C 60 40 0',
  'D A-C 72.1110255 0.005',
  'D B-C 56.5685425 0.005',
  'A C-A-B 90-00-00 3',
].join('\n');

const createDenseResult = () => {
  const base = new LSAEngine({ input, maxIterations: 8 }).solve();
  const distObservation = base.observations.find((obs) => obs.type === 'dist');
  const angleObservation = base.observations.find((obs) => obs.type === 'angle');
  const sampleStation = Object.values(base.stations)[0];
  if (!distObservation || !angleObservation || !sampleStation) {
    throw new Error('Expected baseline rows for dense map fixture');
  }
  base.observations = [
    {
      ...angleObservation,
      id: 9000,
      sourceLine: 9000,
      at: 'ANG',
      from: 'AA',
      to: 'BB',
    },
    ...Array.from({ length: 220 }, (_, index) => ({
      ...distObservation,
      id: 3000 + index,
      sourceLine: 12000 + index,
      from: `P${String(index).padStart(3, '0')}`,
      to: `Q${String(index).padStart(3, '0')}`,
      obs: distObservation.obs + index * 0.00005,
      calc:
        typeof distObservation.calc === 'number'
          ? distObservation.calc + index * 0.00005
          : distObservation.calc,
    })),
  ];
  base.stations = Object.fromEntries(
    Array.from({ length: 220 }, (_, index) => {
      const pId = `P${String(index).padStart(3, '0')}`;
      const qId = `Q${String(index).padStart(3, '0')}`;
      const pStation = {
        ...sampleStation,
        x: sampleStation.x + index,
        y: sampleStation.y + index * 0.8,
        fixed: index < 2,
        ...(sampleStation.errorEllipse ? { errorEllipse: { ...sampleStation.errorEllipse } } : {}),
      };
      const qStation = {
        ...sampleStation,
        x: sampleStation.x + index + 0.7,
        y: sampleStation.y + index * 0.8 + 0.5,
        fixed: false,
        ...(sampleStation.errorEllipse ? { errorEllipse: { ...sampleStation.errorEllipse } } : {}),
      };
      return [
        [pId, pStation],
        [qId, qStation],
      ];
    }).flat(),
  );
  return base;
};

const buildProjection = (stations: Record<string, Station>) => {
  const rows = Object.values(stations);
  const xs = rows.map((station) => station.x);
  const ys = rows.map((station) => station.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const pad = Math.max((maxX - minX) * 0.1, (maxY - minY) * 0.1, 1);
  const bboxMinX = minX - pad;
  const bboxMinY = minY - pad;
  const width = maxX - minX + pad * 2;
  const height = maxY - minY + pad * 2;
  const scale = Math.min(VIEW_W / width, VIEW_H / height);
  const offsetX = (VIEW_W - width * scale) * 0.5;
  const offsetY = (VIEW_H - height * scale) * 0.5;
  return (stationId: string) => {
    const station = stations[stationId];
    if (!station) throw new Error(`Missing station ${stationId}`);
    const x = offsetX + (station.x - bboxMinX) * scale;
    const y = VIEW_H - (offsetY + (station.y - bboxMinY) * scale);
    return { x, y };
  };
};

const setSvgRect = (svg: SVGSVGElement) => {
  Object.defineProperty(svg, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({
      left: 0,
      top: 0,
      width: VIEW_W,
      height: VIEW_H,
      right: VIEW_W,
      bottom: VIEW_H,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    }),
  });
};

describe('MapView canvas hit testing', () => {
  it('selects stations and observations from SVG background clicks over canvas geometry', async () => {
    const result = new LSAEngine({ input, maxIterations: 8 }).solve();
    const stationIds = Object.keys(result.stations);
    if (stationIds.length < 3) throw new Error('Expected at least three stations');
    const project = buildProjection(result.stations);
    const stationPickId = stationIds[0];
    const stationPoint = project(stationPickId);
    const lineObservationCandidate = result.observations.find(
      (obs) => obs.type === 'dist' || obs.type === 'gps',
    );
    if (
      !lineObservationCandidate ||
      !('from' in lineObservationCandidate) ||
      !('to' in lineObservationCandidate)
    ) {
      throw new Error('Expected a line observation');
    }
    const lineObservation = lineObservationCandidate;
    const from = project(lineObservation.from);
    const to = project(lineObservation.to);
    const midPoint = { x: (from.x + to.x) * 0.5, y: (from.y + to.y) * 0.5 };
    const selectedStation = vi.fn();
    const selectedObservation = vi.fn();

    const container = document.createElement('div');
    document.body.appendChild(container);
    const root: Root = createRoot(container);

    await act(async () => {
      root.render(
        <MapView
          result={result}
          units="m"
          showLostStations={true}
          onSelectStation={selectedStation}
          onSelectObservation={selectedObservation}
        />,
      );
    });

    const svg = container.querySelector('svg') as SVGSVGElement | null;
    expect(svg).toBeTruthy();
    if (!svg) throw new Error('Expected map svg');
    setSvgRect(svg);

    await act(async () => {
      svg.dispatchEvent(
        new MouseEvent('click', {
          clientX: stationPoint.x + 2,
          clientY: stationPoint.y + 1,
          bubbles: true,
        }),
      );
    });
    expect(selectedStation).toHaveBeenCalledWith(stationPickId);

    await act(async () => {
      svg.dispatchEvent(
        new MouseEvent('click', {
          clientX: midPoint.x,
          clientY: midPoint.y,
          bubbles: true,
        }),
      );
    });
    expect(selectedObservation).toHaveBeenCalledWith(lineObservation.id);

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it('keeps selected overlays visible during dense interaction simplify mode', async () => {
    const denseResult = createDenseResult();
    const selectedObservationId = denseResult.observations.find((obs) => obs.type === 'dist')?.id ?? null;
    const selectedStationId = Object.keys(denseResult.stations)[0] ?? null;
    if (!selectedObservationId || !selectedStationId) {
      throw new Error('Expected dense selection baseline');
    }
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root: Root = createRoot(container);

    await act(async () => {
      root.render(
        <MapView
          result={denseResult}
          units="m"
          showLostStations={true}
          selectedObservationId={selectedObservationId}
          selectedStationId={selectedStationId}
        />,
      );
    });

    const svg = container.querySelector('svg') as SVGSVGElement | null;
    expect(svg).toBeTruthy();
    if (!svg) throw new Error('Expected map svg');
    setSvgRect(svg);

    await act(async () => {
      svg.dispatchEvent(
        new WheelEvent('wheel', {
          deltaY: -140,
          clientX: 500,
          clientY: 350,
          bubbles: true,
          cancelable: true,
        }),
      );
      await Promise.resolve();
    });

    expect(
      container.querySelector(`[data-map-station-selection="${selectedStationId}"]`),
    ).toBeTruthy();
    expect(container.querySelector(`[data-map-observation="${selectedObservationId}"]`)).toBeTruthy();

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });
});
