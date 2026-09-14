import React, { useMemo } from 'react';
import { LayerPanel } from '../components/surveyCad/LayerPanel';
import { SheetWorkspace } from '../components/surveyCad/SheetWorkspace';
import { parseCadDrawingFile } from '../engine/cad/cadDrawingFile';
import type { TitleBlockInstance } from '../engine/cad/cadSheets';
import type { CadDrawingDocument, CadEntity } from '../engine/cad/cadTypes';
import type { DraftDocument } from '../engine/cad/cadDraftTypes';

interface SurveyDraftingResultsProps {
  doc: CadDrawingDocument;
  draft: DraftDocument;
  titleBlocks: TitleBlockInstance[];
  pointTableRows: string[][];
  onReload: (_doc: CadDrawingDocument) => void;
  onReloadFailed: () => void;
}

// Dev-harness-only results block: layer panel, sheet preview, and table.
export const SurveyDraftingResults = ({
  doc,
  draft,
  titleBlocks,
  pointTableRows,
  onReload,
  onReloadFailed,
}: SurveyDraftingResultsProps): React.JSX.Element => {
  const sheet = draft.sheets[0];
  const entityCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    doc.project.entities.forEach((entity: CadEntity) => {
      counts[entity.layerId] = (counts[entity.layerId] ?? 0) + 1;
    });
    return counts;
  }, [doc.project.entities]);

  return (
    <>
      <label>
        Reload saved .wncad
        <input
          data-testid="draft-open-input"
          type="file"
          accept=".wncad,.json"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (!file) return;
            void file.text().then((text) => {
              const parsed = parseCadDrawingFile(text);
              if (parsed.ok) onReload(parsed.drawing);
              else onReloadFailed();
            });
          }}
        />
      </label>
      <LayerPanel layers={doc.project.layers} entityCounts={entityCounts} />
      <SheetWorkspace
        project={doc.project}
        draft={draft}
        activeSheetId={sheet?.id}
        titleBlocks={titleBlocks}
        projectName="Harness Plan"
      />
      {pointTableRows.length > 0 ? (
        <table data-testid="draft-point-table">
          <tbody>
            {pointTableRows.map((row) => (
              <tr key={row[0]}>
                {row.map((cell, index) => (
                  <td key={index}>{cell}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </>
  );
};
