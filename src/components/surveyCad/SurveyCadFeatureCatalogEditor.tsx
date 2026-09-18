import React, { useEffect, useState } from 'react';
import { canonicalizeCode } from '../../engine/fieldToFinish/codeMatching';
import type {
  FeatureCodeCatalog,
  FeatureDefinition,
} from '../../engine/fieldToFinish/featureCatalog';
import { validateCatalog } from '../../engine/fieldToFinish/catalogIo';
import { computeFeatureCatalogRevision } from '../../engine/fieldToFinish/catalogRevision';
import {
  AliasSection,
  CatalogHeader,
} from './FeatureCatalogManager.aliases';
import {
  CatalogDefinitionEditor,
  type CatalogEditorDrawing,
} from './FeatureCatalogManager.editor';
import {
  CatalogTable,
  type CatalogSortKey,
} from './FeatureCatalogManager.table';

export type { CatalogEditorDrawing };

interface CatalogEditorProps {
  catalog: FeatureCodeCatalog;
  onCatalogChange: (_catalog: FeatureCodeCatalog) => void;
  /** Drawing tables for dropdowns + missing-ref warnings. Absent = legacy contexts (free text). */
  drawing?: CatalogEditorDrawing;
  /** Link status chip for the header (CURRENT / CATALOG_CHANGED / …). */
  linkStatus?: string;
  /** True when showing the starter fallback (edits adopt into the drawing). */
  isFallback?: boolean;
  /** GENERATED-entity reference counts by definition id (delete warning). */
  referenceCounts?: Record<string, number>;
  /** Prefill for the "Create Definition from Code" flow (review step). */
  createPrefill?: { code: string; description?: string; layer?: string } | null;
  onCreateConsumed?: () => void;
  /** Toolspace/ribbon focus target (feature-codes | aliases). Session-only. */
  focusSection?: string | null;
}

const emptyDefinition = (code: string): FeatureDefinition => ({
  id: `def-${code.toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'new'}-${Date.now().toString(36)}`,
  code: code.toUpperCase() || 'NEW',
  description: '',
  layer: `F2F-${code.toUpperCase() || 'NEW'}`,
  pointBehavior: 'point',
  lineworkBehavior: { enabled: false, implicitContinuation: false },
});

/**
 * Phase 18E — professional feature-code manager (drawing-owned catalog).
 * Stable id ≠ editable code: rename the code freely; duplicate canonical
 * codes are blocked via validateCatalog (first wins at generation). Delete
 * warns how many generated entities reference the definition but never
 * deletes geometry. Sort/search are view-only — generation always uses the
 * first point-role match in SOURCE code order.
 */
