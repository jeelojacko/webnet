import { computeClassicTraverseLegacyDisplayGridFactors } from './geodesy';
import type { AdjustmentResult, InputStationSnapshot, Observation, Station } from '../types';
import type { IndustryListingSettings } from './industryListingTypes';

export type StationEntry = [string, Station];

export type StationDisplayFactors = {
  convergenceAngleRad: number;
  gridScaleFactor: number;
  elevationFactor: number;
  combinedFactor: number;
};

type ControlConstraintStation = Station | {
  constraintModeX?: Station['constraintModeX'];
  constraintModeY?: Station['constraintModeY'];
  constraintModeH?: Station['constraintModeH'];
};

type BuildIndustryListingStationContextOptions = {
  coordSystemMode: 'local' | 'grid';
  crsId: string;
  isPreanalysis: boolean;
  observationsForListing: Observation[];
  res: AdjustmentResult;
  settings: IndustryListingSettings;
  showLostStations: boolean;
  sideshotsForListing: NonNullable<AdjustmentResult['sideshots']>;
  usesClassicParityLayout: boolean;
};

export const observationStationIds = (obs: Observation): string[] => {
  if (obs.type === 'angle') return [obs.at, obs.from, obs.to];
  if (obs.type === 'direction') return [obs.at, obs.to];
  if ('from' in obs && 'to' in obs) return [obs.from, obs.to];
  return [];
};

const stationHasActiveControlConstraint = (station: ControlConstraintStation): boolean =>
  station.constraintModeX === 'fixed' ||
  station.constraintModeX === 'weighted' ||
  station.constraintModeY === 'fixed' ||
  station.constraintModeY === 'weighted' ||
  station.constraintModeH === 'fixed' ||
  station.constraintModeH === 'weighted';

const stationHasWeightedControlConstraint = (station: ControlConstraintStation): boolean =>
  station.constraintModeX === 'weighted' ||
  station.constraintModeY === 'weighted' ||
  station.constraintModeH === 'weighted';

const stationHasOnlyFixedControlConstraint = (station: ControlConstraintStation): boolean =>
  stationHasActiveControlConstraint(station) && !stationHasWeightedControlConstraint(station);

const inputStationIsUsed = (
  stationId: string,
  station: ControlConstraintStation,
  observedStationIds: Set<string>,
): boolean => observedStationIds.has(stationId) || stationHasActiveControlConstraint(station);

const buildInputStationSnapshot = (
  stationId: string,
  station: Station,
): InputStationSnapshot => ({
  stationId,
  x: station.x,
  y: station.y,
  h: station.h,
  coordInputClass: station.coordInputClass,
  constraintModeX: station.constraintModeX,
  constraintModeY: station.constraintModeY,
  constraintModeH: station.constraintModeH,
});

const buildClassicTraverseStationOrder = (
  stationSnapshots: InputStationSnapshot[],
  observationsForListing: Observation[],
  sideshotsForListing: NonNullable<AdjustmentResult['sideshots']>,
  stations: AdjustmentResult['stations'],
): string[] => {
  const classicTraverseStationOrder: string[] = [];
  const pushClassicTraverseStation = (stationId?: string) => {
    if (!stationId) return;
    if (classicTraverseStationOrder.includes(stationId)) return;
    if (!stations[stationId]) return;
    classicTraverseStationOrder.push(stationId);
  };

  stationSnapshots.forEach((station) => pushClassicTraverseStation(station.stationId));
  [...observationsForListing]
    .sort(
      (a, b) =>
        (a.sourceLine ?? Number.MAX_SAFE_INTEGER) - (b.sourceLine ?? Number.MAX_SAFE_INTEGER) ||
        a.id - b.id,
    )
    .forEach((obs) => {
      switch (obs.type) {
        case 'angle':
          pushClassicTraverseStation(obs.at);
          pushClassicTraverseStation(obs.from);
          pushClassicTraverseStation(obs.to);
          break;
        case 'direction':
          pushClassicTraverseStation(obs.at);
          pushClassicTraverseStation(obs.to);
          break;
        case 'dist':
        case 'dir':
        case 'bearing':
        case 'gps':
        case 'zenith':
        case 'lev':
          pushClassicTraverseStation(obs.from);
          pushClassicTraverseStation(obs.to);
          break;
        default:
          break;
      }
    });
  sideshotsForListing.forEach((row) => {
    pushClassicTraverseStation(row.from);
    pushClassicTraverseStation(row.to);
  });

  return classicTraverseStationOrder;
};

const buildClassicTraverseLegacyFactorByStation = (
  stationIds: string[],
  stations: AdjustmentResult['stations'],
): Map<string, StationDisplayFactors> =>
  new Map(
    stationIds.flatMap((stationId) => {
      const station = stations[stationId];
      if (
        !station ||
        !Number.isFinite(station.latDeg ?? Number.NaN) ||
        !Number.isFinite(station.lonDeg ?? Number.NaN)
      ) {
        return [];
      }
      const legacyFactors = computeClassicTraverseLegacyDisplayGridFactors(
        station.latDeg as number,
        station.lonDeg as number,
      );
      if (!legacyFactors) return [];
      const elevationFactor = station.elevationFactor ?? 1;
      return [
        [
          stationId,
          {
            convergenceAngleRad: legacyFactors.convergenceAngleRad,
            gridScaleFactor: legacyFactors.gridScaleFactor,
            elevationFactor,
            combinedFactor: legacyFactors.gridScaleFactor * elevationFactor,
          },
        ] as const,
      ];
    }),
  );

