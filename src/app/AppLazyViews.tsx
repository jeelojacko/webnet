import React from 'react';
import {
  loadImportReviewModal,
  loadIndustryOutputView,
  loadMapView,
  loadProcessingSummaryView,
  loadProjectOptionsModal,
  loadReportView,
} from './AppLazyLoaders';

export const ImportReviewModal = React.lazy(loadImportReviewModal);
export const ReportView = React.lazy(loadReportView);
export const MapView = React.lazy(loadMapView);
export const ProcessingSummaryView = React.lazy(loadProcessingSummaryView);
export const IndustryOutputView = React.lazy(loadIndustryOutputView);
export const ProjectOptionsModal = React.lazy(loadProjectOptionsModal);
