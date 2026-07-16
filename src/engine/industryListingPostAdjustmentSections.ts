import { radToDmsStr } from './angles';
import type { AdjustmentResult, GpsObservation } from '../types';

type HeadingAppender = (_title: string, _underline?: string) => void;
type TableRenderer = (_headers: string[], _rows: string[][], _rightAligned?: number[]) => void;
type SideshotRow = NonNullable<AdjustmentResult['sideshots']>[number];

type AppendPostAdjustmentListingSectionsOptions = {
  addCenteredHeading: HeadingAppender;
  coordMode: '2D' | '3D';
  gpsCoordinateSideshotsForListing: SideshotRow[];
  gpsLoopDiagnostics: AdjustmentResult['gpsLoopDiagnostics'];
  gpsOffsetObservations: GpsObservation[];
  gpsVectorSideshotsForListing: SideshotRow[];
  levelingLoopDiagnostics: AdjustmentResult['levelingLoopDiagnostics'];
  linearUnit: string;
  lines: string[];
  renderTextTable: TableRenderer;
  stationDescription: (_stationId: string) => string;
  tsSideshotsForListing: SideshotRow[];
  unitScale: number;
};

const appendSideshotListingSection = (
  title: string,
  rows: SideshotRow[],
  {
    addCenteredHeading,
    linearUnit,
    lines,
    renderTextTable,
    unitScale,
  }: Pick<
    AppendPostAdjustmentListingSectionsOptions,
    'addCenteredHeading' | 'linearUnit' | 'lines' | 'renderTextTable' | 'unitScale'
  >,
) => {
  if (rows.length === 0) return;
  lines.push('');
  addCenteredHeading(title);
  lines.push('');
  const tableRows = rows.map((row) => [
    row.from,
    row.to,
    row.sourceLine != null ? `1:${row.sourceLine}` : '-',
    row.mode,
    row.azimuth != null ? radToDmsStr(row.azimuth) : '-',
    row.azimuthSource ?? '-',
    (row.horizDistance * unitScale).toFixed(4),
    row.deltaH != null ? (row.deltaH * unitScale).toFixed(4) : '-',
    row.northing != null ? (row.northing * unitScale).toFixed(4) : '-',
    row.easting != null ? (row.easting * unitScale).toFixed(4) : '-',
    row.height != null ? (row.height * unitScale).toFixed(4) : '-',
    row.sigmaN != null ? (row.sigmaN * unitScale).toFixed(4) : '-',
    row.sigmaE != null ? (row.sigmaE * unitScale).toFixed(4) : '-',
    row.sigmaH != null ? (row.sigmaH * unitScale).toFixed(4) : '-',
    row.note ?? '-',
  ]);
  renderTextTable(
    [
      'From',
      'To',
      'File:Line',
      'Mode',
      'Az',
      'AzSrc',
      `HD (${linearUnit})`,
      `dH (${linearUnit})`,
      `Northing (${linearUnit})`,
      `Easting (${linearUnit})`,
      `Height (${linearUnit})`,
      `σN (${linearUnit})`,
      `σE (${linearUnit})`,
      `σH (${linearUnit})`,
      'Note',
    ],
    tableRows,
    [6, 7, 8, 9, 10, 11, 12, 13],
  );
};

const appendResolvedTsSideshotCoordinates = ({
  addCenteredHeading,
  coordMode,
  lines,
  renderTextTable,
  resolvedTsSideshotsForListing,
  stationDescription,
  unitScale,
}: Pick<
  AppendPostAdjustmentListingSectionsOptions,
  'addCenteredHeading' | 'coordMode' | 'lines' | 'renderTextTable' | 'stationDescription' | 'unitScale'
> & {
  resolvedTsSideshotsForListing: SideshotRow[];
}) => {
  if (resolvedTsSideshotsForListing.length === 0) return;
  lines.push('');
  addCenteredHeading('Sideshot Coordinates Computed After Adjustment');
  lines.push('');
  const sideshotCoordinateRows = resolvedTsSideshotsForListing.map((row) => {
    const description = stationDescription(row.to);
    if (coordMode === '3D') {
      return [
        row.to,
        (row.northing! * unitScale).toFixed(4),
        (row.easting! * unitScale).toFixed(4),
        row.height != null ? (row.height * unitScale).toFixed(4) : '-',
        description,
      ];
    }
    return [row.to, (row.northing! * unitScale).toFixed(4), (row.easting! * unitScale).toFixed(4), description];
  });
  renderTextTable(
    coordMode === '3D'
      ? ['Station', 'N', 'E', 'Elev', 'Description']
      : ['Station', 'N', 'E', 'Description'],
    sideshotCoordinateRows,
    coordMode === '3D' ? [1, 2, 3] : [1, 2],
  );
};

