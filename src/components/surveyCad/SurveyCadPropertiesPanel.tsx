import React, { useEffect, useMemo, useState } from 'react';
import type { CadEntityId } from '../../engine/cad/cadTypes';
import type {
  CadEntityPropertyEditField,
  CadPropertiesPanelState,
} from '../../engine/cad/cadProperties';

interface SurveyCadPropertiesPanelProps {
  panelState: CadPropertiesPanelState;
  onSelectEntity: (_entityId: CadEntityId) => void;
  onEditField: (
    _entityId: CadEntityId,
    _field: CadEntityPropertyEditField,
    _value: string,
  ) => boolean;
}

const SurveyCadPropertiesPanel: React.FC<SurveyCadPropertiesPanelProps> = ({
  panelState,
  onSelectEntity,
  onEditField,
}) => {
  const [selectedTypeKey, setSelectedTypeKey] = useState<CadEntityId | null>(
    panelState.mode === 'multi' ? panelState.defaultTypeKey : null,
  );
  const [selectedEntityId, setSelectedEntityId] = useState<CadEntityId | null>(
    panelState.mode === 'multi' ? panelState.defaultEntityId : null,
  );
  const [draftValues, setDraftValues] = useState<Record<string, string>>({});

  useEffect(() => {
    if (panelState.mode !== 'multi') {
      setSelectedTypeKey(null);
      setSelectedEntityId(null);
    } else {
      setSelectedTypeKey(panelState.defaultTypeKey);
      setSelectedEntityId(panelState.defaultEntityId);
    }
    setDraftValues({});
  }, [panelState]);

  const activeGroup = useMemo(() => {
    if (panelState.mode !== 'multi') return null;
    return (
      panelState.groups.find((group) => group.typeKey === selectedTypeKey) ??
      panelState.groups[0] ??
      null
    );
  }, [panelState, selectedTypeKey]);

  const activeEntity = useMemo(() => {
    if (panelState.mode === 'single') return panelState.entity;
    if (!activeGroup) return null;
    return (
      activeGroup.entities.find((entity) => entity.entityId === selectedEntityId) ??
      activeGroup.entities[0] ??
      null
    );
  }, [activeGroup, panelState, selectedEntityId]);

  if (!activeEntity) return null;

  return (
    <div
      className="absolute right-3 top-16 z-20 w-[21rem] overflow-hidden rounded border border-slate-800/80 bg-slate-950/92 text-[11px] text-slate-200 shadow-xl backdrop-blur-[1px]"
      data-survey-cad-properties-panel
      data-survey-cad-cogo-panel
    >
      <div className="border-b border-slate-800/80 px-3 py-2">
        <div
          className="text-[10px] font-semibold uppercase tracking-[0.14em] text-cyan-200"
          data-survey-cad-properties-panel-title
          data-survey-cad-cogo-panel-title
        >
          Properties
        </div>
        {panelState.mode === 'multi' ? (
          <div className="mt-2 grid gap-2">
            <select
              className="rounded border border-slate-700 bg-slate-900 px-2 py-1 text-[11px] text-slate-100"
              value={activeGroup?.typeKey ?? ''}
              onChange={(event) => {
                const nextTypeKey = event.target.value;
                const nextGroup = panelState.groups.find((group) => group.typeKey === nextTypeKey) ?? null;
                setSelectedTypeKey(nextTypeKey);
                setSelectedEntityId(nextGroup?.entities[0]?.entityId ?? null);
              }}
              data-survey-cad-properties-type-select
            >
              {panelState.groups.map((group) => (
                <option key={group.typeKey} value={group.typeKey}>
                  {group.typeLabel}
                </option>
              ))}
            </select>
            <select
              className="rounded border border-slate-700 bg-slate-900 px-2 py-1 text-[11px] text-slate-100"
              value={activeEntity.entityId}
              onChange={(event) => {
                const nextEntityId = event.target.value;
                setSelectedEntityId(nextEntityId);
                onSelectEntity(nextEntityId);
              }}
              data-survey-cad-properties-entity-select
            >
              {activeGroup?.entities.map((entity) => (
                <option key={entity.entityId} value={entity.entityId}>
                  {entity.entityLabel}
                </option>
              ))}
            </select>
          </div>
        ) : null}
        <div className="pt-2 font-semibold text-slate-100" data-survey-cad-properties-entity-label>
          {activeEntity.entityLabel}
        </div>
      </div>
      <div
        className="grid grid-cols-[auto,1fr] gap-x-3 gap-y-1 px-3 py-3"
        data-survey-cad-properties-panel-rows
        data-survey-cad-cogo-panel-rows
      >
        {activeEntity.properties.map((row) => (
          <React.Fragment key={row.key}>
            <span className="text-slate-400">{row.label}</span>
            {row.editableField ? (
              (() => {
                const editableField = row.editableField;
                return (
                  <input
                    type="text"
                    className="min-w-0 rounded border border-slate-700 bg-slate-900 px-2 py-1 text-[11px] text-slate-100 outline-none focus:border-cyan-400"
                    value={draftValues[row.key] ?? row.value}
                    onChange={(event) =>
                      setDraftValues((current) => ({
                        ...current,
                        [row.key]: event.target.value,
                      }))
                    }
                    onBlur={() =>
                      setDraftValues((current) => {
                        if (!(row.key in current)) return current;
                        const nextValues = { ...current };
                        delete nextValues[row.key];
                        return nextValues;
                      })
                    }
                    onKeyDown={(event) => {
                      if (event.key === 'Escape') {
                        event.preventDefault();
                        setDraftValues((current) => {
                          if (!(row.key in current)) return current;
                          const nextValues = { ...current };
                          delete nextValues[row.key];
                          return nextValues;
                        });
                        return;
                      }
                      if (event.key !== 'Enter') return;
                      event.preventDefault();
                      const applied = onEditField(
                        activeEntity.entityId,
                        editableField,
                        draftValues[row.key] ?? row.value,
                      );
                      if (!applied) return;
                      setDraftValues((current) => {
                        if (!(row.key in current)) return current;
                        const nextValues = { ...current };
                        delete nextValues[row.key];
                        return nextValues;
                      });
                    }}
                    data-survey-cad-properties-input={row.key}
                  />
                );
              })()
            ) : (
              <span>{row.value}</span>
            )}
          </React.Fragment>
        ))}
      </div>
    </div>
  );
};

export default SurveyCadPropertiesPanel;
