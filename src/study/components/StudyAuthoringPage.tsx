import { useMemo, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  CheckCircle2,
  FileJson,
  Plus,
  ShieldCheck,
  Trash2,
  XCircle,
} from 'lucide-react';
import type {
  AiLearningObjective,
  AiProposedSourceGroup,
  AiStoredUnitProposal,
  AiStudyDisposition,
  AiStudyMapProposal,
  AiSuggestedPriority,
} from '../ai/studyAiTypes';
import type { StudyDataSnapshot } from '../studyTypes';

type StudyAuthoringPageProps = {
  data: StudyDataSnapshot;
  aiImportText: string;
  onAiImportTextChange: (_text: string) => void;
  onImportAiAuthoring: () => Promise<void>;
  onUpdateMapProposal: (_proposal: AiStudyMapProposal) => Promise<void>;
  onUpdateUnitProposal: (_proposal: AiStoredUnitProposal) => Promise<void>;
  onValidateUnitProposal: (_proposalId: string) => Promise<void>;
  onApproveUnitProposal: (_proposalId: string) => Promise<void>;
  statusMessage: string;
};

type AuthoringTab = 'runs' | 'map' | 'units';

const dispositions: AiStudyDisposition[] = [
  'standalone',
  'combine',
  'split',
  'reference-only',
  'skip',
  'needs-human-review',
];

const priorities: AiSuggestedPriority[] = ['P1', 'P2', 'P3', 'P4'];

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

const moveObjective = (
  proposal: AiStoredUnitProposal,
  objectiveId: string,
  direction: -1 | 1,
): AiStoredUnitProposal => {
  const index = proposal.objectives.findIndex((objective) => objective.id === objectiveId);
  const target = index + direction;
  if (index < 0 || target < 0 || target >= proposal.objectives.length) return proposal;
  const next = [...proposal.objectives];
  [next[index], next[target]] = [next[target], next[index]];
  return { ...proposal, objectives: next };
};

const addObjective = (proposal: AiStoredUnitProposal): AiStoredUnitProposal => {
  const id = `obj-${proposal.objectives.length + 1}-${Date.now().toString(36)}`;
  const firstSourceKey = proposal.sourceKeys[0] ?? '';
  return {
    ...proposal,
    objectives: [
      ...proposal.objectives,
      {
        id,
        type: 'other',
        objective: '',
        guidedQuestion: '',
        studyAnswer: '',
        required: true,
        sourceKeys: firstSourceKey ? [firstSourceKey] : [],
        evidence: [],
        confidence: 'medium',
      },
    ],
  };
};

const deleteObjective = (
  proposal: AiStoredUnitProposal,
  objectiveId: string,
): AiStoredUnitProposal => ({
  ...proposal,
  objectives: proposal.objectives.filter((objective) => objective.id !== objectiveId),
});

const updateMapGroup = (
  proposal: AiStudyMapProposal,
  groupId: string,
  patch: Partial<AiProposedSourceGroup>,
): AiStudyMapProposal => ({
  ...proposal,
  proposedGroups: proposal.proposedGroups.map((group) =>
    group.groupId === groupId ? { ...group, ...patch } : group,
  ),
});

const setMapStatus = (
  proposal: AiStudyMapProposal,
  reviewStatus: AiStudyMapProposal['reviewStatus'],
): AiStudyMapProposal => ({
  ...proposal,
  reviewStatus,
  validationStatus:
    reviewStatus === 'approved' && proposal.validationStatus === 'not-validated'
      ? 'valid'
      : proposal.validationStatus,
});

const sourceTextForProposal = (
  data: StudyDataSnapshot,
  proposal: AiStoredUnitProposal,
): string =>
  data.legalComponents
    .filter(
      (component) =>
        component.documentId === proposal.sourceDocumentId &&
        proposal.sourceKeys.includes(component.sourceKey),
    )
    .map((component) => `${component.label} ${component.heading ?? ''}\n${component.text}`)
    .join('\n\n');