const appendGpsOffsetObservations = ({
  addCenteredHeading,
  gpsOffsetObservations,
  linearUnit,
  lines,
  renderTextTable,
  unitScale,
}: Pick<
  AppendPostAdjustmentListingSectionsOptions,
  'addCenteredHeading' | 'gpsOffsetObservations' | 'linearUnit' | 'lines' | 'renderTextTable' | 'unitScale'
>) => {
  if (gpsOffsetObservations.length === 0) return;
  lines.push('');
  addCenteredHeading('GPS Rover Offset Observations');
  lines.push('');
  const gpsOffsetRows = gpsOffsetObservations.map((obs) => [
    obs.from,
    obs.to,
    obs.sourceLine != null ? `1:${obs.sourceLine}` : '-',
    obs.gpsOffsetSourceLine != null ? `1:${obs.gpsOffsetSourceLine}` : '-',
    obs.gpsOffsetAzimuthRad != null ? radToDmsStr(obs.gpsOffsetAzimuthRad) : '-',
    obs.gpsOffsetDistanceM != null ? (obs.gpsOffsetDistanceM * unitScale).toFixed(4) : '-',
    obs.gpsOffsetZenithRad != null ? radToDmsStr(obs.gpsOffsetZenithRad) : '-',
    obs.gpsOffsetDeltaE != null ? (obs.gpsOffsetDeltaE * unitScale).toFixed(4) : '-',
    obs.gpsOffsetDeltaN != null ? (obs.gpsOffsetDeltaN * unitScale).toFixed(4) : '-',
    obs.gpsOffsetDeltaH != null ? (obs.gpsOffsetDeltaH * unitScale).toFixed(4) : '-',
  ]);
  renderTextTable(
    [
      'From',
      'To',
      'G Line',
      'G4 Line',
      'Az',
      `Slope (${linearUnit})`,
      'Zenith',
      `dE (${linearUnit})`,
      `dN (${linearUnit})`,
      `dH (${linearUnit})`,
    ],
    gpsOffsetRows,
    [5, 7, 8, 9],
  );
};

const appendGpsLoopDiagnostics = ({
  addCenteredHeading,
  gpsLoopDiagnostics,
  linearUnit,
  lines,
  renderTextTable,
  unitScale,
}: Pick<
  AppendPostAdjustmentListingSectionsOptions,
  'addCenteredHeading' | 'gpsLoopDiagnostics' | 'linearUnit' | 'lines' | 'renderTextTable' | 'unitScale'
>) => {
  if (!gpsLoopDiagnostics?.enabled) return;
  lines.push('');
  addCenteredHeading('GPS Loop Diagnostics');
  lines.push('');
  lines.push(
    `vectors=${gpsLoopDiagnostics.vectorCount}, loops=${gpsLoopDiagnostics.loopCount}, pass=${gpsLoopDiagnostics.passCount}, warn=${gpsLoopDiagnostics.warnCount}, tolerance=${(gpsLoopDiagnostics.thresholds.baseToleranceM * unitScale).toFixed(4)}${linearUnit}+${gpsLoopDiagnostics.thresholds.ppmTolerance}ppm*dist`,
  );
  lines.push('');
  const gpsLoopRows = gpsLoopDiagnostics.loops.map((loop) => [
    String(loop.rank),
    loop.key,
    loop.pass ? 'PASS' : 'WARN',
    (loop.closureMag * unitScale).toFixed(4),
    (loop.toleranceM * unitScale).toFixed(4),
    loop.linearPpm != null ? loop.linearPpm.toFixed(1) : '-',
    loop.closureRatio != null ? `1:${loop.closureRatio.toFixed(0)}` : '-',
    loop.severity.toFixed(2),
    loop.sourceLines.length > 0 ? loop.sourceLines.join(',') : '-',
    loop.stationPath.join('->'),
  ]);
  renderTextTable(
    [
      '#',
      'Loop',
      'Status',
      `Closure (${linearUnit})`,
      `Tol (${linearUnit})`,
      'Linear (ppm)',
      'Ratio',
      'Severity',
      'Lines',
      'Path',
    ],
    gpsLoopRows,
    [3, 4, 5, 7],
  );
};

