import type { AdjustmentResult, Observation, Station } from '../types';

const FT_PER_M = 3.280839895;

export interface LandXmlExportSettings {
  units: 'm' | 'ft';
  solveProfile: 'webnet' | 'industry-parity';
  showLostStations?: boolean;
  projectName?: string;
  applicationName?: string;
  applicationVersion?: string;
  generatedAt?: Date;
}

type ExportPoint = {
  id: string;
  northing: number;
  easting: number;
  elevation: number;
  station?: Station;
  description?: string;
  source: 'station' | 'sideshot';
  sourceLine?: number;
  sigmaN?: number;
  sigmaE?: number;
  sigmaH?: number;
  azimuthSource?: string;
};

type ExportConnection = {
  from: string;
  to: string;
  kind: 'network' | 'sideshot';
  observationTypes: Set<string>;
  sourceLines: Set<number>;
  sigmaDist?: number;
  sigmaAz?: number;
};

const xmlEscape = (value: string): string =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');

const formatNumber = (value: number): string => {
  if (!Number.isFinite(value)) return '0.000000';
  const normalized = Math.abs(value) < 5e-13 ? 0 : value;
  return normalized.toFixed(6);
};

const pointCoordText = (point: ExportPoint): string =>
  `${formatNumber(point.northing)} ${formatNumber(point.easting)} ${formatNumber(point.elevation)}`;

const pointKind = (point: ExportPoint): string => {
  if (point.source === 'sideshot') return 'sideshot';
  if (point.station?.lost) return 'lost';
  if (point.station?.fixed) return 'fixed';
  return 'adjusted';
};

const stationDescription = (res: AdjustmentResult, stationId: string): string | undefined => {
  const descriptions = res.parseState?.reconciledDescriptions ?? {};
  const value = descriptions[stationId];
  return value && value.trim().length > 0 ? value.trim() : undefined;
};

const addFeatureProperties = (
  lines: string[],
  properties: Array<[label: string, value: string | number | undefined]>,
  indent: string,
): void => {
  const rows = properties.filter(([, value]) => value != null && `${value}`.trim().length > 0);
  if (rows.length === 0) return;
  lines.push(`${indent}<Feature code="WebNet">`);
  rows.forEach(([label, value]) => {
    lines.push(
      `${indent}  <Property label="${xmlEscape(label)}" value="${xmlEscape(String(value))}" />`,
    );
  });
  lines.push(`${indent}</Feature>`);
};

const activeObservationConnectionPairs = (
  obs: Observation,
): Array<{ from: string; to: string; type: string }> => {
  if (obs.type === 'angle') {
    return [
      { from: obs.at, to: obs.from, type: 'angle-ray' },
      { from: obs.at, to: obs.to, type: 'angle-ray' },
    ];
  }
  if (obs.type === 'direction') {
    return [{ from: obs.at, to: obs.to, type: 'direction' }];
  }
  if (
    obs.type === 'dist' ||
    obs.type === 'bearing' ||
    obs.type === 'dir' ||
    obs.type === 'gps' ||
    obs.type === 'lev' ||
    obs.type === 'zenith'
  ) {
    return [{ from: obs.from, to: obs.to, type: obs.type }];
  }
  return [];
};

const buildConnectionKey = (from: string, to: string, kind: 'network' | 'sideshot'): string =>
  `${kind}:${from}=>${to}`;

