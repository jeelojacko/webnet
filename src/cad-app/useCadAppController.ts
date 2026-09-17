import { useCallback, useEffect, useMemo, useState, type SetStateAction } from 'react';
import { createBlankCadDrawingDocument } from '../engine/cad/cadDrawingFile';
import type { CadDrawingDocument } from '../engine/cad/cadTypes';
import {
  clearLegacyMigrationCandidate,
  readAdjustmentSource,
  readLatestSourceForProject,
  readLegacyMigrationCandidate,
  type AdjustmentSourceSnapshot,
  type CadSourceRegistryEntry,
} from './cadSourceBridge';
import { importSnapshotIntoCadDrawing } from './cadSnapshotImport';
import { createCleanSession, type CadDocumentSession } from './cadAppTypes';

export interface UseCadAppControllerArgs {
  initialDrawing?: CadDrawingDocument | null;
  initialSourceId?: string | null;
  initialMigrationRequested?: boolean;
}

/**
 * Phase 18A — standalone CAD controller. Owns the active drawing, dirty
 * tracking, WNCAD file I/O, pending-source notices, and dependency identity.
 * No parser/solver/QC state — CAD consumes AdjustmentSourceSnapshot only.
 */
export const useCadAppController = ({
  initialDrawing = null,
  initialSourceId = null,
  initialMigrationRequested = false,
}: UseCadAppControllerArgs = {}) => {
  const [session, setSession] = useState<CadDocumentSession>(() =>
    createCleanSession(initialDrawing ?? createBlankCadDrawingDocument({ units: 'm' }), null),
  );
  const [notice, setNotice] = useState<string | null>(null);
  const [pendingSourceId, setPendingSourceId] = useState<string | null>(initialSourceId);
  const [invalidSourceId, setInvalidSourceId] = useState<string | null>(null);
  const [migrationAvailable, setMigrationAvailable] = useState<boolean>(initialMigrationRequested);

  const pendingSnapshot: AdjustmentSourceSnapshot | null = useMemo(
    () => readAdjustmentSource(pendingSourceId),
    // ponytail: storage re-read per pending id change only; cross-tab writes
    // surface on next navigation, no live subscription needed for Stage 1.
    [pendingSourceId],
  );

  useEffect(() => {
    if (pendingSourceId && !pendingSnapshot) {
      setInvalidSourceId(pendingSourceId);
    } else {
      setInvalidSourceId(null);
    }
  }, [pendingSourceId, pendingSnapshot]);

  const migrationCandidate: CadDrawingDocument | null = useMemo(
    () => (migrationAvailable ? readLegacyMigrationCandidate() : null),
    [migrationAvailable],
  );

  /** Latest published identity for the pending snapshot's project — the "current" the chip compares against. */
  const latestRegistryEntry: CadSourceRegistryEntry | null = useMemo(
    () => readLatestSourceForProject(pendingSnapshot?.projectId ?? null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pendingSnapshot?.sourceId],
  );

  useEffect(() => {
    if (!session.dirty) return;
    const handler = (event: BeforeUnloadEvent): void => {
      event.preventDefault();
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [session.dirty]);

  /** Narrow unsaved guard for Back-to-Adjustment / unload / replace. */
  const requireCleanOrConfirm = useCallback(
    (actionLabel: string): boolean => {
      if (!session.dirty) return true;
      return window.confirm(
        `The CAD drawing has unsaved changes. ${actionLabel} anyway and discard them?`,
      );
    },
    [session.dirty],
  );

  const applyDrawingChange = useCallback((update: SetStateAction<CadDrawingDocument | null>) => {
    setSession((previous) => {
      const next = typeof update === 'function' ? update(previous.drawing) : update;
      if (!next || next === previous.drawing) return previous;
      return { drawing: next, dirty: true, saveTargetName: previous.saveTargetName };
    });
  }, []);

  const applyLifecycleEvent = useCallback((event: 'cad-saved' | 'cad-opened' | 'cad-created', fileName: string | null) => {
    setSession((previous) => ({
      ...previous,
      dirty: false,
      saveTargetName: event === 'cad-saved' ? (fileName ?? previous.saveTargetName) : fileName,
    }));
  }, []);

  const handleImportPendingSource = useCallback(() => {
    if (!pendingSnapshot) return;
    const imported = importSnapshotIntoCadDrawing({
      document: session.drawing,
      snapshot: pendingSnapshot,
    });
    if (!imported.ok) {
      setNotice(imported.message);
      return;
    }
    setSession((previous) => ({ drawing: imported.drawing, dirty: true, saveTargetName: previous.saveTargetName }));
    setNotice(
      `Imported ${pendingSnapshot.stationCount} adjusted stations from ${pendingSnapshot.projectName ?? pendingSnapshot.projectId}.`,
    );
  }, [pendingSnapshot, session.drawing]);

  const handleDismissPendingSource = useCallback(() => {
    setPendingSourceId(null);
    try {
      const url = new URL(window.location.href);
      url.searchParams.delete('source');
      window.history.replaceState(null, '', url.pathname + (url.search ? url.search : ''));
    } catch {
      // URL cleanup is best-effort; dismissal itself already applied.
    }
  }, []);

  const handleOpenMigrationCandidate = useCallback(() => {
    if (!migrationCandidate) return;
    if (!requireCleanOrConfirm('Replace the current drawing with the legacy drawing')) return;
    setSession(createCleanSession(migrationCandidate, null));
    clearLegacyMigrationCandidate();
    setMigrationAvailable(false);
    setNotice('Opened the legacy CAD drawing. Review dependencies before exporting.');
  }, [migrationCandidate, requireCleanOrConfirm]);

  const handleDismissMigrationCandidate = useCallback(() => {
    clearLegacyMigrationCandidate();
    setMigrationAvailable(false);
  }, []);

  return {
    session,
    notice,
    pendingSnapshot,
    invalidSourceId,
    migrationCandidate,
    latestRegistryEntry,
    applyDrawingChange,
    applyLifecycleEvent,
    handleImportPendingSource,
    handleDismissPendingSource,
    handleOpenMigrationCandidate,
    handleDismissMigrationCandidate,
    requireCleanOrConfirm,
  };
};

export type CadAppController = ReturnType<typeof useCadAppController>;