const appendLevelingLoopDiagnostics = ({
  addCenteredHeading,
  levelingLoopDiagnostics,
  linearUnit,
  lines,
  renderTextTable,
  unitScale,
}: Pick<
  AppendPostAdjustmentListingSectionsOptions,
  'addCenteredHeading' | 'levelingLoopDiagnostics' | 'linearUnit' | 'lines' | 'renderTextTable' | 'unitScale'
>) => {
  if (!levelingLoopDiagnostics?.enabled) return;
  lines.push('');
  addCenteredHeading('Differential Leveling Loop Diagnostics');
  lines.push('');
  lines.push(
    `observations=${levelingLoopDiagnostics.observationCount}, loops=${levelingLoopDiagnostics.loopCount}, pass=${levelingLoopDiagnostics.passCount}, warn=${levelingLoopDiagnostics.warnCount}, totalLength=${levelingLoopDiagnostics.totalLengthKm.toFixed(3)}km, warnLength=${levelingLoopDiagnostics.warnTotalLengthKm.toFixed(3)}km, tolerance=${levelingLoopDiagnostics.thresholds.baseMm.toFixed(2)}mm+${levelingLoopDiagnostics.thresholds.perSqrtKmMm.toFixed(2)}mm*sqrt(km), worst|dH|=${levelingLoopDiagnostics.worstClosure != null ? (levelingLoopDiagnostics.worstClosure * unitScale).toFixed(4) : '-'}${linearUnit}`,
  );
  lines.push('');
  const levelingLoopRows = levelingLoopDiagnostics.loops.map((loop) => [
    String(loop.rank),
    loop.key,
    loop.pass ? 'PASS' : 'WARN',
    (loop.closure * unitScale).toFixed(4),
    (loop.absClosure * unitScale).toFixed(4),
    loop.loopLengthKm.toFixed(3),
    loop.toleranceMm.toFixed(2),
    loop.closurePerSqrtKmMm.toFixed(2),
    loop.sourceLines.length > 0 ? loop.sourceLines.join(',') : '-',
    loop.stationPath.join('->'),
  ]);
  renderTextTable(
    [
      '#',
      'Loop',
      'Status',
      `dH (${linearUnit})`,
      `|dH| (${linearUnit})`,
      'Len (km)',
      'Tol (mm)',
      'mm/sqrt(km)',
      'Lines',
      'Path',
    ],
    levelingLoopRows,
    [3, 4, 5, 6, 7],
  );
  lines.push('');
  const levelingSegmentRows = levelingLoopDiagnostics.loops.flatMap((loop) =>
    loop.segments.map((segment, index) => [
      loop.key,
      String(index + 1),
      segment.from,
      segment.to,
      (segment.observedDh * unitScale).toFixed(4),
      segment.lengthKm.toFixed(3),
      segment.sourceLine != null ? String(segment.sourceLine) : '-',
      segment.closureLeg ? 'Closure' : 'Traverse',
    ]),
  );
  renderTextTable(
    ['Loop', 'Seg', 'From', 'To', `dH (${linearUnit})`, 'Len (km)', 'Line', 'Role'],
    levelingSegmentRows,
    [1, 4, 5, 6],
  );
  if (levelingLoopDiagnostics.suspectSegments.length === 0) return;
  lines.push('');
  const levelingSuspectRows = levelingLoopDiagnostics.suspectSegments.map((segment) => [
    String(segment.rank),
    `${segment.from}->${segment.to}`,
    segment.sourceLine != null ? String(segment.sourceLine) : '-',
    String(segment.warnLoopCount),
    segment.suspectScore.toFixed(2),
    (segment.maxAbsDh * unitScale).toFixed(4),
    segment.worstLoopKey ?? '-',
  ]);
  renderTextTable(
    ['#', 'Segment', 'Line', 'WarnLoops', 'Score', `Max |dH| (${linearUnit})`, 'Worst Loop'],
    levelingSuspectRows,
    [2, 3, 4, 5],
  );
};

export const appendPostAdjustmentListingSections = (options: AppendPostAdjustmentListingSectionsOptions) => {
  const {
    gpsCoordinateSideshotsForListing,
    gpsVectorSideshotsForListing,
    tsSideshotsForListing,
  } = options;
  const resolvedTsSideshotsForListing = tsSideshotsForListing.filter(
    (row) => row.northing != null && row.easting != null,
  );
  const unresolvedTsSideshotsForListing = tsSideshotsForListing.filter(
    (row) => row.northing == null || row.easting == null,
  );
  appendResolvedTsSideshotCoordinates({ ...options, resolvedTsSideshotsForListing });
  appendSideshotListingSection('Post-Adjusted Sideshots (TS)', unresolvedTsSideshotsForListing, options);
  appendSideshotListingSection('Post-Adjusted GPS Sideshot Vectors', gpsVectorSideshotsForListing, options);
  appendSideshotListingSection('Post-Adjusted GNSS Topo Coordinates (GS)', gpsCoordinateSideshotsForListing, options);
  appendGpsOffsetObservations(options);
  appendGpsLoopDiagnostics(options);
  appendLevelingLoopDiagnostics(options);
};
