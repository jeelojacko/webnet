import type { SurfaceBuildRequest } from '../engine/cad/cadSurfaceTypes';
import type { CadSurfaceContourSet } from '../engine/cad/surfaceContours/contourTypes';
import type { CadVolumeResult } from '../engine/cad/cadTypes';
import type { CadSurfaceProfileResult } from '../engine/cad/profiles/profileExtraction';
import type { CadSurfaceSectionResult } from '../engine/cad/cadSectionTypes';
import type {
  SurfaceContourRequest,
  SurfaceProfileRequest,
  SurfaceSectionsRequest,
  SurfaceVolumeRequest,
  SurfaceWorkerResponseMessage,
} from './surfaceWorkerHandler';
import type { SurfaceWorkerMesh } from './surfaceWorkerHandler';

export type { SurfaceWorkerMesh };

/**
 * Phase 18G — narrow typed production client for surfaceWorker.
 *
 * One client per document session (never per click): build/cancel/dispose
 * only. Messages carry plain data (requestId + surfaceId + revision +
 * compact snapshot) — no React. Progress messages are dropped (no fake
 * progress); only terminal outcomes settle.
 *
 * Settlement contract: `done` resolves to the mesh on success, to null
 * when the request was cancelled/superseded/disposed (settle silently —
 * the service drops it), and rejects only on real failure
 * (worker-reported failure, malformed response, or worker death).
 */

export const SURFACE_BUILD_UNAVAILABLE = 'Surface worker unavailable.';
export const SURFACE_BUILD_MALFORMED = 'Malformed surface worker response.';
export const SURFACE_VOLUME_MALFORMED = 'Malformed surface volume worker response.';
export const SURFACE_VOLUME_UNAVAILABLE = 'Surface volume worker unavailable.';
export const SURFACE_PROFILE_MALFORMED = 'Malformed surface profile worker response.';
export const SURFACE_PROFILE_UNAVAILABLE = 'Surface profile worker unavailable.';
export const SURFACE_SECTIONS_MALFORMED = 'Malformed surface sections worker response.';
export const SURFACE_SECTIONS_UNAVAILABLE = 'Surface sections worker unavailable.';

export interface PendingSurfaceBuild {
  requestId: string;
  done: Promise<SurfaceWorkerMesh | null>;
  cancel: () => void;
}

export interface PendingSurfaceContours {
  requestId: string;
  done: Promise<CadSurfaceContourSet | null>;
  cancel: () => void;
}

export interface PendingSurfaceVolume {
  requestId: string;
  done: Promise<CadVolumeResult | null>;
  cancel: () => void;
}

export interface PendingSurfaceProfile {
  requestId: string;
  done: Promise<CadSurfaceProfileResult | null>;
  cancel: () => void;
}

export interface PendingSurfaceSections {
  requestId: string;
  done: Promise<CadSurfaceSectionResult[] | null>;
  cancel: () => void;
}

/** Minimal worker surface the client drives (real Worker satisfies this). */
export interface SurfaceWorkerPort {
  postMessage: (_message: unknown) => void;
  terminate: () => void;
  addEventListener: (_type: string, _listener: (_event: unknown) => void) => void;
  removeEventListener: (_type: string, _listener: (_event: unknown) => void) => void;
}

export interface SurfaceBuildTransport {
  readonly alive: boolean;
  build: (_request: SurfaceBuildRequest) => PendingSurfaceBuild;
  cancel: (_requestId: string) => void;
  dispose: () => void;
}

const TERMINAL_TYPES = new Set([
  'success',
  'failure',
  'cancelled',
  'contour-success',
  'contour-failure',
  'volume-success',
  'volume-failure',
  'profile-success',
  'profile-failure',
  'sections-success',
  'sections-failure',
]);
const OK_OUTCOMES = new Set(['ok', 'insufficient', 'blocked']);

type TerminalSurfaceWorkerMessage = Exclude<SurfaceWorkerResponseMessage, { type: 'progress' }>;

