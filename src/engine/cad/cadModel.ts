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
import { createDefaultCadPointLabelStyles } from './cadPointLabelStyles';
import { basePointStyleIdForClass, createDefaultCadPointStyles } from './cadPointStyles';
import { stampAdjustmentDependency } from './cadAdjustmentDependency';
import type { ResultDependencyIdentity } from '../resultIntegrity';

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
    const pointClass = station.fixed
      ? 'control'
      : station.coordInputClass === 'unknown'
        ? 'unknown'
        : 'free';
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
      pointClass,
      source,
      pointStyleId: basePointStyleIdForClass(pointClass),
      errorEllipse: station.errorEllipse,
      metadata: {
        fixed: station.fixed,
        coordInputClass: station.coordInputClass ?? 'unknown',
        spikeSource: source,
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
      spikeSource: point.source,
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
        spikeSource: point.source,
      },
    }));

const buildLineEntities = (
  stations: ParseResult['stations'],
  observations: Observation[],
  source: Pick<CadProject['metadata'], 'source'>['source'],
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
        spikeSource: source,
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
  const lineEntities = buildLineEntities(parsed.stations, parsed.observations, source);
  const ellipseEntities = buildEllipseEntities(pointEntities);
  const labelEntities = buildLabelEntities(pointEntities);
  const entities: CadEntity[] = [
    ...pointEntities,
    ...lineEntities,
    ...ellipseEntities,
    ...labelEntities,
  ];

  return {
    version: 2,
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
    // Clone the default table (never hand out the singletons by reference).
    layers: DEFAULT_CAD_LAYERS.map((layer) => ({ ...layer })),
    styleLibrary: {
      lineTypes: DEFAULT_CAD_STYLE_LIBRARY.lineTypes.map((entry) => ({
        ...entry,
        dashPattern: [...entry.dashPattern],
      })),
      textStyles: DEFAULT_CAD_STYLE_LIBRARY.textStyles.map((entry) => ({ ...entry })),
      pointSymbols: DEFAULT_CAD_STYLE_LIBRARY.pointSymbols.map((entry) => ({ ...entry })),
      styles: DEFAULT_CAD_STYLE_LIBRARY.styles.map((entry) => ({ ...entry })),
    },
    entities,
    pointStyles: createDefaultCadPointStyles(),
    labelStyles: createDefaultCadPointLabelStyles(),
    cogoComputations: [],
    bounds: buildCadBounds(entities),
    currentLayerId: 'general',
  };
};

export interface BuildSurveyCadSpikeProjectArgs {
  input: string;
  instrumentLibrary: InstrumentLibrary;
  parseOptions: ParseOptions;
  units: UnitsMode;
  result?: AdjustmentResult | null;
  /**
   * Phase 17E: stamp result-built entities so they evaluate CURRENT.
   * Optional (backward-compatible); absent = legacy unstamped behavior.
   * Parsed-input builds never stamp.
   */
  resultDependencyIdentity?: ResultDependencyIdentity | null;
}

export const buildSurveyCadSpikeProject = ({
  input,
  instrumentLibrary,
  parseOptions,
  units,
  result,
  resultDependencyIdentity = null,
}: BuildSurveyCadSpikeProjectArgs): CadProject => {
  if (result) {
    const project = buildCadProjectFromParsed(
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
    if (!resultDependencyIdentity) return project;
    return {
      ...project,
      entities: project.entities.map((entity) => stampAdjustmentDependency(entity, resultDependencyIdentity)),
    };
  }

  const parsed = parseInput(input, instrumentLibrary, parseOptions);
  return buildCadProjectFromParsed(parsed, units, 'parsed-input');
};
