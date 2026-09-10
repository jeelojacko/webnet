import type {
  StudySearchDiagnostics,
  StudySearchResultSummary,
  StudySearchScope,
  StudySearchStatus,
} from './studySearchTypes';

export type StudySearchInitializeMessage = {
  type: 'initialize';
  requestId: string;
};

export type StudySearchQueryMessage = {
  type: 'search';
  requestId: string;
  query: string;
  scope: StudySearchScope;
  limitPerCategory?: number;
};

export type StudySearchRebuildMessage = {
  type: 'rebuild';
  requestId: string;
};

export type StudySearchBulkUpdateMessage = {
  type: 'study-bulk-update';
  requestId: string;
  upsertUnitIds: string[];
  removeUnitIds: string[];
};

export type StudySearchDiagnosticsMessage = {
  type: 'diagnostics';
  requestId: string;
};

export type StudySearchWorkerRequest =
  | StudySearchInitializeMessage
  | StudySearchQueryMessage
  | StudySearchRebuildMessage
  | StudySearchBulkUpdateMessage
  | StudySearchDiagnosticsMessage;

export type StudySearchReadyMessage = {
  type: 'ready';
  requestId: string;
  status: StudySearchStatus;
};

export type StudySearchProgressMessage = {
  type: 'progress';
  requestId: string;
  status: StudySearchStatus;
};

export type StudySearchResultsMessage = {
  type: 'results';
  requestId: string;
  results: StudySearchResultSummary[];
  elapsedMs: number;
};

export type StudySearchErrorMessage = {
  type: 'error';
  requestId: string;
  message: string;
};

export type StudySearchDiagnosticsResponseMessage = {
  type: 'diagnostics';
  requestId: string;
  diagnostics: StudySearchDiagnostics;
};

export type StudySearchWorkerResponse =
  | StudySearchReadyMessage
  | StudySearchProgressMessage
  | StudySearchResultsMessage
  | StudySearchErrorMessage
  | StudySearchDiagnosticsResponseMessage;
