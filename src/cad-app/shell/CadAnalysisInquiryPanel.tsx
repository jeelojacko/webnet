import React from 'react';
import type { CadShellActions, CadWorkspaceSnapshot } from './cadShellTypes';
import { buttonClass, inputClass } from '../../components/surveyCad/surveyManagerShared';

interface CadAnalysisInquiryPanelProps {
  snapshot: CadWorkspaceSnapshot;
  actions: CadShellActions;
  analysisId: string;
  pickArmedFor: string | null;
  pickedAnswer: string | null;
}

/**
 * Phase 18U — analysis inquiry: pick a plan point in the viewport (or type
 * E/N) and read the exact metric + band. Answers are honest about misses
 * (outside the source domain / no result) rather than guessing a band.
 */
export const CadAnalysisInquiryPanel: React.FC<CadAnalysisInquiryPanelProps> = ({
  snapshot,
  actions,
  analysisId,
  pickArmedFor,
  pickedAnswer,
}) => {
  const row = snapshot.analysis?.analyses.find((entry) => entry.id === analysisId) ?? null;
  const [x, setX] = React.useState('');
  const [y, setY] = React.useState('');
  const [answer, setAnswer] = React.useState<string | null>(null);
  const armed = pickArmedFor === analysisId;
  if (!row) return null;
  const query = (): void => {
    const px = Number.parseFloat(x);
    const py = Number.parseFloat(y);
    if (!Number.isFinite(px) || !Number.isFinite(py)) {
      setAnswer('Enter numeric E/N values.');
      return;
    }
    setAnswer(
      actions.queryAnalysis?.(analysisId, px, py) ?? 'Analysis inquiry unavailable in this workspace.',
    );
  };
  const shown = pickedAnswer ?? answer;
  return (
    <div className="grid gap-1 rounded border border-slate-700 p-2" data-cad-analysis-inquiry={analysisId}>
      <h4 className="text-[11px] font-semibold text-slate-200">Analysis Inquiry</h4>
      <div className="grid grid-cols-[1fr_1fr_auto_auto] items-end gap-1">
        <label className="grid gap-0.5 text-[11px] text-slate-300">
          <span className="text-slate-400">Easting</span>
          <input aria-label="Analysis inquiry easting" className={inputClass} value={x} onChange={(event) => setX(event.target.value)} />
        </label>
        <label className="grid gap-0.5 text-[11px] text-slate-300">
          <span className="text-slate-400">Northing</span>
          <input aria-label="Analysis inquiry northing" className={inputClass} value={y} onChange={(event) => setY(event.target.value)} />
        </label>
        <button type="button" className={buttonClass} onClick={query}>Query</button>
        <button
          type="button"
          className={buttonClass}
          disabled={!row.calculable}
          title={row.calculable ? 'Pick a plan point in the viewport.' : 'Source must be Current.'}
          onClick={() => actions.startAnalysisPick?.(armed ? null : analysisId)}
        >
          {armed ? 'Cancel Pick' : 'Pick Point'}
        </button>
      </div>
      <p
        className="text-[11px] text-slate-300"
        role="status"
        data-cad-analysis-answer={analysisId}
      >
        {shown ??
          (row.status === 'CURRENT'
            ? 'Pick or type a point for the exact metric and band.'
            : `${row.statusText} — calculate the analysis to query exact band membership.`)}
      </p>
    </div>
  );
};
