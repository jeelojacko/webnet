// Exam Prep — Lookup Drills view.
//
// Renders the 24 frozen lookup drills through the shared ExamDrillCard. Each
// drill is an independent card; session state (timer, textarea, reveal) is
// UI-only. Phase 2 persistence: attempts (immutable drill self-assessments)
// drive each card's readiness summary and Save Result panel. Answer keys stay
// hidden before Reveal.

import type { ExamPrepAttempt, ExamPrepDrillAttempt } from '../examPrepTypes';
import { EXAM_PREP_MANIFEST } from '../examPrepManifest';
import { ExamDrillCard } from './examDrillCard';

export type ExamPrepDrillsViewProps = {
  attempts: ExamPrepAttempt[];
  onOpenProvision: (_documentId: string, _sourceKey: string) => void;
  onSaveDrillAttempt: (_attempt: ExamPrepDrillAttempt) => Promise<void>;
};

export const ExamPrepDrillsView = ({
  attempts,
  onOpenProvision,
  onSaveDrillAttempt,
}: ExamPrepDrillsViewProps) => {
  const drills = EXAM_PREP_MANIFEST.units.filter((unit) => unit.tier === 'DRILL');
  return (
    <div className="space-y-2">
      <h3 className="text-sm font-semibold uppercase tracking-wide text-emerald-300">
        Lookup Drills
        <span className="ml-2 font-normal normal-case text-slate-500">
          {drills.length} drills · self-assessed results are saved locally
        </span>
      </h3>
      <div className="space-y-2">
        {drills.map((unit) => (
          <ExamDrillCard
            key={unit.id}
            unit={unit}
            onOpenProvision={onOpenProvision}
            attempts={attempts}
            onSaveAttempt={onSaveDrillAttempt}
          />
        ))}
      </div>
    </div>
  );
};
