/**
 * Phase 20C Wave-4B — grading-GROUP inquiry panel.
 *
 * Renders the deterministic Wave-3 group inquiry report for one group row and
 * offers the per-corner/per-station CSV. A non-CURRENT row answers honestly
 * (status reason, no stale numbers). Summary + corner table come from the
 * shared report builder, so the panel and CSV cannot drift.
 */
import React from 'react';
import { saveBrowserTextFile } from '../../engine/browserFileIo';
import {
  buildGroupCsv,
  buildGroupCsvFilename,
  buildGroupInquiryReport,
} from './cadGradingGroupReport';
import type {
  CadGradingGroup,
  CadGradingGroupResult,
  GroupStatus,
} from '../../engine/cad/grading/gradingGroupTypes';
import type { GradingAccuracy } from '../../engine/cad/grading/gradingTypes';
import { buttonClass } from '../../components/surveyCad/surveyManagerShared';

/** Structural row shape (the group snapshot owns the canonical type). */
export interface CadGradingGroupInquiryRow {
  id: string;
  name: string;
  definition: CadGradingGroup;
  sourceName: string;
  targetName: string;
  status: GroupStatus;
  accuracy: GradingAccuracy | null;
  /** Result held by the cache at the CURRENT revision, else null. */
  result: CadGradingGroupResult | null;
}

export const CadGradingGroupInquiryPanel: React.FC<{ row: CadGradingGroupInquiryRow }> = ({ row }) => {
  const [notice, setNotice] = React.useState<string | null>(null);
  const report = buildGroupInquiryReport(
    row.definition,
    row.sourceName,
    row.targetName,
    row.status,
    row.accuracy,
    row.result,
  );
  const download = (): void => {
    if (row.status !== 'CURRENT' || row.result == null) {
      setNotice('CSV blocked — calculate a CURRENT group result first.');
      return;
    }
    void saveBrowserTextFile(
      buildGroupCsvFilename(row.name),
      buildGroupCsv(row.definition, row.status, row.accuracy, row.result),
      [{ description: 'CSV Files', accept: { 'text/csv': ['.csv'] } }],
    ).then((saved) => setNotice(saved ? 'Grading group CSV saved.' : 'Save cancelled.'));
  };
  return (
    <section className="mt-3 border-t border-slate-700 pt-2" data-cad-grading-group-inquiry={row.id}>
      <div className="mb-1 flex items-center justify-between gap-2">
        <h3 className="text-[12px] font-semibold">Grading Group Inquiry</h3>
        <button type="button" className={buttonClass} onClick={download} data-cad-grading-group-csv>
          Export CSV
        </button>
      </div>
      {notice ? <p role="status" className="mb-1 text-[11px] text-amber-200">{notice}</p> : null}
      <pre className="whitespace-pre-wrap text-[11px] text-slate-300" data-cad-grading-group-inquiry-report>
        {report}
      </pre>
    </section>
  );
};
