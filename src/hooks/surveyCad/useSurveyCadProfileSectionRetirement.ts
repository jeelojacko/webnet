/**
 * STRUCT-194.8 — profile + section session-result retirement.
 *
 * Extracted verbatim from `SurveyCadWorkspace` with no behavior change, at the
 * exact former `knownProfileIdsRef` position (after the pure civil-inquiry
 * factory). Two independent refs + effects:
 *   - profiles: deleted `surfaceProfiles` -> `profileService.handleProfileDeleted`
 *     and selected-profile clear; deps `[surfaceProfiles, profileService,
 *     selectedProfileId]`;
 *   - sample-line groups: deleted `sampleLineGroups` ->
 *     `sectionService.handleGroupDeleted` and BOTH selected-group and
 *     selected-line clear; deps `[sampleLineGroups, sectionService,
 *     selectedSampleLineGroupId]`.
 *
 * Source surface meshes are untouched. Each ref persists across drawing
 * switches exactly as the original per-render refs did and is only written by
 * its own effect.
 */
import { useEffect, useRef, type Dispatch, type SetStateAction } from 'react';
import type { CadProject } from '../../engine/cad/cadTypes';
import type { SurfaceProfileService } from '../../workers/surfaceProfileService';
import type { SurfaceSectionService } from '../../workers/surfaceSectionService';

export interface SurveyCadProfileSectionRetirementArgs {
  surfaceProfiles: CadProject['surfaceProfiles'];
  profileService: SurfaceProfileService;
  selectedProfileId: string | null;
  setSelectedProfileId: Dispatch<SetStateAction<string | null>>;
  sampleLineGroups: CadProject['sampleLineGroups'];
  sectionService: SurfaceSectionService;
  selectedSampleLineGroupId: string | null;
  setSelectedSampleLineGroupId: Dispatch<SetStateAction<string | null>>;
  setSelectedSampleLineId: Dispatch<SetStateAction<string | null>>;
}

export const useSurveyCadProfileSectionRetirement = ({
  surfaceProfiles,
  profileService,
  selectedProfileId,
  setSelectedProfileId,
  sampleLineGroups,
  sectionService,
  selectedSampleLineGroupId,
  setSelectedSampleLineGroupId,
  setSelectedSampleLineId,
}: SurveyCadProfileSectionRetirementArgs): void => {
  // Phase 18J — drop session samples for deleted profiles (results never
  // persist; the service cancels in-flight work first). Source surface
  // meshes are untouched.
  const knownProfileIdsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    const live = new Set((surfaceProfiles ?? []).map((entry) => entry.id));
    for (const id of knownProfileIdsRef.current) {
      if (!live.has(id)) profileService.handleProfileDeleted(id);
    }
    knownProfileIdsRef.current = live;
    if (selectedProfileId != null && !live.has(selectedProfileId)) setSelectedProfileId(null);
  }, [surfaceProfiles, profileService, selectedProfileId]);

  // Phase 18K — drop session sections for deleted groups (results never
  // persist; the service cancels in-flight work first). Source surface
  // meshes are untouched.
  const knownSectionGroupIdsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    const live = new Set((sampleLineGroups ?? []).map((entry) => entry.id));
    for (const id of knownSectionGroupIdsRef.current) {
      if (!live.has(id)) sectionService.handleGroupDeleted(id);
    }
    knownSectionGroupIdsRef.current = live;
    if (selectedSampleLineGroupId != null && !live.has(selectedSampleLineGroupId)) {
      setSelectedSampleLineGroupId(null);
      setSelectedSampleLineId(null);
    }
  }, [sampleLineGroups, sectionService, selectedSampleLineGroupId]);
};