const isResponseMessage = (value: unknown): value is TerminalSurfaceWorkerMessage => {
  if (typeof value !== 'object' || value === null) return false;
  const message = value as Record<string, unknown>;
  return (
    typeof message['type'] === 'string' &&
    TERMINAL_TYPES.has(message['type'] as string) &&
    typeof message['requestId'] === 'string'
  );
};

const isWellFormedContourSet = (value: unknown): value is CadSurfaceContourSet => {
  if (typeof value !== 'object' || value === null) return false;
  const set = value as Record<string, unknown>;
  const stats = set['stats'] as Record<string, unknown> | null | undefined;
  return (
    typeof set['surfaceId'] === 'string' &&
    typeof set['surfaceRevision'] === 'string' &&
    typeof set['styleRevision'] === 'string' &&
    Array.isArray(set['minorPaths']) &&
    Array.isArray(set['majorPaths']) &&
    typeof stats === 'object' &&
    stats !== null &&
    stats !== undefined &&
    typeof stats['segmentCount'] === 'number'
  );
};

export const SURFACE_CONTOUR_MALFORMED = 'Malformed surface contour worker response.';

const isWellFormedVolumeResult = (value: unknown): value is CadVolumeResult => {
  if (typeof value !== 'object' || value === null) return false;
  const result = value as Record<string, unknown>;
  return (
    typeof result['baseSurfaceId'] === 'string' &&
    typeof result['comparisonSurfaceId'] === 'string' &&
    typeof result['revision'] === 'string' &&
    typeof result['overlapArea'] === 'number' &&
    typeof result['cutVolume'] === 'number' &&
    typeof result['fillVolume'] === 'number' &&
    typeof result['netVolume'] === 'number' &&
    typeof result['stats'] === 'object' &&
    result['stats'] !== null
  );
};

const isWellFormedProfileResult = (value: unknown): value is CadSurfaceProfileResult => {
  if (typeof value !== 'object' || value === null) return false;
  const result = value as Record<string, unknown>;
  return (
    typeof result['profileId'] === 'string' &&
    typeof result['revision'] === 'string' &&
    Array.isArray(result['segments']) &&
    typeof result['coveredLength'] === 'number' &&
    typeof result['gapLength'] === 'number'
  );
};

const isWellFormedSectionResult = (value: unknown): value is CadSurfaceSectionResult => {
  if (typeof value !== 'object' || value === null) return false;
  const result = value as Record<string, unknown>;
  return (
    typeof result['groupId'] === 'string' &&
    typeof result['lineId'] === 'string' &&
    typeof result['surfaceId'] === 'string' &&
    typeof result['revision'] === 'string' &&
    typeof result['surfaceRevision'] === 'string' &&
    Array.isArray(result['segments']) &&
    typeof result['coveredWidth'] === 'number' &&
    typeof result['gapWidth'] === 'number'
  );
};

const isWellFormedMesh = (value: unknown): value is SurfaceWorkerMesh => {
  if (typeof value !== 'object' || value === null) return false;
  const mesh = value as Record<string, unknown>;
  return (
    typeof mesh['outcome'] === 'string' &&
    OK_OUTCOMES.has(mesh['outcome'] as string) &&
    Array.isArray(mesh['points']) &&
    Array.isArray(mesh['triangles']) &&
    typeof mesh['stats'] === 'object' &&
    mesh['stats'] !== null &&
    typeof mesh['grid'] === 'object' &&
    mesh['grid'] !== null &&
    Array.isArray(mesh['adjacency']) &&
    Array.isArray(mesh['edgeKinds'])
  );
};

