import { radToDmsStr } from './angles';
import type { RunResultsTextContext } from './runResultsTextContext';

type PostAdjustedSectionContext = Pick<
  RunResultsTextContext,
  | 'linearUnit'
  | 'unitScale'
  | 'outputSideshots'
  | 'outputTsSideshots'
  | 'outputGpsVectorSideshots'
  | 'outputGpsCoordinateSideshots'
  | 'gpsLoopDiagnostics'
>;

export const appendPostAdjustedSections = ({
  lines,
  context,
}: {
  lines: string[];
  context: PostAdjustedSectionContext;
}): void => {
  const {
    linearUnit,
    unitScale,
    outputSideshots,
    outputTsSideshots,
    outputGpsVectorSideshots,
    outputGpsCoordinateSideshots,
    gpsLoopDiagnostics,
  } = context;
    const appendSideshotSection = (title: string, sideshots: typeof outputSideshots): void => {
      if (sideshots.length === 0) return;
      lines.push(`--- ${title} ---`);
      const rows = sideshots.map((s) => ({
        from: s.from,
        to: s.to,
        line: s.sourceLine != null ? String(s.sourceLine) : '-',
        mode: s.mode,
        source: s.sourceType ?? '-',
        relation:
          s.sourceType === 'GS' ? (s.relationFrom ? `FROM=${s.relationFrom}` : 'standalone') : '-',
        az: s.azimuth != null ? radToDmsStr(s.azimuth) : '-',
        azSrc: s.azimuthSource ?? '-',
        hd: (s.horizDistance * unitScale).toFixed(4),
        dH: s.deltaH != null ? (s.deltaH * unitScale).toFixed(4) : '-',
        northing: s.northing != null ? (s.northing * unitScale).toFixed(4) : '-',
        easting: s.easting != null ? (s.easting * unitScale).toFixed(4) : '-',
        height: s.height != null ? (s.height * unitScale).toFixed(4) : '-',
        sigmaN: s.sigmaN != null ? (s.sigmaN * unitScale).toFixed(4) : '-',
        sigmaE: s.sigmaE != null ? (s.sigmaE * unitScale).toFixed(4) : '-',
        sigmaH: s.sigmaH != null ? (s.sigmaH * unitScale).toFixed(4) : '-',
        note: s.note ?? '-',
      }));
      const header = {
        from: 'From',
        to: 'To',
        line: 'Line',
        mode: 'Mode',
        source: 'Source',
        relation: 'Relation',
        az: 'Az',
        azSrc: 'AzSrc',
        hd: `HD(${linearUnit})`,
        dH: `dH(${linearUnit})`,
        northing: `Northing(${linearUnit})`,
        easting: `Easting(${linearUnit})`,
        height: `Height(${linearUnit})`,
        sigmaN: `σN(${linearUnit})`,
        sigmaE: `σE(${linearUnit})`,
        sigmaH: `σH(${linearUnit})`,
        note: 'Note',
      };
      const widths = {
        from: Math.max(header.from.length, ...rows.map((r) => r.from.length)),
        to: Math.max(header.to.length, ...rows.map((r) => r.to.length)),
        line: Math.max(header.line.length, ...rows.map((r) => r.line.length)),
        mode: Math.max(header.mode.length, ...rows.map((r) => r.mode.length)),
        source: Math.max(header.source.length, ...rows.map((r) => r.source.length)),
        relation: Math.max(header.relation.length, ...rows.map((r) => r.relation.length)),
        az: Math.max(header.az.length, ...rows.map((r) => r.az.length)),
        azSrc: Math.max(header.azSrc.length, ...rows.map((r) => r.azSrc.length)),
        hd: Math.max(header.hd.length, ...rows.map((r) => r.hd.length)),
        dH: Math.max(header.dH.length, ...rows.map((r) => r.dH.length)),
        northing: Math.max(header.northing.length, ...rows.map((r) => r.northing.length)),
        easting: Math.max(header.easting.length, ...rows.map((r) => r.easting.length)),
        height: Math.max(header.height.length, ...rows.map((r) => r.height.length)),
        sigmaN: Math.max(header.sigmaN.length, ...rows.map((r) => r.sigmaN.length)),
        sigmaE: Math.max(header.sigmaE.length, ...rows.map((r) => r.sigmaE.length)),
        sigmaH: Math.max(header.sigmaH.length, ...rows.map((r) => r.sigmaH.length)),
        note: Math.max(header.note.length, ...rows.map((r) => r.note.length)),
      };
      const pad = (value: string, size: number) => value.padEnd(size, ' ');
      lines.push(
        [
          pad(header.from, widths.from),
          pad(header.to, widths.to),
          pad(header.line, widths.line),
          pad(header.mode, widths.mode),
          pad(header.source, widths.source),
          pad(header.relation, widths.relation),
          pad(header.az, widths.az),
          pad(header.azSrc, widths.azSrc),
          pad(header.hd, widths.hd),
          pad(header.dH, widths.dH),
          pad(header.northing, widths.northing),
          pad(header.easting, widths.easting),
          pad(header.height, widths.height),
          pad(header.sigmaN, widths.sigmaN),
          pad(header.sigmaE, widths.sigmaE),
          pad(header.sigmaH, widths.sigmaH),
          pad(header.note, widths.note),
        ].join('  '),
      );
      rows.forEach((r) => {
        lines.push(
          [
            pad(r.from, widths.from),
            pad(r.to, widths.to),
            pad(r.line, widths.line),
            pad(r.mode, widths.mode),
            pad(r.source, widths.source),
            pad(r.relation, widths.relation),
            pad(r.az, widths.az),
            pad(r.azSrc, widths.azSrc),
            pad(r.hd, widths.hd),
            pad(r.dH, widths.dH),
            pad(r.northing, widths.northing),
            pad(r.easting, widths.easting),
            pad(r.height, widths.height),
            pad(r.sigmaN, widths.sigmaN),
            pad(r.sigmaE, widths.sigmaE),
            pad(r.sigmaH, widths.sigmaH),
            pad(r.note, widths.note),
          ].join('  '),
        );
      });
      lines.push('');
    };
    appendSideshotSection('Post-Adjusted Sideshots (TS)', outputTsSideshots);
    appendSideshotSection('Post-Adjusted GPS Sideshot Vectors', outputGpsVectorSideshots);
    appendSideshotSection('Post-Adjusted GNSS Topo Coordinates (GS)', outputGpsCoordinateSideshots);
    const appendGpsLoopSection = (): void => {
      if (!gpsLoopDiagnostics?.enabled) return;
      lines.push('--- GPS Loop Diagnostics ---');
      lines.push(
        `vectors=${gpsLoopDiagnostics.vectorCount}, loops=${gpsLoopDiagnostics.loopCount}, pass=${gpsLoopDiagnostics.passCount}, warn=${gpsLoopDiagnostics.warnCount}, tolerance=${(gpsLoopDiagnostics.thresholds.baseToleranceM * unitScale).toFixed(4)}${linearUnit}+${gpsLoopDiagnostics.thresholds.ppmTolerance}ppm*dist`,
      );
      const rows = gpsLoopDiagnostics.loops.map((loop) => ({
        rank: String(loop.rank),
        key: loop.key,
        status: loop.pass ? 'PASS' : 'WARN',
        closure: (loop.closureMag * unitScale).toFixed(4),
        tolerance: (loop.toleranceM * unitScale).toFixed(4),
        ppm: loop.linearPpm != null ? loop.linearPpm.toFixed(1) : '-',
        ratio: loop.closureRatio != null ? `1:${loop.closureRatio.toFixed(0)}` : '-',
        severity: loop.severity.toFixed(2),
        lines: loop.sourceLines.length > 0 ? loop.sourceLines.join(',') : '-',
        path: loop.stationPath.join('->'),
      }));
      const header = {
        rank: '#',
        key: 'Loop',
        status: 'Status',
        closure: `Closure(${linearUnit})`,
        tolerance: `Tol(${linearUnit})`,
        ppm: 'Linear(ppm)',
        ratio: 'Ratio',
        severity: 'Severity',
        lines: 'Lines',
        path: 'Path',
      };
      const widths = {
        rank: Math.max(header.rank.length, ...rows.map((r) => r.rank.length)),
        key: Math.max(header.key.length, ...rows.map((r) => r.key.length)),
        status: Math.max(header.status.length, ...rows.map((r) => r.status.length)),
        closure: Math.max(header.closure.length, ...rows.map((r) => r.closure.length)),
        tolerance: Math.max(header.tolerance.length, ...rows.map((r) => r.tolerance.length)),
        ppm: Math.max(header.ppm.length, ...rows.map((r) => r.ppm.length)),
        ratio: Math.max(header.ratio.length, ...rows.map((r) => r.ratio.length)),
        severity: Math.max(header.severity.length, ...rows.map((r) => r.severity.length)),
        lines: Math.max(header.lines.length, ...rows.map((r) => r.lines.length)),
        path: Math.max(header.path.length, ...rows.map((r) => r.path.length)),
      };
      const pad = (value: string, size: number) => value.padEnd(size, ' ');
      lines.push(
        [
          pad(header.rank, widths.rank),
          pad(header.key, widths.key),
          pad(header.status, widths.status),
          pad(header.closure, widths.closure),
          pad(header.tolerance, widths.tolerance),
          pad(header.ppm, widths.ppm),
          pad(header.ratio, widths.ratio),
          pad(header.severity, widths.severity),
          pad(header.lines, widths.lines),
          pad(header.path, widths.path),
        ].join('  '),
      );
      rows.forEach((row) => {
        lines.push(
          [
            pad(row.rank, widths.rank),
            pad(row.key, widths.key),
            pad(row.status, widths.status),
            pad(row.closure, widths.closure),
            pad(row.tolerance, widths.tolerance),
            pad(row.ppm, widths.ppm),
            pad(row.ratio, widths.ratio),
            pad(row.severity, widths.severity),
            pad(row.lines, widths.lines),
            pad(row.path, widths.path),
          ].join('  '),
        );
      });
      lines.push('');
    };
    appendGpsLoopSection();
};