export const SurveyCadFeatureCatalogEditor: React.FC<CatalogEditorProps> = ({
  catalog,
  onCatalogChange,
  drawing,
  linkStatus = 'UNLINKED',
  isFallback = false,
  referenceCounts = {},
  createPrefill = null,
  onCreateConsumed,
  focusSection = null,
}) => {
  const [selectedId, setSelectedId] = useState<string | null>(
    catalog.definitions[0]?.id ?? null,
  );
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState<CatalogSortKey>('code');
  const [notice, setNotice] = useState('');
  const selected = catalog.definitions.find((entry) => entry.id === selectedId) ?? null;
  const issues = validateCatalog(catalog);
  const revision = computeFeatureCatalogRevision(catalog);

  useEffect(() => {
    if (!selected && catalog.definitions[0]) setSelectedId(catalog.definitions[0].id);
  }, [catalog.definitions, selected]);

  // Review-step handoff: prefill a new definition from an unmapped code.
  useEffect(() => {
    if (!createPrefill) return;
    const code = createPrefill.code.trim().toUpperCase();
    if (!code) {
      onCreateConsumed?.();
      return;
    }
    if (catalog.definitions.some((def) => canonicalizeCode(def.code) === canonicalizeCode(code))) {
      setNotice(`Code “${code}” already exists — selected instead of duplicating.`);
      const hit = catalog.definitions.find((def) => canonicalizeCode(def.code) === canonicalizeCode(code));
      if (hit) setSelectedId(hit.id);
      onCreateConsumed?.();
      return;
    }
    const next = {
      ...emptyDefinition(code),
      ...(createPrefill.description ? { description: createPrefill.description } : {}),
      ...(createPrefill.layer ? { layer: createPrefill.layer } : {}),
    };
    onCatalogChange({ ...catalog, definitions: [...catalog.definitions, next] });
    setSelectedId(next.id);
    setNotice(`Created definition “${code}” — confirm the layer and styles, then re-run review.`);
    onCreateConsumed?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [createPrefill]);

  const patchDefinition = (id: string, patch: Partial<FeatureDefinition>): void => {
    onCatalogChange({
      ...catalog,
      definitions: catalog.definitions.map((entry) =>
        entry.id === id ? { ...entry, ...patch } : entry,
      ),
    });
  };

  const addDefinition = (): void => {
    const next = emptyDefinition(`NEW${catalog.definitions.length + 1}`);
    onCatalogChange({ ...catalog, definitions: [...catalog.definitions, next] });
    setSelectedId(next.id);
  };

  const duplicateSelected = (): void => {
    if (!selected) return;
    const copy: FeatureDefinition = {
      ...selected,
      id: `${selected.id}-copy-${Date.now().toString(36)}`,
      code: `${selected.code}_COPY`,
      lineworkBehavior: { ...selected.lineworkBehavior },
      ...(selected.defaultAttributes ? { defaultAttributes: { ...selected.defaultAttributes } } : {}),
    };
    // Duplicate canonical codes are blocked: appending “_COPY” keeps the copy
    // unique; if it still collides (user copied twice), validateCatalog flags
    // it and generation lets the first win — no silent fork.
    onCatalogChange({ ...catalog, definitions: [...catalog.definitions, copy] });
    setSelectedId(copy.id);
  };

  const deleteSelected = (): void => {
    if (!selected) return;
    const refs = referenceCounts[selected.id] ?? 0;
    if (refs > 0) {
      const ok = window.confirm(
        `${refs} generated entit${refs === 1 ? 'y references' : 'ies reference'} “${selected.code}”. ` +
          'Delete the definition only — geometry is never deleted. Continue?',
      );
      if (!ok) return;
    }
    onCatalogChange({
      ...catalog,
      definitions: catalog.definitions.filter((entry) => entry.id !== selected.id),
    });
    setSelectedId(null);
  };

  return (
    <div className="grid gap-2" data-f2f-catalog-editor data-f2f-focus={focusSection ?? ''}>
      <CatalogHeader
        catalog={catalog}
        revision={revision}
        linkStatus={linkStatus}
        isFallback={isFallback}
        onHeaderChange={(name, version) => onCatalogChange({ ...catalog, name, version })}
      />
      <div className="flex flex-wrap items-center gap-1">
        <button type="button" className="rounded border border-slate-600 px-2 py-1 hover:bg-slate-800" onClick={addDefinition} data-f2f-catalog-add>
          New
        </button>
        <button type="button" className="rounded border border-slate-600 px-2 py-1 hover:bg-slate-800 disabled:opacity-40" onClick={duplicateSelected} disabled={!selected} data-f2f-catalog-duplicate>
          Duplicate
        </button>
        <button
          type="button"
          className="rounded border border-slate-600 px-2 py-1 hover:bg-slate-800 disabled:opacity-40"
          onClick={() => {
            if (!selected) return;
            const nextCode = window.prompt('Rename code (stable id unchanged):', selected.code);
            if (nextCode?.trim()) patchDefinition(selected.id, { code: nextCode.trim().toUpperCase() });
          }}
          disabled={!selected}
          data-f2f-catalog-rename
        >
          Rename
        </button>
        <button
          type="button"
          className="rounded border border-red-800 px-2 py-1 hover:bg-red-950 disabled:opacity-40"
          onClick={deleteSelected}
          disabled={!selected}
          title={selected && (referenceCounts[selected.id] ?? 0) > 0
            ? `${referenceCounts[selected.id]} generated entities reference this definition (geometry kept)`
            : 'Delete definition (geometry kept)'}
          data-f2f-catalog-delete
        >
          Delete
        </button>
      </div>
      {notice ? <p className="text-[11px] text-sky-300" data-f2f-catalog-notice>{notice}</p> : null}
      {issues.length > 0 ? (
        <ul className="grid gap-0.5 text-[11px] text-amber-300" data-f2f-catalog-issues>
          {issues.map((issue, index) => (
            <li key={`${issue.severity}-${index}`}>{issue.message}</li>
          ))}
        </ul>
      ) : null}
      <div className="grid gap-2 md:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]" data-f2f-manager-columns>
        <CatalogTable
          definitions={catalog.definitions}
          selectedId={selectedId}
          search={search}
          sortKey={sortKey}
          onSearchChange={setSearch}
          onSortChange={setSortKey}
          onSelect={setSelectedId}
        />
        <div data-f2f-manager-editor>
          {selected ? (
            <CatalogDefinitionEditor
              definition={selected}
              drawing={drawing}
              onPatch={(patch) => patchDefinition(selected.id, patch)}
              onRenameId={(nextId) => {
                if (catalog.definitions.some((entry) => entry.id === nextId && entry.id !== selected.id)) {
                  setNotice(`Id “${nextId}” already exists — pick a unique stable id.`);
                  return;
                }
                onCatalogChange({
                  ...catalog,
                  definitions: catalog.definitions.map((entry) =>
                    entry.id === selected.id ? { ...entry, id: nextId } : entry,
                  ),
                });
                setSelectedId(nextId);
              }}
            />
          ) : (
            <p className="text-[12px] text-slate-400">Select a feature code to edit.</p>
          )}
        </div>
      </div>
      <div data-f2f-manager-aliases={focusSection === 'aliases' ? 'focused' : ''}>
        <AliasSection
          catalog={catalog}
          onAdd={(alias) => onCatalogChange({ ...catalog, aliases: [...catalog.aliases, alias] })}
          onRemove={(index) => onCatalogChange({ ...catalog, aliases: catalog.aliases.filter((_, keep) => keep !== index) })}
          onEdit={(index, alias) =>
            onCatalogChange({ ...catalog, aliases: catalog.aliases.map((entry, at) => (at === index ? alias : entry)) })
          }
        />
      </div>
    </div>
  );
};
