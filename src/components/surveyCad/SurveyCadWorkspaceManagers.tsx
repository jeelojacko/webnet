import type {
  ChangeEvent,
  ComponentProps,
  Dispatch,
  ReactNode,
  RefObject,
  SetStateAction,
} from 'react';
import type { CadProject, CadDrawingDocument } from '../../engine/cad/cadTypes';
import type { DraftDocument } from '../../engine/cad/cadDraftTypes';
import type { FeatureCodeCatalog } from '../../engine/fieldToFinish/featureCatalog';
import type { GradingTerminationKind } from '../../engine/cad/grading/gradingTypes';
import type { DrawingDependencySummary } from '../../engine/cad/cadAdjustmentDependency';
import type { ResultDependencyIdentity } from '../../engine/resultIntegrity';
import type { AdjustmentResult } from '../../types';
import type { SuccessfulAdjustmentRunInfo } from '../../hooks/useAdjustmentOutcomeApplication';
import type { AdjustmentSourceSnapshot } from '../../cad-app/cadSourceBridge';
import type { CadShellLink } from '../../cad-app/shell/cadShellLink';
import type {
  CadShellActions,
  CadWorkspaceSnapshot,
  SurveyManagerKind,
} from '../../cad-app/shell/cadShellTypes';
import type { useSurveyCadWorkspace } from '../../hooks/surveyCad/useSurveyCadWorkspace';
import { CadGradingGroupManager } from '../../cad-app/shell/CadGradingGroupManager';
import { CadGradingManager } from '../../cad-app/shell/CadGradingManager';
import { CadProfileManager } from '../../cad-app/shell/CadProfileManager';
import { CadSampleLineManager } from '../../cad-app/shell/CadSampleLineManager';
import { CadSurfaceManager } from '../../cad-app/shell/CadSurfaceManager';
import { LandXmlImportReviewModal } from '../landXmlImportReview/LandXmlImportReviewModal';
import { ExportCenterPanel } from './ExportCenterPanel';
import SurveyCadCommandToolbar from './SurveyCadCommandToolbar';
import { SurveyCadDraftingPanel, type SurveyCadDraftingTab } from './SurveyCadDraftingPanel';
import { SurveyPointGroupManager } from './SurveyPointGroupManager';
import { SurveyPointLabelStyleManager } from './SurveyPointLabelStyleManager';
import { SurveyPointStyleManager } from './SurveyPointStyleManager';
import SurveyCadWorkspaceEditForms, {
  type SurveyCadWorkspaceEditFormsProps,
} from './SurveyCadWorkspaceEditForms';
import { validateSetCurrent } from './LayerPanel.guards';
import {
  formatDependencyChipText,
  getDependencyAction,
} from './cadDependencyDiagnostics';

type SurveyCadWorkspaceValue = ReturnType<typeof useSurveyCadWorkspace>;
type DraftingPanelProps = ComponentProps<typeof SurveyCadDraftingPanel>;
type ExportCenterProps = ComponentProps<typeof ExportCenterPanel>;
type ToolbarProps = ComponentProps<typeof SurveyCadCommandToolbar>;
type LandXmlModalProps = ComponentProps<typeof LandXmlImportReviewModal>;

export interface SurveyCadWorkspaceFileInputs {
  onDrawingFileChange: (_event: ChangeEvent<HTMLInputElement>) => void;
  onLandXmlFileChange: (_event: ChangeEvent<HTMLInputElement>) => void;
}

export interface SurveyCadWorkspaceChrome {
  shellChrome: boolean;
  drawingName: string;
  fileStatusText: string;
  dependencySummary: DrawingDependencySummary;
  hasAdjustmentSource: boolean;
  adjustmentSnapshot: AdjustmentSourceSnapshot | null;
  result: AdjustmentResult | null;
  canFeedDraftingFromResult: boolean;
  resultDependencyIdentity: ResultDependencyIdentity | null;
  onNewDrawing: () => void;
  onSaveDrawing: () => void;
  onImportAdjustedPoints: () => void;
  onToggleDraftingPanel: () => void;
  onToggleExportCenter: () => void;
}

export interface SurveyCadWorkspaceDraftingPanelGroup {
  open: boolean;
  project: CadProject;
  initialTab: SurveyCadDraftingTab;
  draft: DraftDocument | undefined;
  workspace: SurveyCadWorkspaceValue;
  activeDrawing: CadDrawingDocument;
  shellLink: CadShellLink | null;
  replaceActiveDrawing: (_drawing: CadDrawingDocument, _statusText: string) => void;
  setFileStatusText: (_text: string) => void;
  onClose: () => void;
  catalog: FeatureCodeCatalog;
  onCatalogChange: DraftingPanelProps['onCatalogChange'];
  catalogStatus: DraftingPanelProps['catalogStatus'];
  catalogIsFallback: boolean;
  catalogHasLegacyContent: boolean;
  referenceCounts: Record<string, number>;
  fieldToFinishSettings: DraftingPanelProps['fieldToFinishSettings'];
  onFieldToFinishSettingsChange: DraftingPanelProps['onFieldToFinishSettingsChange'];
  f2fSection: string | null;
  adjustmentSource: SuccessfulAdjustmentRunInfo | null;
}

