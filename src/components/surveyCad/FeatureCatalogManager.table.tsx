import React from 'react';
import type { FeatureDefinition } from '../../engine/fieldToFinish/featureCatalog';

export type CatalogSortKey = 'code' | 'description' | 'layer';

export interface CatalogTableProps {
  definitions: FeatureDefinition[];
  selectedId: string | null;
  search: string;
  sortKey: CatalogSortKey;
  onSearchChange: (_value: string) => void;
  onSortChange: (_key: CatalogSortKey) => void;
  onSelect: (_id: string) => void;
}

/**
 * Phase 18E — left code list. Search covers code+description+layer
 * (case-insensitive); sort is display-only and never touches definition
 * order, so multi-code semantics are unaffected: the first point-role match
 * in SOURCE code order wins at generation regardless of this view.
 */
export const CatalogTable: React.FC<CatalogTableProps> = ({
  definitions,
  selectedId,
  search,
  sortKey,
  onSearchChange,
  onSortChange,
  onSelect,
}) => {
  const needle = search.trim().toLowerCase();
  const visible = definitions
    .filter((entry) =>
      needle.length === 0
        ? true
        : entry.code.toLowerCase().includes(needle) ||
          entry.description.toLowerCase().includes(needle) ||
          entry.layer.toLowerCase().includes(needle),
    )
    .sort((a, b) => {
      const pick = (entry: FeatureDefinition): string =>
        sortKey === 'code' ? entry.code : sortKey === 'description' ? entry.description : entry.layer;
      return pick(a).localeCompare(pick(b), undefined, { sensitivity: 'base' });
    });
  return (
    <div className="grid gap-1" data-f2f-catalog-table>
      <div className="flex items-center gap-1">
        <input
          aria-label="Search feature codes"
          className="w-full rounded border border-slate-700 bg-slate-900 px-1.5 py-0.5 text-[12px]"
          value={search}
          placeholder="Search code, description, layer…"
          onChange={(event) => onSearchChange(event.target.value)}
          data-f2f-catalog-search
        />
        <label className="flex items-center gap-1 text-[11px] text-slate-400">
          Sort
          <select
            aria-label="Sort feature codes"
            className="rounded border border-slate-700 bg-slate-900 px-1 py-0.5"
            value={sortKey}
            onChange={(event) => onSortChange(event.target.value as CatalogSortKey)}
            data-f2f-catalog-sort
          >
            <option value="code">Code</option>
            <option value="description">Description</option>
            <option value="layer">Layer</option>
          </select>
        </label>
      </div>
      <div className="grid max-h-56 gap-0.5 overflow-auto" data-f2f-catalog-list role="listbox" aria-label="Feature codes">
        {visible.map((entry) => (
          <button
            key={entry.id}
            type="button"
            role="option"
            aria-selected={entry.id === selectedId}
            className={`grid grid-cols-[5rem_1fr_auto] items-center gap-2 rounded border px-2 py-1 text-left text-[12px] hover:bg-slate-800 ${entry.id === selectedId ? 'border-sky-500' : 'border-slate-700'}`}
            onClick={() => onSelect(entry.id)}
            data-f2f-catalog-row={entry.id}
          >
            <span className="font-mono font-semibold">{entry.code}</span>
            <span className="truncate text-slate-300">
              {entry.description || <span className="italic text-slate-500">—</span>}
              <span className="pl-2 font-mono text-[11px] text-slate-500">{entry.layer}</span>
            </span>
            <span className="flex items-center gap-1 text-[11px]" title={entry.lineworkBehavior.enabled ? 'Linework on' : 'No linework'}>
              <span aria-hidden>{entry.pointBehavior === 'point' ? '◆' : '○'}</span>
              {entry.lineworkBehavior.enabled ? <span aria-hidden className="text-sky-400">━━━</span> : null}
            </span>
          </button>
        ))}
        {visible.length === 0 ? (
          <p className="text-[12px] text-slate-500">No codes match “{search}”.</p>
        ) : null}
      </div>
    </div>
  );
};
