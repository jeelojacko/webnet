// Exam Prep — Lookup Drills view.
//
// Renders the 24 frozen lookup drills through the shared ExamDrillCard with
// no persistence and no answer leakage before Reveal. Each drill is an
// independent card; session state (timer, textarea, reveal) is UI-only.

import { EXAM_PREP_MANIFEST } from '../examPrepManifest';
import { ExamDrillCard } from './examDrillCard';

export type ExamPrepDrillsViewProps = {
  onOpenProvision: (_documentId: string, _sourceKey: string) => void;
};

export const ExamPrepDrillsView = ({ onOpenProvision }: ExamPrepDrillsViewProps) => {
  const drills = EXAM_PREP_MANIFEST.units.filter((unit) => unit.tier === 'DRILL');
  return (
    <div className="space-y-2">
      <h3 className="text-sm font-semibold uppercase tracking-wide text-emerald-300">
        Lookup Drills
        <span className="ml-2 font-normal normal-case text-slate-500">
          {drills.length} drills · session-only, nothing saved
        </span>
      </h3>
      <div className="space-y-2">
        {drills.map((unit) => (
          <ExamDrillCard key={unit.id} unit={unit} onOpenProvision={onOpenProvision} />
        ))}
      </div>
    </div>
  );
};
