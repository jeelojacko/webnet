import type { Dispatch, SetStateAction } from 'react';
import type { CadProject } from '../../engine/cad/cadTypes';
import type { CadSectionCache } from '../../engine/cad/sectionCache';
import type { CadShellActions } from '../../cad-app/shell/cadShellTypes';
import type { SurfaceProfileService } from '../../workers/surfaceProfileService';
import type { SurfaceSectionService } from '../../workers/surfaceSectionService';
import { planSectionViewLayout } from './cadWorkspaceSectionViewLayout';

export interface CadWorkspaceShellLinearContext {
  project: CadProject;
  selectedProfileId: string | null;
  sectionCache: CadSectionCache;
  profileService: SurfaceProfileService;
  sectionService: SurfaceSectionService;
  workspace: { runLayerCommand: CadShellActions['runLayerCommand'] };
  describeProfileElevation: (_profileId: string, _displayStation: number) => string;
  describeSectionElevation: (
    _groupId: string,
    _lineId: string,
    _surfaceId: string,
    _offset: number,
  ) => string;
  setSelectedProfileId: Dispatch<SetStateAction<string | null>>;
  setSelectedProfileViewId: Dispatch<SetStateAction<string | null>>;
  setSelectedSampleLineGroupId: Dispatch<SetStateAction<string | null>>;
  setSelectedSampleLineId: Dispatch<SetStateAction<string | null>>;
  setSelectedSectionViewId: Dispatch<SetStateAction<string | null>>;
  setFileStatusText: Dispatch<SetStateAction<string>>;
}

export type CadWorkspaceShellLinearActions = Pick<
  CadShellActions,
  | 'selectProfile'
  | 'rebuildProfile'
  | 'createProfileView'
  | 'selectProfileView'
  | 'queryProfileElevation'
  | 'selectSampleLineGroup'
  | 'selectSampleLine'
  | 'rebuildSections'
  | 'rebuildSectionLine'
  | 'createSectionViews'
  | 'selectSectionView'
  | 'querySectionElevation'
>;

/**
 * Profile + section shell actions. Pure at construction; the long
 * `createSectionViews` placement math lives in the pure
 * `planSectionViewLayout` helper (identical layout/status/failure counts).
 */
export const buildCadWorkspaceShellLinearActions = (
  context: CadWorkspaceShellLinearContext,
): CadWorkspaceShellLinearActions => {
  const {
    project,
    selectedProfileId,
    sectionCache,
    profileService,
    sectionService,
    workspace,
    describeProfileElevation,
    describeSectionElevation,
    setSelectedProfileId,
    setSelectedProfileViewId,
    setSelectedSampleLineGroupId,
    setSelectedSampleLineId,
    setSelectedSectionViewId,
    setFileStatusText,
  } = context;
  return {
    selectProfile: (profileId) => setSelectedProfileId(profileId),
    rebuildProfile: (profileId) => profileService.requestProfile(profileId),
    createProfileView: (profileId) => {
      const target = (project.surfaceProfiles ?? []).find(
        (entry) => entry.id === (profileId ?? selectedProfileId),
      );
      if (!target) {
        setFileStatusText('Select a surface profile first.');
        return;
      }
      const ok = workspace.runLayerCommand({
        key: 'PROFILE_VIEW_CREATE',
        alignmentEntityId: target.alignmentEntityId,
        profileIds: [target.id],
      });
      setFileStatusText(ok ? 'Profile view created.' : 'Profile view rejected — see status/locks.');
    },
    selectProfileView: (viewId) => setSelectedProfileViewId(viewId),
    queryProfileElevation: (profileId, displayStation) =>
      describeProfileElevation(profileId, displayStation),
    selectSampleLineGroup: (groupId) => {
      setSelectedSampleLineGroupId(groupId);
      if (groupId == null) setSelectedSampleLineId(null);
    },
    selectSampleLine: (groupId, lineId) => {
      if (groupId != null) setSelectedSampleLineGroupId(groupId);
      setSelectedSampleLineId(lineId);
    },
    rebuildSections: (groupId) => sectionService.requestGroup(groupId),
    rebuildSectionLine: (groupId, lineId) => sectionService.requestLine(groupId, lineId),
    createSectionViews: (groupId) => {
      const plan = planSectionViewLayout(project, sectionCache, groupId);
      if (plan.kind === 'group-missing') {
        setFileStatusText('Select a sample-line group first.');
        return 'Select a sample-line group first.';
      }
      if (plan.kind === 'already-exist') {
        setFileStatusText(plan.message);
        return plan.message;
      }
      let created = 0;
      for (const placement of plan.placements) {
        const ok = workspace.runLayerCommand({
          key: 'SECTION_VIEW_CREATE',
          sampleLineGroupId: groupId,
          sampleLineId: placement.lineId,
          insertionX: placement.insertionX,
          insertionY: placement.insertionY,
        });
        if (ok) created += 1;
      }
      const message =
        created === plan.placements.length
          ? `Created ${created} section views for “${plan.groupName}”.`
          : `Created ${created} of ${plan.placements.length} section views — see status/locks.`;
      setFileStatusText(message);
      return message;
    },
    selectSectionView: (viewId) => setSelectedSectionViewId(viewId),
    querySectionElevation: (groupId, lineId, surfaceId, offset) =>
      describeSectionElevation(groupId, lineId, surfaceId, offset),
  };
};
