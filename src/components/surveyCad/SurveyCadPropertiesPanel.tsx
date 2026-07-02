import React, { useEffect, useMemo, useState } from 'react';
import type { CadEntityId } from '../../engine/cad/cadTypes';
import { cadConvertAreaSquareMeters, type CadParcelReportSummary } from '../../engine/cad/cadCogo';
import type {
  CadEntityPropertyEditField,
  CadPropertiesPanelState,
} from '../../engine/cad/cadProperties';
import SurveyCadFloatingPanelShell from './SurveyCadFloatingPanelShell';

interface SurveyCadPropertiesPanelProps {
  panelState: CadPropertiesPanelState;
  selectedParcelReport?: CadParcelReportSummary | null;
  onSelectEntity: (_entityId: CadEntityId) => void;
  onEditField: (
    _entityId: CadEntityId,
    _field: CadEntityPropertyEditField,
    _value: string,
  ) => boolean;
}

const SurveyCadPropertiesPanel: React.FC<SurveyCadPropertiesPanelProps> = ({
  panelState,
  selectedParcelReport = null,
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
  const activeParcelReport = useMemo(
    () => (activeEntity?.entityType === 'parcel' ? selectedParcelReport : null),
    [activeEntity?.entityType, selectedParcelReport],
  );
  const activeParcelAreaUnits = useMemo(
    () => (activeParcelReport ? cadConvertAreaSquareMeters(activeParcelReport.areaSquareMeters) : null),
    [activeParcelReport],
  );

  if (!activeEntity) return null;

  const panelControls =
    panelState.mode === 'multi' ? (
      <div className="grid gap-1">
        <select
          className="rounded border border-slate-700 bg-slate-900 px-1.5 py-0.5 text-[9px] text-slate-100"
          value={activeGroup?.typeKey ?? ''}
          onChange={(event) => {
            const nextTypeKey = event.target.value;
            const nextGroup = panelState.groups.find((group) => group.typeKey === nextTypeKey) ?? null;
            setSelectedTypeKey(nextTypeKey);
            setSelectedEntityId(nextGroup?.entities[0]?.entityId ?? null);
          }}
          title="Choose the selected entity type group"
          data-survey-cad-properties-type-select
        >
          {panelState.groups.map((group) => (
            <option key={group.typeKey} value={group.typeKey}>
              {group.typeLabel}
            </option>
          ))}
        </select>
        <select
          className="rounded border border-slate-700 bg-slate-900 px-1.5 py-0.5 text-[9px] text-slate-100"
          value={activeEntity.entityId}
          onChange={(event) => {
            const nextEntityId = event.target.value;
            setSelectedEntityId(nextEntityId);
            onSelectEntity(nextEntityId);
          }}
          title="Choose the active selected entity"
          data-survey-cad-properties-entity-select
        >
          {activeGroup?.entities.map((entity) => (
            <option key={entity.entityId} value={entity.entityId}>
              {entity.entityLabel}
            </option>
          ))}
        </select>
      </div>
    ) : null;

  return (
    <SurveyCadFloatingPanelShell
      title="Properties"
      dock="right"
      collapsed={false}
      positionStyle={{ right: '12px', top: '104px', width: '19rem', height: '600px' }}
      shellDataAttribute="data-survey-cad-properties-panel"
      headerDataAttribute="data-survey-cad-properties-panel-header"
      headerActions={<></>}
    >
      <div className="grid min-h-0 flex-1 gap-1 overflow-y-auto p-1.5 pr-2 text-[9px] leading-3 text-slate-200">
        <div className="sr-only" data-survey-cad-properties-panel-title>
          Properties
        </div>
        {panelControls}
        <div className="font-semibold text-slate-100" data-survey-cad-properties-entity-label>
          {activeEntity.entityLabel}
        </div>
        {activeParcelReport ? (
          <div className="grid gap-1 rounded border border-slate-800 bg-slate-900/50 p-1.5">
            <div className="text-[8px] font-semibold uppercase tracking-[0.1em] text-cyan-200">
              {activeParcelReport.parcelName}
            </div>
            <div className="grid grid-cols-[auto,1fr] gap-x-2 gap-y-0.5">
              <span className="text-slate-400">Area</span>
              <span>{activeParcelReport.areaSquareMeters.toFixed(3)} m²</span>
              <span className="text-slate-400">Area (ha)</span>
              <span>{activeParcelAreaUnits?.hectares.toFixed(4)} ha</span>
              <span className="text-slate-400">Area (ac)</span>
              <span>{activeParcelAreaUnits?.acres.toFixed(4)} ac</span>
              <span className="text-slate-400">Area (ft²)</span>
              <span>{activeParcelAreaUnits?.squareFeet.toFixed(3)} ft²</span>
              <span className="text-slate-400">Perimeter</span>
              <span>{activeParcelReport.perimeterMeters.toFixed(3)} m</span>
              <span className="text-slate-400">Closure dN</span>
              <span>{activeParcelReport.closureDeltaY.toFixed(3)} m</span>
              <span className="text-slate-400">Closure dE</span>
              <span>{activeParcelReport.closureDeltaX.toFixed(3)} m</span>
              <span className="text-slate-400">Closure</span>
              <span>{activeParcelReport.closureDistanceMeters.toFixed(3)} m</span>
            </div>
            <div className="pt-1 text-[8px] font-semibold uppercase tracking-[0.1em] text-slate-400">
              Courses
            </div>
            <div className="grid gap-0.5">
              {activeParcelReport.courses.map((course, index) => (
                <div
                  key={`${course.fromLabel}-${course.toLabel}-${index + 1}`}
                  className="grid grid-cols-[4.5rem_1fr_auto] gap-x-1"
                  data-survey-cad-parcel-course
                >
                  <span className="text-slate-400">{course.fromLabel}-{course.toLabel}</span>
                  <span>
                    {course.bearing}
                    <span className="pl-1 text-[8px] text-slate-400">{course.azimuthText}</span>
                  </span>
                  <span>{course.distanceMeters.toFixed(3)} m</span>
                </div>
              ))}
            </div>
          </div>
        ) : null}
        <div
          className="grid grid-cols-[auto,1fr] gap-x-2 gap-y-0.5"
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
                      className="min-w-0 rounded border border-slate-700 bg-slate-900 px-1.5 py-0.5 text-[9px] text-slate-100 outline-none focus:border-cyan-400"
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
    </SurveyCadFloatingPanelShell>
  );
};

export default SurveyCadPropertiesPanel;
