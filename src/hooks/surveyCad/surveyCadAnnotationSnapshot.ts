// Phase 18O — workspace-side annotation snapshot (pure).
//
// Builds the `CadAnnotationSnapshot` the shell chrome renders: style tables
// straight from the project (blank drawings are backfilled with seeds at
// load), per-table reference counts, arrowhead definitions from the block
// library, and precomputed selected-entity detail so the Properties palette
// stays a dumb renderer.

import type {
  CadAnnotationSelectionInfo,
  CadAnnotationSnapshot,
} from '../../cad-app/annotation/cadAnnotationUiTypes';
import { resolveCadAnnotationAnchor } from '../../engine/cad/annotation/cadAnnotationAnchors';
import {
  deriveBearingDistanceLabel,
  deriveCurveLabel,
} from '../../engine/cad/annotation/cadSurveyLabels';
import { resolveAnnotationScaleDenominator } from '../../engine/cad/annotation/cadAnnotationSettings';
import {
  seedBearingLabelStyles,
  seedCurveLabelStyles,
  seedDimensionStyles,
  seedLeaderStyles,
  seedProfessionalTextStyles,
} from '../../engine/cad/annotation/cadAnnotationSeeds';
import { resolveDimensionDerivation } from '../../engine/cad/cadRenderer';
import { getCadEntityDisplayLabel } from '../../engine/cad/cadEntityNames';
import { formatCadSweepDms } from '../../engine/cad/cadCogoSummaries';
import type {
  CadBearingDistanceLabelEntity,
  CadCurveLabelEntity,
  CadDimensionEntity,
  CadEntity,
  CadLeaderEntity,
  CadMTextEntity,
  CadProject,
} from '../../engine/cad/cadTypes';

const layerNameOf = (project: CadProject, layerId: string): string =>
  project.layers.find((layer) => layer.id === layerId)?.name ?? layerId;

const anchorSourceLabel = (project: CadProject, entity: CadDimensionEntity | CadLeaderEntity): string => {
  for (const anchor of entity.type === 'leader' ? [entity.arrowAnchor] : entity.anchors) {
    if (anchor.kind === 'fixed') continue;
    const source = project.entities.find((candidate) => candidate.id === anchor.entityId);
    if (source) return getCadEntityDisplayLabel(source);
  }
  return entity.type === 'leader' ? 'Fixed point' : 'Fixed points';
};

const buildMTextInfo = (project: CadProject, entity: CadMTextEntity): CadAnnotationSelectionInfo => ({
  kind: 'mtext',
  entityId: entity.id,
  layerId: entity.layerId,
  layerName: layerNameOf(project, entity.layerId),
  text: entity.text,
  textStyleId: entity.textStyleId,
  x: entity.x,
  y: entity.y,
  rotationDeg: entity.rotationDeg,
  attachment: entity.attachment,
});

const buildLeaderInfo = (project: CadProject, entity: CadLeaderEntity): CadAnnotationSelectionInfo => {
  const resolved = resolveCadAnnotationAnchor(entity.arrowAnchor, project);
  return {
    kind: 'leader',
    entityId: entity.id,
    layerId: entity.layerId,
    layerName: layerNameOf(project, entity.layerId),
    text: entity.text,
    leaderStyleId: entity.leaderStyleId,
    textStyleId: entity.textStyleId ?? null,
    textAttachment: entity.textAttachment ?? null,
    targetStatus: entity.arrowAnchor.kind === 'fixed' ? 'fixed' : resolved.ok ? 'attached' : 'broken',
    targetLabel: anchorSourceLabel(project, entity),
    vertices: entity.vertices.map((vertex) => ({ x: vertex.x, y: vertex.y })),
  };
};

