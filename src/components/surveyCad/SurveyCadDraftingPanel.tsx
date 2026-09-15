import React, { useMemo, useState } from 'react';
import { createStableRuntimeId } from '../../engine/id';
import type { DraftDocument } from '../../engine/cad/cadDraftTypes';
import type { CadLayer, CadProject } from '../../engine/cad/cadTypes';
import type { FieldToFinishCadPayload } from '../../engine/fieldToFinish/cadGeneration';
import { LayerPanel } from './LayerPanel';
import { SurveyCadFieldToFinishPanel } from './SurveyCadFieldToFinishPanel';
import { SheetWorkspace } from './SheetWorkspace';
import { TitleBlockTemplateEditor } from './TitleBlockTemplateEditor';

type DraftingTab = 'SHEETS' | 'LAYERS' | 'TITLE_BLOCKS' | 'FIELD_TO_FINISH';

interface SurveyCadDraftingPanelProps {
  project: CadProject;
  draft: DraftDocument | undefined;
  onProjectLayersChange: (_layers: CadLayer[]) => void;
  onDraftChange: (_draft: DraftDocument) => void;
  onClose: () => void;
  onCommitFieldToFinishPayload?: (_payload: FieldToFinishCadPayload) => void;
}

export const SurveyCadDraftingPanel = ({
  project,
  draft,
  onProjectLayersChange,
  onDraftChange,
  onClose,
  onCommitFieldToFinishPayload,
}: SurveyCadDraftingPanelProps): React.JSX.Element => {
  const [tab, setTab] = useState<DraftingTab>('SHEETS');
  const entityCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    project.entities.forEach((entity) => {
      counts[entity.layerId] = (counts[entity.layerId] ?? 0) + 1;
    });
    return counts;
  }, [project.entities]);

  const update = (next: CadLayer[]): void => {
    onProjectLayersChange(next);
  };

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
          <SurveyCadFieldToFinishPanel project={project} onCommitPayload={onCommitFieldToFinishPayload} />
        ) : (
          <p className="text-[12px] text-slate-400">
            Field-to-Finish commit is unavailable in this context.
          </p>
        )
      ) : (
        <LayerPanel
          layers={project.layers}
          entityCounts={entityCounts}
          onCreate={(name) =>
            update([
              ...project.layers,
              {
                id: createStableRuntimeId('cad-layer'),
                name,
                color: '#ffffff',
                visible: true,
                locked: false,
                role: 'planning',
              },
            ])
          }
          onRename={(layerId, name) =>
            update(project.layers.map((layer) => (layer.id === layerId ? { ...layer, name } : layer)))
          }
          onToggleVisibility={(layerId, visible) =>
            update(
              project.layers.map((layer) => (layer.id === layerId ? { ...layer, visible } : layer)),
            )
          }
          onToggleLocked={(layerId, locked) =>
            update(
              project.layers.map((layer) => (layer.id === layerId ? { ...layer, locked } : layer)),
            )
          }
          onTogglePrintable={(layerId, printable) =>
            update(
              project.layers.map((layer) => (layer.id === layerId ? { ...layer, printable } : layer)),
            )
          }
          onDelete={(layerId) => {
            if ((entityCounts[layerId] ?? 0) > 0) return;
            update(project.layers.filter((layer) => layer.id !== layerId));
          }}
        />
      )}
    </section>
  );
};
