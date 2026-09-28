import React, { useMemo } from 'react';
import {
  cadConvertAreaSquareMeters,
  type CadParcelReportSummary,
} from '../../engine/cad/cadCogo';

/**
 * Phase 21B — Parcel Report block for the shell Properties palette.
 *
 * Migrated from the legacy `SurveyCadParcelReportOverlay` / parcel Properties
 * block: a headed report with area in m²/ha/ac/ft², perimeter/closure, and the
 * straight-line course table. Rounding is byte-identical to the legacy overlay
 * (areas 3/4/4/3, distances 3). Per-course curve metrics stay in the palette's
 * engine `curve:` rows (`parcelInquiryRows`), so they are not duplicated here;
 * arc courses still contribute their truthful chord bearing/length to the
 * course table.
 */
export const CadParcelReportProperties: React.FC<{ report: CadParcelReportSummary }> = ({
  report,
}) => {
  const areaUnits = useMemo(
    () => cadConvertAreaSquareMeters(report.areaSquareMeters),
    [report.areaSquareMeters],
  );
  return (
    <div className="cad-shell-props-group" data-cad-parcel-report={report.parcelName}>
      <h4>Parcel Report</h4>
      <dl>
        <div><dt>Parcel</dt><dd>{report.parcelName}</dd></div>
        <div><dt>Area</dt><dd>{report.areaSquareMeters.toFixed(3)} m²</dd></div>
        <div><dt>Area (ha)</dt><dd>{areaUnits.hectares.toFixed(4)} ha</dd></div>
        <div><dt>Area (ac)</dt><dd>{areaUnits.acres.toFixed(4)} ac</dd></div>
        <div><dt>Area (ft²)</dt><dd>{areaUnits.squareFeet.toFixed(3)} ft²</dd></div>
        <div><dt>Perimeter</dt><dd>{report.perimeterMeters.toFixed(3)} m</dd></div>
        <div><dt>Closure dN</dt><dd>{report.closureDeltaY.toFixed(3)} m</dd></div>
        <div><dt>Closure dE</dt><dd>{report.closureDeltaX.toFixed(3)} m</dd></div>
        <div><dt>Closure</dt><dd>{report.closureDistanceMeters.toFixed(3)} m</dd></div>
      </dl>
      <h4>Courses</h4>
      <dl data-cad-parcel-report-courses>
        {report.courses.map((course, index) => (
          <div
            key={`${course.fromLabel}-${course.toLabel}-${index + 1}`}
            data-cad-parcel-report-course={`${course.fromLabel}-${course.toLabel}`}
          >
            <dt>{course.fromLabel}-{course.toLabel}</dt>
            <dd>{course.bearing} · {course.azimuthText} · {course.distanceMeters.toFixed(3)} m</dd>
          </div>
        ))}
      </dl>
    </div>
  );
};