const buildDimensionInfo = (project: CadProject, entity: CadDimensionEntity): CadAnnotationSelectionInfo => {
  const derivation = resolveDimensionDerivation(project, entity);
  const measuredText = derivation?.geometry.formattedText ?? '—';
  return {
    kind: 'dimension',
    entityId: entity.id,
    layerId: entity.layerId,
    layerName: layerNameOf(project, entity.layerId),
    dimensionKind: entity.dimensionKind,
    dimensionStyleId: entity.dimensionStyleId,
    measuredText,
    displayedText: entity.textOverride ?? measuredText,
    textOverride: entity.textOverride ?? null,
    placement: `${entity.orientation ?? entity.dimensionKind} @ ${entity.dimLinePoint.x.toFixed(3)},${entity.dimLinePoint.y.toFixed(3)}`,
    sourceText: anchorSourceLabel(project, entity),
    textPoint: entity.textPoint != null ? { x: entity.textPoint.x, y: entity.textPoint.y } : null,
    autoTextPoint: derivation?.geometry.textPosition ?? { ...entity.dimLinePoint },
    broken: derivation == null,
  };
};

const buildBearingLabelInfo = (
  project: CadProject,
  entity: CadBearingDistanceLabelEntity,
): CadAnnotationSelectionInfo => {
  const source = project.entities.find((candidate) => candidate.id === entity.sourceEntityId);
  const style = project.bearingLabelStyles?.find((entry) => entry.id === entity.labelStyleId);
  const broken = source == null || source.type !== 'line';
  const derived =
    !broken && source.type === 'line'
      ? (() => {
          const label = deriveBearingDistanceLabel({
            from: { x: source.fromX, y: source.fromY },
            to: { x: source.toX, y: source.toY },
            content: style?.content ?? 'bearing-distance',
            separator: '\n',
            distancePrecision: style?.decimalPrecision ?? 3,
          });
          return [
            { label: 'Bearing', value: label.bearing },
            { label: 'Distance', value: label.distance },
          ];
        })()
      : [];
  return {
    kind: 'bearing-label',
    entityId: entity.id,
    layerId: entity.layerId,
    layerName: layerNameOf(project, entity.layerId),
    labelStyleId: entity.labelStyleId,
    sourceEntityId: entity.sourceEntityId,
    sourceLabel: source ? getCadEntityDisplayLabel(source) : entity.sourceEntityId,
    statusText: broken ? 'Broken — source line is gone' : 'Attached',
    derived,
    offset: { x: entity.offset.x, y: entity.offset.y },
    manualTextOverride: entity.manualTextOverride ?? null,
    broken,
  };
};

const buildCurveLabelInfo = (
  project: CadProject,
  entity: CadCurveLabelEntity,
): CadAnnotationSelectionInfo => {
  const source = project.entities.find((candidate) => candidate.id === entity.sourceEntityId);
  const style = project.curveLabelStyles?.find((entry) => entry.id === entity.labelStyleId);
  const broken = source == null || source.type !== 'arc';
  const derived: Array<{ label: string; value: string }> = [];
  if (!broken && source.type === 'arc') {
    const label = deriveCurveLabel({
      center: { x: source.centerX, y: source.centerY },
      radius: source.radius,
      startAngleDeg: source.startAngleDeg,
      endAngleDeg: source.endAngleDeg,
      fields: style?.fields ?? ['radius', 'delta', 'length'],
      decimalPrecision: style?.decimalPrecision ?? 3,
    });
    if (label) {
      const precision = style?.decimalPrecision ?? 3;
      const rows: Record<string, string> = {
        radius: `R ${label.radius.toFixed(precision)}`,
        delta: `Δ ${formatCadSweepDms(label.deltaDeg)}`,
        length: `L ${label.arcLength.toFixed(precision)}`,
        chord: `C ${label.chordLength.toFixed(precision)}`,
      };
      for (const field of style?.fields ?? ['radius', 'delta', 'length']) {
        derived.push({ label: field, value: rows[field] ?? '' });
      }
    }
  }
  return {
    kind: 'curve-label',
    entityId: entity.id,
    layerId: entity.layerId,
    layerName: layerNameOf(project, entity.layerId),
    labelStyleId: entity.labelStyleId,
    sourceEntityId: entity.sourceEntityId,
    sourceLabel: source ? getCadEntityDisplayLabel(source) : entity.sourceEntityId,
    statusText: broken ? 'Broken — source arc is gone' : 'Attached',
    derived,
    offset: { x: entity.offset.x, y: entity.offset.y },
    manualTextOverride: entity.manualTextOverride ?? null,
    broken,
  };
};

