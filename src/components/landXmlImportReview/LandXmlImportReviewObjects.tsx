import React from 'react';
import type { LandXmlImportPreview } from '../../engine/landxmlImport';
import { isLandXmlImportable } from './landXmlImportReview.selection';
import type { LandXmlImportReviewSelection } from './landXmlImportReview.types';
import { LandXmlImportDispositionBadge } from './LandXmlImportDispositionBadge';

interface LandXmlImportReviewObjectsProps {
  preview: LandXmlImportPreview;
  selection: LandXmlImportReviewSelection;
  onTogglePoints: () => void;
  onToggleAlignment: (_name: string) => void;
  onToggleSurface: (_name: string) => void;
}

const Row: React.FC<{
  checked: boolean;
  disabled: boolean;
  onChange: () => void;
  label: React.ReactNode;
  ariaLabel: string;
  meta?: string;
  dataAttribute?: string;
}> = ({ checked, disabled, onChange, label, ariaLabel, meta, dataAttribute }) => (
  <li className="flex items-center gap-2 border-b border-slate-800 py-1 last:border-b-0">
    <input
      type="checkbox"
      checked={checked}
      disabled={disabled}
      onChange={onChange}
      aria-label={ariaLabel}
      className="accent-sky-500"
      data-landxml-row={dataAttribute}
    />
    <span className="min-w-0 flex-1 truncate text-[12px]">{label}</span>
    {meta ? <span className="shrink-0 text-[11px] text-slate-400">{meta}</span> : null}
  </li>
);

/**
 * Section 2 of the LandXML Import Review: points (category-level), and
 * per-object alignments + TIN surfaces. Only IMPORTABLE/WARNING rows are
 * selectable; UNSUPPORTED/BLOCKED rows render checked=false + disabled.
 */
export const LandXmlImportReviewObjects = ({
  preview,
  selection,
  onTogglePoints,
  onToggleAlignment,
  onToggleSurface,
}: LandXmlImportReviewObjectsProps): React.JSX.Element => (
  <div className="mt-2 space-y-2">
    <section aria-label="LandXML points">
      <h3 className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Points</h3>
      <ul className="mt-1">
        <Row
          checked={selection.includePoints && preview.points.length > 0}
          disabled={preview.points.length === 0}
          onChange={onTogglePoints}
          label={`Points (${preview.points.length})`}
          ariaLabel={`Import points (${preview.points.length})`}
          meta="category-level"
          dataAttribute="points"
        />
      </ul>
    </section>

    <section aria-label="LandXML alignments">
      <h3 className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
        {`Alignments (${preview.alignments.length})`}
      </h3>
      {preview.alignments.length === 0 ? (
        <p className="text-[12px] text-slate-500">None in this document.</p>
      ) : (
        <ul className="mt-1" data-landxml-alignments>
          {preview.alignments.map((alignment) => {
            const importable = isLandXmlImportable(alignment.disposition);
            return (
              <Row
                key={alignment.name}
                checked={importable && selection.alignmentNames.includes(alignment.name)}
                disabled={!importable}
                onChange={() => onToggleAlignment(alignment.name)}
                label={
                  <span className="flex items-center gap-2">
                    <span className="truncate">{alignment.name}</span>
                    <LandXmlImportDispositionBadge
                      disposition={alignment.disposition}
                      reasonCode={alignment.reasonCode}
                    />
                  </span>
                }
                ariaLabel={`Import alignment ${alignment.name}`}
                meta={`${alignment.elements.length} element(s)`}
                dataAttribute="alignment"
              />
            );
          })}
        </ul>
      )}
    </section>

    <section aria-label="LandXML TIN surfaces">
      <h3 className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
        {`TIN surfaces (${preview.surfaces.length})`}
      </h3>
      {preview.surfaces.length === 0 ? (
        <p className="text-[12px] text-slate-500">None in this document.</p>
      ) : (
        <ul className="mt-1" data-landxml-surfaces>
          {preview.surfaces.map((surface) => {
            const importable = isLandXmlImportable(surface.disposition);
            const vertexCount = surface.vertices.length / 3;
            const faceCount = surface.faces.length / 3;
            return (
              <Row
                key={surface.name}
                checked={importable && selection.surfaceNames.includes(surface.name)}
                disabled={!importable}
                onChange={() => onToggleSurface(surface.name)}
                label={
                  <span className="flex items-center gap-2">
                    <span className="truncate">{surface.name}</span>
                    <LandXmlImportDispositionBadge
                      disposition={surface.disposition}
                      reasonCode={surface.reasonCode}
                    />
                  </span>
                }
                ariaLabel={`Import TIN surface ${surface.name}`}
                meta={importable ? `${vertexCount} verts · ${faceCount} faces` : undefined}
                dataAttribute="surface"
              />
            );
          })}
        </ul>
      )}
    </section>
  </div>
);
