import React, { useState } from 'react';
import type {
  FeatureCodeCatalog,
  FeatureDefinition,
} from '../../engine/fieldToFinish/featureCatalog';
import { validateCatalog } from '../../engine/fieldToFinish/catalogIo';

interface CatalogEditorProps {
  catalog: FeatureCodeCatalog;
  onCatalogChange: (_catalog: FeatureCodeCatalog) => void;
}

const emptyDefinition = (code: string): FeatureDefinition => ({
  id: `def-${code.toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'new'}`,
  code: code.toUpperCase() || 'NEW',
  description: '',
  layer: `F2F-${code.toUpperCase() || 'NEW'}`,
  pointBehavior: 'point',
  lineworkBehavior: { enabled: false, implicitContinuation: false },
});

const StylePreview: React.FC<{ definition: FeatureDefinition }> = ({ definition }) => (
  <span
    className="inline-flex items-center gap-1 rounded border border-slate-700 px-1.5 py-0.5"
    title={`Layer ${definition.layer} · symbol ${definition.pointSymbolId ?? 'default'} · linework ${definition.lineworkBehavior.enabled ? 'on' : 'off'}`}
    data-f2f-style-preview={definition.id}
  >
    <span aria-hidden>◆</span>
    <span aria-hidden style={{ color: '#38bdf8' }}>━━━</span>
    <span className="italic">Abc</span>
  </span>
);