const StudyAuthoringPage = ({
  data,
  aiImportText,
  onAiImportTextChange,
  onImportAiAuthoring,
  onUpdateMapProposal,
  onUpdateUnitProposal,
  onValidateUnitProposal,
  onApproveUnitProposal,
  statusMessage,
}: StudyAuthoringPageProps) => {
  const [activeTab, setActiveTab] = useState<AuthoringTab>('map');
  const [selectedMapId, setSelectedMapId] = useState<string | null>(
    data.aiStudyMapProposals[0]?.id ?? null,
  );
  const [selectedProposalId, setSelectedProposalId] = useState<string | null>(
    data.aiUnitProposals[0]?.proposalId ?? null,
  );
  const mapProposal = data.aiStudyMapProposals.find((entry) => entry.id === selectedMapId);
  const unitProposal = data.aiUnitProposals.find((entry) => entry.proposalId === selectedProposalId);
  const documentById = useMemo(
    () => new Map(data.legalDocuments.map((document) => [document.id, document])),
    [data.legalDocuments],
  );

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-xl font-semibold text-white">Authoring</h2>
        <p className="text-sm text-slate-500">
          Study Map decisions must be reviewed before Unit Authoring jobs are prepared.
        </p>
      </div>
      {statusMessage ? (
        <div className="rounded border border-emerald-800 bg-emerald-950/40 px-4 py-3 text-sm text-emerald-200">
          {statusMessage}
        </div>
      ) : null}
      <section className="grid gap-3 sm:grid-cols-4">
        {[
          ['Runs', data.aiAuthoringRuns.length],
          ['Study Map', data.aiStudyMapProposals.length],
          ['Unit Proposals', data.aiUnitProposals.length],
          [
            'Approved',
            data.aiStudyMapProposals.filter((entry) => entry.reviewStatus === 'approved').length,
          ],
        ].map(([label, value]) => (
          <div key={label} className="rounded border border-slate-800 bg-slate-900 p-4">
            <div className="text-lg font-semibold text-white">{value}</div>
            <div className="text-xs uppercase tracking-wide text-slate-500">{label}</div>
          </div>
        ))}
      </section>
      <section className="rounded border border-slate-800 bg-slate-900 p-4">
        <div className="mb-2 flex items-center gap-2 text-xs uppercase tracking-wide text-slate-500">
          <FileJson size={16} />
          Import AI Authoring JSON
        </div>
        <textarea
          value={aiImportText}
          onChange={(event) => onAiImportTextChange(event.target.value)}
          placeholder='Paste {"runs":[],"mapJobs":[],"mapResults":[],"mapProposals":[],"unitProposals":[]} here.'
          className="min-h-32 w-full rounded border border-slate-700 bg-slate-950 p-3 font-mono text-xs text-slate-300"
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
      <div className="flex flex-wrap gap-2">
        {[
          ['runs', 'Runs'],
          ['map', 'Study Map'],
          ['units', 'Unit Proposals'],
        ].map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setActiveTab(id as AuthoringTab)}
            className={`rounded border px-3 py-2 text-sm ${
              activeTab === id
                ? 'border-emerald-600 bg-emerald-950/30 text-emerald-100'
                : 'border-slate-800 bg-slate-900 text-slate-300 hover:bg-slate-800'
            }`}
          >
            {label}
          </button>
        ))}
      </div>
      {activeTab === 'runs' ? (
        <section className="space-y-2 rounded border border-slate-800 bg-slate-900 p-4">
          {data.aiAuthoringRuns.map((run) => (
            <div key={run.runId} className="rounded border border-slate-800 bg-slate-950 p-3">
              <div className="font-mono text-sm text-emerald-200">{run.runId}</div>
              <div className="mt-1 text-xs text-slate-500">
                {run.jobType} / {run.promptSpecVersion} / jobs {run.jobCount} / valid{' '}
                {run.completedCount} / invalid {run.invalidCount}
              </div>
            </div>
          ))}
        </section>
      ) : null}
      {activeTab === 'map' ? (
        <section className="grid min-h-[32rem] gap-4 lg:grid-cols-[22rem_minmax(0,1fr)]">
          <div className="space-y-2 overflow-auto rounded border border-slate-800 bg-slate-900 p-3">
            {data.aiStudyMapProposals.map((entry) => (
              <button
                key={entry.id}
                type="button"
                onClick={() => setSelectedMapId(entry.id)}
                className={`block w-full rounded border px-3 py-2 text-left text-sm ${
                  entry.id === selectedMapId
                    ? 'border-emerald-600 bg-emerald-950/30 text-emerald-100'
                    : 'border-slate-800 bg-slate-950 text-slate-300 hover:bg-slate-800'
                }`}
              >
                <div className="font-medium">
                  {entry.targetSectionLabels.join(', ')} {entry.targetHeading ?? ''}
                </div>
                <div className="mt-1 text-xs text-slate-500">
                  {entry.disposition} / {entry.reviewStatus} / {entry.confidence}
                </div>
              </button>
            ))}
          </div>
          {mapProposal ? (
            <div className="space-y-4 rounded border border-slate-800 bg-slate-900 p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="text-xs uppercase tracking-wide text-slate-500">
                    {mapProposal.document.title}
                  </div>
                  <h3 className="mt-1 text-lg font-semibold text-white">
                    {mapProposal.targetSectionLabels.join(', ')} {mapProposal.targetHeading ?? ''}
                  </h3>
                </div>
                <div className="flex flex-wrap gap-2">
                  {[
                    ['Approve Map', 'approved'],
                    ['Defer', 'deferred'],
                    ['Reject', 'rejected'],
                    ['Regenerate', 'stale'],
                  ].map(([label, status]) => (
                    <button
                      key={status}
                      type="button"
                      onClick={() =>
                        void onUpdateMapProposal(
                          setMapStatus(mapProposal, status as AiStudyMapProposal['reviewStatus']),
                        )
                      }
                      className="rounded border border-slate-700 px-3 py-2 text-sm text-slate-200 hover:bg-slate-800"
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="grid gap-3 lg:grid-cols-3">
                <label className="text-xs text-slate-400">
                  Disposition
                  <select
                    value={mapProposal.disposition}
                    onChange={(event) =>
                      void onUpdateMapProposal({
                        ...mapProposal,
                        disposition: event.target.value as AiStudyDisposition,
                      })
                    }
                    className="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm text-white"
                  >
                    {dispositions.map((disposition) => (
                      <option key={disposition}>{disposition}</option>
                    ))}
                  </select>
                </label>
                <label className="text-xs text-slate-400">
                  Priority
                  <select
                    value={mapProposal.suggestedPriority ?? 'P3'}
                    onChange={(event) =>
                      void onUpdateMapProposal({
                        ...mapProposal,
                        suggestedPriority: event.target.value as AiSuggestedPriority,
                      })
                    }
                    className="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm text-white"
                  >
                    {priorities.map((priority) => (
                      <option key={priority}>{priority}</option>
                    ))}
                  </select>
                </label>
                <div className="text-xs text-slate-400">
                  Status
                  <div className="mt-1 rounded border border-slate-800 bg-slate-950 px-2 py-1.5 text-sm text-slate-200">
                    {mapProposal.reviewStatus} / {mapProposal.validationStatus}
                  </div>
                </div>
              </div>
              <label className="block text-sm text-slate-300">
                Reason
                <textarea
                  value={mapProposal.reason}
                  onChange={(event) =>
                    void onUpdateMapProposal({ ...mapProposal, reason: event.target.value })
                  }
                  className="mt-1 min-h-20 w-full rounded border border-slate-700 bg-slate-950 px-3 py-2 text-white"
                />
              </label>
              <div className="grid gap-4 lg:grid-cols-2">
                <div>
                  <div className="mb-2 text-xs uppercase tracking-wide text-slate-500">
                    Operative Source
                  </div>
                  <pre className="max-h-96 overflow-auto whitespace-pre-wrap rounded border border-slate-800 bg-slate-950 p-3 text-xs text-slate-300">
                    {mapProposal.operativeSourceText ?? mapProposal.exactSourceText ?? 'No source text imported.'}
                  </pre>
                </div>
                <div className="space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-xs uppercase tracking-wide text-slate-500">
                      Proposed Groups
                    </div>
                    <button
                      type="button"
                      onClick={() =>
                        void onUpdateMapProposal({
                          ...mapProposal,
                          proposedGroups: [
                            ...mapProposal.proposedGroups,
                            {
                              groupId: `group-${mapProposal.proposedGroups.length + 1}`,
                              titleSuggestion: '',
                              sourceKeys: mapProposal.targetSourceKeys,
                              reason: '',
                              approximateLearningGoal: '',
                            },
                          ],
                        })
                      }
                      className="inline-flex items-center gap-1 rounded border border-slate-700 px-2 py-1 text-xs text-slate-200 hover:bg-slate-800"
                    >
                      <Plus size={14} />
                      Add group
                    </button>
                  </div>
                  {mapProposal.proposedGroups.map((group) => (
                    <div key={group.groupId} className="rounded border border-slate-800 bg-slate-950 p-3">
                      <input
                        value={group.titleSuggestion}
                        onChange={(event) =>
                          void onUpdateMapProposal(
                            updateMapGroup(mapProposal, group.groupId, {
                              titleSuggestion: event.target.value,
                            }),
                          )
                        }
                        placeholder="Group title"
                        className="w-full rounded border border-slate-700 bg-slate-900 px-2 py-1.5 text-sm text-white"
                      />
                      <input
                        value={group.sourceKeys.join(', ')}
                        onChange={(event) =>
                          void onUpdateMapProposal(
                            updateMapGroup(mapProposal, group.groupId, {
                              sourceKeys: event.target.value
                                .split(',')
                                .map((value) => value.trim())
                                .filter(Boolean),
                            }),
                          )
                        }
                        placeholder="sourceKey, sourceKey"
                        className="mt-2 w-full rounded border border-slate-700 bg-slate-900 px-2 py-1.5 font-mono text-xs text-white"
                      />
                      <textarea
                        value={group.approximateLearningGoal}
                        onChange={(event) =>
                          void onUpdateMapProposal(
                            updateMapGroup(mapProposal, group.groupId, {
                              approximateLearningGoal: event.target.value,
                            }),
                          )
                        }
                        placeholder="Approximate learning goal"
                        className="mt-2 min-h-16 w-full rounded border border-slate-700 bg-slate-900 px-2 py-1.5 text-sm text-white"
                      />
                    </div>
                  ))}
                  {[...mapProposal.warnings, ...mapProposal.conflictCodes].length > 0 ? (
                    <pre className="max-h-36 overflow-auto rounded bg-slate-950 p-3 text-xs text-amber-200">
                      {[...mapProposal.warnings, ...mapProposal.conflictCodes].join('\n')}
                    </pre>
                  ) : null}
                </div>
              </div>
            </div>
          ) : (
            <div className="rounded border border-slate-800 bg-slate-900 p-4 text-sm text-slate-500">
              Select a Study Map proposal to review.
            </div>
          )}
        </section>
      ) : null}
      {activeTab === 'units' ? (
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
          {unitProposal ? (
            <div className="space-y-4 rounded border border-slate-800 bg-slate-900 p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="text-xs uppercase tracking-wide text-slate-500">
                    {documentById.get(unitProposal.sourceDocumentId)?.officialTitle ??
                      unitProposal.sourceDocumentId}
                  </div>
                  <h3 className="mt-1 text-lg font-semibold text-white">{unitProposal.title}</h3>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => void onValidateUnitProposal(unitProposal.proposalId)}
                    className="inline-flex items-center gap-2 rounded border border-slate-700 px-3 py-2 text-sm text-slate-200 hover:bg-slate-800"
                  >
                    <ShieldCheck size={16} />
                    Validate
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      void onUpdateUnitProposal({ ...unitProposal, reviewStatus: 'deferred' })
                    }
                    className="inline-flex items-center gap-2 rounded border border-slate-700 px-3 py-2 text-sm text-slate-200 hover:bg-slate-800"
                  >
                    <XCircle size={16} />
                    Defer
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      void onUpdateUnitProposal({ ...unitProposal, reviewStatus: 'rejected' })
                    }
                    className="inline-flex items-center gap-2 rounded border border-slate-700 px-3 py-2 text-sm text-slate-200 hover:bg-slate-800"
                  >
                    <Trash2 size={16} />
                    Reject
                  </button>
                  <button
                    type="button"
                    onClick={() => void onApproveUnitProposal(unitProposal.proposalId)}
                    disabled={unitProposal.reviewStatus === 'approved' || unitProposal.validationStatus === 'invalid'}
                    className="inline-flex items-center gap-2 rounded bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:cursor-not-allowed disabled:bg-slate-700"
                  >
                    <CheckCircle2 size={16} />
                    Approve
                  </button>
                </div>
              </div>
              <div className="grid gap-4 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
                <div className="space-y-3">
                  <div className="text-xs uppercase tracking-wide text-slate-500">
                    Official Source
                  </div>
                  <div className="rounded border border-slate-800 bg-slate-950 p-3 text-xs text-slate-300">
                    <div className="font-mono text-emerald-300">{unitProposal.sourceKeys.join(', ')}</div>
                    <pre className="mt-2 max-h-[42rem] overflow-auto whitespace-pre-wrap">
                      {sourceTextForProposal(data, unitProposal) ||
                        'Official source text is loaded on demand in normal Study views; use the source keys above if this imported artifact does not include local legalComponents.'}
                    </pre>
                  </div>
                  {unitProposal.sourceCoverage?.length ? (
                    <div className="rounded border border-slate-800 bg-slate-950 p-3">
                      <div className="mb-2 text-xs uppercase tracking-wide text-slate-500">
                        Source Coverage
                      </div>
                      {unitProposal.sourceCoverage.map((coverage) => (
                        <div key={coverage.sourceKey} className="mb-2 text-xs text-slate-300">
                          <div className="font-mono text-emerald-300">{coverage.sourceKey}</div>
                          {coverage.childLabels?.map((child) => (
                            <div key={child.label} className="mt-1">
                              {child.label} {child.status}
                              {child.objectiveIds?.length ? ` by ${child.objectiveIds.join(', ')}` : ''}
                              {child.reason ? ` - ${child.reason}` : ''}
                            </div>
                          ))}
                        </div>
                      ))}
                    </div>
                  ) : null}
                </div>
                <div className="space-y-4">
                  <div className="grid gap-4 lg:grid-cols-2">
                    <label className="text-sm text-slate-300">
                      Title
                      <input
                        value={unitProposal.title}
                        onChange={(event) =>
                          void onUpdateUnitProposal({ ...unitProposal, title: event.target.value })
                        }
                        className="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-3 py-2 text-white"
                      />
                    </label>
                    <label className="text-sm text-slate-300">
                      Main question
                      <input
                        value={unitProposal.mainQuestion}
                        onChange={(event) =>
                          void onUpdateUnitProposal({
                            ...unitProposal,
                            mainQuestion: event.target.value,
                          })
                        }
                        className="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-3 py-2 text-white"
                      />
                    </label>
                  </div>
                  <label className="block text-sm text-slate-300">
                    AI-authored study summary
                    <textarea
                      value={unitProposal.studySummary}
                      onChange={(event) =>
                        void onUpdateUnitProposal({
                          ...unitProposal,
                          studySummary: event.target.value,
                        })
                      }
                      className="mt-1 min-h-24 w-full rounded border border-slate-700 bg-slate-950 px-3 py-2 text-white"
                    />
                  </label>
                  <div className="space-y-3">
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-xs uppercase tracking-wide text-slate-500">
                        Source-grounded learning objectives
                      </div>
                      <button
                        type="button"
                        onClick={() => void onUpdateUnitProposal(addObjective(unitProposal))}
                        className="inline-flex items-center gap-1 rounded border border-slate-700 px-2 py-1 text-xs text-slate-200 hover:bg-slate-800"
                      >
                        <Plus size={14} />
                        Add objective
                      </button>
                    </div>
                    {unitProposal.objectives.map((objective) => (
                      <div key={objective.id} className="rounded border border-slate-800 bg-slate-950 p-3">
                        <div className="mb-2 flex justify-end gap-1">
                          <button
                            type="button"
                            onClick={() =>
                              void onUpdateUnitProposal(moveObjective(unitProposal, objective.id, -1))
                            }
                            className="rounded border border-slate-700 p-1 text-slate-300 hover:bg-slate-800"
                            title="Move objective up"
                          >
                            <ArrowUp size={14} />
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              void onUpdateUnitProposal(moveObjective(unitProposal, objective.id, 1))
                            }
                            className="rounded border border-slate-700 p-1 text-slate-300 hover:bg-slate-800"
                            title="Move objective down"
                          >
                            <ArrowDown size={14} />
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              void onUpdateUnitProposal(deleteObjective(unitProposal, objective.id))
                            }
                            className="rounded border border-slate-700 p-1 text-slate-300 hover:bg-slate-800"
                            title="Delete objective"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                        <div className="grid gap-3 lg:grid-cols-2">
                          <label className="text-xs text-slate-400">
                            Objective
                            <input
                              value={objective.objective}
                              onChange={(event) =>
                                void onUpdateUnitProposal(
                                  updateObjective(unitProposal, objective.id, {
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
                                  updateObjective(unitProposal, objective.id, {
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
                                updateObjective(unitProposal, objective.id, {
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
                  {unitProposal.validationMessages.length > 0 ? (
                    <pre className="max-h-40 overflow-auto rounded bg-slate-950 p-3 text-xs text-amber-200">
                      {unitProposal.validationMessages.join('\n')}
                    </pre>
                  ) : null}
                </div>
              </div>
            </div>
          ) : (
            <div className="rounded border border-slate-800 bg-slate-900 p-4 text-sm text-slate-500">
              Select a unit proposal to review.
            </div>
          )}
        </section>
      ) : null}
    </div>
  );
};

export default StudyAuthoringPage;
