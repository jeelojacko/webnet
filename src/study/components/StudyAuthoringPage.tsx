import { useMemo, useState } from 'react';
import { CheckCircle2, FileJson, ShieldCheck } from 'lucide-react';
import type { AiLearningObjective, AiStoredUnitProposal } from '../ai/studyAiTypes';
import type { StudyDataSnapshot } from '../studyTypes';

type StudyAuthoringPageProps = {
  data: StudyDataSnapshot;
  aiImportText: string;
  onAiImportTextChange: (_text: string) => void;
  onImportAiAuthoring: () => Promise<void>;
  onUpdateUnitProposal: (_proposal: AiStoredUnitProposal) => Promise<void>;
  onValidateUnitProposal: (_proposalId: string) => Promise<void>;
  onApproveUnitProposal: (_proposalId: string) => Promise<void>;
  statusMessage: string;
};

const updateObjective = (
  proposal: AiStoredUnitProposal,
  objectiveId: string,
  patch: Partial<AiLearningObjective>,
): AiStoredUnitProposal => ({
  ...proposal,
  objectives: proposal.objectives.map((objective) =>
    objective.id === objectiveId ? { ...objective, ...patch } : objective,
  ),
});

const StudyAuthoringPage = ({
  data,
  aiImportText,
  onAiImportTextChange,
  onImportAiAuthoring,
  onUpdateUnitProposal,
  onValidateUnitProposal,
  onApproveUnitProposal,
  statusMessage,
}: StudyAuthoringPageProps) => {
  const [selectedProposalId, setSelectedProposalId] = useState<string | null>(
    data.aiUnitProposals[0]?.proposalId ?? null,
  );
  const proposal = data.aiUnitProposals.find((entry) => entry.proposalId === selectedProposalId);
  const documentById = useMemo(
    () => new Map(data.legalDocuments.map((document) => [document.id, document])),
    [data.legalDocuments],
  );

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-xl font-semibold text-white">Authoring</h2>
        <p className="text-sm text-slate-500">
          AI-generated plans and proposals stay here until explicitly approved.
        </p>
      </div>
      {statusMessage ? (
        <div className="rounded border border-emerald-800 bg-emerald-950/40 px-4 py-3 text-sm text-emerald-200">
          {statusMessage}
        </div>
      ) : null}
      <section className="grid gap-3 sm:grid-cols-4">
        <div className="rounded border border-slate-800 bg-slate-900 p-4">
          <div className="text-lg font-semibold text-white">{data.aiAuthoringRuns.length}</div>
          <div className="text-xs uppercase tracking-wide text-slate-500">Runs</div>
        </div>
        <div className="rounded border border-slate-800 bg-slate-900 p-4">
          <div className="text-lg font-semibold text-white">{data.aiStudyMapProposals.length}</div>
          <div className="text-xs uppercase tracking-wide text-slate-500">Study Map</div>
        </div>
        <div className="rounded border border-slate-800 bg-slate-900 p-4">
          <div className="text-lg font-semibold text-white">{data.aiUnitProposals.length}</div>
          <div className="text-xs uppercase tracking-wide text-slate-500">Unit Proposals</div>
        </div>
        <div className="rounded border border-slate-800 bg-slate-900 p-4">
          <div className="text-lg font-semibold text-white">
            {data.aiUnitProposals.filter((entry) => entry.reviewStatus === 'approved').length}
          </div>
          <div className="text-xs uppercase tracking-wide text-slate-500">Approved</div>
        </div>
      </section>
      <section className="rounded border border-slate-800 bg-slate-900 p-4">
        <div className="mb-2 flex items-center gap-2 text-xs uppercase tracking-wide text-slate-500">
          <FileJson size={16} />
          Import AI Authoring JSON
        </div>
        <textarea
          value={aiImportText}
          onChange={(event) => onAiImportTextChange(event.target.value)}
          placeholder='Paste {"runs":[],"mapJobs":[],"mapResults":[],"unitProposals":[]} here.'
          className="min-h-36 w-full rounded border border-slate-700 bg-slate-950 p-3 font-mono text-xs text-slate-300"
        />
        <button
          type="button"
          onClick={() => void onImportAiAuthoring()}
          disabled={!aiImportText.trim()}
          className="mt-3 rounded bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:cursor-not-allowed disabled:bg-slate-700"
        >
          Import Proposals
        </button>
      </section>
      <section className="grid min-h-[32rem] gap-4 lg:grid-cols-[22rem_minmax(0,1fr)]">
        <div className="space-y-2 overflow-auto rounded border border-slate-800 bg-slate-900 p-3">
          {data.aiUnitProposals.length === 0 ? (
            <div className="text-sm text-slate-500">No unit proposals imported.</div>
          ) : (
            data.aiUnitProposals.map((entry) => (
              <button
                key={entry.proposalId}
                type="button"
                onClick={() => setSelectedProposalId(entry.proposalId)}
                className={`block w-full rounded border px-3 py-2 text-left text-sm ${
                  entry.proposalId === selectedProposalId
                    ? 'border-emerald-600 bg-emerald-950/30 text-emerald-100'
                    : 'border-slate-800 bg-slate-950 text-slate-300 hover:bg-slate-800'
                }`}
              >
                <div className="font-medium">{entry.title}</div>
                <div className="mt-1 text-xs text-slate-500">
                  {entry.reviewStatus} / {entry.validationStatus} / {entry.confidence}
                </div>
              </button>
            ))
          )}
        </div>
        {proposal ? (
          <div className="space-y-4 rounded border border-slate-800 bg-slate-900 p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="text-xs uppercase tracking-wide text-slate-500">
                  {documentById.get(proposal.sourceDocumentId)?.officialTitle ??
                    proposal.sourceDocumentId}
                </div>
                <h3 className="mt-1 text-lg font-semibold text-white">{proposal.title}</h3>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => void onValidateUnitProposal(proposal.proposalId)}
                  className="inline-flex items-center gap-2 rounded border border-slate-700 px-3 py-2 text-sm text-slate-200 hover:bg-slate-800"
                >
                  <ShieldCheck size={16} />
                  Validate
                </button>
                <button
                  type="button"
                  onClick={() => void onApproveUnitProposal(proposal.proposalId)}
                  disabled={proposal.reviewStatus === 'approved' || proposal.validationStatus === 'invalid'}
                  className="inline-flex items-center gap-2 rounded bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:cursor-not-allowed disabled:bg-slate-700"
                >
                  <CheckCircle2 size={16} />
                  Approve
                </button>
              </div>
            </div>
            <div className="grid gap-4 lg:grid-cols-2">
              <label className="text-sm text-slate-300">
                Title
                <input
                  value={proposal.title}
                  onChange={(event) => void onUpdateUnitProposal({ ...proposal, title: event.target.value })}
                  className="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-3 py-2 text-white"
                />
              </label>
              <label className="text-sm text-slate-300">
                Main question
                <input
                  value={proposal.mainQuestion}
                  onChange={(event) =>
                    void onUpdateUnitProposal({ ...proposal, mainQuestion: event.target.value })
                  }
                  className="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-3 py-2 text-white"
                />
              </label>
            </div>
            <label className="block text-sm text-slate-300">
              AI-authored study summary
              <textarea
                value={proposal.studySummary}
                onChange={(event) =>
                  void onUpdateUnitProposal({ ...proposal, studySummary: event.target.value })
                }
                className="mt-1 min-h-24 w-full rounded border border-slate-700 bg-slate-950 px-3 py-2 text-white"
              />
            </label>
            <div className="space-y-3">
              <div className="text-xs uppercase tracking-wide text-slate-500">
                Source-grounded learning objectives
              </div>
              {proposal.objectives.map((objective) => (
                <div key={objective.id} className="rounded border border-slate-800 bg-slate-950 p-3">
                  <div className="grid gap-3 lg:grid-cols-2">
                    <label className="text-xs text-slate-400">
                      Objective
                      <input
                        value={objective.objective}
                        onChange={(event) =>
                          void onUpdateUnitProposal(
                            updateObjective(proposal, objective.id, {
                              objective: event.target.value,
                            }),
                          )
                        }
                        className="mt-1 w-full rounded border border-slate-700 bg-slate-900 px-2 py-1.5 text-sm text-white"
                      />
                    </label>
                    <label className="text-xs text-slate-400">
                      Guided question
                      <input
                        value={objective.guidedQuestion}
                        onChange={(event) =>
                          void onUpdateUnitProposal(
                            updateObjective(proposal, objective.id, {
                              guidedQuestion: event.target.value,
                            }),
                          )
                        }
                        className="mt-1 w-full rounded border border-slate-700 bg-slate-900 px-2 py-1.5 text-sm text-white"
                      />
                    </label>
                  </div>
                  <label className="mt-2 block text-xs text-slate-400">
                    AI source-grounded study answer
                    <textarea
                      value={objective.studyAnswer}
                      onChange={(event) =>
                        void onUpdateUnitProposal(
                          updateObjective(proposal, objective.id, {
                            studyAnswer: event.target.value,
                          }),
                        )
                      }
                      className="mt-1 min-h-20 w-full rounded border border-slate-700 bg-slate-900 px-2 py-1.5 text-sm text-white"
                    />
                  </label>
                  <details className="mt-2 text-xs text-slate-400">
                    <summary className="cursor-pointer text-slate-300">Grounding evidence</summary>
                    <div className="mt-2 space-y-2">
                      {objective.evidence.map((evidence, index) => (
                        <div key={`${evidence.sourceKey}-${index}`} className="rounded bg-slate-900 p-2">
                          <div className="font-mono text-emerald-300">{evidence.sourceKey}</div>
                          <div className="mt-1 whitespace-pre-wrap">{evidence.evidenceText}</div>
                        </div>
                      ))}
                    </div>
                  </details>
                </div>
              ))}
            </div>
            {proposal.validationMessages.length > 0 ? (
              <pre className="max-h-40 overflow-auto rounded bg-slate-950 p-3 text-xs text-amber-200">
                {proposal.validationMessages.join('\n')}
              </pre>
            ) : null}
          </div>
        ) : (
          <div className="rounded border border-slate-800 bg-slate-900 p-4 text-sm text-slate-500">
            Select a unit proposal to review.
          </div>
        )}
      </section>
    </div>
  );
};

export default StudyAuthoringPage;
