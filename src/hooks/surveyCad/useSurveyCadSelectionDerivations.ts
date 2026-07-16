import { useMemo } from 'react';
import {
  cadBuildParcelReportSummary,
  cadBuildParcelSourceDraft,
  isCadLineLikeEntity,
} from '../../engine/cad/cadCogo';
import { cadBuildAlignmentDraft } from '../../engine/cad/cadAlignment';
import { getSelectedCadEntities } from '../../engine/cad/cadSelection';
import { buildCadPropertiesPanelState } from '../../engine/cad/cadProperties';
import type {
  CadAlignmentEntity,
  CadArcEntity,
  CadLineEntity,
  CadParcelEntity,
  CadPolylineEntity,
  CadProject,
  CadSurveyPointEntity,
} from '../../engine/cad/cadTypes';

interface UseSurveyCadSelectionDerivationsOptions {
  cadProject: CadProject;
  selection: Parameters<typeof getSelectedCadEntities>[1];
}

export const useSurveyCadSelectionDerivations = ({
  cadProject,
  selection,
}: UseSurveyCadSelectionDerivationsOptions) => {
  const selectedEntities = useMemo(
    () => getSelectedCadEntities(cadProject, selection),
    [cadProject, selection],
  );
  const selectedArcForContinue = useMemo(
    () => selectedEntities.find((entity): entity is CadArcEntity => entity.type === 'arc') ?? null,
    [selectedEntities],
  );
  const selectedParcelSource = useMemo(
    () =>
      selectedEntities.every((entity) => entity.type === 'line' || entity.type === 'polyline')
        ? cadBuildParcelSourceDraft(
            selectedEntities.filter(
              (entity): entity is CadLineEntity | CadPolylineEntity =>
                entity.type === 'line' || entity.type === 'polyline',
            ),
          )
        : null,
    [selectedEntities],
  );
  const selectedParcelDiagnosticLines = useMemo(
    () =>
      selectedEntities.every((entity) => entity.type === 'line')
        ? selectedEntities.filter((entity): entity is CadLineEntity => entity.type === 'line')
        : [],
    [selectedEntities],
  );
  const selectedParcelsForOverlap = useMemo(
    () =>
      selectedEntities.length >= 2 &&
      selectedEntities.every((entity): entity is CadParcelEntity => entity.type === 'parcel')
        ? selectedEntities
        : [],
    [selectedEntities],
  );
  const selectedParcelForSplit = useMemo(
    () =>
      selectedEntities.length === 2
        ? selectedEntities.find((entity): entity is CadParcelEntity => entity.type === 'parcel') ?? null
        : null,
    [selectedEntities],
  );
  const selectedSplitLineForParcel = useMemo(
    () =>
      selectedEntities.length === 2
        ? selectedEntities.find((entity): entity is CadLineEntity => entity.type === 'line') ?? null
        : null,
    [selectedEntities],
  );
  const selectedLineLikes = useMemo(
    () => selectedEntities.filter(isCadLineLikeEntity),
    [selectedEntities],
  );
  const selectedAlignmentSources = useMemo(
    () =>
      selectedEntities.filter(
        (entity): entity is CadLineEntity | CadArcEntity => entity.type === 'line' || entity.type === 'arc',
      ),
    [selectedEntities],
  );
  const selectedAlignmentDraft = useMemo(
    () =>
      selectedAlignmentSources.length === selectedEntities.length
        ? cadBuildAlignmentDraft(selectedAlignmentSources)
        : null,
    [selectedAlignmentSources, selectedEntities],
  );
  const selectedLineForCoreCogo = useMemo(
    () =>
      selectedEntities.length === 1 && selectedEntities[0]?.type === 'line'
        ? selectedEntities[0]
        : null,
    [selectedEntities],
  );
  const selectedSurveyPointForBatchCogo = useMemo(
    () =>
      selectedEntities.length === 1 && selectedEntities[0]?.type === 'survey-point'
        ? selectedEntities[0]
        : null,
    [selectedEntities],
  );
  const selectedAlignmentForStationing = useMemo(
    () => selectedEntities.find((entity): entity is CadAlignmentEntity => entity.type === 'alignment') ?? null,
    [selectedEntities],
  );
  const selectedSurveyPointForStationing = useMemo(
    () => selectedEntities.find((entity): entity is CadSurveyPointEntity => entity.type === 'survey-point') ?? null,
    [selectedEntities],
  );
  const selectedLinePairForIntersection = useMemo(
    () =>
      selectedEntities.length === 2 &&
      selectedEntities[0]?.type === 'line' &&
      selectedEntities[1]?.type === 'line'
        ? ([selectedEntities[0], selectedEntities[1]] as [CadLineEntity, CadLineEntity])
        : null,
    [selectedEntities],
  );
  const selectedParcelReport = useMemo(() => {
    const selectedParcel = selectedEntities.find((entity) => entity.type === 'parcel');
    if (!selectedParcel || selectedParcel.type !== 'parcel') return null;
    return cadBuildParcelReportSummary({
      parcelName: selectedParcel.parcelName,
      vertices: selectedParcel.vertices,
      vertexLabels: selectedParcel.vertexLabels,
    });
  }, [selectedEntities]);
  const propertiesPanelState = useMemo(
    () => buildCadPropertiesPanelState(cadProject, selectedEntities),
    [cadProject, selectedEntities],
  );

  return {
    propertiesPanelState,
    selectedAlignmentDraft,
    selectedAlignmentForStationing,
    selectedArcForContinue,
    selectedEntities,
    selectedLineForCoreCogo,
    selectedLineLikes,
    selectedLinePairForIntersection,
    selectedParcelDiagnosticLines,
    selectedParcelForSplit,
    selectedParcelReport,
    selectedParcelsForOverlap,
    selectedParcelSource,
    selectedSplitLineForParcel,
    selectedSurveyPointForBatchCogo,
    selectedSurveyPointForStationing,
  };
};
