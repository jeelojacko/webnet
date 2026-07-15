import React from 'react';

import type { SortedObservation } from '../../engine/resultDerivedModels';
import type { AdjustmentResult, Observation, Station } from '../../types';
import AdjustedCoordinatesSection from './AdjustedCoordinatesSection';
import ObservationTableSection from './ObservationTableSection';
import ReportFilterPanel from './ReportFilterPanel';
import SideshotSection from './SideshotSection';
import type { CollapsibleDetailSectionId } from './reportSectionRegistry';

type SideshotRows = NonNullable<AdjustmentResult['sideshots']>;
type SourceLineRenderer = (_line: number | null | undefined) => React.ReactNode;
type LoadMoreRenderer = (
  _key: string,
  _shownCount: number,
  _totalCount: number,
  _step?: number,
) => React.ReactNode;

type SectionControls = {
  isDetailSectionPinned: (_id: CollapsibleDetailSectionId) => boolean;
  isSectionCollapsed: (_id: CollapsibleDetailSectionId) => boolean;
  onHeaderRef: (_id: CollapsibleDetailSectionId, _node: HTMLDivElement | null) => void;
  toggleDetailSection: (_id: CollapsibleDetailSectionId) => void;
  togglePinnedDetailSection: (_id: CollapsibleDetailSectionId, _label: string) => void;
};

type SharedObservationTableProps = SectionControls & {
  autoSideshotObsIds: Set<number>;
  excludedIds: Set<number>;
  formatEffectiveDistance: (_value?: number) => string;
  formatMdb: (_value: number, _angular: boolean) => string;
  observationWeightLabel: (_observation: Observation) => string;
  onSelectObservation?: (_observationId: number) => void;
  onToggleExclude: (_observationId: number) => void;
  prismAnnotation: (_observation: Observation) => string;
  renderSourceLineLink: SourceLineRenderer;
  rowSelectionClass: (_selected: boolean) => string;
  selectedObservationId: number | null;
  showAllRows: (_key: string, _totalCount: number) => void;
  showMoreRows: (_key: string, _step?: number) => void;
  unitScale: number;
  units: 'm' | 'ft';
  visibleRowsFor: <T>(_key: string, _rows: T[], _defaultSize?: number) => T[];
};

const OBSERVATION_TABLES: Array<{
  sectionId: CollapsibleDetailSectionId;
  title: string;
  type: Observation['type'];
}> = [
  { type: 'angle', title: 'Angles (TS)', sectionId: 'angles-ts' },
  { type: 'direction', title: 'Directions (DB/DN)', sectionId: 'directions-db-dn' },
  { type: 'dist', title: 'Distances (TS)', sectionId: 'distances-ts' },
  { type: 'bearing', title: 'Bearings/Azimuths', sectionId: 'bearings-azimuths' },
  { type: 'dir', title: 'Directions (Azimuth)', sectionId: 'directions-azimuth' },
  { type: 'zenith', title: 'Zenith/Vertical Angles', sectionId: 'zenith-vertical-angles' },
  { type: 'gps', title: 'GPS Vectors', sectionId: 'gps-vectors' },
  { type: 'lev', title: 'Leveling dH', sectionId: 'leveling-dh' },
];

const ObservationTypeTables: React.FC<
  SharedObservationTableProps & {
    byType: (_type: Observation['type']) => SortedObservation[];
  }
> = ({ byType, ...tableProps }) => (
  <>
    {OBSERVATION_TABLES.map(({ sectionId, title, type }) => (
      <ObservationTableSection
        key={sectionId}
        obsList={byType(type)}
        title={title}
        sectionId={sectionId}
        {...tableProps}
      />
    ))}
  </>
);

export const PostAdjustedSideshotSections: React.FC<
  SectionControls & {
    gpsCoordinateSideshots: SideshotRows;
    gpsSideshots: SideshotRows;
    gpsVectorSideshots: SideshotRows;
    isDataCheck: boolean;
    renderSourceLineLink: SourceLineRenderer;
    tsSideshots: SideshotRows;
    unitScale: number;
    units: 'm' | 'ft';
  }
> = ({
  gpsCoordinateSideshots,
  gpsSideshots,
  gpsVectorSideshots,
  isDataCheck,
  isDetailSectionPinned,
  isSectionCollapsed,
  onHeaderRef,
  renderSourceLineLink,
  toggleDetailSection,
  togglePinnedDetailSection,
  tsSideshots,
  unitScale,
  units,
}) => {
  if (isDataCheck || (tsSideshots.length === 0 && gpsSideshots.length === 0)) return null;

  const renderSideshotSection = (
    title: string,
    rows: SideshotRows,
    sectionId: CollapsibleDetailSectionId,
  ) => (
    <SideshotSection
      title={title}
      rows={rows}
      units={units}
      unitScale={unitScale}
      sectionId={sectionId}
      collapsed={isSectionCollapsed(sectionId)}
      pinned={isDetailSectionPinned(sectionId)}
      onToggleCollapse={toggleDetailSection}
      onTogglePin={togglePinnedDetailSection}
      onHeaderRef={onHeaderRef}
      renderSourceLineLink={renderSourceLineLink}
    />
  );

  return (
    <>
      {renderSideshotSection('Post-Adjusted Sideshots (TS)', tsSideshots, 'post-adjusted-sideshots-ts')}
      {renderSideshotSection(
        'Post-Adjusted GPS Sideshot Vectors',
        gpsVectorSideshots,
        'post-adjusted-gps-sideshot-vectors',
      )}
      {renderSideshotSection(
        'Post-Adjusted GNSS Topo Coordinates (GS)',
        gpsCoordinateSideshots,
        'post-adjusted-gnss-topo-coordinates',
      )}
    </>
  );
};

