import type { AdjustmentResult, Observation } from '../types';
import { formatObservationStationsLabel } from './resultDerivedModels';
import type { DerivedMapLink, DerivedObservationRef, DerivedQaResult, DerivedStationRef } from './qaWorkflowTypes';

const normalizeStationIds = (obs: Observation): string[] => {
  if (obs.type === 'angle') return [obs.at, obs.from, obs.to];
  if (obs.type === 'direction') return [obs.at, obs.to];
  if (obs.type === 'dist' || obs.type === 'gps' || obs.type === 'lev' || obs.type === 'zenith')
    return [obs.from, obs.to];
  if (obs.type === 'bearing' || obs.type === 'dir') return [obs.from, obs.to];
  return [];
};

export const buildObservationMatchKey = (obs: Observation): string =>
  `${obs.type}|${formatObservationStationsLabel(obs)}|${obs.sourceLine ?? -1}`;

const normalizeSearchText = (...parts: Array<string | number | null | undefined>): string =>
  parts
    .filter((part) => part != null && String(part).trim() !== '')
    .join(' ')
    .toLowerCase();

export const buildQaDerivedResult = (result: AdjustmentResult): DerivedQaResult => {
  const observationById = new Map<number, DerivedObservationRef>();
  const stationById = new Map<string, DerivedStationRef>();
  const mapLinks: DerivedMapLink[] = [];

  result.observations.forEach((obs) => {
    const stationIds = normalizeStationIds(obs);
    const pairStationIds =
      obs.type === 'dist' ||
      obs.type === 'gps' ||
      obs.type === 'lev' ||
      obs.type === 'zenith' ||
      obs.type === 'bearing' ||
      obs.type === 'dir'
        ? [stationIds[0], stationIds[1]].filter(Boolean)
        : obs.type === 'direction'
          ? [obs.at, obs.to]
          : [];
    const pairKey =
      pairStationIds.length === 2
        ? pairStationIds.slice().sort((a, b) => a.localeCompare(b, undefined, { numeric: true })).join('|')
        : null;
    const ref: DerivedObservationRef = {
      id: obs.id,
      type: obs.type,
      stationsLabel: formatObservationStationsLabel(obs),
      stationIds,
      sourceLine: obs.sourceLine ?? null,
      pairKey,
      searchText: normalizeSearchText(
        obs.type,
        formatObservationStationsLabel(obs),
        obs.sourceLine ?? '',
      ),
      absStdRes: Number.isFinite(obs.stdRes) ? Math.abs(obs.stdRes ?? 0) : 0,
    };
    observationById.set(obs.id, ref);
    stationIds.forEach((stationId) => {
      const current = stationById.get(stationId) ?? {
        id: stationId,
        sourceLines: [],
        observationIds: [],
        searchText: stationId.toLowerCase(),
      };
      current.observationIds.push(obs.id);
      if (ref.sourceLine != null) current.sourceLines.push(ref.sourceLine);
      current.searchText = normalizeSearchText(current.searchText, ref.searchText);
      stationById.set(stationId, current);
    });
    if (
      pairStationIds.length === 2 &&
      (obs.type === 'dist' || obs.type === 'gps' || obs.type === 'lev' || obs.type === 'bearing' || obs.type === 'dir')
    ) {
      mapLinks.push({
        key: `obs-${obs.id}`,
        observationId: obs.id,
        type: obs.type,
        fromId: pairStationIds[0],
        toId: pairStationIds[1],
        sourceLine: ref.sourceLine,
        pairKey: pairKey ?? `${pairStationIds[0]}|${pairStationIds[1]}`,
      });
    }
  });

  const observations = [...observationById.values()].sort((a, b) => b.absStdRes - a.absStdRes);
  const stations = [...stationById.values()].map((station) => ({
    ...station,
    sourceLines: station.sourceLines.slice().sort((a, b) => a - b),
  }));
  const suspectObservationIds = observations
    .filter((obs) => obs.absStdRes >= 2)
    .map((obs) => obs.id);

  return {
    observations,
    observationById,
    stations,
    stationById,
    mapLinks,
    suspectObservationIds,
  };
};
