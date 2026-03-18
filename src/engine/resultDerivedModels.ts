import { RAD_TO_DEG } from './angles';
import type {
  AdjustmentResult,
  AliasTraceEntry,
  DescriptionReconcileMode,
  DescriptionScanSummary,
  DescriptionTraceEntry,
  Observation,
  ParseOptions,
  StationMap,
  } from '../types';

export type SortedObservation = Observation & { originalIndex: number };

export interface DataCheckDiffRow {
  obs: Observation;
  stations: string;
  diffMagnitude: number;
  diffLabel: string;
}

export interface ObservationMapLink {
  key: string;
  observationId: number;
  type: Observation['type'];
  fromId: string;
  toId: string;
  sourceLine: number | null;
  pairKey: string;
}

export interface VisibleStationRow {
  id: string;
  station: StationMap[string];
  severity: 'watch' | 'weak' | null;
}

export interface DescriptionReferenceRow {
  key: string;
  description: string;
  lines: number[];
}

export interface ResultTraceabilityModel {
  aliasTrace: AliasTraceEntry[];
  descriptionTrace: DescriptionTraceEntry[];
  descriptionScanSummary: DescriptionScanSummary[];
  descriptionConflicts: DescriptionScanSummary[];
  descriptionRefsByStation: Map<string, DescriptionReferenceRow[]>;
  lostStationIds: string[];
  descriptionReconcileMode: DescriptionReconcileMode;
  descriptionAppendDelimiter: string;
  descriptionRepeatedStationCount: number;
  descriptionConflictCount: number;
  reconciledDescriptions: Record<string, string>;
}

export interface ResultStatisticalSummaryRow {
  label: string;
  count: number;
  sumSquares: number;
  errorFactor: number;
}

export interface ResultStatisticalSummaryModel {
  rows: ResultStatisticalSummaryRow[];
  totalCount: number;
  totalSumSquares: number;
}

export type StatisticalSummaryProfile = 'ui' | 'listing';

const normalizeText = (value: string): string => value.replace(/\s+/g, ' ').trim().toUpperCase();

export const formatObservationStationsLabel = (obs: Observation): string => {
  if (obs.type === 'angle') return `${obs.at}-${obs.from}-${obs.to}`;
  if (obs.type === 'direction') return `${obs.at}-${obs.to}`;
  if (
    obs.type === 'dist' ||
    obs.type === 'gps' ||
    obs.type === 'lev' ||
    obs.type === 'zenith' ||
    obs.type === 'bearing' ||
    obs.type === 'dir'
  ) {
    return `${obs.from}-${obs.to}`;
  }
  return '-';
};

export const buildObservationSearchText = (obs: Observation): string => {
  if (obs.type === 'angle') return `${obs.at} ${obs.from} ${obs.to}`;
  if (obs.type === 'direction') return `${obs.at} ${obs.to} ${obs.setId ?? ''}`;
  if ('from' in obs && 'to' in obs) return `${obs.from} ${obs.to}`;
  return '';
};

export const sortObservationsByStdRes = (observations: Observation[]): SortedObservation[] =>
  [...observations]
    .map((obs, index) => ({ ...obs, originalIndex: index }))
    .sort((a, b) => Math.abs(b.stdRes || 0) - Math.abs(a.stdRes || 0));

export const groupSortedObservationsByType = <TObservation extends SortedObservation>(
  observations: TObservation[],
): Map<Observation['type'], TObservation[]> => {
  const byTypeMap = new Map<Observation['type'], TObservation[]>();
  observations.forEach((obs) => {
    const rows = byTypeMap.get(obs.type) ?? [];
    rows.push(obs);
    byTypeMap.set(obs.type, rows);
  });
  return byTypeMap;
};

const describeDataCheckDifference = (
  obs: Observation,
  unitScale: number,
  linearUnitSuffix: string,
): { magnitude: number; label: string } | null => {
  if (
    obs.type === 'dist' ||
    obs.type === 'lev' ||
    obs.type === 'angle' ||
    obs.type === 'direction' ||
    obs.type === 'bearing' ||
    obs.type === 'dir' ||
    obs.type === 'zenith'
  ) {
    const residual = typeof obs.residual === 'number' ? obs.residual : Number.NaN;
    if (!Number.isFinite(residual)) return null;
    if (
      obs.type === 'angle' ||
      obs.type === 'direction' ||
      obs.type === 'bearing' ||
      obs.type === 'dir' ||
      obs.type === 'zenith'
    ) {
      const arcsec = Math.abs(residual * RAD_TO_DEG * 3600);
      return { magnitude: arcsec, label: `${arcsec.toFixed(2)}"` };
    }
    const linear = Math.abs(residual) * unitScale;
    return { magnitude: linear, label: `${linear.toFixed(4)}${linearUnitSuffix}` };
  }
  if (obs.type === 'gps' && obs.residual && typeof obs.residual === 'object') {
    const residual = obs.residual as { vE?: number; vN?: number };
    const vE = Number.isFinite(residual.vE as number) ? (residual.vE as number) : Number.NaN;
    const vN = Number.isFinite(residual.vN as number) ? (residual.vN as number) : Number.NaN;
    if (!Number.isFinite(vE) || !Number.isFinite(vN)) return null;
    const linear = Math.hypot(vE, vN) * unitScale;
    return { magnitude: linear, label: `${linear.toFixed(4)}${linearUnitSuffix}` };
  }
  return null;
};