export interface SurveyCadWorkspaceManagersGroup {
  surveyManager: { kind: SurveyManagerKind; selectedId?: string } | null;
  setSurveyManager: Dispatch<
    SetStateAction<{ kind: SurveyManagerKind; selectedId?: string } | null>
  >;
  workspace: SurveyCadWorkspaceValue;
  project: CadProject;
  catalog: FeatureCodeCatalog;
  featureCatalogRef: RefObject<FeatureCodeCatalog>;
  onCatalogChange: (_catalog: FeatureCodeCatalog) => void;
  shellSnapshot: CadWorkspaceSnapshot | null;
  shellActions: CadShellActions;
  surfacePick: { surfaceId: string; mode: 'elevation' | 'slope' } | null;
  volumePick: { volumeId: string } | null;
  volumePickAnswer: { volumeId: string; text: string } | null;
  analysisPick: { analysisId: string } | null;
  analysisPickAnswer: { analysisId: string; text: string } | null;
  gradingManagerTab: 'definition' | 'inquiry';
  gradingManagerMethod: GradingTerminationKind;
  groupManagerTab: 'definition' | 'criteria' | 'inquiry';
}

export interface SurveyCadWorkspaceExportCenterGroup {
  open: boolean;
  props: ExportCenterProps;
}

export interface SurveyCadWorkspaceManagersProps {
  drawingFileInputRef: RefObject<HTMLInputElement | null>;
  landXmlFileInputRef: RefObject<HTMLInputElement | null>;
  fileInputs: SurveyCadWorkspaceFileInputs;
  chrome: SurveyCadWorkspaceChrome;
  toolbar: ToolbarProps;
  draftingPanel: SurveyCadWorkspaceDraftingPanelGroup;
  managers: SurveyCadWorkspaceManagersGroup;
  exportCenter: SurveyCadWorkspaceExportCenterGroup;
  /** Null until a LandXML preview is staged (modal is never mounted otherwise). */
  landXml: LandXmlModalProps | null;
  editForms: SurveyCadWorkspaceEditFormsProps;
  children?: ReactNode;
}

const catalogRewire = (
  managers: SurveyCadWorkspaceManagersGroup,
  table: 'point' | 'label',
  fromId: string,
  toId: string,
) => {
  managers.onCatalogChange({
    ...managers.featureCatalogRef.current,
    definitions: managers.featureCatalogRef.current.definitions.map((def) =>
      table === 'point' && def.pointStyleId === fromId
        ? { ...def, pointStyleId: toId }
        : table === 'label' && def.labelStyleId === fromId
          ? { ...def, labelStyleId: toId }
          : def,
    ),
  });
};

/**
 * STRUCT-194.1 — dedicated-page chrome + conditional manager overlays,
 * extracted from SurveyCadWorkspace. Purely presentational: every ref,
 * handler, and live source object stays owned by the parent, which passes the
 * interaction surface as `children` so the drawing/pick handlers are never
 * rebuilt here. The dependency chip always renders (independent of
 * `shellChrome`), matching the pre-extraction behavior.
 */
