import type {
  AliasTraceEntry,
  DirectionRejectDiagnostic,
  Observation,
  ParseOptions,
  StationId,
  StationMap,
} from '../types';

export type ResolveAlias = (_id: StationId) => { canonicalId: StationId; reference?: string };
export type AddAliasTrace = (
  _sourceId: StationId,
  _canonicalId: StationId,
  _context: AliasTraceEntry['context'],
  _sourceLine?: number,
  _detail?: string,
  _reference?: string,
) => void;
export type ApplyFixities = (
  _station: StationMap[string],
  _fix: { x?: boolean; y?: boolean; h?: boolean },
  _coordMode: ParseOptions['coordMode'],
) => void;

interface ApplyAliasPostProcessingArgs {
  stations: StationMap;
  observations: Observation[];
  state: ParseOptions;
  logs: string[];
  resolveAlias: ResolveAlias;
  addAliasTrace: AddAliasTrace;
  applyFixities: ApplyFixities;
  explicitAliasCount: number;
  aliasRuleCount: number;
  directionRejectDiagnostics: DirectionRejectDiagnostic[];
}

const isPlaceholderStation = (station: StationMap[string]): boolean =>
  Math.abs(station.x) <= 1e-12 &&
  Math.abs(station.y) <= 1e-12 &&
  Math.abs(station.h) <= 1e-12 &&
  (station.sx == null || Math.abs(station.sx) <= 1e-12) &&
  (station.sy == null || Math.abs(station.sy) <= 1e-12) &&
  (station.sh == null || Math.abs(station.sh) <= 1e-12) &&
  station.constraintCorrXY == null &&
  station.constraintX == null &&
  station.constraintY == null &&
  station.constraintH == null &&
  !(station.fixedX ?? false) &&
  !(station.fixedY ?? false) &&
  !(station.fixedH ?? false);

const mergeStation = (
  target: StationMap[string],
  incoming: StationMap[string],
  incomingId: StationId,
  canonicalId: StationId,
  options: Pick<ApplyAliasPostProcessingArgs, 'applyFixities' | 'logs' | 'state'>,
): void => {
  const { applyFixities, logs, state } = options;
  const targetPlaceholder = isPlaceholderStation(target);
  const incomingPlaceholder = isPlaceholderStation(incoming);
  if (targetPlaceholder && !incomingPlaceholder) {
    Object.assign(target, incoming);
  } else {
    const hasConflict =
      !incomingPlaceholder &&
      (Math.abs(target.x - incoming.x) > 1e-6 ||
        Math.abs(target.y - incoming.y) > 1e-6 ||
        (state.coordMode === '3D' && Math.abs(target.h - incoming.h) > 1e-6));
    if (hasConflict) {
      logs.push(
        `Warning: alias merge ${incomingId} -> ${canonicalId} has conflicting coordinates; keeping first station definition.`,
      );
    }
  }
  const fixedX = (target.fixedX ?? false) || (incoming.fixedX ?? false);
  const fixedY = (target.fixedY ?? false) || (incoming.fixedY ?? false);
  const fixedH = (target.fixedH ?? false) || (incoming.fixedH ?? false);
  applyFixities(target, { x: fixedX, y: fixedY, h: fixedH }, state.coordMode);
  if (target.sx == null && incoming.sx != null) target.sx = incoming.sx;
  else if (target.sx != null && incoming.sx != null) target.sx = Math.min(target.sx, incoming.sx);
  if (target.sy == null && incoming.sy != null) target.sy = incoming.sy;
  else if (target.sy != null && incoming.sy != null) target.sy = Math.min(target.sy, incoming.sy);
  if (target.sh == null && incoming.sh != null) target.sh = incoming.sh;
  else if (target.sh != null && incoming.sh != null) target.sh = Math.min(target.sh, incoming.sh);
  if (target.constraintX == null && incoming.constraintX != null) target.constraintX = incoming.constraintX;
  if (target.constraintY == null && incoming.constraintY != null) target.constraintY = incoming.constraintY;
  if (target.constraintH == null && incoming.constraintH != null) target.constraintH = incoming.constraintH;
  if (target.constraintCorrXY == null && incoming.constraintCorrXY != null) {
    target.constraintCorrXY = incoming.constraintCorrXY;
  }
  if (target.constraintModeX == null && incoming.constraintModeX != null) target.constraintModeX = incoming.constraintModeX;
  if (target.constraintModeY == null && incoming.constraintModeY != null) target.constraintModeY = incoming.constraintModeY;
  if (target.constraintModeH == null && incoming.constraintModeH != null) target.constraintModeH = incoming.constraintModeH;
  if (target.heightType == null && incoming.heightType != null) target.heightType = incoming.heightType;
  if (target.latDeg == null && incoming.latDeg != null) target.latDeg = incoming.latDeg;
  if (target.lonDeg == null && incoming.lonDeg != null) target.lonDeg = incoming.lonDeg;
};

