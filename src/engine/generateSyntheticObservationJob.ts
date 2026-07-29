import type {
  SyntheticObservationInputRenderOptions,
  SyntheticObservationJob,
} from './generateSyntheticObservations.types';

export const renderSyntheticObservationJob = (
  job: Pick<
    SyntheticObservationJob,
    'headerLines' | 'stationLines' | 'plainObservationLines' | 'directionSetBlocks'
  >,
  options: SyntheticObservationInputRenderOptions = {},
): string => {
  const observationOrder = options.observationOrder ?? 'default';
  const directionSetupOrder = options.directionSetupOrder ?? 'default';
  const plainObservationLines =
    observationOrder === 'reverse'
      ? [...job.plainObservationLines].reverse()
      : [...job.plainObservationLines];
  const directionSetBlocks =
    directionSetupOrder === 'reverse'
      ? [...job.directionSetBlocks].reverse()
      : [...job.directionSetBlocks];
  return [
    ...job.headerLines,
    ...job.stationLines,
    ...plainObservationLines,
    ...directionSetBlocks.flat(),
  ].join('\n');
};

const renameStationToken = (token: string, mapping: Record<string, string>): string =>
  mapping[token] ?? token;

const renamePairToken = (token: string, mapping: Record<string, string>): string =>
  token
    .split('-')
    .map((part) => renameStationToken(part, mapping))
    .join('-');

const renameSyntheticObservationLine = (line: string, mapping: Record<string, string>): string => {
  const parts = line.split(' ');
  const code = parts[0];
  if (code == null) return line;
  if (code === 'C' && parts[1]) {
    parts[1] = renameStationToken(parts[1], mapping);
    return parts.join(' ');
  }
  if ((code === 'D' || code === 'B' || code === 'V' || code === 'DV' || code === 'A') && parts[1]) {
    parts[1] = renamePairToken(parts[1], mapping);
    return parts.join(' ');
  }
  if (code === 'DB') {
    if (parts[1]) parts[1] = renameStationToken(parts[1], mapping);
    if (parts[2]) parts[2] = renameStationToken(parts[2], mapping);
    return parts.join(' ');
  }
  if ((code === 'DN' || code === 'DM') && parts[1]) {
    parts[1] = renameStationToken(parts[1], mapping);
    return parts.join(' ');
  }
  return line;
};

export const renameSyntheticObservationJob = (
  job: SyntheticObservationJob,
  mapping: Record<string, string>,
): SyntheticObservationJob => {
  const stationLines = job.stationLines.map((line) => renameSyntheticObservationLine(line, mapping));
  const plainObservationLines = job.plainObservationLines.map((line) =>
    renameSyntheticObservationLine(line, mapping),
  );
  const directionSetBlocks = job.directionSetBlocks.map((block) =>
    block.map((line) => renameSyntheticObservationLine(line, mapping)),
  );
  const approximateStations = job.approximateStations.map((station) => ({
    ...station,
    id: renameStationToken(station.id, mapping),
  }));
  return {
    ...job,
    stationLines,
    plainObservationLines,
    directionSetBlocks,
    approximateStations,
    input: renderSyntheticObservationJob({
      headerLines: job.headerLines,
      stationLines,
      plainObservationLines,
      directionSetBlocks,
    }),
  };
};
