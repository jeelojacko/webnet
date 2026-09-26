import type { CadShellActions, CadWorkspaceSnapshot } from './cadShellTypes';
import type { CadSurfaceRow } from './cadSurfaceSnapshot';

/** Phase 18W — shared props + commit-notice helper for definition sections. */
export interface DefinitionSectionProps {
  snapshot: CadWorkspaceSnapshot;
  actions: CadShellActions;
  row: CadSurfaceRow;
  setNotice: (_notice: string) => void;
}

export const makeSectionCommit = (
  setNotice: (_notice: string) => void,
): ((_label: string, _ok: boolean) => void) =>
  (label, ok) => setNotice(ok ? `${label} done.` : `${label} rejected — see status/locks.`);

/** Phase 18W — cross-command focus: SURF*EDIT commands plant this, sections consume on mount. */
export interface DefinitionFocusRequest {
  surfaceId: string;
  section: 'breaklines' | 'boundaries';
  targetId: string;
}

let pendingDefinitionFocus: DefinitionFocusRequest | null = null;

export const requestDefinitionFocus = (request: DefinitionFocusRequest): void => {
  pendingDefinitionFocus = request;
};

export const consumeDefinitionFocus = (): DefinitionFocusRequest | null => {
  const request = pendingDefinitionFocus;
  pendingDefinitionFocus = null;
  return request;
};

/** Phase 18Y — cross-command focus for the Compose Surface dialog. */
export type SurfaceComposeFocusMode = 'copy' | 'paste';

let pendingComposeFocus: SurfaceComposeFocusMode | null = null;

export const requestSurfaceComposeFocus = (mode: SurfaceComposeFocusMode): void => {
  pendingComposeFocus = mode;
};

export const consumeSurfaceComposeFocus = (): SurfaceComposeFocusMode | null => {
  const mode = pendingComposeFocus;
  pendingComposeFocus = null;
  return mode;
};
