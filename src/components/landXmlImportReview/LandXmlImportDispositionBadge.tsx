import React from 'react';
import type { LandXmlImportDisposition } from './landXmlImportReview.types';
import { describeLandXmlDisposition } from './landXmlImportReview.format';

const CLASS_BY_DISPOSITION: Record<LandXmlImportDisposition, string> = {
  IMPORTABLE: 'border-emerald-600 bg-emerald-950 text-emerald-200',
  WARNING: 'border-amber-500 bg-amber-950 text-amber-200',
  UNSUPPORTED: 'border-orange-500 bg-orange-950 text-orange-200',
  BLOCKED: 'border-red-600 bg-red-950 text-red-200',
};

/** Disposition badge: WARNING / UNSUPPORTED / BLOCKED differ in text + colour. */
export const LandXmlImportDispositionBadge = ({
  disposition,
  reasonCode,
}: {
  disposition: LandXmlImportDisposition;
  reasonCode?: string;
}): React.JSX.Element => (
  <span
    className={`rounded border px-1.5 py-0.5 text-[10px] uppercase tracking-wide ${CLASS_BY_DISPOSITION[disposition]}`}
    data-landxml-disposition={disposition}
    title={reasonCode}
  >
    {describeLandXmlDisposition(disposition)}
    {reasonCode ? <span className="ml-1 normal-case opacity-80">{reasonCode}</span> : null}
  </span>
);
