import React from 'react';
import type { AdjustmentResult, Observation } from '../../types';
import type { ReportViewProps } from '../ReportView.types';
import type { CollapsibleDetailSectionId } from './reportSectionRegistry';
import ReportClosingSections from './ReportClosingSections';
import {
  RelativeCovariancesSection,
  StationCovariancesSection,
  WeakGeometryCuesSection,
} from './ReportPrecisionSections';
import { ObservationResidualsSummarySections } from './ReportResidualSummarySections';
import {
  ObservationTypeTables,
  ReportFilterAndCoordinatesSections,
} from './ReportObservationWorkflowSections';
import type { SortedObservation } from '../../engine/resultDerivedModels';

type SourceLineRenderer = (_line: number | null | undefined) => React.ReactNode;
type LoadMoreRenderer = React.ComponentProps<
  typeof ReportFilterAndCoordinatesSections
>['renderLoadMoreFooter'];
type HeaderRenderer = React.ComponentProps<
  typeof ReportClosingSections
>['renderCollapsibleSectionHeader'];

type ReportViewPrecisionResidualsBandProps = {
  allDetailSectionsCollapsed: boolean;
  autoSideshotObsIds: Set<number>;
  byType: (_type: Observation['type']) => SortedObservation[];
  clearFilters: () => void;
  covarianceScale: number;
  deferredReportFilterQuery: string;
  directionTreatmentDiagnostics: React.ComponentProps<
    typeof ReportClosingSections
  >['directionTreatmentDiagnostics'];
  ellipseConfidenceScale: number;
  ellipseMode: React.ComponentProps<typeof ReportFilterAndCoordinatesSections>['ellipseMode'];
  ellipseScale: number;
  ellipseUnit: string;
  excludedIds: Set<number>;
  filteredObservationCount: number;
  filteredRelativeCovariances: React.ComponentProps<
    typeof RelativeCovariancesSection
  >['filteredRelativeCovariances'];
  filteredRelativePrecision: React.ComponentProps<
    typeof ObservationResidualsSummarySections
  >['filteredRelativePrecision'];
  filteredStationCovariances: React.ComponentProps<
    typeof StationCovariancesSection
  >['filteredStationCovariances'];
  filteredStationRows: React.ComponentProps<
    typeof ReportFilterAndCoordinatesSections
  >['filteredStationRows'];
  flaggedRelativeCues: React.ComponentProps<typeof WeakGeometryCuesSection>['flaggedRelativeCues'];
  flaggedStationCues: React.ComponentProps<typeof WeakGeometryCuesSection>['flaggedStationCues'];
  focusFilterRequestKey: number;
  formatEffectiveDistance: (_value?: number) => string;
  formatMdb: (_value: number, _angular: boolean) => string;
  importedGroupOptions: string[];
  isDataCheck: boolean;
  isDetailSectionPinned: (_id: CollapsibleDetailSectionId) => boolean;
  isPreanalysis: boolean;
  isRegularAdjustment: boolean;
  isSectionCollapsed: (_id: CollapsibleDetailSectionId) => boolean;
  logs: string[];
  normalizedReportFilterQuery: string;
  observationWeightLabel: (_obs: Observation) => string;
  onEllipseModeChange: React.ComponentProps<
    typeof ReportFilterAndCoordinatesSections
  >['onEllipseModeChange'];
  onHeaderRef: (_id: CollapsibleDetailSectionId, _node: HTMLDivElement | null) => void;
  onReportExclusionFilterChange: React.ComponentProps<
    typeof ReportFilterAndCoordinatesSections
  >['onReportExclusionFilterChange'];
  onReportFilterQueryChange: (_value: string) => void;
  onReportObservationTypeFilterChange: React.ComponentProps<
    typeof ReportFilterAndCoordinatesSections
  >['onReportObservationTypeFilterChange'];
  onReviewAdjustedOnlyChange: (_value: boolean) => void;
  onReviewConflictOnlyChange: (_value: boolean) => void;
  onReviewImportedGroupFilterChange: (_value: string) => void;
  onSelectObservation: ReportViewProps['onSelectObservation'];
  onSelectStation: ReportViewProps['onSelectStation'];
  onToggleExclude: ReportViewProps['onToggleExclude'];
  parseState: AdjustmentResult['parseState'];
  preanalysisLabelTooltip: (_label: string) => string | undefined;
  prismAnnotation: (_obs: Observation) => string;
  renderCollapsibleSectionHeader: HeaderRenderer;
  renderLoadMoreFooter: LoadMoreRenderer;
  renderSourceLineLink: SourceLineRenderer;
  reportExclusionFilter: React.ComponentProps<
    typeof ReportFilterAndCoordinatesSections
  >['reportExclusionFilter'];
  reportFilterQuery: string;
  reportObservationTypeFilter: React.ComponentProps<
    typeof ReportFilterAndCoordinatesSections
  >['reportObservationTypeFilter'];
  reviewAdjustedOnly: boolean;
  reviewConflictOnly: boolean;
  reviewImportedGroupFilter: string;
  rowSelectionClass: (_selected: boolean) => string;
  selectedObservationId: number | null;
  selectedStationId: string | null;
  showAllRows: React.ComponentProps<typeof ObservationTypeTables>['showAllRows'];
  showMoreRows: React.ComponentProps<typeof ObservationTypeTables>['showMoreRows'];
  sortedObservationCount: number;
  stationDescription: (_stationId: string) => string;
  stationTypeBadge: React.ComponentProps<typeof ReportFilterAndCoordinatesSections>['stationTypeBadge'];
  toggleDetailSection: (_id: CollapsibleDetailSectionId) => void;
  togglePinnedDetailSection: (_id: CollapsibleDetailSectionId, _label: string) => void;
  topRelativeCovarianceRow: React.ComponentProps<
    typeof RelativeCovariancesSection
  >['topRelativeCovarianceRow'];
  topRelativePrecisionRow: React.ComponentProps<
    typeof ObservationResidualsSummarySections
  >['topRelativePrecisionRow'];
  topStationCovarianceRow: React.ComponentProps<
    typeof StationCovariancesSection
  >['topStationCovarianceRow'];
  topTypeSummaryEntry: React.ComponentProps<
    typeof ObservationResidualsSummarySections
  >['topTypeSummaryEntry'];
  typeSummaryEntries: React.ComponentProps<
    typeof ObservationResidualsSummarySections
  >['typeSummaryEntries'];
  typeSummaryObsCount: number;
  unitScale: number;
  units: ReportViewProps['units'];
  visibleRelativeCovariances: React.ComponentProps<
    typeof RelativeCovariancesSection
  >['visibleRelativeCovariances'];
  visibleRelativePrecision: React.ComponentProps<
    typeof ObservationResidualsSummarySections
  >['visibleRelativePrecision'];
  visibleRowsFor: React.ComponentProps<typeof ReportFilterAndCoordinatesSections>['visibleRowsFor'];
  visibleStationCovariances: React.ComponentProps<
    typeof StationCovariancesSection
  >['visibleStationCovariances'];
  weakGeometryDiagnostics: AdjustmentResult['weakGeometryDiagnostics'];
};

