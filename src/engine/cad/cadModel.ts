import { parseInput } from '../parse';
import type {
  AdjustmentResult,
  InstrumentLibrary,
  Observation,
  ParseOptions,
  ParseResult,
  StationId,
  UnitsMode,
} from '../../types';
import type {
  CadEntity,
  CadLineEntity,
  CadProject,
  CadSurveyPointEntity,
  CadTextEntity,
  CadErrorEllipseEntity,
} from './cadTypes';
import { DEFAULT_CAD_LAYERS } from './cadLayers';
import { buildCadBounds } from './cadProjectState';
import { DEFAULT_CAD_STYLE_LIBRARY } from './cadStyles';

const sortStationIds = (ids: StationId[]) =>
  [...ids].sort((left, right) => left.localeCompare(right, undefined, { numeric: true }));

const lineObservationStations = (
  observation: Observation,
): { from: StationId; to: StationId } | null => {
  switch (observation.type) {
    case 'dist':
    case 'bearing':
    case 'zenith':
    case 'gps':
    case 'lev':
    case 'direction':
    case 'dir':
      return 'from' in observation && 'to' in observation
        ? { from: observation.from, to: observation.to }
        : null;
    default:
      return null;
  }
};

const buildPointEntities = (
  source: Pick<CadProject['metadata'], 'source'>['source'],
  stations: ParseResult['stations'],
): CadSurveyPointEntity[] =>
  sortStationIds(Object.keys(stations)).map((stationId) => {
    const station = stations[stationId];
    return {
      id: `pt:${stationId}`,
      type: 'survey-point',
      layerId: station.fixed ? 'control-points' : 'points',
      styleId: station.fixed ? 'style-control-point' : 'style-point',
      visible: true,
      locked: false,
      stationId,
      x: station.x,
      y: station.y,
      z: station.h,
      pointClass: station.fixed ? 'control' : station.coordInputClass === 'unknown' ? 'unknown' : 'free',
      source,
      errorEllipse: station.errorEllipse,
      metadata: {
        fixed: station.fixed,
        coordInputClass: station.coordInputClass ?? 'unknown',
      },
    };
  });

const buildLabelEntities = (points: CadSurveyPointEntity[]): CadTextEntity[] =>
  points.map((point) => ({
    id: `label:${point.stationId}`,
    type: 'text',
    layerId: 'labels',
    styleId: 'style-label',
    visible: true,
    locked: false,
    x: point.x,
    y: point.y,
    text: point.stationId,
    anchorEntityId: point.id,
    metadata: {
      stationId: point.stationId,
    },
  }));

const buildEllipseEntities = (points: CadSurveyPointEntity[]): CadErrorEllipseEntity[] =>
  points
    .filter((point) => point.errorEllipse != null)
    .map((point) => ({
      id: `ellipse:${point.stationId}`,
      type: 'error-ellipse',
      layerId: 'error-ellipses',
      styleId: 'style-error-ellipse',
      visible: true,
      locked: false,
      stationId: point.stationId,
      centerX: point.x,
      centerY: point.y,
      semiMajor: point.errorEllipse!.semiMajor,
      semiMinor: point.errorEllipse!.semiMinor,
      thetaDeg: point.errorEllipse!.theta,
      metadata: {
        stationId: point.stationId,
      },
    }));

const buildLineEntities = (
  stations: ParseResult['stations'],
  observations: Observation[],
): CadLineEntity[] => {
  const pairs = new Map<string, CadLineEntity>();
  observations.forEach((observation) => {
    const pair = lineObservationStations(observation);
    if (!pair) return;
    const from = stations[pair.from];
    const to = stations[pair.to];
    if (!from || !to) return;
    const pairKey =
      pair.from.localeCompare(pair.to, undefined, { numeric: true }) <= 0
        ? `${pair.from}|${pair.to}`
        : `${pair.to}|${pair.from}`;
    const existing = pairs.get(pairKey);
    if (existing) {
      existing.sourceObservationIds.push(observation.id);
      return;
    }
    pairs.set(pairKey, {
      id: `line:${pairKey}`,
      type: 'line',
      layerId: 'observation-lines',
      styleId: 'style-observation-line',
      visible: true,
      locked: false,
      fromStationId: pair.from,
      toStationId: pair.to,
      fromX: from.x,
      fromY: from.y,
      toX: to.x,
      toY: to.y,
      sourceObservationIds: [observation.id],
      metadata: {
        pairKey,
      },
    });
  });
  return [...pairs.values()].sort((left, right) =>
    left.id.localeCompare(right.id, undefined, { numeric: true }),
  );
};

const buildCadProjectFromParsed = (
  parsed: ParseResult,
  units: UnitsMode,
  source: CadProject['metadata']['source'],
): CadProject => {
  const pointEntities = buildPointEntities(source, parsed.stations);
  const lineEntities = buildLineEntities(parsed.stations, parsed.observations);
  const ellipseEntities = buildEllipseEntities(pointEntities);
  const labelEntities = buildLabelEntities(pointEntities);
  const entities: CadEntity[] = [
    ...pointEntities,
    ...lineEntities,
    ...ellipseEntities,
    ...labelEntities,
  ];

  return {
    version: 1,
    id: 'survey-cad-spike-project',
    name: source === 'adjustment-result' ? 'Adjusted Survey CAD Spike' : 'Parsed Survey CAD Spike',
    metadata: {
      source,
      runMode: parsed.parseState.runMode ?? 'unknown',
      units,
      stationCount: pointEntities.length,
      observationCount: parsed.observations.length,
      adjustedStationCount: source === 'adjustment-result' ? pointEntities.length : 0,
    },
    layers: DEFAULT_CAD_LAYERS,
    styleLibrary: DEFAULT_CAD_STYLE_LIBRARY,
    entities,
    bounds: buildCadBounds(entities),
  };
};

export interface BuildSurveyCadSpikeProjectArgs {
  input: string;
  instrumentLibrary: InstrumentLibrary;
  parseOptions: ParseOptions;
  units: UnitsMode;
  result?: AdjustmentResult | null;
}

export const buildSurveyCadSpikeProject = ({
  input,
  instrumentLibrary,
  parseOptions,
  units,
  result,
}: BuildSurveyCadSpikeProjectArgs): CadProject => {
  if (result) {
    return buildCadProjectFromParsed(
      {
        stations: result.stations,
        observations: result.observations,
        instrumentLibrary,
        unknowns: [],
        parseState: result.parseState ?? parseOptions,
        logs: result.logs,
      },
      units,
      'adjustment-result',
    );
  }

  const parsed = parseInput(input, instrumentLibrary, parseOptions);
  return buildCadProjectFromParsed(parsed, units, 'parsed-input');
};
