import React from 'react';
import type { FeatureDefinition } from '../../engine/fieldToFinish/featureCatalog';
import type { F2FReviewRow } from './f2fReviewUtils';

/**
 * Phase 18E — review table: Point / Raw Code / Matched Definition / Layer /
 * Point Style / Label Style / Linework Control / Status + inline warnings.
 * Unmapped rows stay preserved in the list (never auto-created).
 */
export const F2FReviewTable: React.FC<{
  rows: F2FReviewRow[];
  details: ReadonlyMap<string, FeatureDefinition | null>;
}> = ({ rows, details }) => {
  if (rows.length === 0) return null;
  return (
    <div className="grid max-h-64 gap-0.5 overflow-auto text-[11px]" data-f2f-review-rows>
      <div className="grid grid-cols-[3rem_6rem_6rem_6rem_5rem_5rem_5rem_5rem] gap-1 font-semibold text-slate-300">
        <span>Point</span><span>Raw code</span><span>Matched</span><span>Layer</span>
        <span>Pt style</span><span>Label style</span><span>Control</span><span>Status</span>
      </div>
      {rows.map((row) => {
        const def = details.get(row.pointId) ?? null;
        return (
          <div key={row.pointId} className="grid grid-cols-[3rem_6rem_6rem_6rem_5rem_5rem_5rem_5rem] gap-1 border-t border-slate-800 py-0.5">
            <span className="font-mono">{row.pointId}</span>
            <span className="font-mono">{row.rawCode || '—'}</span>
            <span>{def ? def.code : '—'}{row.description ? ` · ${row.description}` : ''}</span>
            <span className="font-mono">{def?.layer ?? '—'}</span>
            <span className="font-mono">{def?.pointStyleId ?? 'default'}</span>
            <span className="font-mono">{def?.labelStyleId ?? 'compat'}</span>
            <span className="font-mono">{row.lineworkControls || '—'}</span>
            <span className={row.mappingStatus === 'Unmapped' ? 'text-amber-300' : ''}>
              {row.mappingStatus}
              {row.warnings.length > 0 ? ` · ${row.warnings.join('; ')}` : ''}
            </span>
          </div>
        );
      })}
    </div>
  );
};