export class SurfaceWorkerClient implements SurfaceBuildTransport {
  private readonly port: SurfaceWorkerPort;
  private readonly pending = new Map<
    string,
    {
      resolve: (_mesh: SurfaceWorkerMesh | null) => void;
      reject: (_error: Error) => void;
      settled: boolean;
    }
  >();
  private readonly pendingContours = new Map<
    string,
    {
      resolve: (_set: CadSurfaceContourSet | null) => void;
      reject: (_error: Error) => void;
      settled: boolean;
    }
  >();
  private readonly pendingVolumes = new Map<
    string,
    {
      resolve: (_result: CadVolumeResult | null) => void;
      reject: (_error: Error) => void;
      settled: boolean;
    }
  >();
  private readonly pendingProfiles = new Map<
    string,
    {
      resolve: (_result: CadSurfaceProfileResult | null) => void;
      reject: (_error: Error) => void;
      settled: boolean;
    }
  >();
  private readonly pendingSections = new Map<
    string,
    {
      resolve: (_result: CadSurfaceSectionResult[] | null) => void;
      reject: (_error: Error) => void;
      settled: boolean;
    }
  >();
  private nextRequestId = 0;
  private dead = false;
  private readonly handleMessage = (event: unknown): void => {
    const data = (event as { data?: unknown })?.data;
    if (!isResponseMessage(data)) return;
    if (data.type === 'contour-success' || data.type === 'contour-failure') {
      this.handleContourMessage(data);
      return;
    }
    if (data.type === 'volume-success' || data.type === 'volume-failure') {
      this.handleVolumeMessage(data);
      return;
    }
    if (data.type === 'profile-success' || data.type === 'profile-failure') {
      this.handleProfileMessage(data);
      return;
    }
    if (data.type === 'sections-success' || data.type === 'sections-failure') {
      this.handleSectionsMessage(data);
      return;
    }
    const entry = this.pending.get(data.requestId);
    if (!entry || entry.settled) return;
    if (data.type === 'cancelled') {
      entry.settled = true;
      this.pending.delete(data.requestId);
      entry.resolve(null);
      return;
    }
    if (data.type === 'failure') {
      entry.settled = true;
      this.pending.delete(data.requestId);
      entry.reject(new Error(data.error || 'Surface build failed.'));
      return;
    }
    if (data.type !== 'success') return;
    if (!isWellFormedMesh(data.result)) {
      entry.settled = true;
      this.pending.delete(data.requestId);
      entry.reject(new Error(SURFACE_BUILD_MALFORMED));
      return;
    }
    entry.settled = true;
    this.pending.delete(data.requestId);
    entry.resolve(data.result);
  };
  /** Phase 18H: contour terminal messages settle contour pendings only (cancel → null, malformed → reject). */
  private readonly handleContourMessage = (
    data: Extract<TerminalSurfaceWorkerMessage, { type: 'contour-success' | 'contour-failure' }>,
  ): void => {
    const entry = this.pendingContours.get(data.requestId);
    if (!entry || entry.settled) return;
    if (data.type === 'contour-failure') {
      entry.settled = true;
      this.pendingContours.delete(data.requestId);
      entry.reject(new Error(data.error || 'Surface contour derivation failed.'));
      return;
    }
    if (!isWellFormedContourSet(data.result)) {
      entry.settled = true;
      this.pendingContours.delete(data.requestId);
      entry.reject(new Error(SURFACE_CONTOUR_MALFORMED));
      return;
    }
    entry.settled = true;
    this.pendingContours.delete(data.requestId);
    entry.resolve(data.result);
  };
  /** Phase 18I: volume terminal messages settle volume pendings only (malformed → reject). */
  private readonly handleVolumeMessage = (
    data: Extract<TerminalSurfaceWorkerMessage, { type: 'volume-success' | 'volume-failure' }>,
  ): void => {
    const entry = this.pendingVolumes.get(data.requestId);
    if (!entry || entry.settled) return;
    if (data.type === 'volume-failure') {
      entry.settled = true;
      this.pendingVolumes.delete(data.requestId);
      entry.reject(new Error(data.error || 'Surface volume computation failed.'));
      return;
    }
    if (!isWellFormedVolumeResult(data.result)) {
      entry.settled = true;
      this.pendingVolumes.delete(data.requestId);
      entry.reject(new Error(SURFACE_VOLUME_MALFORMED));
      return;
    }
    entry.settled = true;
    this.pendingVolumes.delete(data.requestId);
    entry.resolve(data.result);
  };
  /** Phase 18J: profile terminal messages settle profile pendings only (malformed → reject). */
  private readonly handleProfileMessage = (
    data: Extract<TerminalSurfaceWorkerMessage, { type: 'profile-success' | 'profile-failure' }>,
  ): void => {
    const entry = this.pendingProfiles.get(data.requestId);
    if (!entry || entry.settled) return;
    if (data.type === 'profile-failure') {
      entry.settled = true;
      this.pendingProfiles.delete(data.requestId);
      entry.reject(new Error(data.error || 'Surface profile derivation failed.'));
      return;
    }
    if (!isWellFormedProfileResult(data.result)) {
      entry.settled = true;
      this.pendingProfiles.delete(data.requestId);
      entry.reject(new Error(SURFACE_PROFILE_MALFORMED));
      return;
    }
    entry.settled = true;
    this.pendingProfiles.delete(data.requestId);
    entry.resolve(data.result);
  };
  /** Phase 18K: batched section terminal messages settle section pendings only. */
  private readonly handleSectionsMessage = (
    data: Extract<TerminalSurfaceWorkerMessage, { type: 'sections-success' | 'sections-failure' }>,
  ): void => {
    const entry = this.pendingSections.get(data.requestId);
    if (!entry || entry.settled) return;
    if (data.type === 'sections-failure') {
      entry.settled = true;
      this.pendingSections.delete(data.requestId);
      entry.reject(new Error(data.error || 'Surface section derivation failed.'));
      return;
    }
    if (!Array.isArray(data.results) || !data.results.every(isWellFormedSectionResult)) {
      entry.settled = true;
      this.pendingSections.delete(data.requestId);
      entry.reject(new Error(SURFACE_SECTIONS_MALFORMED));
      return;
    }
    entry.settled = true;
    this.pendingSections.delete(data.requestId);
    entry.resolve(data.results);
  };
  private readonly handleFatal = (): void => {
    this.failAll(new Error(SURFACE_BUILD_UNAVAILABLE));
  };

