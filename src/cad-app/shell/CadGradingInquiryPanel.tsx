/**
 * Phase 20B — grading inquiry panel.
 *
 * Renders the deterministic inquiry report for one grading row and offers
 * the per-station CSV. A non-CURRENT row answers honestly (reason, no stale
 * numbers). No raw arrays in the report body.
 */
import React from 'react';
import { saveBrowserTextFile } from '../../engine/browserFileIo';
import {
  buildGradingCsv,
  buildGradingCsvFilename,
  buildGradingInquiryReport,
} from './cadGradingReport';
import type { CadGradingRow } from './cadGradingSnapshot';
import { buttonClass } from '../../components/surveyCad/surveyManagerShared';

export const CadGradingInquiryPanel: React.FC<{ row: CadGradingRow }> = ({ row }) => {
  const [notice, setNotice] = React.useState<string | null>(null);
  const result = row.currentResult;
  const report = buildGradingInquiryReport(row.definition, row.source, row, result);
  const download = (): void => {
    if (row.status !== 'CURRENT' || result == null || row.source == null) {
      setNotice('CSV blocked — calculate a CURRENT result first.');
      return;
    }
    void saveBrowserTextFile(buildGradingCsvFilename(row.name), buildGradingCsv(row.definition, row.source, result), [
      { description: 'CSV Files', accept: { 'text/csv': ['.csv'] } },
    ]).then((saved) => setNotice(saved ? 'Grading CSV saved.' : 'Save cancelled.'));
  };
  return (
    <section className="mt-3 border-t border-slate-700 pt-2" data-cad-grading-inquiry={row.id}>
      <div className="mb-1 flex items-center justify-between gap-2">
        <h3 className="text-[12px] font-semibold">Grading Inquiry</h3>
        <button type="button" className={buttonClass} onClick={download} data-cad-grading-csv>
          Export CSV
        </button>
      </div>
      {notice ? <p role="status" className="mb-1 text-[11px] text-amber-200">{notice}</p> : null}
      <pre className="whitespace-pre-wrap text-[11px] text-slate-300" data-cad-grading-inquiry-report>
        {report}
      </pre>
    </section>
  );
};
