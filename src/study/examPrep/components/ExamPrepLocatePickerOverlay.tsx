// Exam Prep Locate — same-tab picker overlay.
//
// Primary picker surface: a near-fullscreen overlay hosting the reusable
// StudyLibrary picker presentation/search/actions WITHOUT unmounting the
// Locate sprint (queue/index/timer/found state stays alive; the elapsed
// timer keeps running while browsing). Picks call straight back into the
// sprint, which freezes feedback; nothing persists until Continue. Closing
// without a pick preserves the current item. Keyed per item by the caller
// so reopening after an advance starts with a fresh empty search.

import StudyLibrary, { type StudyLibraryProps } from '../../components/StudyLibrary';
import { openStudyUrlNewTab, openProvisionNewTab } from '../../studyWindow';
import type { StudyDataSnapshot } from '../../studyTypes';

export type ExamPrepLocatePickerOverlayProps = {
  prompt: string;
  data: StudyDataSnapshot;
  onLoadLegalDocumentComponentSummary: StudyLibraryProps['onLoadLegalDocumentComponentSummary'];
  onPick: (_pick: { documentId: string; sourceKey: string | null }) => void;
  onClose: () => void;
};

export const ExamPrepLocatePickerOverlay = ({
  prompt,
  data,
  onLoadLegalDocumentComponentSummary,
  onPick,
  onClose,
}: ExamPrepLocatePickerOverlayProps) => (
  <div
    role="dialog"
    aria-modal="true"
    aria-label="Locate picker"
    className="fixed inset-0 z-50 overflow-y-auto bg-slate-950/90 p-4"
  >
    <div className="mx-auto max-w-5xl space-y-3 rounded border border-sky-800 bg-slate-900 p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wide text-sky-300">
            Locate picker
          </p>
          <p className="mt-1 text-sm text-sky-100">{prompt}</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded border border-slate-600 bg-slate-800 px-3 py-1.5 text-xs font-semibold text-slate-200 hover:bg-slate-700"
        >
          Close Picker
        </button>
      </div>
      <StudyLibrary
        data={data}
        onSelectDocument={(documentId) => {
          void openStudyUrlNewTab(`/study/document/${encodeURIComponent(documentId)}`);
        }}
        onCreateCustomUnit={() => undefined}
        onEditUnit={() => undefined}
        onPreviewUnit={() => undefined}
        onPracticeUnit={() => undefined}
        onOpenProvision={(documentId, sourceKey) => {
          void openProvisionNewTab(documentId, sourceKey);
        }}
        onDeleteUnit={() => undefined}
        onDuplicateUnit={() => undefined}
        onNavigate={(path) => {
          void openStudyUrlNewTab(path);
        }}
        onLoadLegalDocumentComponentSummary={onLoadLegalDocumentComponentSummary}
        pickerOverlayPrompt={prompt}
        onPickerOverlayPick={onPick}
      />
    </div>
  </div>
);