  constructor(port: SurfaceWorkerPort) {
    this.port = port;
    port.addEventListener('message', this.handleMessage);
    port.addEventListener('error', this.handleFatal);
  }

  get alive(): boolean {
    return !this.dead;
  }

  build(request: SurfaceBuildRequest): PendingSurfaceBuild {
    this.nextRequestId += 1;
    const requestId = `sreq-${this.nextRequestId}`;
    let entry!: { resolve: (_m: SurfaceWorkerMesh | null) => void; reject: (_e: Error) => void; settled: boolean };
    const done = new Promise<SurfaceWorkerMesh | null>((resolve, reject) => {
      entry = { resolve, reject, settled: false };
    });
    this.pending.set(requestId, entry);
    try {
      this.port.postMessage({ type: 'build', requestId, request });
    } catch (error) {
      this.pending.delete(requestId);
      entry.reject(error instanceof Error ? error : new Error(String(error)));
    }
    return {
      requestId,
      done,
      cancel: () => this.cancel(requestId),
    };
  }

  /**
   * Phase 18H contour derivation. Payload uses structured clone of
   * compact arrays — the client never detaches main-thread buffers.
   * Cancel → null; malformed → reject; failure → reject.
   */
  deriveContours(request: SurfaceContourRequest): PendingSurfaceContours {
    this.nextRequestId += 1;
    const requestId = `creq-${this.nextRequestId}`;
    let entry!: {
      resolve: (_s: CadSurfaceContourSet | null) => void;
      reject: (_e: Error) => void;
      settled: boolean;
    };
    const done = new Promise<CadSurfaceContourSet | null>((resolve, reject) => {
      entry = { resolve, reject, settled: false };
    });
    this.pendingContours.set(requestId, entry);
    try {
      this.port.postMessage({ type: 'contours', requestId, request });
    } catch (error) {
      this.pendingContours.delete(requestId);
      entry.reject(error instanceof Error ? error : new Error(String(error)));
    }
    return {
      requestId,
      done,
      cancel: () => this.cancel(requestId),
    };
  }

