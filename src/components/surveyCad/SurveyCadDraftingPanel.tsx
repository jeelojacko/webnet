import React, { useMemo, useState } from 'react';
import type { DraftDocument } from '../../engine/cad/cadDraftTypes';
import type { CadProject } from '../../engine/cad/cadTypes';
import { resolveCurrentCadLayerId } from '../../engine/cad/cadLayers';
import type { FieldToFinishCadPayload } from '../../engine/fieldToFinish/cadGeneration';
import type { FeatureCodeCatalog } from '../../engine/fieldToFinish/featureCatalog';
import type { SuccessfulAdjustmentRunInfo } from '../../hooks/useAdjustmentOutcomeApplication';
import { LayerPanel } from './LayerPanel';
import type { LayerManagerCommand } from './LayerPanel.types';
import { SurveyCadFieldToFinishPanel } from './SurveyCadFieldToFinishPanel';
import { SheetWorkspace } from './SheetWorkspace';
import { TitleBlockTemplateEditor } from './TitleBlockTemplateEditor';

export type SurveyCadDraftingTab = 'SHEETS' | 'LAYERS' | 'TITLE_BLOCKS' | 'FIELD_TO_FINISH';

interface SurveyCadDraftingPanelProps {
  project: CadProject;
  initialTab?: SurveyCadDraftingTab;
  draft: DraftDocument | undefined;
  /** Undoable layer-table mutations (LAYER_* transactions, never replace). */
  onLayerCommand: (_command: LayerManagerCommand) => void;
  /** Guarded set-current (must exist/ON/thawed). */
  onSetCurrentLayer: (_layerId: string) => void;
  onDraftChange: (_draft: DraftDocument) => void;
  onClose: () => void;
  onCommitFieldToFinishPayload?: (_payload: FieldToFinishCadPayload) => void;
  /** Workspace-owned active catalog, shared with the Export Center. */
  catalog?: FeatureCodeCatalog;
  onCatalogChange?: (_catalog: FeatureCodeCatalog) => void;
  /** Latest successful production run; enables the explicit adjustment-linked commit. */
  adjustmentSource?: SuccessfulAdjustmentRunInfo | null;
}

export const SurveyCadDraftingPanel = ({
  project,
  initialTab = 'SHEETS',
  draft,
  onLayerCommand,
  onSetCurrentLayer,
  onDraftChange,
  onClose,
  onCommitFieldToFinishPayload,
  catalog,
  onCatalogChange,
  adjustmentSource = null,
}: SurveyCadDraftingPanelProps): React.JSX.Element => {
  const [tab, setTab] = useState<SurveyCadDraftingTab>(initialTab);
  const entityCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const entity of project.entities) counts[entity.layerId] = (counts[entity.layerId] ?? 0) + 1;
    return counts;
  }, [project.entities]);

  return (
    <section
      aria-label="Sheets and layers"
      className="absolute right-3 top-16 z-40 max-h-[80%] w-[520px] overflow-auto rounded border border-slate-600 bg-slate-900 p-3 text-slate-100"
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <div role="tablist" aria-label="Drafting panels" className="flex gap-1">
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'SHEETS'}
            className="rounded border border-slate-600 px-2 py-1 hover:bg-slate-800"
            onClick={() => setTab('SHEETS')}
          >
            Sheets
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'LAYERS'}
            className="rounded border border-slate-600 px-2 py-1 hover:bg-slate-800"
            onClick={() => setTab('LAYERS')}
          >
            Layers
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'TITLE_BLOCKS'}
            className="rounded border border-slate-600 px-2 py-1 hover:bg-slate-800"
            onClick={() => setTab('TITLE_BLOCKS')}
          >
            Title Blocks
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'FIELD_TO_FINISH'}
            className="rounded border border-slate-600 px-2 py-1 hover:bg-slate-800"
            onClick={() => setTab('FIELD_TO_FINISH')}
          >
            Field-to-Finish
          </button>
        </div>
        <button
          type="button"
          className="rounded border border-slate-600 px-2 py-1 hover:bg-slate-800"
          onClick={onClose}
          data-survey-cad-close-drafting-panel
        >
          Close
        </button>
      </div>
      {tab === 'SHEETS' ? (
        draft && draft.sheets.length > 0 ? (
          <SheetWorkspace project={project} draft={draft} projectName={project.name} />
        ) : (
          <p className="text-[12px] text-slate-400">
            No sheets yet. Sheets are created with the plan viewport from the current model.
          </p>
        )
      ) : tab === 'TITLE_BLOCKS' ? (
        draft ? (
          <TitleBlockTemplateEditor draft={draft} projectName={project.name} onDraftChange={onDraftChange} />
        ) : (
          <p className="text-[12px] text-slate-400">No draft yet. Title blocks live on the draft document.</p>
        )
      ) : tab === 'FIELD_TO_FINISH' ? (
        onCommitFieldToFinishPayload ? (
          <SurveyCadFieldToFinishPanel project={project} onCommitPayload={onCommitFieldToFinishPayload} catalog={catalog} onCatalogChange={onCatalogChange} adjustmentSource={adjustmentSource} />
        ) : (
          <p className="text-[12px] text-slate-400">
            Field-to-Finish commit is unavailable in this context.
          </p>
        )
      ) : (
        <LayerPanel
          layers={project.layers}
          currentLayerId={resolveCurrentCadLayerId(project)}
          lineTypes={project.styleLibrary.lineTypes}
          entityCounts={entityCounts}
          onLayerCommand={onLayerCommand}
          onSetCurrent={onSetCurrentLayer}
        />
      )}
    </section>
  );
};
