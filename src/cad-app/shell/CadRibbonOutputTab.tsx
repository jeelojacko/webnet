// Phase 21A Wave 2 — Output tab: File deliverables as an icon grid.
// New/Open/Save use curated file icons; Import LandXML uses a curated
// LandXML icon (Phase 21B); Export Center and Sheets & Layers keep short text
// faces (no truthful asset). Registry-only dispatch, same definitions as the
// menu + quick-access paths.
import React from 'react';
import type { CadShellActions, CadWorkspaceSnapshot } from './cadShellTypes';
import { RegistryIconRow, RibbonGroup } from './CadRibbonShared';

const FILE_KEYS = [
  'SHELL_NEW',
  'SHELL_OPEN',
  'SHELL_SAVE',
  'SHELL_EXPORT_CENTER',
  'SHELL_SHEETS_LAYERS',
  'SHELL_IMPORT_LANDXML',
] as const;

export const CadRibbonOutputTab: React.FC<{
  snapshot: CadWorkspaceSnapshot | null;
  actions: CadShellActions | null;
}> = ({ snapshot, actions }) => (
  <RibbonGroup label="File">
    <RegistryIconRow keys={FILE_KEYS} snapshot={snapshot} actions={actions} />
  </RibbonGroup>
);