export const SurveyCadFeatureCatalogEditor: React.FC<CatalogEditorProps> = ({
  catalog,
  onCatalogChange,
}) => {
  const [selectedId, setSelectedId] = useState<string | null>(
    catalog.definitions[0]?.id ?? null,
  );
  const selected = catalog.definitions.find((entry) => entry.id === selectedId) ?? null;
  const issues = validateCatalog(catalog);

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
      id: `${selected.id}-copy`,
      code: `${selected.code}_COPY`,
      lineworkBehavior: { ...selected.lineworkBehavior },
    };
    onCatalogChange({ ...catalog, definitions: [...catalog.definitions, copy] });
    setSelectedId(copy.id);
  };

  const deleteSelected = (): void => {
    if (!selected) return;
    onCatalogChange({
      ...catalog,
      definitions: catalog.definitions.filter((entry) => entry.id !== selected.id),
    });
    setSelectedId(null);
  };

  return (
    <div className="grid gap-2" data-f2f-catalog-editor>
      <div className="flex flex-wrap items-center gap-1">
        <button type="button" className="rounded border border-slate-600 px-2 py-1 hover:bg-slate-800" onClick={addDefinition} data-f2f-catalog-add>
          Add
        </button>
        <button type="button" className="rounded border border-slate-600 px-2 py-1 hover:bg-slate-800 disabled:opacity-40" onClick={duplicateSelected} disabled={!selected} data-f2f-catalog-duplicate>
          Duplicate
        </button>
        <button type="button" className="rounded border border-slate-600 px-2 py-1 hover:bg-slate-800 disabled:opacity-40" onClick={deleteSelected} disabled={!selected} data-f2f-catalog-delete>
          Delete
        </button>
        <span className="text-[11px] text-slate-400">
          {catalog.name} v{catalog.version} · {catalog.definitions.length} definitions
        </span>
      </div>
      {issues.length > 0 ? (
        <ul className="grid gap-0.5 text-[11px] text-amber-300" data-f2f-catalog-issues>
          {issues.map((issue, index) => (
            <li key={`${issue.severity}-${index}`}>{issue.message}</li>
          ))}
        </ul>
      ) : null}
      <div className="grid max-h-48 gap-0.5 overflow-auto" data-f2f-catalog-list>
        {catalog.definitions.map((entry) => (
          <button
            key={entry.id}
            type="button"
            aria-pressed={entry.id === selectedId}
            className={`flex items-center justify-between gap-2 rounded border px-2 py-1 text-left text-[12px] hover:bg-slate-800 ${entry.id === selectedId ? 'border-sky-500' : 'border-slate-700'}`}
            onClick={() => setSelectedId(entry.id)}
            data-f2f-catalog-row={entry.id}
          >
            <span>
              <span className="font-mono font-semibold">{entry.code}</span>
              <span className="pl-2 text-slate-400">{entry.description || entry.layer}</span>
            </span>
            <StylePreview definition={entry} />
          </button>
        ))}
      </div>
      {selected ? (
        <div className="grid grid-cols-[auto,1fr] items-center gap-x-2 gap-y-1 text-[12px]" data-f2f-catalog-form>
          <label htmlFor="f2f-def-code">Feature Code</label>
          <input
            id="f2f-def-code"
            className="rounded border border-slate-700 bg-slate-900 px-1.5 py-0.5 font-mono"
            value={selected.code}
            onChange={(event) => patchDefinition(selected.id, { code: event.target.value.toUpperCase() })}
          />
          <label htmlFor="f2f-def-desc">Definition</label>
          <input
            id="f2f-def-desc"
            className="rounded border border-slate-700 bg-slate-900 px-1.5 py-0.5"
            value={selected.description}
            onChange={(event) => patchDefinition(selected.id, { description: event.target.value })}
          />
          <label htmlFor="f2f-def-layer">Layer</label>
          <input
            id="f2f-def-layer"
            className="rounded border border-slate-700 bg-slate-900 px-1.5 py-0.5 font-mono"
            value={selected.layer}
            onChange={(event) => patchDefinition(selected.id, { layer: event.target.value })}
          />
          <label htmlFor="f2f-def-symbol">Point symbol</label>
          <input
            id="f2f-def-symbol"
            className="rounded border border-slate-700 bg-slate-900 px-1.5 py-0.5 font-mono"
            value={selected.pointSymbolId ?? ''}
            placeholder="default"
            onChange={(event) =>
              patchDefinition(selected.id, { pointSymbolId: event.target.value || undefined })
            }
          />
          <label htmlFor="f2f-def-label-style">Label style</label>
          <input
            id="f2f-def-label-style"
            className="rounded border border-slate-700 bg-slate-900 px-1.5 py-0.5 font-mono"
            value={selected.labelStyleId ?? ''}
            placeholder="default"
            onChange={(event) =>
              patchDefinition(selected.id, { labelStyleId: event.target.value || undefined })
            }
          />
          <span>Point / line style</span>
          <span className="flex items-center gap-2">
            <select
              aria-label="Point style"
              className="rounded border border-slate-700 bg-slate-900 px-1.5 py-0.5"
              value={selected.pointBehavior}
              onChange={(event) =>
                patchDefinition(selected.id, {
                  pointBehavior: event.target.value === 'none' ? 'none' : 'point',
                })
              }
            >
              <option value="point">Create point</option>
              <option value="none">No point</option>
            </select>
            <input
              aria-label="Line style"
              className="w-full rounded border border-slate-700 bg-slate-900 px-1.5 py-0.5 font-mono"
              value={selected.styleId ?? ''}
              placeholder="line style (default)"
              onChange={(event) =>
                patchDefinition(selected.id, { styleId: event.target.value || undefined })
              }
            />
          </span>
          <span>Generated Linework</span>
          <span className="flex items-center gap-2">
            <label className="flex items-center gap-1">
              <input
                type="checkbox"
                checked={selected.lineworkBehavior.enabled}
                onChange={(event) =>
                  patchDefinition(selected.id, {
                    lineworkBehavior: { ...selected.lineworkBehavior, enabled: event.target.checked },
                  })
                }
              />
              enabled
            </label>
            <label className="flex items-center gap-1">
              <input
                type="checkbox"
                checked={selected.lineworkBehavior.implicitContinuation}
                onChange={(event) =>
                  patchDefinition(selected.id, {
                    lineworkBehavior: {
                      ...selected.lineworkBehavior,
                      implicitContinuation: event.target.checked,
                    },
                  })
                }
              />
              implicit continuation
            </label>
          </span>
          <label htmlFor="f2f-def-rename">Rename (id)</label>
          <input
            id="f2f-def-rename"
            className="rounded border border-slate-700 bg-slate-900 px-1.5 py-0.5 font-mono"
            value={selected.id}
            onChange={(event) => {
              const nextId = event.target.value.trim() || selected.id;
              onCatalogChange({
                ...catalog,
                definitions: catalog.definitions.map((entry) =>
                  entry.id === selected.id ? { ...entry, id: nextId } : entry,
                ),
              });
              setSelectedId(nextId);
            }}
          />
        </div>
      ) : (
        <p className="text-[12px] text-slate-400">Select a Feature Code to edit.</p>
      )}
      <div className="grid gap-1 text-[12px]" data-f2f-catalog-aliases>
        <span className="font-semibold">Aliases (alias → Feature Code)</span>
        {catalog.aliases.map((alias, index) => (
          <span key={`${alias.alias}-${index}`} className="flex items-center gap-1 font-mono">
            <span>{alias.alias} → {alias.targetCode}</span>
            <button
              type="button"
              className="rounded border border-slate-700 px-1 hover:bg-slate-800"
              onClick={() =>
                onCatalogChange({
                  ...catalog,
                  aliases: catalog.aliases.filter((_, keep) => keep !== index),
                })
              }
              aria-label={`Remove alias ${alias.alias}`}
            >
              ×
            </button>
          </span>
        ))}
        <AliasAdder
          onAdd={(alias, targetCode) =>
            onCatalogChange({ ...catalog, aliases: [...catalog.aliases, { alias, targetCode }] })
          }
        />
      </div>
    </div>
  );
};

const AliasAdder: React.FC<{ onAdd: (_alias: string, _target: string) => void }> = ({ onAdd }) => {
  const [alias, setAlias] = useState('');
  const [target, setTarget] = useState('');
  return (
    <span className="flex items-center gap-1">
      <input
        aria-label="Alias"
        className="w-24 rounded border border-slate-700 bg-slate-900 px-1.5 py-0.5 font-mono"
        value={alias}
        placeholder="EP"
        onChange={(event) => setAlias(event.target.value.toUpperCase())}
      />
      <span>→</span>
      <input
        aria-label="Target code"
        className="w-28 rounded border border-slate-700 bg-slate-900 px-1.5 py-0.5 font-mono"
        value={target}
        placeholder="EDGE"
        onChange={(event) => setTarget(event.target.value.toUpperCase())}
      />
      <button
        type="button"
        className="rounded border border-slate-600 px-2 py-0.5 hover:bg-slate-800 disabled:opacity-40"
        disabled={!alias.trim() || !target.trim()}
        onClick={() => {
          onAdd(alias.trim(), target.trim());
          setAlias('');
          setTarget('');
        }}
      >
        Add alias
      </button>
    </span>
  );
};
