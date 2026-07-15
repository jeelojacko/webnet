import { useEffect, useRef, useState } from 'react';

import type {
  BracePreviewPoint2d,
  PlanningInputPoint2d,
  PlanningPolygon2d,
  ScenarioPreviewSegment2d,
} from './useMapViewPlanning2d';

export interface UseFrozenMapViewOverlaysOptions {
  effectiveMode: '2d' | '3d';
  interactionPhase: 'idle' | 'interacting' | 'settling';
  visiblePointLabels2d: Set<string>;
  planningPolygons2d: PlanningPolygon2d[];
  planningInputPoints2d: PlanningInputPoint2d[];
  bracePreviewPoints2d: BracePreviewPoint2d[];
  scenarioPreviewSegments2d: ScenarioPreviewSegment2d[];
}

export interface FrozenMapViewOverlays {
  svgVisiblePointLabels2d: Set<string>;
  svgPlanningPolygons2d: PlanningPolygon2d[];
  svgPlanningInputPoints2d: PlanningInputPoint2d[];
  svgBracePreviewPoints2d: BracePreviewPoint2d[];
  svgScenarioPreviewSegments2d: ScenarioPreviewSegment2d[];
}

export const useFrozenMapViewOverlays = (
  options: UseFrozenMapViewOverlaysOptions,
): FrozenMapViewOverlays => {
  const {
    bracePreviewPoints2d,
    effectiveMode,
    interactionPhase,
    planningInputPoints2d,
    planningPolygons2d,
    scenarioPreviewSegments2d,
    visiblePointLabels2d,
  } = options;

  const frozenVisiblePointLabels2dRef = useRef<Set<string>>(new Set());
  const [frozenVisiblePointLabels2d, setFrozenVisiblePointLabels2d] = useState<Set<string>>(
    () => new Set(),
  );
  const frozenPlanningPolygons2dRef = useRef<PlanningPolygon2d[]>([]);
  const [frozenPlanningPolygons2d, setFrozenPlanningPolygons2d] = useState<PlanningPolygon2d[]>([]);
  const frozenPlanningInputPoints2dRef = useRef<PlanningInputPoint2d[]>([]);
  const [frozenPlanningInputPoints2d, setFrozenPlanningInputPoints2d] = useState<
    PlanningInputPoint2d[]
  >([]);
  const frozenBracePreviewPoints2dRef = useRef<BracePreviewPoint2d[]>([]);
  const [frozenBracePreviewPoints2d, setFrozenBracePreviewPoints2d] = useState<
    BracePreviewPoint2d[]
  >([]);
  const frozenScenarioPreviewSegments2dRef = useRef<ScenarioPreviewSegment2d[]>([]);
  const [frozenScenarioPreviewSegments2d, setFrozenScenarioPreviewSegments2d] = useState<
    ScenarioPreviewSegment2d[]
  >([]);

  useEffect(() => {
    if (interactionPhase !== 'idle') return;
    frozenVisiblePointLabels2dRef.current = visiblePointLabels2d;
    frozenPlanningPolygons2dRef.current = planningPolygons2d;
    frozenPlanningInputPoints2dRef.current = planningInputPoints2d;
    frozenBracePreviewPoints2dRef.current = bracePreviewPoints2d;
    frozenScenarioPreviewSegments2dRef.current = scenarioPreviewSegments2d;
    setFrozenVisiblePointLabels2d(visiblePointLabels2d);
    setFrozenPlanningPolygons2d(planningPolygons2d);
    setFrozenPlanningInputPoints2d(planningInputPoints2d);
    setFrozenBracePreviewPoints2d(bracePreviewPoints2d);
    setFrozenScenarioPreviewSegments2d(scenarioPreviewSegments2d);
  }, [
    bracePreviewPoints2d,
    interactionPhase,
    planningInputPoints2d,
    planningPolygons2d,
    scenarioPreviewSegments2d,
    visiblePointLabels2d,
  ]);

  const frozenOverlayInteraction = effectiveMode === '2d' && interactionPhase === 'interacting';

  return {
    svgVisiblePointLabels2d: frozenOverlayInteraction
      ? frozenVisiblePointLabels2d
      : visiblePointLabels2d,
    svgPlanningPolygons2d: frozenOverlayInteraction ? frozenPlanningPolygons2d : planningPolygons2d,
    svgPlanningInputPoints2d: frozenOverlayInteraction
      ? frozenPlanningInputPoints2d
      : planningInputPoints2d,
    svgBracePreviewPoints2d: frozenOverlayInteraction
      ? frozenBracePreviewPoints2d
      : bracePreviewPoints2d,
    svgScenarioPreviewSegments2d: frozenOverlayInteraction
      ? frozenScenarioPreviewSegments2d
      : scenarioPreviewSegments2d,
  };
};