const SurveyCadWorkspaceManagers = ({
  drawingFileInputRef,
  landXmlFileInputRef,
  fileInputs,
  chrome,
  toolbar,
  draftingPanel,
  managers,
  exportCenter,
  landXml,
  editForms,
  children,
}: SurveyCadWorkspaceManagersProps) => {
  const dependencyAction = getDependencyAction(chrome.dependencySummary);
  const exportCenterProps = exportCenter.props;
  return (
    <div className="h-full min-h-0 overflow-hidden bg-slate-950 text-slate-100" data-survey-cad-dedicated-page>
      <input
        ref={drawingFileInputRef}
        type="file"
        accept=".wncad,.json,.survey-cad.json"
        className="hidden"
        onChange={fileInputs.onDrawingFileChange}
        data-survey-cad-open-drawing-input
      />
      <input
        ref={landXmlFileInputRef}
        type="file"
        accept=".xml"
        className="hidden"
        onChange={fileInputs.onLandXmlFileChange}
        data-landxml-import-input
      />
      <div className="relative h-full min-h-0 bg-slate-950">
        {chrome.shellChrome ? null : (
          <div className="absolute left-3 right-3 top-1 z-40 flex items-center justify-between gap-2 px-2 text-[11px] text-slate-300">
            <div className="min-w-0 truncate" data-survey-cad-drawing-title>
              {chrome.drawingName}
            </div>
            <div className="flex flex-wrap items-center justify-end gap-1">
              <button type="button" className="rounded border border-slate-600 bg-slate-900 px-2 py-1 text-slate-100 hover:bg-slate-800" onClick={chrome.onNewDrawing} data-survey-cad-new-drawing>
                New Drawing
              </button>
              <button type="button" className="rounded border border-slate-600 bg-slate-900 px-2 py-1 text-slate-100 hover:bg-slate-800" onClick={() => drawingFileInputRef.current?.click()} data-survey-cad-open-drawing>
                Open Drawing
              </button>
              <button type="button" className="rounded border border-slate-600 bg-slate-900 px-2 py-1 text-slate-100 hover:bg-slate-800" onClick={chrome.onSaveDrawing} data-survey-cad-save-drawing>
                Save Drawing
              </button>
              <button type="button" className="rounded border border-slate-600 bg-slate-900 px-2 py-1 text-slate-100 hover:bg-slate-800" onClick={chrome.onSaveDrawing} data-survey-cad-save-drawing-as>
                Save Drawing As
              </button>
              <button type="button" className="rounded border border-slate-600 bg-slate-900 px-2 py-1 text-slate-100 hover:bg-slate-800" onClick={chrome.onSaveDrawing} data-survey-cad-export-drawing>
                Export Drawing
              </button>
              <button type="button" className="rounded border border-slate-600 bg-slate-900 px-2 py-1 text-slate-100 hover:bg-slate-800" onClick={chrome.onToggleDraftingPanel} data-survey-cad-drafting-panels>
                Sheets &amp; Layers
              </button>
              <button type="button" className="rounded border border-slate-600 bg-slate-900 px-2 py-1 text-slate-100 hover:bg-slate-800" onClick={chrome.onToggleExportCenter} data-survey-cad-export-center>
                Export Center
              </button>
              {chrome.hasAdjustmentSource ? (
                <button
                  type="button"
                  className="rounded border border-sky-500 bg-sky-950 px-2 py-1 text-sky-100 hover:bg-sky-900 disabled:cursor-not-allowed disabled:border-slate-700 disabled:bg-slate-900 disabled:text-slate-500"
                  onClick={chrome.onImportAdjustedPoints}
                  disabled={chrome.adjustmentSnapshot != null ? false : (!chrome.result || !chrome.canFeedDraftingFromResult || !chrome.resultDependencyIdentity)}
                  title={
                    chrome.adjustmentSnapshot != null
                      ? 'Import adjusted points from the published adjustment source'
                      : chrome.canFeedDraftingFromResult
                        ? 'Import adjusted points from the current result'
                        : 'Import blocked: the adjustment result is not current'
                  }
                  data-survey-cad-import-adjusted-points
                >
                  Import Adjusted Points
                </button>
              ) : null}
            </div>
          </div>
        )}
        {chrome.fileStatusText ? (
          <div className="pointer-events-none absolute left-5 top-9 z-40 max-w-xl truncate text-[11px] text-slate-400" data-survey-cad-file-status>
            {chrome.fileStatusText}
          </div>
        ) : null}
        <div
          className="pointer-events-none absolute left-5 top-14 z-40 max-w-xl truncate text-[11px] text-slate-300"
          data-survey-cad-dependency-status
          title={dependencyAction ?? undefined}
        >
          {formatDependencyChipText(chrome.dependencySummary)}
        </div>
        {chrome.shellChrome ? null : <SurveyCadCommandToolbar {...toolbar} />}
        {draftingPanel.open ? (
          <SurveyCadDraftingPanel
            project={draftingPanel.project}
            initialTab={draftingPanel.initialTab}
            draft={draftingPanel.draft}
            onLayerCommand={(command) => void draftingPanel.workspace.runLayerCommand(command)}
            onSetCurrentLayer={(layerId) => {
              if (validateSetCurrent(draftingPanel.project.layers, layerId) != null) return;
              void draftingPanel.workspace.runLayerCommand({ key: 'LAYER_SET_CURRENT', layerId });
            }}
            onDraftChange={(draft) => {
              if (draftingPanel.shellLink?.requestDraftCommit) {
                draftingPanel.shellLink.requestDraftCommit(draft);
                draftingPanel.setFileStatusText('Updated title block template.');
                return;
              }
              draftingPanel.replaceActiveDrawing({ ...draftingPanel.activeDrawing, draft }, 'Updated title block template.');
            }}
            onClose={draftingPanel.onClose}
            onCommitFieldToFinishPayload={draftingPanel.workspace.commitFieldToFinishPayload}
            catalog={draftingPanel.catalog}
            onCatalogChange={draftingPanel.onCatalogChange}
            catalogStatus={draftingPanel.catalogStatus}
            catalogIsFallback={draftingPanel.catalogIsFallback}
            catalogHasLegacyContent={draftingPanel.catalogHasLegacyContent}
            referenceCounts={draftingPanel.referenceCounts}
            fieldToFinishSettings={draftingPanel.fieldToFinishSettings}
            onFieldToFinishSettingsChange={draftingPanel.onFieldToFinishSettingsChange}
            f2fSection={draftingPanel.f2fSection}
            adjustmentSource={draftingPanel.adjustmentSource}
          />
        ) : null}
        {managers.surveyManager?.kind === 'point-styles' ? (
          <SurveyPointStyleManager
            project={managers.project}
            catalog={managers.catalog}
            onSurveyCommand={(command) => managers.workspace.runLayerCommand(command)}
            onCatalogRewire={(table, fromId, toId) => catalogRewire(managers, table, fromId, toId)}
            initialSelectedId={managers.surveyManager.selectedId}
            onClose={() => managers.setSurveyManager(null)}
          />
        ) : null}
        {managers.surveyManager?.kind === 'point-label-styles' ? (
          <SurveyPointLabelStyleManager
            project={managers.project}
            catalog={managers.catalog}
            onSurveyCommand={(command) => managers.workspace.runLayerCommand(command)}
            onCatalogRewire={(table, fromId, toId) => catalogRewire(managers, table, fromId, toId)}
            initialSelectedId={managers.surveyManager.selectedId}
            onClose={() => managers.setSurveyManager(null)}
          />
        ) : null}
        {managers.surveyManager?.kind === 'point-groups' ? (
          <SurveyPointGroupManager
            project={managers.project}
            onSurveyCommand={(command) => managers.workspace.runLayerCommand(command)}
            initialSelectedId={managers.surveyManager.selectedId}
            onClose={() => managers.setSurveyManager(null)}
          />
        ) : null}
        {managers.surveyManager?.kind === 'surfaces' && managers.shellSnapshot ? (
          <CadSurfaceManager
            snapshot={managers.shellSnapshot}
            actions={managers.shellActions}
            initialSelectedId={managers.surveyManager.selectedId}
            pickArmedFor={managers.surfacePick?.surfaceId ?? null}
            volumePickArmedFor={managers.volumePick?.volumeId ?? null}
            volumePickAnswer={managers.volumePickAnswer}
            analysisPickArmedFor={managers.analysisPick?.analysisId ?? null}
            analysisPickAnswer={managers.analysisPickAnswer}
            onClose={() => managers.setSurveyManager(null)}
          />
        ) : null}
        {managers.surveyManager?.kind === 'profiles' && managers.shellSnapshot ? (
          <CadProfileManager
            snapshot={managers.shellSnapshot}
            actions={managers.shellActions}
            onClose={() => managers.setSurveyManager(null)}
          />
        ) : null}
        {managers.surveyManager?.kind === 'sections' && managers.shellSnapshot ? (
          <CadSampleLineManager
            snapshot={managers.shellSnapshot}
            actions={managers.shellActions}
            onClose={() => managers.setSurveyManager(null)}
          />
        ) : null}
        {managers.surveyManager?.kind === 'gradings' && managers.shellSnapshot ? (
          <CadGradingManager
            snapshot={managers.shellSnapshot}
            actions={managers.shellActions}
            initialSelectedId={managers.surveyManager.selectedId}
            initialTab={managers.gradingManagerTab}
            initialMethod={managers.gradingManagerMethod}
            onClose={() => managers.setSurveyManager(null)}
          />
        ) : null}
        {managers.surveyManager?.kind === 'grading-groups' && managers.shellSnapshot ? (
          <CadGradingGroupManager
            snapshot={managers.shellSnapshot}
            actions={managers.shellActions}
            initialSelectedId={managers.surveyManager.selectedId}
            initialTab={managers.groupManagerTab}
            onClose={() => managers.setSurveyManager(null)}
          />
        ) : null}
        {exportCenter.open ? <ExportCenterPanel {...exportCenterProps} /> : null}
        {landXml ? <LandXmlImportReviewModal {...landXml} /> : null}
        <SurveyCadWorkspaceEditForms {...editForms} />
        {children}
      </div>
    </div>
  );
};

export default SurveyCadWorkspaceManagers;