const remapObservationAliases = (
  obs: Observation,
  { addAliasTrace, resolveAlias }: Pick<ApplyAliasPostProcessingArgs, 'addAliasTrace' | 'resolveAlias'>,
): void => {
  if (obs.type === 'angle') {
    const at = resolveAlias(obs.at);
    addAliasTrace(obs.at, at.canonicalId, 'observation', obs.sourceLine, `${obs.type}.at`, at.reference);
    obs.at = at.canonicalId;
    const from = resolveAlias(obs.from);
    addAliasTrace(obs.from, from.canonicalId, 'observation', obs.sourceLine, `${obs.type}.from`, from.reference);
    obs.from = from.canonicalId;
    const to = resolveAlias(obs.to);
    addAliasTrace(obs.to, to.canonicalId, 'observation', obs.sourceLine, `${obs.type}.to`, to.reference);
    obs.to = to.canonicalId;
  } else if (obs.type === 'direction') {
    const at = resolveAlias(obs.at);
    addAliasTrace(obs.at, at.canonicalId, 'observation', obs.sourceLine, `${obs.type}.at`, at.reference);
    obs.at = at.canonicalId;
    const to = resolveAlias(obs.to);
    addAliasTrace(obs.to, to.canonicalId, 'observation', obs.sourceLine, `${obs.type}.to`, to.reference);
    obs.to = to.canonicalId;
  } else if (
    obs.type === 'dist' ||
    obs.type === 'bearing' ||
    obs.type === 'dir' ||
    obs.type === 'gps' ||
    obs.type === 'lev' ||
    obs.type === 'zenith'
  ) {
    const from = resolveAlias(obs.from);
    addAliasTrace(obs.from, from.canonicalId, 'observation', obs.sourceLine, `${obs.type}.from`, from.reference);
    obs.from = from.canonicalId;
    const to = resolveAlias(obs.to);
    addAliasTrace(obs.to, to.canonicalId, 'observation', obs.sourceLine, `${obs.type}.to`, to.reference);
    obs.to = to.canonicalId;
  }
  if (obs.calc != null && typeof obs.calc === 'object') {
    const calcMeta = obs.calc as { backsightId?: StationId };
    if (calcMeta.backsightId) {
      const bs = resolveAlias(calcMeta.backsightId);
      addAliasTrace(
        calcMeta.backsightId,
        bs.canonicalId,
        'sideshot-backsight',
        obs.sourceLine,
        `${obs.type}.backsight`,
        bs.reference,
      );
      calcMeta.backsightId = bs.canonicalId;
    }
  }
};

export const applyAliasPostProcessing = (options: ApplyAliasPostProcessingArgs): void => {
  const {
    addAliasTrace,
    aliasRuleCount,
    directionRejectDiagnostics,
    explicitAliasCount,
    logs,
    observations,
    resolveAlias,
    state,
    stations,
  } = options;
  if (explicitAliasCount === 0 && aliasRuleCount === 0) return;

  observations.forEach((obs) => remapObservationAliases(obs, options));
  state.gpsTopoShots?.forEach((shot) => {
    const target = resolveAlias(shot.pointId);
    addAliasTrace(shot.pointId, target.canonicalId, 'observation', shot.sourceLine, 'GS.point', target.reference);
    shot.pointId = target.canonicalId;
    if (shot.fromId) {
      const from = resolveAlias(shot.fromId);
      addAliasTrace(shot.fromId, from.canonicalId, 'observation', shot.sourceLine, 'GS.from', from.reference);
      shot.fromId = from.canonicalId;
    }
  });
  directionRejectDiagnostics.forEach((diag) => {
    const occupy = resolveAlias(diag.occupy);
    addAliasTrace(
      diag.occupy,
      occupy.canonicalId,
      'direction-reject',
      diag.sourceLine,
      `${diag.recordType ?? 'UNKNOWN'}.occupy`,
      occupy.reference,
    );
    diag.occupy = occupy.canonicalId;
    if (diag.target) {
      const target = resolveAlias(diag.target);
      addAliasTrace(
        diag.target,
        target.canonicalId,
        'direction-reject',
        diag.sourceLine,
        `${diag.recordType ?? 'UNKNOWN'}.target`,
        target.reference,
      );
      diag.target = target.canonicalId;
    }
  });

  const remappedStations: StationMap = {};
  let renamedStationCount = 0;
  Object.entries(stations).forEach(([id, station]) => {
    const stationAlias = resolveAlias(id);
    const canonicalId = stationAlias.canonicalId;
    if (canonicalId !== id) renamedStationCount += 1;
    addAliasTrace(id, canonicalId, 'station', undefined, 'station.id', stationAlias.reference);
    const existing = remappedStations[canonicalId];
    if (!existing) remappedStations[canonicalId] = { ...station };
    else mergeStation(existing, station, id, canonicalId, options);
  });
  Object.keys(stations).forEach((id) => delete stations[id]);
  Object.assign(stations, remappedStations);
  logs.push(
    `Alias canonicalization applied (explicit=${explicitAliasCount}, rules=${aliasRuleCount}, station remaps=${renamedStationCount}).`,
  );
};
