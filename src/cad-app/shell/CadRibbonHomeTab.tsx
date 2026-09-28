// Phase 21A Wave 2 — Home tab: Draw (icon-first + tool-family splits),
// Modify + Edit icon grids, Blocks, Layers, Parcel/Network, Feature Line,
// Grading groups. Draw dispatch is registry-only (splits route through
// executeShellCommand internally); family faces are sticky per
// useCadToolFamilyState and reset on New/Open via notifyDrawingLifecycle
// (wired in CadApplicationShell).
//
// Icon gaps: TRAVERSE has no curated asset, and the circle / ellipse /
// shapes / hatch / bestfit family primaries are all-planned with no
// truthful icon — all keep a short text face per the manifest fallback
// policy (never a placeholder glyph).
import React from 'react';
import { CAD_RIBBON_TOOL_FAMILIES } from './cadRibbonToolFamilies';
import { CadRibbonSplitButton } from './CadRibbonSplitButton';
import { CadLayersGroup } from './CadLayersGroup';
import { CadParcelNetworkRibbonGroup } from './CadParcelNetworkRibbonGroup';
import { CadFeatureLineRibbonGroup } from './CadFeatureLineRibbonGroup';
import { CadGradingRibbonGroup } from './CadGradingRibbonGroup';
import { CadGradingGroupRibbonGroup } from './CadGradingGroupRibbonGroup';
import { CAD_SHELL_COMMANDS } from './cadCommandRegistry';
import { PARCEL_NETWORK_KEYS } from './cadParcelNetwork.constants';
import type { CadToolFamilyState } from './useCadToolFamilyState';
import type { CadShellActions, CadWorkspaceSnapshot } from './cadShellTypes';
import { RegistryIconButton, RegistryIconRow, RibbonGroup } from './CadRibbonShared';

export interface CadRibbonHomeTabProps {
  snapshot: CadWorkspaceSnapshot | null;
  actions: CadShellActions | null;
  familyState: CadToolFamilyState;
}

const MODIFY_KEYS = [
  'MOVE',
  'COPY',
  'ROTATE',
  'SCALE',
  'MIRROR',
  'TRIM',
  'EXTEND',
  'FILLET',
  'EXPLODE',
  'PASTE',
  'ALIGN2D',
  'HELMERT2D',
  'GRIDGROUND',
  'PROJECTTRANSFORM',
] as const;

const EDIT_KEYS = [
  'SHELL_UNDO',
  'SHELL_REDO',
  'SHELL_SELECT_ALL',
  'SHELL_CLEAR_SELECTION',
  'SHELL_ERASE',
  'LAYER',
  'BLOCKS',
] as const;

const BLOCK_KEYS = ['INSERT', 'BLOCK', 'BLOCKS', 'EXPLODE'] as const;

/** Family split in the Draw group (compact face, sticky variant). */
const DrawSplit: React.FC<{
  familyId: string;
  snapshot: CadWorkspaceSnapshot | null;
  actions: CadShellActions | null;
  familyState: CadToolFamilyState;
  activeCommandKey: string | null;
}> = ({ familyId, snapshot, actions, familyState, activeCommandKey }) => {
  const family = CAD_RIBBON_TOOL_FAMILIES.find((entry) => entry.id === familyId) ?? null;
  if (family == null) return null;
  return (
    <CadRibbonSplitButton
      family={family}
      currentVariantId={familyState.currentVariantByFamily[familyId] ?? family.defaultVariantId}
      snapshot={snapshot}
      actions={actions}
      onSelectVariant={(variantId) => familyState.selectVariant(familyId, variantId)}
      active={familyState.isFamilyActive(familyId, activeCommandKey)}
      size="large"
    />
  );
};

export const CadRibbonHomeTab: React.FC<CadRibbonHomeTabProps> = ({
  snapshot,
  actions,
  familyState,
}) => {
  const activeCommandKey = snapshot?.activeCommandKey ?? null;
  const parcelDefs = CAD_SHELL_COMMANDS.filter(
    (def) =>
      def.category === 'Parcel' && !PARCEL_NETWORK_KEYS.has(def.key),
  );
  return (
    <>
      <RibbonGroup label="Draw">
        <RegistryIconButton commandKey="COGO_POINT" snapshot={snapshot} actions={actions} active={activeCommandKey === 'COGO_POINT'} />
        <DrawSplit familyId="line" snapshot={snapshot} actions={actions} familyState={familyState} activeCommandKey={activeCommandKey} />
        <RegistryIconButton commandKey="PLINE" snapshot={snapshot} actions={actions} active={activeCommandKey === 'PLINE'} />
        <RegistryIconButton commandKey="TRAVERSE" snapshot={snapshot} actions={actions} active={activeCommandKey === 'TRAVERSE'} />
        <DrawSplit familyId="arc" snapshot={snapshot} actions={actions} familyState={familyState} activeCommandKey={activeCommandKey} />
        <DrawSplit familyId="circle" snapshot={snapshot} actions={actions} familyState={familyState} activeCommandKey={activeCommandKey} />
        <DrawSplit familyId="bestfit" snapshot={snapshot} actions={actions} familyState={familyState} activeCommandKey={activeCommandKey} />
        <DrawSplit familyId="curves" snapshot={snapshot} actions={actions} familyState={familyState} activeCommandKey={activeCommandKey} />
        <DrawSplit familyId="ellipse" snapshot={snapshot} actions={actions} familyState={familyState} activeCommandKey={activeCommandKey} />
        <DrawSplit familyId="shapes" snapshot={snapshot} actions={actions} familyState={familyState} activeCommandKey={activeCommandKey} />
        <DrawSplit familyId="hatch" snapshot={snapshot} actions={actions} familyState={familyState} activeCommandKey={activeCommandKey} />
        <RegistryIconButton commandKey="BLOCK" snapshot={snapshot} actions={actions} active={activeCommandKey === 'BLOCK'} />
        <RegistryIconButton commandKey="INSERT" snapshot={snapshot} actions={actions} active={activeCommandKey === 'INSERT'} />
      </RibbonGroup>
      <RibbonGroup label="Modify">
        <RegistryIconRow keys={MODIFY_KEYS} snapshot={snapshot} actions={actions} activeCommandKey={activeCommandKey} />
      </RibbonGroup>
      <RibbonGroup label="Edit">
        <RegistryIconRow keys={EDIT_KEYS} snapshot={snapshot} actions={actions} />
      </RibbonGroup>
      <RibbonGroup label="Blocks">
        <RegistryIconRow keys={BLOCK_KEYS} snapshot={snapshot} actions={actions} activeCommandKey={activeCommandKey} />
      </RibbonGroup>
      <CadLayersGroup snapshot={snapshot} actions={actions} />
      <RibbonGroup label="Parcel">
        {parcelDefs.map((def) => (
          <RegistryIconButton
            key={def.key}
            commandKey={def.key}
            snapshot={snapshot}
            actions={actions}
            active={activeCommandKey === def.key}
          />
        ))}
      </RibbonGroup>
      <CadParcelNetworkRibbonGroup snapshot={snapshot} actions={actions} />
      <CadFeatureLineRibbonGroup snapshot={snapshot} actions={actions} />
      <CadGradingRibbonGroup snapshot={snapshot} actions={actions} />
      <CadGradingGroupRibbonGroup snapshot={snapshot} actions={actions} />
    </>
  );
};