export const buildIndustryListingStationContext = ({
  coordSystemMode,
  crsId,
  isPreanalysis,
  observationsForListing,
  res,
  settings,
  showLostStations,
  sideshotsForListing,
  usesClassicParityLayout,
}: BuildIndustryListingStationContextOptions) => {
  let stationEntriesInputOrder = Object.entries(res.stations).filter(
    ([, station]) => showLostStations || !station.lost,
  );
  const enteredInputStationSnapshots =
    res.parseState?.inputStationSnapshots?.filter(
      (station) => showLostStations || !res.stations[station.stationId]?.lost,
    ) ??
    stationEntriesInputOrder
      .filter(([, station]) => station.coordInputClass != null && station.coordInputClass !== 'unknown')
      .map(([stationId, station]) => buildInputStationSnapshot(stationId, station));

  const observedStationIds = new Set<string>();
  observationsForListing.forEach((obs) => {
    observationStationIds(obs).forEach((stationId) => {
      if (stationId) observedStationIds.add(stationId);
    });
  });
  sideshotsForListing.forEach((row) => {
    if (row.from) observedStationIds.add(row.from);
    if (row.to) observedStationIds.add(row.to);
  });

  const usedEnteredStationSnapshots = enteredInputStationSnapshots.filter((station) =>
    inputStationIsUsed(station.stationId, station, observedStationIds),
  );
  const usedEnteredStationIdSet = new Set(
    usedEnteredStationSnapshots.map((station) => station.stationId),
  );
  const unusedEnteredStationSnapshots = enteredInputStationSnapshots.filter(
    (station) => !usedEnteredStationIdSet.has(station.stationId),
  );
  const useClassicPreanalysisListing = usesClassicParityLayout && isPreanalysis;
  const fixedUsedEnteredStationSnapshots = usedEnteredStationSnapshots.filter((station) =>
    useClassicPreanalysisListing
      ? stationHasOnlyFixedControlConstraint(station)
      : stationHasActiveControlConstraint(station),
  );
  const partiallyFixedUsedEnteredStationSnapshots = useClassicPreanalysisListing
    ? usedEnteredStationSnapshots.filter((station) => stationHasWeightedControlConstraint(station))
    : [];
  const freeUsedEnteredStationSnapshots = usedEnteredStationSnapshots.filter(
    (station) =>
      !fixedUsedEnteredStationSnapshots.some(
        (fixedStation) => fixedStation.stationId === station.stationId,
      ) &&
      !partiallyFixedUsedEnteredStationSnapshots.some(
        (partialStation) => partialStation.stationId === station.stationId,
      ),
  );
  const classicTraverseStationOrder = buildClassicTraverseStationOrder(
    usedEnteredStationSnapshots,
    observationsForListing,
    sideshotsForListing,
    res.stations,
  );

  const usesLegacyNbDisplayFactors =
    coordSystemMode === 'grid' && crsId === 'CA_NAD83_CSRS_NB_STEREO_DOUBLE';
  const classicTraverseLegacyFactorByStation = usesLegacyNbDisplayFactors
    ? buildClassicTraverseLegacyFactorByStation(
        usesClassicParityLayout
          ? classicTraverseStationOrder
          : stationEntriesInputOrder.map(([stationId]) => stationId),
        res.stations,
      )
    : new Map<string, StationDisplayFactors>();

  if (usesClassicParityLayout && unusedEnteredStationSnapshots.length > 0) {
    const unusedStationIdSet = new Set(
      unusedEnteredStationSnapshots.map((station) => station.stationId),
    );
    stationEntriesInputOrder = stationEntriesInputOrder.filter(
      ([stationId]) => !unusedStationIdSet.has(stationId),
    );
  }

  const stationEntriesForListing =
    settings.listingSortCoordinatesBy === 'name'
      ? [...stationEntriesInputOrder].sort((a, b) =>
          a[0].localeCompare(b[0], undefined, { numeric: true }),
        )
      : stationEntriesInputOrder;

  const displayFactorsForStation = (
    stationId: string,
    station: Station,
  ): StationDisplayFactors => {
    const displayFactors = classicTraverseLegacyFactorByStation.get(stationId);
    if (displayFactors) return displayFactors;
    const elevationFactor = station.elevationFactor ?? 1;
    const gridScaleFactor = station.gridScaleFactor ?? 1;
    return {
      convergenceAngleRad: station.convergenceAngleRad ?? 0,
      gridScaleFactor,
      elevationFactor,
      combinedFactor: station.combinedFactor ?? gridScaleFactor * elevationFactor,
    };
  };

  return {
    classicTraverseLegacyFactorByStation,
    classicTraverseStationOrder,
    displayFactorsForStation,
    enteredInputStationSnapshots,
    fixedStations: usesClassicParityLayout && unusedEnteredStationSnapshots.length > 0
      ? fixedUsedEnteredStationSnapshots.length
      : stationEntriesInputOrder.filter(([, station]) => station.fixed).length,
    fixedUsedEnteredStationSnapshots,
    freeStations: usesClassicParityLayout && unusedEnteredStationSnapshots.length > 0
      ? freeUsedEnteredStationSnapshots.length
      : stationEntriesInputOrder.filter(([, station]) => !station.fixed).length,
    freeUsedEnteredStationSnapshots,
    partiallyFixedUsedEnteredStationSnapshots,
    stationEntriesForListing,
    stationEntriesInputOrder,
    unusedEnteredStationSnapshots,
    useClassicPreanalysisListing,
    usesLegacyNbDisplayFactors,
    usedEnteredStationSnapshots,
  };
};
