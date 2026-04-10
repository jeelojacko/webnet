import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { WorkspaceDraftSnapshot, WorkspaceRecoveryRecord } from '../appStateTypes';

const DEFAULT_STORAGE_KEY = 'webnet.workspace-recovery.v1';

const canUseLocalStorage = (): boolean =>
  typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';

export const encodeUint8ArrayToBase64 = (bytes: Uint8Array | null): string | null => {
  if (!bytes || bytes.length === 0) return null;
  let binary = '';
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    const chunk = bytes.subarray(index, index + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
};

export const decodeBase64ToUint8Array = (value: string | null | undefined): Uint8Array | null => {
  if (!value) return null;
  try {
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
  } catch {
    return null;
  }
};

const parseRecoveryRecord = (raw: string | null): WorkspaceRecoveryRecord | null => {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as WorkspaceRecoveryRecord | null;
    if (!parsed || parsed.version !== 1 || !parsed.snapshot) return null;
    return parsed;
  } catch {
    return null;
  }
};

interface UseWorkspaceRecoveryArgs {
  snapshot: WorkspaceDraftSnapshot;
  onRecover: (_snapshot: WorkspaceDraftSnapshot) => void;
  storageKey?: string;
  disabled?: boolean;
}

export const useWorkspaceRecovery = ({
  snapshot,
  onRecover,
  storageKey = DEFAULT_STORAGE_KEY,
  disabled = false,
}: UseWorkspaceRecoveryArgs) => {
  const [pendingRecovery, setPendingRecovery] = useState<WorkspaceRecoveryRecord | null>(null);
  const [persistEnabled, setPersistEnabled] = useState(false);
  const [isInitialized, setIsInitialized] = useState(false);
  const [hasStoredDraft, setHasStoredDraft] = useState(false);
  const lastSavedSnapshotRef = useRef<string | null>(null);

  const serializedSnapshot = useMemo(() => JSON.stringify(snapshot), [snapshot]);

  useEffect(() => {
    if (disabled) {
      setPendingRecovery(null);
      setPersistEnabled(false);
      setIsInitialized(true);
      setHasStoredDraft(false);
      lastSavedSnapshotRef.current = null;
      return;
    }
    if (!canUseLocalStorage()) {
      setPersistEnabled(true);
      setIsInitialized(true);
      setHasStoredDraft(false);
      return;
    }
    const record = parseRecoveryRecord(window.localStorage.getItem(storageKey));
    if (record) {
      setPendingRecovery(record);
      setHasStoredDraft(true);
      lastSavedSnapshotRef.current = JSON.stringify(record.snapshot);
    } else {
      setPersistEnabled(true);
      setHasStoredDraft(false);
    }
    setIsInitialized(true);
  }, [disabled, storageKey]);

  useEffect(() => {
    if (disabled || !isInitialized || !persistEnabled || !canUseLocalStorage()) return;
    if (serializedSnapshot === lastSavedSnapshotRef.current) return;
    const record: WorkspaceRecoveryRecord = {
      version: 1,
      savedAt: new Date().toISOString(),
      snapshot,
    };
    window.localStorage.setItem(storageKey, JSON.stringify(record));
    lastSavedSnapshotRef.current = serializedSnapshot;
    setHasStoredDraft(true);
  }, [disabled, isInitialized, persistEnabled, serializedSnapshot, snapshot, storageKey]);

  const recoverDraft = useCallback(() => {
    if (!pendingRecovery) return;
    onRecover(pendingRecovery.snapshot);
    lastSavedSnapshotRef.current = JSON.stringify(pendingRecovery.snapshot);
    setPendingRecovery(null);
    setPersistEnabled(true);
    setHasStoredDraft(true);
  }, [onRecover, pendingRecovery]);

  const discardRecoveredDraft = useCallback(() => {
    if (canUseLocalStorage()) {
      window.localStorage.removeItem(storageKey);
    }
    lastSavedSnapshotRef.current = serializedSnapshot;
    setPendingRecovery(null);
    setPersistEnabled(true);
    setHasStoredDraft(false);
  }, [serializedSnapshot, storageKey]);

  const clearCurrentDraft = useCallback(() => {
    if (canUseLocalStorage()) {
      window.localStorage.removeItem(storageKey);
    }
    lastSavedSnapshotRef.current = serializedSnapshot;
    setPendingRecovery(null);
    setPersistEnabled(true);
    setHasStoredDraft(false);
  }, [serializedSnapshot, storageKey]);

  return {
    pendingRecovery,
    hasStoredDraft,
    recoverDraft,
    discardRecoveredDraft,
    clearCurrentDraft,
  };
};