export const ReportFilterAndCoordinatesSections: React.FC<{
  clearFilters: () => void;
  deferredReportFilterQuery: string;
  ellipseConfidenceScale: number;
  ellipseMode: '1sigma' | '95';
  ellipseScale: number;
  ellipseUnit: string;
  filteredObservationCount: number;
  filteredStationRows: Array<[string, Station]>;
  focusFilterRequestKey: number;
  importedGroupOptions: string[];
  isDataCheck: boolean;
  isPreanalysis: boolean;
  isSectionCollapsed: (_id: CollapsibleDetailSectionId) => boolean;
  normalizedReportFilterQuery: string;
  onEllipseModeChange: (_mode: '1sigma' | '95') => void;
  onReportExclusionFilterChange: (_value: 'all' | 'included' | 'excluded') => void;
  onReportFilterQueryChange: (_value: string) => void;
  onReportObservationTypeFilterChange: (_value: 'all' | Observation['type']) => void;
  onReviewAdjustedOnlyChange: (_value: boolean) => void;
  onReviewConflictOnlyChange: (_value: boolean) => void;
  onReviewImportedGroupFilterChange: (_value: string) => void;
  onSelectStation?: (_stationId: string) => void;
  renderLoadMoreFooter: LoadMoreRenderer;
  reportExclusionFilter: 'all' | 'included' | 'excluded';
  reportFilterQuery: string;
  reportObservationTypeFilter: 'all' | Observation['type'];
  reviewAdjustedOnly: boolean;
  reviewConflictOnly: boolean;
  reviewImportedGroupFilter: string;
  rowSelectionClass: (_selected: boolean) => string;
  selectedStationId: string | null;
  sortedObservationCount: number;
  stationDescription: (_stationId: string) => string;
  stationTypeBadge: (_station: Station) => { label: string; className: string; title: string };
  toggleDetailSection: (_id: CollapsibleDetailSectionId) => void;
  unitScale: number;
  units: 'm' | 'ft';
  visibleRowsFor: <T>(_key: string, _rows: T[], _defaultSize?: number) => T[];
}> = ({
  clearFilters,
  deferredReportFilterQuery,
  ellipseConfidenceScale,
  ellipseMode,
  ellipseScale,
  ellipseUnit,
  filteredObservationCount,
  filteredStationRows,
  focusFilterRequestKey,
  importedGroupOptions,
  isDataCheck,
  isPreanalysis,
  isSectionCollapsed,
  normalizedReportFilterQuery,
  onEllipseModeChange,
  onReportExclusionFilterChange,
  onReportFilterQueryChange,
  onReportObservationTypeFilterChange,
  onReviewAdjustedOnlyChange,
  onReviewConflictOnlyChange,
  onReviewImportedGroupFilterChange,
  onSelectStation,
  renderLoadMoreFooter,
  reportExclusionFilter,
  reportFilterQuery,
  reportObservationTypeFilter,
  reviewAdjustedOnly,
  reviewConflictOnly,
  reviewImportedGroupFilter,
  rowSelectionClass,
  selectedStationId,
  sortedObservationCount,
  stationDescription,
  stationTypeBadge,
  toggleDetailSection,
  unitScale,
  units,
  visibleRowsFor,
}) => {
  if (isDataCheck) return null;

  return (
    <>
      <ReportFilterPanel
        isPreanalysis={isPreanalysis}
        sectionId="report-filters"
        collapsed={isSectionCollapsed('report-filters')}
        onToggleCollapse={toggleDetailSection}
        reportFilterQuery={reportFilterQuery}
        onReportFilterQueryChange={onReportFilterQueryChange}
        reportObservationTypeFilter={reportObservationTypeFilter}
        onReportObservationTypeFilterChange={onReportObservationTypeFilterChange}
        reportExclusionFilter={reportExclusionFilter}
        onReportExclusionFilterChange={onReportExclusionFilterChange}
        reviewConflictOnly={reviewConflictOnly}
        onReviewConflictOnlyChange={onReviewConflictOnlyChange}
        reviewAdjustedOnly={reviewAdjustedOnly}
        onReviewAdjustedOnlyChange={onReviewAdjustedOnlyChange}
        reviewImportedGroupFilter={reviewImportedGroupFilter}
        onReviewImportedGroupFilterChange={onReviewImportedGroupFilterChange}
        importedGroupOptions={importedGroupOptions}
        onClearFilters={clearFilters}
        filteredObservationCount={filteredObservationCount}
        totalObservationCount={sortedObservationCount}
        deferredReportFilterQuery={deferredReportFilterQuery}
        normalizedReportFilterQuery={normalizedReportFilterQuery}
        focusRequestKey={focusFilterRequestKey}
      />

      <AdjustedCoordinatesSection
        isPreanalysis={isPreanalysis}
        units={units}
        ellipseMode={ellipseMode}
        onEllipseModeChange={onEllipseModeChange}
        ellipseUnit={ellipseUnit}
        ellipseConfidenceScale={ellipseConfidenceScale}
        ellipseScale={ellipseScale}
        filteredStationRows={filteredStationRows}
        selectedStationId={selectedStationId}
        onSelectStation={onSelectStation}
        stationDescription={stationDescription}
        stationTypeBadge={stationTypeBadge}
        rowSelectionClass={rowSelectionClass}
        unitScale={unitScale}
        visibleRowsFor={visibleRowsFor}
        renderLoadMoreFooter={renderLoadMoreFooter}
      />
    </>
  );
};

export { ObservationTypeTables };
