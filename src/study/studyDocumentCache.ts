// Study — per-document official legal-component load cache.
//
// The official legal text is stored authoritatively in IndexedDB and loaded
// on demand (never at app startup). Documents are re-read on every mount of
// the reader/library pages, which re-runs full `legalComponents` index scans.
// This cache is an in-memory, per-storage-instance perf layer: the first
// request for a document issues ONE IndexedDB read (deduplicated while
// in-flight) and later requests resolve from memory. It is invalidated at the
// exact seams that rewrite `legalComponents` (`replaceAll` — import + delete
// all — and `importOfficialContentPackage`). It is intentionally NOT a
// durability layer: another tab importing the official package can still make
// cached entries stale until the next invalidation, and per-record reads
// (`getLegalComponent`, `getLegalComponentsBySourceKeys`) stay uncached so
// source-review acknowledgements always see fresh rows.

import type { ImportedLegalComponent } from './studyTypes';

type Loader = (_documentId: string) => Promise<ImportedLegalComponent[]>;

export class StudyDocumentComponentCache {
  private entries = new Map<string, Promise<ImportedLegalComponent[]>>();

  /** Returns the shared (possibly in-flight) load for a document. */
  get(documentId: string, loader: Loader): Promise<ImportedLegalComponent[]> {
    const existing = this.entries.get(documentId);
    if (existing) return existing;
    const promise = loader(documentId).catch((error: unknown) => {
      // Drop failed loads so a later request can retry the underlying read.
      this.entries.delete(documentId);
      throw error;
    });
    this.entries.set(documentId, promise);
    return promise;
  }

  has(documentId: string): boolean {
    return this.entries.has(documentId);
  }

  /** Drops every cached document; the next read hits IndexedDB again. */
  invalidateAll(): void {
    this.entries.clear();
  }

  get cachedDocumentIds(): string[] {
    return Array.from(this.entries.keys());
  }
}
