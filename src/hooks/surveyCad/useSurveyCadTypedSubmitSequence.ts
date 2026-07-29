import {
  cadBuildParcelReportSummary,
  buildCadMultiInverseSummary,
  cadConvertAreaSquareMeters,
} from '../../engine/cad/cadCogo';
import { parseInputPoint } from './useSurveyCadCommandParsing';
import type { HandleSurveyCadTypedSubmitOptions } from './useSurveyCadTypedSubmit.types';

export const handleSurveyCadSequenceReportSubmit = ({
  consumePoint,
  publishReport,
  replaceSession,
  session,
}: Omit<HandleSurveyCadTypedSubmitOptions, 'applyHistoryUpdate'>): boolean => {
  if (session.key === 'MULTI_INVERSE') {
    if (session.inputValue.trim().length === 0) {
      if (session.points.length < 2) return true;
      const multi = buildCadMultiInverseSummary(session.points);
      publishReport(
        'MULTI_INVERSE',
        'Multi-Point Inverse',
        `Computed ${multi.legs.length} inverse leg${multi.legs.length === 1 ? '' : 's'}`,
        [
          ...multi.legs.flatMap((leg, index) => [
            { label: `Leg ${index + 1}`, value: `${leg.fromLabel} -> ${leg.toLabel}` },
            { label: `Leg ${index + 1} Bearing`, value: leg.bearing },
            { label: `Leg ${index + 1} Distance`, value: leg.distance.toFixed(3), unit: 'm' },
          ]),
          { label: 'Total distance', value: multi.totalDistance.toFixed(3), unit: 'm' },
        ],
      );
      replaceSession({
        ...session,
        points: [],
        resultText: `MULTI_INVERSE reported ${multi.legs.length} legs, total ${multi.totalDistance.toFixed(3)} m.`,
      });
      return true;
    }
    const parsedPoint = parseInputPoint(
      session.inputValue,
      session.points[session.points.length - 1] ?? null,
    );
    if (!parsedPoint) {
      replaceSession({
        ...session,
        resultText:
          'MULTI_INVERSE point input invalid. Use `x,y`, `LABEL=x,y`, `@azimuth,distance`, or survey bearing-distance.',
      });
      return true;
    }
    consumePoint(parsedPoint);
    return true;
  }

  if (session.key === 'AREA') {
    if (session.inputValue.trim().length === 0) {
      if (session.points.length < 3) return true;
      const report = cadBuildParcelReportSummary({
        parcelName: 'Area Sequence',
        vertices: session.points,
        vertexLabels: session.points.map((point) => point.label),
      });
      if (!report) {
        replaceSession({
          ...session,
          resultText: 'AREA could not build a valid loop from the captured point sequence.',
        });
        return true;
      }
      const convertedArea = cadConvertAreaSquareMeters(report.areaSquareMeters);
      publishReport(
        'AREA',
        'Area by Point Sequence',
        `Computed area from ${report.courseCount} side${report.courseCount === 1 ? '' : 's'}.`,
        [
          { label: 'Points', value: session.points.map((point) => point.label).join(' -> ') },
          { label: 'Area', value: report.areaSquareMeters.toFixed(3), unit: 'm2' },
          { label: 'Area (ha)', value: convertedArea.hectares.toFixed(4), unit: 'ha' },
          { label: 'Area (ac)', value: convertedArea.acres.toFixed(4), unit: 'ac' },
          { label: 'Area (ft2)', value: convertedArea.squareFeet.toFixed(3), unit: 'ft2' },
          { label: 'Perimeter', value: report.perimeterMeters.toFixed(3), unit: 'm' },
          { label: 'Closure dN', value: report.closureDeltaY.toFixed(3), unit: 'm' },
          { label: 'Closure dE', value: report.closureDeltaX.toFixed(3), unit: 'm' },
          { label: 'Closure', value: report.closureDistanceMeters.toFixed(3), unit: 'm' },
        ],
      );
      replaceSession({
        ...session,
        points: [],
        resultText: `AREA reported ${report.courseCount} sides, ${report.areaSquareMeters.toFixed(3)} m².`,
      });
      return true;
    }
    const parsedPoint = parseInputPoint(
      session.inputValue,
      session.points[session.points.length - 1] ?? null,
    );
    if (!parsedPoint) {
      replaceSession({
        ...session,
        resultText:
          'AREA point input invalid. Use `x,y`, `LABEL=x,y`, `@azimuth,distance`, or survey bearing-distance.',
      });
      return true;
    }
    consumePoint(parsedPoint);
    return true;
  }

  return false;
};