  /**
   * Phase 18I volume computation. Latest-wins ownership is the service's;
   * the client only settles one pending per requestId. Cancel → null;
   * malformed → reject; failure → reject.
   */
  deriveVolume(request: SurfaceVolumeRequest): PendingSurfaceVolume {
    this.nextRequestId += 1;
    const requestId = `vreq-${this.nextRequestId}`;
    let entry!: {
      resolve: (_result: CadVolumeResult | null) => void;
      reject: (_e: Error) => void;
      settled: boolean;
    };
    const done = new Promise<CadVolumeResult | null>((resolve, reject) => {
      entry = { resolve, reject, settled: false };
    });
    this.pendingVolumes.set(requestId, entry);
    try {
      this.port.postMessage({ type: 'volume', requestId, request });
    } catch (error) {
      this.pendingVolumes.delete(requestId);
      entry.reject(error instanceof Error ? error : new Error(String(error)));
    }
    return {
      requestId,
      done,
      cancel: () => this.cancel(requestId),
    };
  }

  /**
   * Phase 18J profile derivation. Latest-wins ownership is the service's;
   * the client only settles one pending per requestId. Cancel → null;
   * malformed → reject; failure → reject.
   */
  deriveProfile(request: SurfaceProfileRequest): PendingSurfaceProfile {
    this.nextRequestId += 1;
    const requestId = `preq-${this.nextRequestId}`;
    let entry!: {
      resolve: (_result: CadSurfaceProfileResult | null) => void;
      reject: (_e: Error) => void;
      settled: boolean;
    };
    const done = new Promise<CadSurfaceProfileResult | null>((resolve, reject) => {
      entry = { resolve, reject, settled: false };
    });
    this.pendingProfiles.set(requestId, entry);
    try {
      this.port.postMessage({ type: 'profile', requestId, request });
    } catch (error) {
      this.pendingProfiles.delete(requestId);
      entry.reject(error instanceof Error ? error : new Error(String(error)));
    }
    return {
      requestId,
      done,
      cancel: () => this.cancel(requestId),
    };
  }

  /**
   * Phase 18K batched sections. Latest-wins ownership is the service's; the
   * client settles one pending per requestId. Cancel -> null; malformed ->
   * reject; failure -> reject.
   */
  deriveSections(request: SurfaceSectionsRequest): PendingSurfaceSections {
    this.nextRequestId += 1;
    const requestId = `sreq2-${this.nextRequestId}`;
    let entry!: {
      resolve: (_result: CadSurfaceSectionResult[] | null) => void;
      reject: (_e: Error) => void;
      settled: boolean;
    };
    const done = new Promise<CadSurfaceSectionResult[] | null>((resolve, reject) => {
      entry = { resolve, reject, settled: false };
    });
    this.pendingSections.set(requestId, entry);
    try {
      this.port.postMessage({ type: 'sections', requestId, request });
    } catch (error) {
      this.pendingSections.delete(requestId);
      entry.reject(error instanceof Error ? error : new Error(String(error)));
    }
    return {
      requestId,
      done,
      cancel: () => this.cancel(requestId),
    };
  }