export const buildLandXmlText = (
  res: AdjustmentResult,
  settings: LandXmlExportSettings,
): string => {
  const unitScale = settings.units === 'ft' ? FT_PER_M : 1;
  const showLostStations = settings.showLostStations ?? true;
  const generatedAt = settings.generatedAt ?? new Date();
  const projectName = settings.projectName ?? 'WebNet Adjustment Export';
  const applicationName = settings.applicationName ?? 'WebNet';
  const applicationVersion = settings.applicationVersion ?? '0.0.0';
  const pointMap = new Map<string, ExportPoint>();
  const connectionMap = new Map<string, ExportConnection>();
  const relativePrecisionMap = new Map(
    (res.relativePrecision ?? []).flatMap((row) => {
      const forward = [`${row.from}|${row.to}`, row] as const;
      const reverse = [`${row.to}|${row.from}`, row] as const;
      return [forward, reverse];
    }),
  );

  Object.entries(res.stations)
    .filter(([, station]) => showLostStations || !station.lost)
    .sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }))
    .forEach(([id, station]) => {
      pointMap.set(id, {
        id,
        northing: station.y * unitScale,
        easting: station.x * unitScale,
        elevation: station.h * unitScale,
        station,
        description: stationDescription(res, id),
        source: 'station',
        sigmaN: station.sN != null ? station.sN * unitScale : undefined,
        sigmaE: station.sE != null ? station.sE * unitScale : undefined,
        sigmaH: station.sH != null ? station.sH * unitScale : undefined,
      });
    });

  (res.sideshots ?? [])
    .filter((row) => (showLostStations ? true : !res.stations[row.to]?.lost))
    .forEach((row) => {
      const relationFrom = row.relationFrom ?? row.from;
      if (!pointMap.has(row.to) && row.northing != null && row.easting != null) {
        pointMap.set(row.to, {
          id: row.to,
          northing: row.northing * unitScale,
          easting: row.easting * unitScale,
          elevation: (row.height ?? 0) * unitScale,
          description: row.note,
          source: 'sideshot',
          sourceLine: row.sourceLine,
          sigmaN: row.sigmaN != null ? row.sigmaN * unitScale : undefined,
          sigmaE: row.sigmaE != null ? row.sigmaE * unitScale : undefined,
          sigmaH: row.sigmaH != null ? row.sigmaH * unitScale : undefined,
          azimuthSource: row.azimuthSource,
        });
      }
      if (row.sourceType === 'GS' && !row.relationFrom) return;
      if (!relationFrom || relationFrom === row.to) return;
      if (!pointMap.has(relationFrom)) return;
      if (!pointMap.has(row.to)) return;
      const key = buildConnectionKey(relationFrom, row.to, 'sideshot');
      const existing = connectionMap.get(key) ?? {
        from: relationFrom,
        to: row.to,
        kind: 'sideshot' as const,
        observationTypes: new Set<string>(),
        sourceLines: new Set<number>(),
      };
      existing.observationTypes.add(`sideshot-${row.mode}`);
      if (row.sourceLine != null) existing.sourceLines.add(row.sourceLine);
      connectionMap.set(key, existing);
    });

  res.observations.forEach((obs) => {
    const isSideshotObservation =
      (typeof obs.calc === 'object' &&
        obs.calc != null &&
        'sideshot' in obs.calc &&
        Boolean((obs.calc as { sideshot?: boolean }).sideshot)) ||
      (obs.type === 'gps' && obs.gpsMode === 'sideshot');
    if (isSideshotObservation) return;
    const isActive = res.preanalysisMode
      ? obs.calc != null || obs.planned
      : obs.residual != null || obs.calc != null;
    if (!isActive) return;
    activeObservationConnectionPairs(obs).forEach((pair) => {
      if (!pointMap.has(pair.from) || !pointMap.has(pair.to)) return;
      const key = buildConnectionKey(pair.from, pair.to, 'network');
      const existing = connectionMap.get(key) ?? {
        from: pair.from,
        to: pair.to,
        kind: 'network' as const,
        observationTypes: new Set<string>(),
        sourceLines: new Set<number>(),
      };
      existing.observationTypes.add(pair.type);
      if (obs.sourceLine != null) existing.sourceLines.add(obs.sourceLine);
      if (existing.sigmaDist == null || existing.sigmaAz == null) {
        const rel = relativePrecisionMap.get(`${pair.from}|${pair.to}`);
        if (rel) {
          existing.sigmaDist =
            rel.sigmaDist != null ? rel.sigmaDist * unitScale : existing.sigmaDist;
          existing.sigmaAz = rel.sigmaAz;
        }
      }
      connectionMap.set(key, existing);
    });
  });

  const points = [...pointMap.values()].sort((a, b) =>
    a.id.localeCompare(b.id, undefined, { numeric: true }),
  );
  const connections = [...connectionMap.values()].sort(
    (a, b) =>
      a.from.localeCompare(b.from, undefined, { numeric: true }) ||
      a.to.localeCompare(b.to, undefined, { numeric: true }) ||
      a.kind.localeCompare(b.kind),
  );

  const date = generatedAt.toISOString().slice(0, 10);
  const time = generatedAt.toISOString().slice(11, 19);
  const projectDesc = [
    `profile=${settings.solveProfile}`,
    `coordMode=${res.parseState?.coordMode ?? '3D'}`,
    `preanalysis=${res.preanalysisMode === true ? 'on' : 'off'}`,
    `stationCount=${points.length}`,
    `connectionCount=${connections.length}`,
  ].join('; ');

  const lines: string[] = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<LandXML xmlns="http://www.landxml.org/schema/LandXML-1.2"',
    '         xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"',
    '         xsi:schemaLocation="http://www.landxml.org/schema/LandXML-1.2 http://www.landxml.org/schema/LandXML-1.2/LandXML-1.2.xsd"',
    `         date="${date}" time="${time}" version="1.2" language="English">`,
    `  <Units><${settings.units === 'ft' ? 'Imperial' : 'Metric'} areaUnit="${
      settings.units === 'ft' ? 'squareFoot' : 'squareMeter'
    }" linearUnit="${settings.units === 'ft' ? 'foot' : 'meter'}" volumeUnit="${
      settings.units === 'ft' ? 'cubicFeet' : 'cubicMeter'
    }" temperatureUnit="celsius" pressureUnit="HPA" angularUnit="decimal degrees" directionUnit="decimal degrees" /></Units>`,
    `  <Application name="${xmlEscape(applicationName)}" version="${xmlEscape(applicationVersion)}" manufacturer="${xmlEscape(
      applicationName,
    )}" desc="Least-squares adjustment export" />`,
    `  <Project name="${xmlEscape(projectName)}" desc="${xmlEscape(projectDesc)}" />`,
  ];

  if (points.length > 0) {
    lines.push('  <CgPoints>');
    points.forEach((point) => {
      lines.push(
        `    <CgPoint name="${xmlEscape(point.id)}" oID="${xmlEscape(point.id)}" desc="${xmlEscape(
          point.description ?? pointKind(point),
        )}">${pointCoordText(point)}`,
      );
      const pointProperties: Array<[string, string | number | undefined]> = [
        ['kind', pointKind(point)],
        ['description', point.description],
        ['source', point.source],
        ['sourceLine', point.sourceLine],
        ['sigmaN', point.sigmaN != null ? formatNumber(point.sigmaN) : undefined],
        ['sigmaE', point.sigmaE != null ? formatNumber(point.sigmaE) : undefined],
        ['sigmaH', point.sigmaH != null ? formatNumber(point.sigmaH) : undefined],
        [
          'ellipseSemiMajor',
          point.station?.errorEllipse?.semiMajor != null
            ? formatNumber(point.station.errorEllipse.semiMajor * unitScale)
            : undefined,
        ],
        [
          'ellipseSemiMinor',
          point.station?.errorEllipse?.semiMinor != null
            ? formatNumber(point.station.errorEllipse.semiMinor * unitScale)
            : undefined,
        ],
        [
          'ellipseAzimuthDeg',
          point.station?.errorEllipse?.theta != null
            ? formatNumber(point.station.errorEllipse.theta)
            : undefined,
        ],
        ['azimuthSource', point.azimuthSource],
      ];
      addFeatureProperties(lines, pointProperties, '      ');
      lines.push('    </CgPoint>');
    });
    lines.push('  </CgPoints>');
  }

  if (connections.length > 0) {
    lines.push('  <PlanFeatures name="WebNet Connections">');
    connections.forEach((connection, idx) => {
      const fromPoint = pointMap.get(connection.from);
      const toPoint = pointMap.get(connection.to);
      if (!fromPoint || !toPoint) return;
      const lineName = `CN-${String(idx + 1).padStart(4, '0')}`;
      lines.push(
        `    <PlanFeature name="${lineName}" desc="${xmlEscape(
          `${connection.from}-${connection.to}`,
        )}" code="${xmlEscape([...connection.observationTypes].sort().join(','))}">`,
      );
      lines.push('      <CoordGeom>');
      lines.push('        <Line>');
      lines.push(
        `          <Start pntRef="${xmlEscape(connection.from)}">${pointCoordText(fromPoint)}</Start>`,
      );
      lines.push(
        `          <End pntRef="${xmlEscape(connection.to)}">${pointCoordText(toPoint)}</End>`,
      );
      lines.push('        </Line>');
      lines.push('      </CoordGeom>');
      addFeatureProperties(
        lines,
        [
          ['kind', connection.kind],
          ['from', connection.from],
          ['to', connection.to],
          ['observationTypes', [...connection.observationTypes].sort().join(',')],
          ['sourceLines', [...connection.sourceLines].sort((a, b) => a - b).join(',')],
          [
            'sigmaDist',
            connection.sigmaDist != null ? formatNumber(connection.sigmaDist) : undefined,
          ],
          [
            'sigmaAzArcSec',
            connection.sigmaAz != null
              ? formatNumber((connection.sigmaAz * 180 * 3600) / Math.PI)
              : undefined,
          ],
        ],
        '      ',
      );
      lines.push('    </PlanFeature>');
    });
    lines.push('  </PlanFeatures>');
  }

  lines.push('</LandXML>');
  return lines.join('\n');
};
