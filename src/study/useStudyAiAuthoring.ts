import { useCallback, useState, type Dispatch, type SetStateAction } from 'react';
import type { StudyStorage } from './studyStorageTypes';
import type { AiStudyMapJob, AiStudyMapResult, AiStoredUnitProposal } from './ai/studyAiTypes';
import {
  mapResultToProposal,
  reconcileAiStudyMapProposals,
  validateAiStudyMapResult,
  validateAiStudyUnitProposal,
} from './ai/studyAiValidation';
import type { StudyDataSnapshot } from './studyTypes';

const replaceAiUnitProposal = (
  proposals: AiStoredUnitProposal[],
  proposal: AiStoredUnitProposal,
): AiStoredUnitProposal[] => [
  ...proposals.filter((entry) => entry.proposalId !== proposal.proposalId),
  proposal,
];

export const useStudyAiAuthoring = ({
  data,
  storage,
  setData,
  setStatusMessage,
  navigate,
}: {
  data: StudyDataSnapshot | null;
  storage: StudyStorage;
  setData: Dispatch<SetStateAction<StudyDataSnapshot | null>>;
  setStatusMessage: Dispatch<SetStateAction<string>>;
  navigate: (_path: string, _state?: unknown) => void;
}) => {
  const [aiImportText, setAiImportText] = useState('');

  const importAiAuthoringJson = useCallback(async () => {
    if (!data) return;
    const payload = JSON.parse(aiImportText) as {
      runs?: StudyDataSnapshot['aiAuthoringRuns'];
      mapJobs?: AiStudyMapJob[];
      mapResults?: AiStudyMapResult[];
      mapProposals?: StudyDataSnapshot['aiStudyMapProposals'];
      unitProposals?: AiStoredUnitProposal[];
    };
    const jobsById = new Map((payload.mapJobs ?? []).map((job) => [job.jobId, job]));
    const importedMapProposals = payload.mapProposals ?? [];
    const resultProposals = (payload.mapResults ?? []).flatMap((result) => {
      const job = jobsById.get(result.jobId);
      const report = validateAiStudyMapResult(result, job);
      if (!job || !report.valid) return [];
      return [mapResultToProposal({ result, job })];
    });
    const mapProposals = reconcileAiStudyMapProposals([
      ...data.aiStudyMapProposals,
      ...importedMapProposals,
      ...resultProposals,
    ]);
    const nowIso = new Date().toISOString();
    const unitProposals = (payload.unitProposals ?? []).map((proposal) => ({
      ...proposal,
      reviewStatus: proposal.reviewStatus ?? 'generated',
      validationStatus: proposal.validationStatus ?? 'not-validated',
      validationMessages: proposal.validationMessages ?? [],
      conflictCodes: proposal.conflictCodes ?? [],
      createdAt: proposal.createdAt ?? nowIso,
      updatedAt: proposal.updatedAt ?? nowIso,
    }));
    await storage.replaceAiAuthoringArtifacts({
      runs: payload.runs,
      mapProposals,
      unitProposals,
    });
    setData({
      ...data,
      aiAuthoringRuns: payload.runs
        ? [...data.aiAuthoringRuns, ...payload.runs]
        : data.aiAuthoringRuns,
      aiStudyMapProposals: mapProposals,
      aiUnitProposals: [...data.aiUnitProposals, ...unitProposals],
    });
    setAiImportText('');
    setStatusMessage('AI authoring artifacts imported.');
  }, [aiImportText, data, setData, setStatusMessage, storage]);

  const updateAiUnitProposal = useCallback(
    async (proposal: AiStoredUnitProposal) => {
      if (!data) return;
      const updated = { ...proposal, updatedAt: new Date().toISOString() };
      await storage.saveAiUnitProposal(updated);
      setData({
        ...data,
        aiUnitProposals: replaceAiUnitProposal(data.aiUnitProposals, updated),
      });
      setStatusMessage(`AI proposal saved: ${updated.title}.`);
    },
    [data, setData, setStatusMessage, storage],
  );

  const validateAiUnitProposalById = useCallback(
    async (proposalId: string) => {
      if (!data) return;
      const proposal = data.aiUnitProposals.find((entry) => entry.proposalId === proposalId);
      if (!proposal) return;
      const sourceComponents = await storage.getLegalComponentsBySourceKeys(
        proposal.sourceDocumentId,
        proposal.sourceKeys,
      );
      const report = validateAiStudyUnitProposal({
        proposal,
        sourceComponents,
        corpusContentHash: data.legalDocuments.find(
          (entry) => entry.id === proposal.sourceDocumentId,
        )?.contentHash,
      });
      const updated: AiStoredUnitProposal = {
        ...proposal,
        validationStatus: report.valid
          ? report.issues.some((issue) => issue.severity === 'warning')
            ? 'warnings'
            : 'valid'
          : 'invalid',
        reviewStatus: report.valid ? 'validated' : 'needs-review',
        validationMessages: report.issues.map((issue) => `${issue.code}: ${issue.message}`),
        updatedAt: new Date().toISOString(),
      };
      await storage.saveAiUnitProposal(updated);
      setData({
        ...data,
        aiUnitProposals: replaceAiUnitProposal(data.aiUnitProposals, updated),
      });
      setStatusMessage(`AI proposal validation ${updated.validationStatus}.`);
    },
    [data, setData, setStatusMessage, storage],
  );

  const approveAiUnitProposal = useCallback(
    async (proposalId: string) => {
      if (!data) return;
      const proposal = data.aiUnitProposals.find((entry) => entry.proposalId === proposalId);
      if (!proposal) return;
      const sourceComponents = await storage.getLegalComponentsBySourceKeys(
        proposal.sourceDocumentId,
        proposal.sourceKeys,
      );
      const report = validateAiStudyUnitProposal({ proposal, sourceComponents });
      if (!report.valid) {
        const updated = {
          ...proposal,
          validationStatus: 'invalid' as const,
          validationMessages: report.issues.map((issue) => `${issue.code}: ${issue.message}`),
          updatedAt: new Date().toISOString(),
        };
        await storage.saveAiUnitProposal(updated);
        setData({
          ...data,
          aiUnitProposals: replaceAiUnitProposal(data.aiUnitProposals, updated),
        });
        setStatusMessage('AI proposal failed validation and was not approved.');
        return;
      }
      const snapshot = await storage.approveAiUnitProposal({ proposalId, sourceComponents });
      setData({ ...snapshot, legalComponents: [] });
      const unitId = snapshot.aiUnitProposals.find((entry) => entry.proposalId === proposalId)
        ?.approvedUnitId;
      setStatusMessage('AI proposal approved into a normal Study unit.');
      if (unitId) {
        navigate(`/study/unit/${encodeURIComponent(unitId)}/edit`, {
          returnTo: '/study/authoring',
        });
      }
    },
    [data, navigate, setData, setStatusMessage, storage],
  );

  return {
    aiImportText,
    setAiImportText,
    importAiAuthoringJson,
    updateAiUnitProposal,
    validateAiUnitProposalById,
    approveAiUnitProposal,
  };
};
