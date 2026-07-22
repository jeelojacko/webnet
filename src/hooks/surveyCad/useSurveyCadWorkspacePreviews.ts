import { useEffect, useMemo, type Dispatch, type SetStateAction } from 'react';
import { buildCadBounds } from '../../engine/cad/cadProjectState';
import { buildCadDisplayScene } from '../../engine/cad/cadRenderer';
import {
  applyCadGripEdit,
  buildCadExtendPreview,
  buildCadFilletPreview,
  buildCadGripHandles,
  buildCadTrimPreview,
} from '../../engine/cad/cadTransactions';
import type { ActiveCommandKey } from './useSurveyCadCommandTypes';
import type { CadCommandPreviewState } from './useSurveyCadCommands';
import type { CommandHoverTarget } from './useSurveyCadWorkspace.types';
import type {
  CadDisplayPrimitive,
  CadGripHandle,
  CadProject,
} from '../../engine/cad/cadTypes';
import type { CadEntityId } from '../../engine/cad/cadTypes';

type EditableGripEntity = Parameters<typeof buildCadGripHandles>[0];

type UseSurveyCadWorkspacePreviewsOptions = {
  activeCommandKey: ActiveCommandKey | null;
  activeExtendTarget: { entityId: CadEntityId; pickPoint: { x: number; y: number }; segmentId?: string } | null;
  activeFilletPreview: {
    radius: number;
    firstEntityId: CadEntityId;
    firstPickPoint: { x: number; y: number };
    firstSegmentId?: string;
  } | null;
  activeGripHandle: CadGripHandle | null;
  activeTrimCuttingEntityIds: CadEntityId[];
  cadProject: CadProject;
  commandHoverTarget: CommandHoverTarget | null;
  commandPreview: CadCommandPreviewState | null;
  displayPrimitives: CadDisplayPrimitive[];
  editableSelectedEntity: EditableGripEntity | null;
  selectedEntityIds: CadEntityId[];
  setActiveGripHandle: Dispatch<SetStateAction<CadGripHandle | null>>;
};