const buildSelectionInfo = (project: CadProject, entity: CadEntity): CadAnnotationSelectionInfo | null => {
  switch (entity.type) {
    case 'mtext':
      return buildMTextInfo(project, entity);
    case 'leader':
      return buildLeaderInfo(project, entity);
    case 'dimension':
      return buildDimensionInfo(project, entity);
    case 'bearing-label':
      return buildBearingLabelInfo(project, entity);
    case 'curve-label':
      return buildCurveLabelInfo(project, entity);
    default:
      return null;
  }
};

/** Per-table reference counts (entity refs + cross-style text refs). Shared with op guards. */
export const buildAnnotationReferenceCounts = (
  project: CadProject,
): CadAnnotationSnapshot['referenceCounts'] => {
  const counts: CadAnnotationSnapshot['referenceCounts'] = {
    textStyles: {},
    dimensionStyles: {},
    leaderStyles: {},
    bearingLabelStyles: {},
    curveLabelStyles: {},
  };
  const bump = (table: keyof typeof counts, id: string): void => {
    counts[table][id] = (counts[table][id] ?? 0) + 1;
  };
  for (const style of [
    ...(project.dimensionStyles ?? []),
    ...(project.leaderStyles ?? []),
    ...(project.bearingLabelStyles ?? []),
    ...(project.curveLabelStyles ?? []),
  ]) {
    bump('textStyles', style.textStyleId);
  }
  for (const entity of project.entities) {
    switch (entity.type) {
      case 'mtext':
        bump('textStyles', entity.textStyleId);
        break;
      case 'leader':
        bump('leaderStyles', entity.leaderStyleId);
        if (entity.textStyleId) bump('textStyles', entity.textStyleId);
        break;
      case 'dimension':
        bump('dimensionStyles', entity.dimensionStyleId);
        break;
      case 'bearing-label':
        bump('bearingLabelStyles', entity.labelStyleId);
        break;
      case 'curve-label':
        bump('curveLabelStyles', entity.labelStyleId);
        break;
      default:
        break;
    }
  }
  return counts;
};

/** Style tables with seed fallback so raw (non-backfilled) projects still render. */
export const buildCadAnnotationSnapshot = (
  project: CadProject,
  selectedEntityIds: readonly string[],
): CadAnnotationSnapshot => {
  // Professional styles only: legacy screen styles are not annotation-managed.
  // Blank drawings backfill exactly the two professional seeds (spec: 2 rows).
  const textStyles = (project.styleLibrary?.textStyles ?? seedProfessionalTextStyles()).filter(
    (style) => style.heightMode != null && style.heightMode !== 'legacy-screen',
  );
  const dimensionStyles = project.dimensionStyles ?? seedDimensionStyles();
  const leaderStyles = project.leaderStyles ?? seedLeaderStyles();
  const bearingLabelStyles = project.bearingLabelStyles ?? seedBearingLabelStyles();
  const curveLabelStyles = project.curveLabelStyles ?? seedCurveLabelStyles();

  const referenceCounts = buildAnnotationReferenceCounts(project);

  const selected: CadAnnotationSelectionInfo[] = [];
  for (const entity of project.entities) {
    if (!selectedEntityIds.includes(entity.id)) continue;
    const info = buildSelectionInfo(project, entity);
    if (info) selected.push(info);
  }

  return {
    annotationScaleDenominator: resolveAnnotationScaleDenominator(project),
    textStyles,
    dimensionStyles,
    leaderStyles,
    bearingLabelStyles,
    curveLabelStyles,
    referenceCounts,
    arrowDefinitions: (project.blockDefinitions ?? []).map((definition) => ({
      id: definition.id,
      name: definition.name,
    })),
    selected,
  };
};
