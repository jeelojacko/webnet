import type { ImportedLegalComponent, ImportedLegalDocument, StudyDataSnapshot } from '../studyTypes';
import type {
  StudySearchDiagnostics,
  StudySearchIndexMetadata,
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

/**
 * Tauri native arm signal (Phase 2G). Posted synchronously by
 * `StudySearchService` the moment it creates the worker on the native
 * backend — before the async native bootstrap resolves (or fails). Once
 * armed, the worker lifetime is native-only: any browser-path message
 * (`initialize`/`rebuild`/`study-bulk-update`/`diagnostics`) or any
 * search/rebuild/update without a successful `native-bootstrap` emits an
 * error and never opens IndexedDB (fail-closed).
 */
export type StudySearchNativeArmMessage = {
  type: 'native-arm';
  requestId: string;
};

/**
 * Tauri native bootstrap (Phase 2G). The main-thread service supplies
 * authoritative records from native StudyStorage plus the cached derived
 * artifacts read over native IPC — the worker never opens IndexedDB on this
 * path. MiniSearch algorithm, validity, and ordering semantics are identical
 * to the browser path.
 */
export type StudySearchNativeBootstrapMessage = {
  type: 'native-bootstrap';
  requestId: string;
  forceRebuild: boolean;
  expectedDbVersion: number;
  snapshot: StudyDataSnapshot;
  legalDocuments: ImportedLegalDocument[];
  legalComponents: ImportedLegalComponent[];
  cachedMetadata: StudySearchIndexMetadata | null;
  cachedOfficialSerialized: string | null;
  cachedStudySerialized: string | null;
};

/**
 * Tauri native study-only refresh (bulk-unit-update equivalent). Rebuilds
 * just the study index from a fresh native snapshot; requires a prior
 * `native-bootstrap` in the same worker lifetime (fail-closed otherwise).
 */
export type StudySearchNativeStudyUpdateMessage = {
  type: 'native-study-update';
  requestId: string;
  expectedDbVersion: number;
  snapshot: StudyDataSnapshot;
  cachedMetadata: StudySearchIndexMetadata | null;
};

export type StudySearchWorkerRequest =
  | StudySearchNativeArmMessage
  | StudySearchInitializeMessage
  | StudySearchQueryMessage
  | StudySearchRebuildMessage
  | StudySearchBulkUpdateMessage
  | StudySearchDiagnosticsMessage
  | StudySearchNativeBootstrapMessage
  | StudySearchNativeStudyUpdateMessage;

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
  | StudySearchDiagnosticsResponseMessage
  | StudySearchNativePersistMessage;

/**
 * Tauri native artifact write-back (Phase 2G). The worker computed fresh
 * derived artifacts from the bootstrapped records; the main-thread service
 * persists them over native IPC/SQLite. Null serializations mean "keep the
 * stored artifact" (study-only refresh leaves the official artifact alone).
 */
export type StudySearchNativePersistMessage = {
  type: 'native-persist';
  requestId: string;
  metadata: StudySearchIndexMetadata;
  officialSerialized: string | null;
  studySerialized: string | null;
};