export const buildDataCheckDiffRows = (
  observations: Observation[],
  options: {
    unitScale: number;
    linearUnitLabel: string;
    linearUnitSpacer?: string;
    limit?: number;
  },
): DataCheckDiffRow[] => {
  const linearUnitSuffix = `${options.linearUnitSpacer ?? ''}${options.linearUnitLabel}`;
  return observations
    .map((obs) => {
      const diff = describeDataCheckDifference(obs, options.unitScale, linearUnitSuffix);
      if (!diff) return null;
      return {
        obs,
        stations: formatObservationStationsLabel(obs),
        diffMagnitude: diff.magnitude,
        diffLabel: diff.label,
      };
    })
    .filter((row): row is DataCheckDiffRow => row != null)
    .sort((a, b) => b.diffMagnitude - a.diffMagnitude)
    .slice(0, options.limit ?? 25);
};

export const buildDescriptionRefsByStation = (
  descriptionTrace: DescriptionTraceEntry[],
): Map<string, DescriptionReferenceRow[]> =>
  descriptionTrace.reduce<Map<string, DescriptionReferenceRow[]>>((acc, entry) => {
    const rows = acc.get(entry.stationId) ?? [];
    const key = normalizeText(entry.description);
    const existing = rows.find((row) => row.key === key);
    if (existing) {
      if (!existing.lines.includes(entry.sourceLine)) existing.lines.push(entry.sourceLine);
      existing.lines.sort((a, b) => a - b);
    } else {
      rows.push({
        key,
        description: entry.description,
        lines: [entry.sourceLine],
      });
      rows.sort((a, b) => a.description.localeCompare(b.description, undefined, { numeric: true }));
    }
    acc.set(entry.stationId, rows);
    return acc;
  }, new Map());

export const buildVisibleStationIds = (
  stations: StationMap,
  showLostStations: boolean,
): string[] =>
  Object.entries(stations)
    .filter(([, station]) => showLostStations || !station.lost)
    .map(([stationId]) => stationId)
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

export const resolveWeakStationSeverity = (
  weakStationSeverity: Map<string, 'watch' | 'weak'>,
  stationId: string,
): 'watch' | 'weak' | null => weakStationSeverity.get(stationId) ?? null;

export const buildWeakStationSeverityLookup = (
  diagnostics?: AdjustmentResult['weakGeometryDiagnostics'],
): Map<string, 'watch' | 'weak'> => {
  const lookup = new Map<string, 'watch' | 'weak'>();
  (diagnostics?.stationCues ?? []).forEach((cue) => {
    if (cue.severity === 'watch' || cue.severity === 'weak') {
      lookup.set(cue.stationId, cue.severity);
    }
  });
  return lookup;
};

export const buildStationIdLookup = (stationIds: string[]): Map<string, string> => {
  const lookup = new Map<string, string>();
  stationIds.forEach((stationId) => {
    lookup.set(stationId.toUpperCase(), stationId);
  });
  return lookup;
};

export const buildVisibleStationRows = (
  stations: StationMap,
  showLostStations: boolean,
  weakStationSeverity: Map<string, 'watch' | 'weak'>,
): VisibleStationRow[] =>
  buildVisibleStationIds(stations, showLostStations).map((stationId) => ({
    id: stationId,
    station: stations[stationId],
    severity: resolveWeakStationSeverity(weakStationSeverity, stationId),
  }));

export const resolveStationIdToken = (
  stationIdLookup: Map<string, string>,
  value: string,
): string | null => {
  const token = value.trim();
  if (!token) return null;
  return stationIdLookup.get(token.toUpperCase()) ?? null;
};

export const buildObservationMapLinks = (observations: Observation[]): ObservationMapLink[] =>
  observations
    .filter(
      (obs) =>
        obs.type === 'dist' || obs.type === 'gps' || obs.type === 'bearing' || obs.type === 'dir',
    )
    .map((obs) => ({
      key: `obs-${obs.id}`,
      observationId: obs.id,
      type: obs.type,
      fromId: obs.from,
      toId: obs.to,
      sourceLine: obs.sourceLine ?? null,
      pairKey: [obs.from, obs.to]
        .slice()
        .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
        .join('|'),
    }));

export const buildMapLinkByPairKey = <TLink extends { pairKey: string }>(
  mapLinks: TLink[],
): Map<string, TLink> => {
  const next = new Map<string, TLink>();
  mapLinks.forEach((link) => {
    if (!next.has(link.pairKey)) next.set(link.pairKey, link);
  });
  return next;
};

