import React from 'react';
import type { LandXmlImportPreview, LandXmlImportUnits } from '../../engine/landxmlImport';
import { LANDXML_CRS_NOTICE, buildLandXmlImportCounts, describeLandXmlUnits } from './landXmlImportReview.format';

/**
 * Section 1 of the LandXML Import Review: identity, version, units, CRS
 * notice, and category counts. Dense definition-list layout.
 */
export const LandXmlImportReviewSummary = ({
  fileName,
  version,
  units,
  crs,
  preview,
}: {
  fileName: string;
  version: string;
  units: LandXmlImportUnits;
  crs: string;
  preview: LandXmlImportPreview;
}): React.JSX.Element => {
  const counts = buildLandXmlImportCounts(preview);
  return (
    <section aria-label="LandXML document summary" className="rounded border border-slate-700 p-2">
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-[12px]" data-landxml-import-summary>
        <dt className="text-slate-400">File</dt>
        <dd className="truncate" title={fileName} data-landxml-import-filename>{fileName}</dd>
        <dt className="text-slate-400">LandXML version</dt>
        <dd>{version}</dd>
        <dt className="text-slate-400">Units</dt>
        <dd data-landxml-import-units>{describeLandXmlUnits(units)}</dd>
        <dt className="text-slate-400">CRS</dt>
        <dd>
          {crs}
          <span className="ml-2 italic text-amber-300">{LANDXML_CRS_NOTICE}</span>
        </dd>
      </dl>
      <div className="mt-2 flex flex-wrap gap-1" aria-label="Imported object counts">
        {counts.map((row) => (
          <span key={row.label} className="rounded border border-slate-600 bg-slate-800 px-2 py-0.5 text-[11px]">
            {`${row.label}: ${row.count}`}
          </span>
        ))}
      </div>
    </section>
  );
};