  cancel(requestId: string): void {
    const sectionEntry = this.pendingSections.get(requestId);
    if (sectionEntry && !sectionEntry.settled) {
      sectionEntry.settled = true;
      this.pendingSections.delete(requestId);
      try {
        this.port.postMessage({ type: 'cancel', requestId });
      } catch {
        // Local settle already applied; a dead port fails closed via dispose.
      }
      sectionEntry.resolve(null);
      return;
    }
    const profileEntry = this.pendingProfiles.get(requestId);
    if (profileEntry && !profileEntry.settled) {
      profileEntry.settled = true;
      this.pendingProfiles.delete(requestId);
      try {
        this.port.postMessage({ type: 'cancel', requestId });
      } catch {
        // Local settle already applied; a dead port fails closed via dispose.
      }
      profileEntry.resolve(null);
      return;
    }
    const volumeEntry = this.pendingVolumes.get(requestId);
    if (volumeEntry && !volumeEntry.settled) {
      volumeEntry.settled = true;
      this.pendingVolumes.delete(requestId);
      try {
        this.port.postMessage({ type: 'cancel', requestId });
      } catch {
        // Local settle already applied; a dead port fails closed via dispose.
      }
      volumeEntry.resolve(null);
      return;
    }
    const contourEntry = this.pendingContours.get(requestId);
    if (contourEntry && !contourEntry.settled) {
      contourEntry.settled = true;
      this.pendingContours.delete(requestId);
      try {
        this.port.postMessage({ type: 'cancel', requestId });
      } catch {
        // Local settle already applied; a dead port fails closed via dispose.
      }
      contourEntry.resolve(null);
      return;
    }
    const entry = this.pending.get(requestId);
    if (!entry || entry.settled) return;
    entry.settled = true;
    this.pending.delete(requestId);
    try {
      this.port.postMessage({ type: 'cancel', requestId });
    } catch {
      // Local settle already applied; a dead port fails closed via dispose.
    }
    entry.resolve(null);
  }

  dispose(): void {
    if (this.dead) return;
    this.dead = true;
    try {
      this.port.removeEventListener('message', this.handleMessage);
      this.port.removeEventListener('error', this.handleFatal);
    } catch {
      // Listener removal is best-effort on a dead port.
    }
    for (const [requestId, entry] of this.pending) {
      if (!entry.settled) {
        entry.settled = true;
        entry.resolve(null);
      }
      this.pending.delete(requestId);
    }
    for (const [requestId, entry] of this.pendingContours) {
      if (!entry.settled) {
        entry.settled = true;
        entry.resolve(null);
      }
      this.pendingContours.delete(requestId);
    }
    for (const [requestId, entry] of this.pendingVolumes) {
      if (!entry.settled) {
        entry.settled = true;
        entry.resolve(null);
      }
      this.pendingVolumes.delete(requestId);
    }
    for (const [requestId, entry] of this.pendingProfiles) {
      if (!entry.settled) {
        entry.settled = true;
        entry.resolve(null);
      }
      this.pendingProfiles.delete(requestId);
    }
    for (const [requestId, entry] of this.pendingSections) {
      if (!entry.settled) {
        entry.settled = true;
        entry.resolve(null);
      }
      this.pendingSections.delete(requestId);
    }
    try {
      this.port.terminate();
    } catch {
      // Termination is best-effort.
    }
  }

  private failAll(error: Error): void {
    if (this.dead) return;
    this.dead = true;
    for (const [requestId, entry] of this.pendingSections) {
      if (!entry.settled) {
        entry.settled = true;
        entry.reject(error);
      }
      this.pendingSections.delete(requestId);
    }
    for (const [requestId, entry] of this.pendingProfiles) {
      if (!entry.settled) {
        entry.settled = true;
        entry.reject(error);
      }
      this.pendingProfiles.delete(requestId);
    }
    for (const [requestId, entry] of this.pendingVolumes) {
      if (!entry.settled) {
        entry.settled = true;
        entry.reject(error);
      }
      this.pendingVolumes.delete(requestId);
    }
    for (const [requestId, entry] of this.pendingContours) {
      if (!entry.settled) {
        entry.settled = true;
        entry.reject(error);
      }
      this.pendingContours.delete(requestId);
    }
    for (const [requestId, entry] of this.pending) {
      if (!entry.settled) {
        entry.settled = true;
        entry.reject(error);
      }
      this.pending.delete(requestId);
    }
    try {
      this.port.removeEventListener('message', this.handleMessage);
      this.port.removeEventListener('error', this.handleFatal);
      this.port.terminate();
    } catch {
      // Fatal path never throws.
    }
  }
}