export const useSurveyCadWorkspacePreviews = ({
  activeCommandKey,
  activeExtendTarget,
  activeFilletPreview,
  activeGripHandle,
  activeTrimCuttingEntityIds,
  cadProject,
  commandHoverTarget,
  commandPreview,
  displayPrimitives,
  editableSelectedEntity,
  selectedEntityIds,
  setActiveGripHandle,
}: UseSurveyCadWorkspacePreviewsOptions) => {
  const commandPreviewPrimitives = useMemo<CadDisplayPrimitive[]>(() => {
    if (!commandPreview) return [] as CadDisplayPrimitive[];
    const previewStroke =
      activeCommandKey === 'COPY' || activeCommandKey === 'PASTE' ? '#38bdf8' : '#22d3ee';
    const previewOpacity = 0.85;
    if (commandPreview.kind === 'point') {
      return [
        {
          kind: 'point' as const,
          id: 'preview:point',
          layerId: 'preview',
          sourceEntityId: 'preview:point',
          stroke: previewStroke,
          fill: previewStroke,
          point: commandPreview.point,
          radius: 2.4,
          opacity: previewOpacity,
        },
      ];
    }
    if (commandPreview.kind === 'line') {
      return [
        {
          kind: 'line' as const,
          id: 'preview:line',
          layerId: 'preview',
          sourceEntityId: 'preview:line',
          stroke: previewStroke,
          points: commandPreview.points,
          strokeWidth: 1.5,
          opacity: previewOpacity,
          strokeDasharray: '8 6',
        },
      ];
    }
    if (commandPreview.kind === 'arc') {
      return [
        {
          kind: 'arc' as const,
          id: 'preview:arc',
          layerId: 'preview',
          sourceEntityId: 'preview:arc',
          stroke: previewStroke,
          center: commandPreview.center,
          radius: commandPreview.radius,
          startAngleDeg: commandPreview.startAngleDeg,
          endAngleDeg: commandPreview.endAngleDeg,
          strokeWidth: 1.5,
          opacity: previewOpacity,
          strokeDasharray: '8 6',
        },
      ];
    }
    if (commandPreview.kind === 'polyline') {
      return commandPreview.points.slice(0, -1).map((point, index) => ({
        kind: 'line' as const,
        id: `preview:polyline:${index + 1}`,
        layerId: 'preview',
        sourceEntityId: `preview:polyline:${index + 1}`,
        stroke: previewStroke,
        points: [point, commandPreview.points[index + 1]!] as [{ x: number; y: number }, { x: number; y: number }],
        strokeWidth: 1.5,
        opacity: previewOpacity,
        strokeDasharray: '8 6',
      }));
    }
    if (commandPreview.kind === 'primitives') {
      return commandPreview.primitives;
    }
    const previewSourceEntityIds =
      commandPreview.kind === 'translate-selection'
        ? commandPreview.sourceEntityIds ?? selectedEntityIds
        : selectedEntityIds;
    return displayPrimitives
      .filter((primitive) => previewSourceEntityIds.includes(primitive.sourceEntityId))
      .map((primitive, index) => {
        if (primitive.kind === 'line') {
          return {
            ...primitive,
            id: `preview:translate:${index + 1}`,
            sourceEntityId: `preview:translate:${index + 1}`,
            stroke: previewStroke,
            points: [
              {
                x: primitive.points[0].x + commandPreview.deltaX,
                y: primitive.points[0].y + commandPreview.deltaY,
              },
              {
                x: primitive.points[1].x + commandPreview.deltaX,
                y: primitive.points[1].y + commandPreview.deltaY,
              },
            ] as [{ x: number; y: number }, { x: number; y: number }],
            opacity: 0.6,
            strokeDasharray: '8 6',
          };
        }
        if (primitive.kind === 'point') {
          return {
            ...primitive,
            id: `preview:translate:${index + 1}`,
            sourceEntityId: `preview:translate:${index + 1}`,
            stroke: previewStroke,
            fill: previewStroke,
            point: {
              x: primitive.point.x + commandPreview.deltaX,
              y: primitive.point.y + commandPreview.deltaY,
            },
            opacity: 0.6,
          };
        }
        if (primitive.kind === 'text') {
          return {
            ...primitive,
            id: `preview:translate:${index + 1}`,
            sourceEntityId: `preview:translate:${index + 1}`,
            stroke: previewStroke,
            point: {
              x: primitive.point.x + commandPreview.deltaX,
              y: primitive.point.y + commandPreview.deltaY,
            },
            opacity: 0.6,
          };
        }
        if (primitive.kind === 'arc') {
          return {
            ...primitive,
            id: `preview:translate:${index + 1}`,
            sourceEntityId: `preview:translate:${index + 1}`,
            stroke: previewStroke,
            center: {
              x: primitive.center.x + commandPreview.deltaX,
              y: primitive.center.y + commandPreview.deltaY,
            },
            opacity: 0.6,
            strokeDasharray: '8 6',
          };
        }
        return {
          ...primitive,
          id: `preview:translate:${index + 1}`,
          sourceEntityId: `preview:translate:${index + 1}`,
          stroke: previewStroke,
          center: {
            x: primitive.center.x + commandPreview.deltaX,
            y: primitive.center.y + commandPreview.deltaY,
          },
          opacity: 0.6,
          strokeDasharray: '8 6',
        };
      });
  }, [activeCommandKey, commandPreview, displayPrimitives, selectedEntityIds]);
  const trimPreview = useMemo(() => {
    if (activeCommandKey !== 'TRIM' || !commandHoverTarget || activeTrimCuttingEntityIds.length === 0) return null;
    return buildCadTrimPreview(
      cadProject,
      activeTrimCuttingEntityIds,
      commandHoverTarget.entityId,
      commandHoverTarget.point,
      commandHoverTarget.segmentId,
    );
  }, [activeCommandKey, activeTrimCuttingEntityIds, cadProject, commandHoverTarget]);
  const trimPreviewPrimitives = useMemo<CadDisplayPrimitive[]>(() => {
    if (!trimPreview) return [];
    return buildCadDisplayScene({
      ...cadProject,
      entities: trimPreview.previewEntities,
      bounds: buildCadBounds(trimPreview.previewEntities),
    }).primitives;
  }, [cadProject, trimPreview]);
  const extendPreview = useMemo(() => {
    if (activeCommandKey !== 'EXTEND' || !commandHoverTarget || !activeExtendTarget) return null;
    return buildCadExtendPreview(
      cadProject,
      commandHoverTarget.entityId,
      activeExtendTarget.entityId,
      activeExtendTarget.pickPoint,
      activeExtendTarget.segmentId,
    );
  }, [activeCommandKey, activeExtendTarget, cadProject, commandHoverTarget]);
  const extendPreviewPrimitives = useMemo<CadDisplayPrimitive[]>(() => {
    if (!extendPreview) return [];
    return buildCadDisplayScene({
      ...cadProject,
      entities: extendPreview.previewEntities,
      bounds: buildCadBounds(extendPreview.previewEntities),
    }).primitives;
  }, [cadProject, extendPreview]);
  const filletPreview = useMemo(() => {
    if (activeCommandKey !== 'FILLET' || !commandHoverTarget || !activeFilletPreview) return null;
    return buildCadFilletPreview(
      cadProject,
      activeFilletPreview.radius,
      activeFilletPreview.firstEntityId,
      activeFilletPreview.firstPickPoint,
      activeFilletPreview.firstSegmentId,
      commandHoverTarget.entityId,
      commandHoverTarget.point,
      commandHoverTarget.segmentId,
    );
  }, [activeCommandKey, activeFilletPreview, cadProject, commandHoverTarget]);
  const filletPreviewPrimitives = useMemo<CadDisplayPrimitive[]>(() => {
    if (!filletPreview) return [];
    return buildCadDisplayScene({
      ...cadProject,
      entities: filletPreview.previewEntities,
      bounds: buildCadBounds(filletPreview.previewEntities),
    }).primitives;
  }, [cadProject, filletPreview]);
  const commandEntityOpacityOverrides = useMemo<Record<string, number>>(
    () => ({
      ...(trimPreview ? { [trimPreview.targetEntityId]: 0.22 } : {}),
      ...(extendPreview
        ? {
            [extendPreview.targetEntityId]: 0.22,
            [extendPreview.boundaryEntityId]: 0.22,
          }
        : {}),
      ...(filletPreview
        ? {
            [filletPreview.firstEntityId]: 0.22,
            [filletPreview.secondEntityId]: 0.22,
          }
        : {}),
    }),
    [extendPreview, filletPreview, trimPreview],
  );
  const gripHandles = useMemo(
    () =>
      activeCommandKey == null && editableSelectedEntity
        ? buildCadGripHandles(editableSelectedEntity)
        : [],
    [activeCommandKey, editableSelectedEntity],
  );
  useEffect(() => {
    if (activeCommandKey != null && activeGripHandle != null) {
      setActiveGripHandle(null);
    }
  }, [activeCommandKey, activeGripHandle, setActiveGripHandle]);
  useEffect(() => {
    if (!activeGripHandle) return;
    const nextHandle = gripHandles.find((handle) => handle.id === activeGripHandle.id) ?? null;
    if (!nextHandle) {
      setActiveGripHandle(null);
    }
  }, [activeGripHandle, gripHandles, setActiveGripHandle]);
  const gripPreviewPrimitives = useMemo<CadDisplayPrimitive[]>(() => {
    if (!activeGripHandle) return [];
    const previewProject = applyCadGripEdit(cadProject, {
      key: 'GRIP_EDIT',
      entityId: activeGripHandle.entityId,
      gripKind: activeGripHandle.kind,
      x: activeGripHandle.x,
      y: activeGripHandle.y,
      vertexIndex: activeGripHandle.vertexIndex,
    });
    if (!previewProject) return [];
    return buildCadDisplayScene(previewProject).primitives
      .filter((primitive) => primitive.sourceEntityId === activeGripHandle.entityId)
      .map((primitive) => ({
        ...primitive,
        stroke: '#22d3ee',
        fill: primitive.kind === 'point' ? '#22d3ee' : primitive.fill,
        opacity: 0.9,
        strokeDasharray:
          primitive.kind === 'text' || primitive.kind === 'point'
            ? primitive.strokeDasharray
            : primitive.strokeDasharray ?? '8 6',
      }));
  }, [activeGripHandle, cadProject]);


  return {
    commandPreviewPrimitives: [
      ...commandPreviewPrimitives,
      ...trimPreviewPrimitives,
      ...extendPreviewPrimitives,
      ...filletPreviewPrimitives,
    ],
    commandEntityOpacityOverrides,
    gripHandles,
    gripPreviewPrimitives,
  };
};
