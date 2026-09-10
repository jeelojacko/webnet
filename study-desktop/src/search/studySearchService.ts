import type { StudySearchWorkerRequest, StudySearchWorkerResponse } from './studySearchMessages';
import type {
  StudySearchDiagnostics,
  StudySearchResultSummary,
  StudySearchScope,
  StudySearchStatus,
} from './studySearchTypes';

type SearchListener = (_results: StudySearchResultSummary[]) => void;
type StatusListener = (_status: StudySearchStatus) => void;

const createRequestId = (): string =>
  `study-search-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

export class StudySearchService {
  private worker: Worker | null = null;
  private latestSearchRequestId = '';
  private resultListeners = new Set<SearchListener>();
  private statusListeners = new Set<StatusListener>();
  private diagnosticsResolvers = new Map<string, (_diagnostics: StudySearchDiagnostics) => void>();

  initialize(): void {
    this.ensureWorker();
    this.post({ type: 'initialize', requestId: createRequestId() });
  }

  search(query: string, scope: StudySearchScope, limitPerCategory = 8): void {
    this.ensureWorker();
    const requestId = createRequestId();
    this.latestSearchRequestId = requestId;
    this.post({ type: 'search', requestId, query, scope, limitPerCategory });
  }

  rebuild(): void {
    this.ensureWorker();
    this.post({ type: 'rebuild', requestId: createRequestId() });
  }

  commitStudyBulkUpdate({
    upsertUnitIds,
    removeUnitIds,
  }: {
    upsertUnitIds: string[];
    removeUnitIds: string[];
  }): void {
    this.ensureWorker();
    this.post({
      type: 'study-bulk-update',
      requestId: createRequestId(),
      upsertUnitIds,
      removeUnitIds,
    });
  }

  requestDiagnostics(): Promise<StudySearchDiagnostics> {
    this.ensureWorker();
    const requestId = createRequestId();
    return new Promise((resolve) => {
      this.diagnosticsResolvers.set(requestId, resolve);
      this.post({ type: 'diagnostics', requestId });
    });
  }

  subscribeResults(listener: SearchListener): () => void {
    this.resultListeners.add(listener);
    return () => this.resultListeners.delete(listener);
  }

  subscribeStatus(listener: StatusListener): () => void {
    this.statusListeners.add(listener);
    return () => this.statusListeners.delete(listener);
  }

  dispose(): void {
    this.worker?.terminate();
    this.worker = null;
  }

  private ensureWorker(): void {
    if (this.worker) return;
    this.worker = new Worker(new URL('./studySearchWorker.ts', import.meta.url), {
      type: 'module',
    });
    this.worker.onmessage = (event: MessageEvent<StudySearchWorkerResponse>) => {
      const message = event.data;
      if (message.type === 'progress' || message.type === 'ready') {
        this.statusListeners.forEach((listener) => listener(message.status));
      }
      if (message.type === 'results' && message.requestId === this.latestSearchRequestId) {
        this.resultListeners.forEach((listener) => listener(message.results));
      }
      if (message.type === 'diagnostics') {
        this.diagnosticsResolvers.get(message.requestId)?.(message.diagnostics);
        this.diagnosticsResolvers.delete(message.requestId);
      }
      if (message.type === 'error') {
        this.statusListeners.forEach((listener) =>
          listener({ ready: false, phase: 'error', message: message.message }),
        );
      }
    };
  }

  private post(message: StudySearchWorkerRequest): void {
    this.worker?.postMessage(message);
  }
}

export const createStudySearchService = (): StudySearchService => new StudySearchService();
