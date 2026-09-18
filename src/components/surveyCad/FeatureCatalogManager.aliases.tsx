import React, { useState } from 'react';
import { canonicalizeCode } from '../../engine/fieldToFinish/codeMatching';
import type { CodeAlias } from '../../engine/fieldToFinish/codeMatching';
import type { FeatureCodeCatalog } from '../../engine/fieldToFinish/featureCatalog';

interface CatalogHeaderProps {
  catalog: FeatureCodeCatalog;
  revision: string;
  linkStatus: string;
  isFallback: boolean;
  onHeaderChange: (_name: string, _version: string) => void;
}

/**
 * Phase 18E — catalog header. `version` is descriptive metadata only —
 * editing it never stales the link; the content revision is authoritative.
 */
export const CatalogHeader: React.FC<CatalogHeaderProps> = ({
  catalog,
  revision,
  linkStatus,
  isFallback,
  onHeaderChange,
}) => (
  <div className="flex flex-wrap items-center gap-2 text-[12px]" data-f2f-catalog-header>
    <label className="flex items-center gap-1">
      Name
      <input
        aria-label="Catalog name"
        className="w-44 rounded border border-slate-700 bg-slate-900 px-1.5 py-0.5"
        value={catalog.name}
        onChange={(event) => onHeaderChange(event.target.value, catalog.version)}
      />
    </label>
    <label
      className="flex items-center gap-1"
      title="Descriptive metadata only — changing the version does NOT stale the link; the content revision below is authoritative."
    >
      v
      <input
        aria-label="Catalog version (descriptive metadata)"
        className="w-14 rounded border border-slate-700 bg-slate-900 px-1.5 py-0.5 font-mono"
        value={catalog.version}
        onChange={(event) => onHeaderChange(catalog.name, event.target.value)}
      />
    </label>
    <span className="text-slate-400">
      {catalog.definitions.length} definitions · rev <span className="font-mono" title={revision}>{revision.slice(0, 8)}</span> · {linkStatus}
      {isFallback ? ' · starter fallback (edits adopt into drawing)' : ''}
    </span>
  </div>
);

interface AliasSectionProps {
  catalog: FeatureCodeCatalog;
  onAdd: (_alias: CodeAlias) => void;
  onRemove: (_index: number) => void;
  onEdit: (_index: number, _alias: CodeAlias) => void;
}

/** Alias CRUD with target-exists, no-dup, and direct-resolve validation. */
export const AliasSection: React.FC<AliasSectionProps> = ({ catalog, onAdd, onRemove, onEdit }) => {
  const [alias, setAlias] = useState('');
  const [target, setTarget] = useState('');
  const [editing, setEditing] = useState<number | null>(null);
  const [editTarget, setEditTarget] = useState('');
  const codes = new Set(catalog.definitions.map((def) => canonicalizeCode(def.code)));
  const aliasKeys = new Set(catalog.aliases.map((entry) => canonicalizeCode(entry.alias)));
  const targetOk = target.trim().length > 0 && codes.has(canonicalizeCode(target));
  const aliasOk =
    alias.trim().length > 0 &&
    !codes.has(canonicalizeCode(alias)) &&
    !aliasKeys.has(canonicalizeCode(alias));
  return (
    <div className="grid gap-1 text-[12px]" data-f2f-catalog-aliases>
      <span className="font-semibold">Aliases (alias → feature code)</span>
      {catalog.aliases.map((entry, index) => {
        const resolves = codes.has(canonicalizeCode(entry.targetCode));
        return (
          <span key={`${entry.alias}-${index}`} className="flex items-center gap-1 font-mono">
            <span className={resolves ? '' : 'text-amber-300'} title={resolves ? undefined : 'Target no longer exists'}>
              {entry.alias} → {entry.targetCode}
            </span>
            {editing === index ? (
              <>
                <input
                  aria-label="Edit alias target"
                  className="w-24 rounded border border-slate-700 bg-slate-900 px-1 py-0.5"
                  value={editTarget}
                  onChange={(event) => setEditTarget(event.target.value.toUpperCase())}
                />
                <button
                  type="button"
                  className="rounded border border-slate-600 px-1 hover:bg-slate-800 disabled:opacity-40"
                  disabled={!codes.has(canonicalizeCode(editTarget))}
                  onClick={() => {
                    onEdit(index, { alias: entry.alias, targetCode: editTarget.trim() });
                    setEditing(null);
                  }}
                >
                  Save
                </button>
              </>
            ) : (
              <button
                type="button"
                className="rounded border border-slate-700 px-1 hover:bg-slate-800"
                aria-label={`Retarget alias ${entry.alias}`}
                onClick={() => {
                  setEditing(index);
                  setEditTarget(entry.targetCode);
                }}
              >
                ✎
              </button>
            )}
            <button
              type="button"
              className="rounded border border-slate-700 px-1 hover:bg-slate-800"
              onClick={() => onRemove(index)}
              aria-label={`Remove alias ${entry.alias}`}
            >
              ×
            </button>
          </span>
        );
      })}
      <span className="flex items-center gap-1">
        <input
          aria-label="Alias"
          className="w-24 rounded border border-slate-700 bg-slate-900 px-1.5 py-0.5 font-mono"
          value={alias}
          placeholder="EOP"
          onChange={(event) => setAlias(event.target.value.toUpperCase())}
        />
        <span>→</span>
        <input
          aria-label="Target code"
          className="w-28 rounded border border-slate-700 bg-slate-900 px-1.5 py-0.5 font-mono"
          value={target}
          placeholder="EP"
          list="f2f-alias-targets"
          onChange={(event) => setTarget(event.target.value.toUpperCase())}
        />
        <datalist id="f2f-alias-targets">
          {catalog.definitions.map((def) => (
            <option key={def.id} value={def.code} />
          ))}
        </datalist>
        <button
          type="button"
          className="rounded border border-slate-600 px-2 py-0.5 hover:bg-slate-800 disabled:opacity-40"
          disabled={!aliasOk || !targetOk}
          title={
            !aliasOk
              ? 'Alias must be new and must not shadow a definition code'
              : !targetOk
                ? 'Target must be an existing definition code'
                : 'Add alias'
          }
          onClick={() => {
            onAdd({ alias: alias.trim(), targetCode: target.trim() });
            setAlias('');
            setTarget('');
          }}
        >
          Add alias
        </button>
      </span>
    </div>
  );
};