const ReportViewPrecisionResidualsBand: React.FC<ReportViewPrecisionResidualsBandProps> = ({
  allDetailSectionsCollapsed,
  autoSideshotObsIds,
  byType,
  clearFilters,
  covarianceScale,
  deferredReportFilterQuery,
  directionTreatmentDiagnostics,
  ellipseConfidenceScale,
  ellipseMode,
  ellipseScale,
  ellipseUnit,
  excludedIds,
  filteredObservationCount,
  filteredRelativeCovariances,
  filteredRelativePrecision,
  filteredStationCovariances,
  filteredStationRows,
  flaggedRelativeCues,
  flaggedStationCues,
  focusFilterRequestKey,
  formatEffectiveDistance,
  formatMdb,
  importedGroupOptions,
  isDataCheck,
  isDetailSectionPinned,
  isPreanalysis,
  isRegularAdjustment,
  isSectionCollapsed,
  logs,
  normalizedReportFilterQuery,
  observationWeightLabel,
  onEllipseModeChange,
  onHeaderRef,
  onReportExclusionFilterChange,
  onReportFilterQueryChange,
  onReportObservationTypeFilterChange,
  onReviewAdjustedOnlyChange,
  onReviewConflictOnlyChange,
  onReviewImportedGroupFilterChange,
  onSelectObservation,
  onSelectStation,
  onToggleExclude,
  parseState,
  preanalysisLabelTooltip,
  prismAnnotation,
  renderCollapsibleSectionHeader,
  renderLoadMoreFooter,
  renderSourceLineLink,
  reportExclusionFilter,
  reportFilterQuery,
  reportObservationTypeFilter,
  reviewAdjustedOnly,
  reviewConflictOnly,
  reviewImportedGroupFilter,
  rowSelectionClass,
  selectedObservationId,
  selectedStationId,
  showAllRows,
  showMoreRows,
  sortedObservationCount,
  stationDescription,
  stationTypeBadge,
  toggleDetailSection,
  togglePinnedDetailSection,
  topRelativeCovarianceRow,
  topRelativePrecisionRow,
  topStationCovarianceRow,
  topTypeSummaryEntry,
  typeSummaryEntries,
  typeSummaryObsCount,
  unitScale,
  units,
  visibleRelativeCovariances,
  visibleRelativePrecision,
  visibleRowsFor,
  visibleStationCovariances,
  weakGeometryDiagnostics,
}) => (
  <>
    <ReportFilterAndCoordinatesSections
      clearFilters={clearFilters}
      deferredReportFilterQuery={deferredReportFilterQuery}
      ellipseConfidenceScale={ellipseConfidenceScale}
      ellipseMode={ellipseMode}
      ellipseScale={ellipseScale}
      ellipseUnit={ellipseUnit}
      filteredObservationCount={filteredObservationCount}
      filteredStationRows={filteredStationRows}
      focusFilterRequestKey={focusFilterRequestKey}
      importedGroupOptions={importedGroupOptions}
      isDataCheck={isDataCheck}
      isPreanalysis={isPreanalysis}
      isSectionCollapsed={isSectionCollapsed}
      normalizedReportFilterQuery={normalizedReportFilterQuery}
      onEllipseModeChange={onEllipseModeChange}
      onReportExclusionFilterChange={onReportExclusionFilterChange}
      onReportFilterQueryChange={onReportFilterQueryChange}
      onReportObservationTypeFilterChange={onReportObservationTypeFilterChange}
      onReviewAdjustedOnlyChange={onReviewAdjustedOnlyChange}
      onReviewConflictOnlyChange={onReviewConflictOnlyChange}
      onReviewImportedGroupFilterChange={onReviewImportedGroupFilterChange}
      onSelectStation={onSelectStation}
      renderLoadMoreFooter={renderLoadMoreFooter}
      reportExclusionFilter={reportExclusionFilter}
      reportFilterQuery={reportFilterQuery}
      reportObservationTypeFilter={reportObservationTypeFilter}
      reviewAdjustedOnly={reviewAdjustedOnly}
      reviewConflictOnly={reviewConflictOnly}
      reviewImportedGroupFilter={reviewImportedGroupFilter}
      rowSelectionClass={rowSelectionClass}
      selectedStationId={selectedStationId}
      sortedObservationCount={sortedObservationCount}
      stationDescription={stationDescription}
      stationTypeBadge={stationTypeBadge}
      toggleDetailSection={toggleDetailSection}
      unitScale={unitScale}
      units={units}
      visibleRowsFor={visibleRowsFor}
    />

    <StationCovariancesSection
      covarianceScale={covarianceScale}
      filteredStationCovariances={filteredStationCovariances}
      isDetailSectionPinned={isDetailSectionPinned}
      isPreanalysis={isPreanalysis}
      isSectionCollapsed={isSectionCollapsed}
      onHeaderRef={onHeaderRef}
      parseState={parseState}
      preanalysisLabelTooltip={preanalysisLabelTooltip}
      renderLoadMoreFooter={renderLoadMoreFooter}
      toggleDetailSection={toggleDetailSection}
      togglePinnedDetailSection={togglePinnedDetailSection}
      topStationCovarianceRow={topStationCovarianceRow}
      units={units}
      visibleStationCovariances={visibleStationCovariances}
    />

    <RelativeCovariancesSection
      covarianceScale={covarianceScale}
      filteredRelativeCovariances={filteredRelativeCovariances}
      isDetailSectionPinned={isDetailSectionPinned}
      isPreanalysis={isPreanalysis}
      isSectionCollapsed={isSectionCollapsed}
      onHeaderRef={onHeaderRef}
      preanalysisLabelTooltip={preanalysisLabelTooltip}
      renderLoadMoreFooter={renderLoadMoreFooter}
      toggleDetailSection={toggleDetailSection}
      togglePinnedDetailSection={togglePinnedDetailSection}
      topRelativeCovarianceRow={topRelativeCovarianceRow}
      unitScale={unitScale}
      visibleRelativeCovariances={visibleRelativeCovariances}
    />

    <WeakGeometryCuesSection
      flaggedRelativeCues={flaggedRelativeCues}
      flaggedStationCues={flaggedStationCues}
      isDetailSectionPinned={isDetailSectionPinned}
      isPreanalysis={isPreanalysis}
      isSectionCollapsed={isSectionCollapsed}
      onHeaderRef={onHeaderRef}
      preanalysisLabelTooltip={preanalysisLabelTooltip}
      toggleDetailSection={toggleDetailSection}
      togglePinnedDetailSection={togglePinnedDetailSection}
      unitScale={unitScale}
      units={units}
      weakGeometryDiagnostics={weakGeometryDiagnostics}
    />

    <ObservationResidualsSummarySections
      allDetailSectionsCollapsed={allDetailSectionsCollapsed}
      ellipseConfidenceScale={ellipseConfidenceScale}
      ellipseScale={ellipseScale}
      ellipseUnit={ellipseUnit}
      filteredRelativePrecision={filteredRelativePrecision}
      isDataCheck={isDataCheck}
      isDetailSectionPinned={isDetailSectionPinned}
      isPreanalysis={isPreanalysis}
      isSectionCollapsed={isSectionCollapsed}
      onHeaderRef={onHeaderRef}
      renderLoadMoreFooter={renderLoadMoreFooter}
      toggleDetailSection={toggleDetailSection}
      togglePinnedDetailSection={togglePinnedDetailSection}
      topRelativePrecisionRow={topRelativePrecisionRow}
      topTypeSummaryEntry={topTypeSummaryEntry}
      typeSummaryEntries={typeSummaryEntries}
      typeSummaryObsCount={typeSummaryObsCount}
      unitScale={unitScale}
      units={units}
      visibleRelativePrecision={visibleRelativePrecision}
    >
      <ObservationTypeTables
        autoSideshotObsIds={autoSideshotObsIds}
        byType={byType}
        excludedIds={excludedIds}
        formatEffectiveDistance={formatEffectiveDistance}
        formatMdb={formatMdb}
        isDetailSectionPinned={isDetailSectionPinned}
        isSectionCollapsed={isSectionCollapsed}
        observationWeightLabel={observationWeightLabel}
        onHeaderRef={onHeaderRef}
        onSelectObservation={onSelectObservation}
        onToggleExclude={onToggleExclude}
        prismAnnotation={prismAnnotation}
        renderSourceLineLink={renderSourceLineLink}
        rowSelectionClass={rowSelectionClass}
        selectedObservationId={selectedObservationId}
        showAllRows={showAllRows}
        showMoreRows={showMoreRows}
        toggleDetailSection={toggleDetailSection}
        togglePinnedDetailSection={togglePinnedDetailSection}
        unitScale={unitScale}
        units={units}
        visibleRowsFor={visibleRowsFor}
      />
    </ObservationResidualsSummarySections>

    <ReportClosingSections
      directionTreatmentDiagnostics={directionTreatmentDiagnostics}
      isDataCheck={isDataCheck}
      isDetailSectionPinned={isDetailSectionPinned}
      isPreanalysis={isPreanalysis}
      isRegularAdjustment={isRegularAdjustment}
      isSectionCollapsed={isSectionCollapsed}
      logs={logs}
      onHeaderRef={onHeaderRef}
      renderCollapsibleSectionHeader={renderCollapsibleSectionHeader}
      renderSourceLineLink={renderSourceLineLink}
      toggleDetailSection={toggleDetailSection}
      togglePinnedDetailSection={togglePinnedDetailSection}
    />
  </>
);

export default ReportViewPrecisionResidualsBand;