export const resolveSelectedObservationPairKey = (
  observationById: Map<number, { pairKey: string | null }> | undefined,
  selectedObservationId: number | null | undefined,
): string | null => {
  if (!observationById || selectedObservationId == null) return null;
  return observationById.get(selectedObservationId)?.pairKey ?? null;
};

export const scoreMapStationPriority = (input: {
  stationId: string;
  selectedStationId?: string | null;
  severity?: 'watch' | 'weak' | null;
  fixed?: boolean;
}): number => {
  const selectedBoost = input.stationId === input.selectedStationId ? 1000 : 0;
  const severityBoost =
    input.severity === 'weak' ? 100 : input.severity === 'watch' ? 80 : 0;
  const fixedBoost = input.fixed ? 10 : 0;
  return selectedBoost + severityBoost + fixedBoost;
};

export const buildResultTraceabilityModel = (
  parseState?: ParseOptions,
): ResultTraceabilityModel => {
  const aliasTrace = [...(parseState?.aliasTrace ?? [])].sort((a, b) => {
    const la = a.sourceLine ?? Number.MAX_SAFE_INTEGER;
    const lb = b.sourceLine ?? Number.MAX_SAFE_INTEGER;
    if (la !== lb) return la - lb;
    const ca = a.context ?? '';
    const cb = b.context ?? '';
    if (ca !== cb) return ca.localeCompare(cb);
    return a.sourceId.localeCompare(b.sourceId);
  });
  const descriptionTrace = [...(parseState?.descriptionTrace ?? [])].sort((a, b) => {
    if (a.sourceLine !== b.sourceLine) return a.sourceLine - b.sourceLine;
    return a.stationId.localeCompare(b.stationId, undefined, { numeric: true });
  });
  const descriptionScanSummary = [...(parseState?.descriptionScanSummary ?? [])].sort((a, b) =>
    a.stationId.localeCompare(b.stationId, undefined, { numeric: true }),
  );
  const descriptionConflicts = descriptionScanSummary.filter((row) => row.conflict);

  return {
    aliasTrace,
    descriptionTrace,
    descriptionScanSummary,
    descriptionConflicts,
    descriptionRefsByStation: buildDescriptionRefsByStation(descriptionTrace),
    lostStationIds: [...(parseState?.lostStationIds ?? [])].sort((a, b) =>
      a.localeCompare(b, undefined, { numeric: true }),
    ),
    descriptionReconcileMode: parseState?.descriptionReconcileMode ?? 'first',
    descriptionAppendDelimiter: parseState?.descriptionAppendDelimiter ?? ' | ',
    descriptionRepeatedStationCount: parseState?.descriptionRepeatedStationCount ?? 0,
    descriptionConflictCount: parseState?.descriptionConflictCount ?? 0,
    reconciledDescriptions: parseState?.reconciledDescriptions ?? {},
  };
};

const classifyObservationSummaryLabel = (
  obs: Observation,
  profile: StatisticalSummaryProfile,
): string | null => {
  if (obs.type === 'angle') return 'Angles';
  if (obs.type === 'dist') return 'Distances';
  if (obs.type === 'gps') return 'GPS';
  if (obs.type === 'lev') return 'Leveling';
  if (profile === 'ui') {
    if (obs.type === 'direction' || obs.type === 'dir' || obs.type === 'bearing')
      return 'Az/Bearings';
    if (obs.type === 'zenith') return 'Zenith';
    return 'Other';
  }
  if (obs.type === 'direction' || obs.type === 'dir' || obs.type === 'bearing')
    return 'Directions';
  return null;
};

export const buildResultStatisticalSummaryModel = (
  result: AdjustmentResult,
  profile: StatisticalSummaryProfile = 'ui',
): ResultStatisticalSummaryModel => {
  if (result.statisticalSummary?.byGroup?.length) {
    return {
      rows: result.statisticalSummary.byGroup.map((row) => ({
        label: row.label,
        count: row.count,
        sumSquares: row.sumSquares,
        errorFactor: row.errorFactor,
      })),
      totalCount: result.statisticalSummary.totalCount,
      totalSumSquares: result.statisticalSummary.totalSumSquares,
    };
  }

  const rowsMap = new Map<string, { count: number; sumSquares: number }>();
  result.observations.forEach((obs) => {
    if (!Number.isFinite(obs.stdRes)) return;
    const label = classifyObservationSummaryLabel(obs, profile);
    if (!label) return;
    const row = rowsMap.get(label) ?? { count: 0, sumSquares: 0 };
    row.count += 1;
    row.sumSquares += (obs.stdRes ?? 0) * (obs.stdRes ?? 0);
    rowsMap.set(label, row);
  });

  const rows = [...rowsMap.entries()]
    .map(([label, row]) => ({
      label,
      count: row.count,
      sumSquares: row.sumSquares,
      errorFactor: row.count > 0 ? Math.sqrt(row.sumSquares / row.count) : 0,
    }))
    .sort((a, b) => a.label.localeCompare(b.label));

  return {
    rows,
    totalCount: rows.reduce((sum, row) => sum + row.count, 0),
    totalSumSquares: rows.reduce((sum, row) => sum + row.sumSquares, 0),
  };
};
