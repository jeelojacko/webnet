import React, { useMemo } from 'react';
import {
  cadConvertAreaSquareMeters,
  type CadParcelReportSummary,
} from '../../engine/cad/cadCogo';

export const SurveyCadParcelReportOverlay: React.FC<{
  selectedParcelReport: CadParcelReportSummary | null;
  hasTopRightOverlay: boolean;
}> = ({ selectedParcelReport, hasTopRightOverlay }) => {
  const selectedParcelAreaUnits = useMemo(
    () =>
      selectedParcelReport
        ? cadConvertAreaSquareMeters(selectedParcelReport.areaSquareMeters)
        : null,
    [selectedParcelReport],
  );

  if (!selectedParcelReport) return null;

  return (
    <div
      className={`pointer-events-none absolute right-3 z-10 max-h-[calc(100%-8rem)] w-[19rem] overflow-hidden rounded border border-slate-800/80 bg-slate-950/88 p-3 text-[11px] text-slate-200 shadow-xl backdrop-blur-[1px] ${
        hasTopRightOverlay ? 'top-[22rem]' : 'top-16'
      }`}
      data-survey-cad-parcel-report
    >
      <div className="pb-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-cyan-200">
        {selectedParcelReport.parcelName}
      </div>
      <div className="grid grid-cols-[auto,1fr] gap-x-3 gap-y-1 text-[11px] leading-4">
        <span className="text-slate-400">Area</span>
        <span>{selectedParcelReport.areaSquareMeters.toFixed(3)} m²</span>
        <span className="text-slate-400">Area (ha)</span>
        <span>{selectedParcelAreaUnits?.hectares.toFixed(4)} ha</span>
        <span className="text-slate-400">Area (ac)</span>
        <span>{selectedParcelAreaUnits?.acres.toFixed(4)} ac</span>
        <span className="text-slate-400">Area (ft²)</span>
        <span>{selectedParcelAreaUnits?.squareFeet.toFixed(3)} ft²</span>
        <span className="text-slate-400">Perimeter</span>
        <span>{selectedParcelReport.perimeterMeters.toFixed(3)} m</span>
        <span className="text-slate-400">Closure dN</span>
        <span>{selectedParcelReport.closureDeltaY.toFixed(3)} m</span>
        <span className="text-slate-400">Closure dE</span>
        <span>{selectedParcelReport.closureDeltaX.toFixed(3)} m</span>
        <span className="text-slate-400">Closure</span>
        <span>{selectedParcelReport.closureDistanceMeters.toFixed(3)} m</span>
      </div>
      <div className="pt-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400">
        Courses
      </div>
      <div className="pt-1">
        {selectedParcelReport.courses.map((course, index) => (
          <div
            key={`${course.fromLabel}-${course.toLabel}-${index + 1}`}
            className="grid grid-cols-[4.75rem_1fr_auto] gap-x-2 py-0.5 text-[11px] leading-4"
            data-survey-cad-parcel-course
          >
            <span className="text-slate-400">{course.fromLabel}-{course.toLabel}</span>
            <span>
              {course.bearing}
              <span className="pl-2 text-[10px] text-slate-400">{course.azimuthText}</span>
            </span>
            <span>{course.distanceMeters.toFixed(3)} m</span>
          </div>
        ))}
      </div>
    </div>
  );
};
