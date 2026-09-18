import React, { useState } from 'react';
import type { FeatureDefinition } from '../../engine/fieldToFinish/featureCatalog';

export interface CatalogEditorDrawing {
  layers: ReadonlyArray<{ id: string; name: string }>;
  pointStyles: ReadonlyArray<{ id: string; name?: string }>;
  labelStyles: ReadonlyArray<{ id: string; name?: string }>;
  pointSymbols: ReadonlyArray<{ id: string; name?: string }>;
}

interface CatalogEditorProps {
  definition: FeatureDefinition;
  drawing?: CatalogEditorDrawing;
  onPatch: (_patch: Partial<FeatureDefinition>) => void;
  onRenameId: (_nextId: string) => void;
}

const inputClass = 'rounded border border-slate-700 bg-slate-900 px-1.5 py-0.5';

/**
 * Phase 18E — right selected-code editor. Missing style refs keep the
 * stored ref (warning only); generation falls back deterministically.
 * New layer names are created on generation — no separate layer write here.
 */
export const CatalogDefinitionEditor: React.FC<CatalogEditorProps> = ({
  definition,
  drawing,
  onPatch,
  onRenameId,
}) => {
  const [attrKey, setAttrKey] = useState('');
  const [attrValue, setAttrValue] = useState('');
  const pointStyleKnown =
    !drawing || !definition.pointStyleId || drawing.pointStyles.some((style) => style.id === definition.pointStyleId);
  const labelStyleKnown =
    !drawing || !definition.labelStyleId || drawing.labelStyles.some((style) => style.id === definition.labelStyleId);
  const layerKnown = !drawing || drawing.layers.some((layer) => layer.name === definition.layer);
  const attrs = Object.entries(definition.defaultAttributes ?? {}).sort(([a], [b]) => a.localeCompare(b));
  return (
    <div className="grid grid-cols-[auto,1fr] items-center gap-x-2 gap-y-1 text-[12px]" data-f2f-catalog-form>
      <label htmlFor="f2f-def-code">Code</label>
      <input
        id="f2f-def-code"
        className={`${inputClass} font-mono`}
        value={definition.code}
        onChange={(event) => onPatch({ code: event.target.value.toUpperCase() })}
        data-f2f-def-code
      />
      <label htmlFor="f2f-def-desc">Description</label>
      <input
        id="f2f-def-desc"
        className={inputClass}
        value={definition.description}
        onChange={(event) => onPatch({ description: event.target.value })}
      />
      <label htmlFor="f2f-def-layer">Layer</label>
      <span className="grid gap-0.5">
        {drawing ? (
          <input
            id="f2f-def-layer"
            className={`${inputClass} font-mono`}
            value={definition.layer}
            list="f2f-layer-options"
            onChange={(event) => onPatch({ layer: event.target.value })}
          />
        ) : (
          <input
            id="f2f-def-layer"
            className={`${inputClass} font-mono`}
            value={definition.layer}
            onChange={(event) => onPatch({ layer: event.target.value })}
          />
        )}
        {drawing ? (
          <datalist id="f2f-layer-options">
            {drawing.layers.map((layer) => (
              <option key={layer.id} value={layer.name} />
            ))}
          </datalist>
        ) : null}
        {drawing && !layerKnown ? (
          <span className="text-[11px] text-sky-300">New layer — created on generation.</span>
        ) : null}
      </span>
      <label htmlFor="f2f-def-point-style">Point style</label>
      <span className="grid gap-0.5">
        {drawing ? (
          <select
            id="f2f-def-point-style"
            className={`${inputClass} font-mono`}
            value={definition.pointStyleId ?? ''}
            onChange={(event) => onPatch({ pointStyleId: event.target.value || undefined })}
          >
            <option value="">(drawing default)</option>
            {drawing.pointStyles.map((style) => (
              <option key={style.id} value={style.id}>{style.name ?? style.id}</option>
            ))}
            {!pointStyleKnown ? <option value={definition.pointStyleId}>{definition.pointStyleId} (missing)</option> : null}
          </select>
        ) : (
          <input
            id="f2f-def-point-style"
            className={`${inputClass} font-mono`}
            value={definition.pointStyleId ?? ''}
            placeholder="default"
            onChange={(event) => onPatch({ pointStyleId: event.target.value || undefined })}
          />
        )}
        {!pointStyleKnown ? (
          <span className="text-[11px] text-amber-300" data-f2f-style-warning>
            Unknown point style “{definition.pointStyleId}” — stored ref kept; drawing default applies at generation.
          </span>
        ) : null}
      </span>
      <label htmlFor="f2f-def-label-style">Label style</label>
      <span className="grid gap-0.5">
        {drawing ? (
          <select
            id="f2f-def-label-style"
            className={`${inputClass} font-mono`}
            value={definition.labelStyleId ?? ''}
            onChange={(event) => onPatch({ labelStyleId: event.target.value || undefined })}
          >
            <option value="">(F2F Full compat)</option>
            {drawing.labelStyles.map((style) => (
              <option key={style.id} value={style.id}>{style.name ?? style.id}</option>
            ))}
            {!labelStyleKnown ? <option value={definition.labelStyleId}>{definition.labelStyleId} (missing)</option> : null}
          </select>
        ) : (
          <input
            id="f2f-def-label-style"
            className={`${inputClass} font-mono`}
            value={definition.labelStyleId ?? ''}
            placeholder="default"
            onChange={(event) => onPatch({ labelStyleId: event.target.value || undefined })}
          />
        )}
        {!labelStyleKnown ? (
          <span className="text-[11px] text-amber-300" data-f2f-style-warning>
            Unknown label style “{definition.labelStyleId}” — stored ref kept; F2F Full compat applies at generation.
          </span>
        ) : null}
      </span>
      <span>Point behavior</span>
      <select
        aria-label="Point behavior"
        className={inputClass}
        value={definition.pointBehavior}
        onChange={(event) => onPatch({ pointBehavior: event.target.value === 'none' ? 'none' : 'point' })}
      >
        <option value="point">point — create point</option>
        <option value="none">none — linework only</option>
      </select>
      <span>Linework</span>
      <span className="grid gap-0.5">
        <span className="flex items-center gap-2">
          <label className="flex items-center gap-1">
            <input
              type="checkbox"
              checked={definition.lineworkBehavior.enabled}
              onChange={(event) =>
                onPatch({ lineworkBehavior: { ...definition.lineworkBehavior, enabled: event.target.checked } })
              }
            />
            enabled
          </label>
          <label className="flex items-center gap-1">
            <input
              type="checkbox"
              checked={definition.lineworkBehavior.implicitContinuation}
              onChange={(event) =>
                onPatch({
                  lineworkBehavior: { ...definition.lineworkBehavior, implicitContinuation: event.target.checked },
                })
              }
            />
            implicit continuation
          </label>
        </span>
        <span className="text-[11px] text-slate-500" title="Control tokens attach to the current code in raw text">
          Control tokens: BEGIN CONTINUE END CLOSE — e.g. “EP BEGIN”.
        </span>
      </span>
      <label htmlFor="f2f-def-rename">Stable id</label>
      <input
        id="f2f-def-rename"
        className={`${inputClass} font-mono`}
        value={definition.id}
        title="Stable id — never changes meaning; the editable code above can be renamed freely."
        onChange={(event) => onRenameId(event.target.value.trim() || definition.id)}
      />
      <span>Attributes</span>
      <span className="grid gap-0.5">
        {attrs.map(([key, value]) => (
          <span key={key} className="flex items-center gap-1 font-mono">
            <span>{key}={value}</span>
            <button
              type="button"
              className="rounded border border-slate-700 px-1 hover:bg-slate-800"
              aria-label={`Remove attribute ${key}`}
              onClick={() => {
                const next = { ...(definition.defaultAttributes ?? {}) };
                delete next[key];
                onPatch({ defaultAttributes: next });
              }}
            >
              ×
            </button>
          </span>
        ))}
        <span className="flex items-center gap-1">
          <input
            aria-label="Attribute key"
            className={`${inputClass} w-24 font-mono`}
            value={attrKey}
            placeholder="key"
            onChange={(event) => setAttrKey(event.target.value)}
          />
          <input
            aria-label="Attribute value"
            className={`${inputClass} w-28 font-mono`}
            value={attrValue}
            placeholder="value"
            onChange={(event) => setAttrValue(event.target.value)}
          />
          <button
            type="button"
            className="rounded border border-slate-600 px-2 py-0.5 hover:bg-slate-800 disabled:opacity-40"
            disabled={!attrKey.trim()}
            onClick={() => {
              onPatch({ defaultAttributes: { ...(definition.defaultAttributes ?? {}), [attrKey.trim()]: attrValue } });
              setAttrKey('');
              setAttrValue('');
            }}
          >
            Add
          </button>
        </span>
        <span className="text-[11px] text-slate-500">Unknown keys preserved on roundtrip.</span>
      </span>
    </div>
  );
};
