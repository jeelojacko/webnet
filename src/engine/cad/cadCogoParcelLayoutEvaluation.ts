import { cadDistance } from './cadGeometry';
import type { CadLineEntity, CadParcelLayoutSettings, CadParcelEntity } from './cadTypes';
import { cadBuildParcelClosureSummary } from './cadCogoParcelGeometry';
import { cadBuildParcelLayoutLocalPoints, type CadParcelLayoutLocalPoint } from './cadCogoParcelLocalGeometry';
import { cadBuildParcelSplitBySlideDraft, cadBuildParcelSplitBySwingDraft } from './cadCogoParcelLayoutPrimitives';
import {
  type CadParcelLayoutConstraintEvaluation,
  type CadParcelLayoutGeneratedParcelDraft,
  type CadParcelLayoutPreviewCandidate,
  type CadParcelLayoutSplitAlternative,
  type CadParcelLayoutSplitDraft,
} from './cadCogoParcelLayoutTypes';

const PARCEL_LAYOUT_EVALUATION_SAMPLE_COUNT = 7;

export const cadBuildAutoLayoutPreviewCandidateFromGeneratedParcel = (
  frontageLine: CadLineEntity,
  frontageLengthMeters: number,
  pathDepthMeters: number | null,
  settings: CadParcelLayoutSettings,
  generatedParcel: CadParcelLayoutGeneratedParcelDraft,
): CadParcelLayoutPreviewCandidate => {
  const draft: CadParcelLayoutSplitDraft = {
    split: {
      firstVertices: generatedParcel.vertices.map((vertex) => ({ x: vertex.x, y: vertex.y })),
      firstVertexLabels: [...generatedParcel.vertexLabels],
      secondVertices: [],
      secondVertexLabels: [],
      splitStart: generatedParcel.vertices[0] ?? { x: frontageLine.fromX, y: frontageLine.fromY },
      splitEnd: generatedParcel.vertices[1] ?? { x: frontageLine.toX, y: frontageLine.toY },
    },
    alternative: 'start',
    frontageLengthMeters,
    childAreaSquareMeters: cadBuildParcelClosureSummary(generatedParcel.vertices)?.areaSquareMeters ?? 0,
    childVertices: generatedParcel.vertices.map((vertex) => ({ x: vertex.x, y: vertex.y })),
    childVertexLabels: [...generatedParcel.vertexLabels],
    remainderVertices: [],
    remainderVertexLabels: [],
  };
  const evaluation = cadEvaluateGeneratedParcelLayoutConstraints({
    frontageLine,
    frontageLengthMeters,
    pathDepthMeters,
    settings,
    generatedParcel,
  });
  const isValid = evaluation.failedRuleCodes.length === 0;
  return {
    tool: 'slide',
    alternative: 'start',
    draft,
    evaluation,
    isValid,
    statusMessage: isValid
      ? `Automatic strip valid: ${draft.childAreaSquareMeters.toFixed(3)} m2 area and ${draft.frontageLengthMeters.toFixed(3)} m frontage.`
      : `Automatic strip invalid: ${evaluation.failedRuleCodes.join(', ')}.`,
  };
};

export const cadBuildCornerRemainderPreviewCandidate = (
  frontageLine: CadLineEntity,
  settings: CadParcelLayoutSettings,
  generatedParcel: CadParcelLayoutGeneratedParcelDraft,
  combinedFrontageMeters: number,
  tool: 'slide' | 'swing',
): CadParcelLayoutPreviewCandidate | null => {
  const childAreaSquareMeters =
    cadBuildParcelClosureSummary(generatedParcel.vertices)?.areaSquareMeters ?? 0;
  if (childAreaSquareMeters <= 1e-9) return null;
  const depthMeters = settings.useMaxDepth ? settings.maxDepthMeters : settings.minDepthMeters;
  const draft: CadParcelLayoutSplitDraft = {
    split: {
      firstVertices: generatedParcel.vertices.map((vertex) => ({ x: vertex.x, y: vertex.y })),
      firstVertexLabels: [...generatedParcel.vertexLabels],
      secondVertices: [],
      secondVertexLabels: [],
      splitStart: generatedParcel.vertices[0] ?? { x: frontageLine.fromX, y: frontageLine.fromY },
      splitEnd: generatedParcel.vertices[1] ?? { x: frontageLine.toX, y: frontageLine.toY },
    },
    alternative: 'start',
    frontageLengthMeters: combinedFrontageMeters,
    childAreaSquareMeters,
    childVertices: generatedParcel.vertices.map((vertex) => ({ x: vertex.x, y: vertex.y })),
    childVertexLabels: [...generatedParcel.vertexLabels],
    remainderVertices: [],
    remainderVertexLabels: [],
  };
  const failedRuleCodes: CadParcelLayoutConstraintEvaluation['failedRuleCodes'] = [];
  if (childAreaSquareMeters + 1e-9 < settings.minAreaSquareMeters) failedRuleCodes.push('min_area');
  if (combinedFrontageMeters + 1e-9 < settings.minFrontageMeters) failedRuleCodes.push('min_frontage');
  if (depthMeters + 1e-9 < settings.minDepthMeters) failedRuleCodes.push('min_depth');
  if (settings.useMaxDepth && depthMeters > settings.maxDepthMeters + 1e-9) failedRuleCodes.push('max_depth');
  const evaluationWithoutMessages: Omit<CadParcelLayoutConstraintEvaluation, 'messages'> = {
    frontageLengthMeters: combinedFrontageMeters,
    frontageAtOffsetWidthMeters: null,
    minimumSampledWidthMeters: settings.minWidthMeters,
    depthMeters,
    score:
      failedRuleCodes.length * 1_000_000 +
      Math.abs(childAreaSquareMeters - settings.minAreaSquareMeters) +
      Math.abs(combinedFrontageMeters - settings.minFrontageMeters),
    failedRuleCodes,
  };
  const evaluation: CadParcelLayoutConstraintEvaluation = {
    ...evaluationWithoutMessages,
    messages: cadBuildParcelLayoutConstraintMessages(settings, draft, evaluationWithoutMessages),
  };
  return {
    tool,
    alternative: 'start',
    draft,
    evaluation,
    isValid: failedRuleCodes.length === 0,
    statusMessage:
      failedRuleCodes.length === 0
        ? `Automatic corner lot valid: ${childAreaSquareMeters.toFixed(3)} m2 area and ${combinedFrontageMeters.toFixed(3)} m combined frontage.`
        : `Automatic corner lot invalid: ${failedRuleCodes.join(', ')}.`,
  };
};

const cadWidthAtParcelLayoutOffset = (
  localVertices: readonly CadParcelLayoutLocalPoint[],
  offsetMeters: number,
  frontageLengthMeters: number,
): number | null => {
  if (localVertices.length < 3) return null;
  if (offsetMeters <= 1e-9) return frontageLengthMeters;
  const xIntersections: number[] = [];
  for (let index = 0; index < localVertices.length; index += 1) {
    const start = localVertices[index]!;
    const end = localVertices[(index + 1) % localVertices.length]!;
    if (Math.abs(start.y - end.y) <= 1e-9) continue;
    const crosses =
      (start.y <= offsetMeters && offsetMeters < end.y) ||
      (end.y <= offsetMeters && offsetMeters < start.y);
    if (!crosses) continue;
    const ratio = (offsetMeters - start.y) / (end.y - start.y);
    xIntersections.push(start.x + (end.x - start.x) * ratio);
  }
  if (xIntersections.length < 2) return null;
  xIntersections.sort((left, right) => left - right);
  return xIntersections[xIntersections.length - 1]! - xIntersections[0]!;
};

export const cadBuildParcelLayoutConstraintMessages = (
  settings: CadParcelLayoutSettings,
  draft: CadParcelLayoutSplitDraft,
  evaluation: Omit<CadParcelLayoutConstraintEvaluation, 'messages'>,
): string[] => {
  const messages: string[] = [];
  const areaPass = draft.childAreaSquareMeters + 1e-9 >= settings.minAreaSquareMeters;
  messages.push(
    `Area ${areaPass ? 'pass' : 'fail'}: ${draft.childAreaSquareMeters.toFixed(3)} m2 vs ${settings.minAreaSquareMeters.toFixed(3)} m2 min.`,
  );
  const frontagePass = draft.frontageLengthMeters + 1e-9 >= settings.minFrontageMeters;
  messages.push(
    `Frontage ${frontagePass ? 'pass' : 'fail'}: ${draft.frontageLengthMeters.toFixed(3)} m vs ${settings.minFrontageMeters.toFixed(3)} m min.`,
  );
  if (settings.useFrontageAtOffset) {
    const widthAtOffset = evaluation.frontageAtOffsetWidthMeters;
    const offsetPass = widthAtOffset != null && widthAtOffset + 1e-9 >= settings.minFrontageMeters;
    messages.push(
      `Offset width ${offsetPass ? 'pass' : 'fail'}: ${widthAtOffset == null ? 'n/a' : `${widthAtOffset.toFixed(3)} m`} at ${settings.frontageOffsetMeters.toFixed(3)} m offset.`,
    );
  }
  const widthPass =
    evaluation.minimumSampledWidthMeters != null &&
    evaluation.minimumSampledWidthMeters + 1e-9 >= settings.minWidthMeters;
  messages.push(
    `Width ${widthPass ? 'pass' : 'fail'}: ${evaluation.minimumSampledWidthMeters == null ? 'n/a' : `${evaluation.minimumSampledWidthMeters.toFixed(3)} m`} vs ${settings.minWidthMeters.toFixed(3)} m min.`,
  );
  const depthPass =
    evaluation.depthMeters != null && evaluation.depthMeters + 1e-9 >= settings.minDepthMeters;
  messages.push(
    `Depth ${depthPass ? 'pass' : 'fail'}: ${evaluation.depthMeters == null ? 'n/a' : `${evaluation.depthMeters.toFixed(3)} m`} vs ${settings.minDepthMeters.toFixed(3)} m min.`,
  );
  if (settings.useMaxDepth) {
    const maxDepthPass =
      evaluation.depthMeters != null && evaluation.depthMeters <= settings.maxDepthMeters + 1e-9;
    messages.push(
      `Max depth ${maxDepthPass ? 'pass' : 'fail'}: ${evaluation.depthMeters == null ? 'n/a' : `${evaluation.depthMeters.toFixed(3)} m`} vs ${settings.maxDepthMeters.toFixed(3)} m max.`,
    );
  }
  return messages;
};

export const cadEvaluateParcelLayoutConstraints = (
  draft: CadParcelLayoutSplitDraft,
  frontageLine: CadLineEntity,
  settings: CadParcelLayoutSettings,
): CadParcelLayoutConstraintEvaluation => {
  const localVertices = cadBuildParcelLayoutLocalPoints(
    { x: frontageLine.fromX, y: frontageLine.fromY },
    { x: frontageLine.toX, y: frontageLine.toY },
    draft.childVertices,
  );
  const depthMeters =
    localVertices == null
      ? null
      : Math.max(
          0,
          ...localVertices.map((point) => point.y).filter((value) => Number.isFinite(value)),
        );
  const frontageAtOffsetWidthMeters =
    settings.useFrontageAtOffset && localVertices
      ? cadWidthAtParcelLayoutOffset(localVertices, settings.frontageOffsetMeters, draft.frontageLengthMeters)
      : null;

  const sampledOffsets: number[] = [];
  if (localVertices && depthMeters != null && depthMeters > 1e-6) {
    const epsilon = Math.max(depthMeters * 1e-3, 1e-4);
    for (let index = 1; index <= PARCEL_LAYOUT_EVALUATION_SAMPLE_COUNT; index += 1) {
      const ratio = index / (PARCEL_LAYOUT_EVALUATION_SAMPLE_COUNT + 1);
      sampledOffsets.push(epsilon + (depthMeters - 2 * epsilon) * ratio);
    }
  }
  const sampledWidths = sampledOffsets
    .map((offsetMeters) =>
      localVertices
        ? cadWidthAtParcelLayoutOffset(localVertices, offsetMeters, draft.frontageLengthMeters)
        : null,
    )
    .filter((value): value is number => value != null && Number.isFinite(value) && value > 1e-9);
  const minimumSampledWidthMeters =
    sampledWidths.length > 0 ? Math.min(...sampledWidths) : null;

  const failedRuleCodes: CadParcelLayoutConstraintEvaluation['failedRuleCodes'] = [];
  if (draft.childAreaSquareMeters + 1e-9 < settings.minAreaSquareMeters) {
    failedRuleCodes.push('min_area');
  }
  if (draft.frontageLengthMeters + 1e-9 < settings.minFrontageMeters) {
    failedRuleCodes.push('min_frontage');
  }
  if (
    settings.useFrontageAtOffset &&
    (frontageAtOffsetWidthMeters == null ||
      frontageAtOffsetWidthMeters + 1e-9 < settings.minFrontageMeters)
  ) {
    failedRuleCodes.push('frontage_at_offset');
  }
  if (
    minimumSampledWidthMeters == null ||
    minimumSampledWidthMeters + 1e-9 < settings.minWidthMeters
  ) {
    failedRuleCodes.push('min_width');
  }
  if (depthMeters == null || depthMeters + 1e-9 < settings.minDepthMeters) {
    failedRuleCodes.push('min_depth');
  }
  if (settings.useMaxDepth && (depthMeters == null || depthMeters > settings.maxDepthMeters + 1e-9)) {
    failedRuleCodes.push('max_depth');
  }

  const areaDelta = Math.abs(draft.childAreaSquareMeters - settings.minAreaSquareMeters);
  const frontageDelta = Math.abs(draft.frontageLengthMeters - settings.minFrontageMeters);
  const widthDelta =
    minimumSampledWidthMeters == null
      ? Number.POSITIVE_INFINITY
      : Math.abs(minimumSampledWidthMeters - settings.minWidthMeters);
  const depthDelta =
    depthMeters == null ? Number.POSITIVE_INFINITY : Math.abs(depthMeters - settings.minDepthMeters);
  let score = failedRuleCodes.length * 1_000_000;
  switch (settings.solutionPreference) {
    case 'smallest_area':
      score += draft.childAreaSquareMeters;
      break;
    case 'largest_area':
      score -= draft.childAreaSquareMeters;
      break;
    case 'most_rectangular': {
      const ratio =
        minimumSampledWidthMeters != null &&
        depthMeters != null &&
        minimumSampledWidthMeters > 1e-9 &&
        depthMeters > 1e-9
          ? Math.max(minimumSampledWidthMeters, depthMeters) /
            Math.min(minimumSampledWidthMeters, depthMeters)
          : Number.POSITIVE_INFINITY;
      score += ratio;
      break;
    }
    case 'closest_to_target_area':
      score += areaDelta;
      break;
    case 'shortest_frontage':
    default:
      score += draft.frontageLengthMeters;
      break;
  }
  score += areaDelta * 1e-3 + frontageDelta * 1e-2 + widthDelta * 1e-2 + depthDelta * 1e-2;

  const evaluationWithoutMessages = {
    frontageLengthMeters: draft.frontageLengthMeters,
    frontageAtOffsetWidthMeters,
    minimumSampledWidthMeters,
    depthMeters,
    score,
    failedRuleCodes,
  };
  return {
    ...evaluationWithoutMessages,
    messages: cadBuildParcelLayoutConstraintMessages(settings, draft, evaluationWithoutMessages),
  };
};

export const cadEvaluateGeneratedParcelLayoutConstraints = ({
  frontageLine,
  frontageLengthMeters,
  pathDepthMeters,
  settings,
  generatedParcel,
}: {
  frontageLine: CadLineEntity;
  frontageLengthMeters: number;
  pathDepthMeters: number | null;
  settings: CadParcelLayoutSettings;
  generatedParcel: CadParcelLayoutGeneratedParcelDraft;
}): CadParcelLayoutConstraintEvaluation => {
  const childAreaSquareMeters =
    cadBuildParcelClosureSummary(generatedParcel.vertices)?.areaSquareMeters ?? 0;
  const draft: CadParcelLayoutSplitDraft = {
    split: {
      firstVertices: generatedParcel.vertices.map((vertex) => ({ x: vertex.x, y: vertex.y })),
      firstVertexLabels: [...generatedParcel.vertexLabels],
      secondVertices: [],
      secondVertexLabels: [],
      splitStart: generatedParcel.vertices[0] ?? { x: frontageLine.fromX, y: frontageLine.fromY },
      splitEnd: generatedParcel.vertices[1] ?? { x: frontageLine.toX, y: frontageLine.toY },
    },
    alternative: 'start',
    frontageLengthMeters,
    childAreaSquareMeters,
    childVertices: generatedParcel.vertices.map((vertex) => ({ x: vertex.x, y: vertex.y })),
    childVertexLabels: [...generatedParcel.vertexLabels],
    remainderVertices: [],
    remainderVertexLabels: [],
  };
  const localVertices = cadBuildParcelLayoutLocalPoints(
    { x: frontageLine.fromX, y: frontageLine.fromY },
    { x: frontageLine.toX, y: frontageLine.toY },
    draft.childVertices,
  );
  const frontageAtOffsetWidthMeters =
    settings.useFrontageAtOffset && localVertices
      ? cadWidthAtParcelLayoutOffset(localVertices, settings.frontageOffsetMeters, frontageLengthMeters)
      : null;
  const sampledOffsets: number[] = [];
  if (localVertices && pathDepthMeters != null && pathDepthMeters > 1e-6) {
    const epsilon = Math.max(pathDepthMeters * 1e-3, 1e-4);
    for (let index = 1; index <= PARCEL_LAYOUT_EVALUATION_SAMPLE_COUNT; index += 1) {
      const ratio = index / (PARCEL_LAYOUT_EVALUATION_SAMPLE_COUNT + 1);
      sampledOffsets.push(epsilon + (pathDepthMeters - 2 * epsilon) * ratio);
    }
  }
  const sampledWidths = sampledOffsets
    .map((offsetMeters) =>
      localVertices
        ? cadWidthAtParcelLayoutOffset(localVertices, offsetMeters, frontageLengthMeters)
        : null,
    )
    .filter((value): value is number => value != null && Number.isFinite(value) && value > 1e-9);
  const minimumSampledWidthMeters =
    sampledWidths.length > 0 ? Math.min(...sampledWidths) : null;

  const failedRuleCodes: CadParcelLayoutConstraintEvaluation['failedRuleCodes'] = [];
  if (childAreaSquareMeters + 1e-9 < settings.minAreaSquareMeters) {
    failedRuleCodes.push('min_area');
  }
  if (frontageLengthMeters + 1e-9 < settings.minFrontageMeters) {
    failedRuleCodes.push('min_frontage');
  }
  if (
    settings.useFrontageAtOffset &&
    (frontageAtOffsetWidthMeters == null || frontageAtOffsetWidthMeters + 1e-9 < settings.minFrontageMeters)
  ) {
    failedRuleCodes.push('frontage_at_offset');
  }
  if (minimumSampledWidthMeters == null || minimumSampledWidthMeters + 1e-9 < settings.minWidthMeters) {
    failedRuleCodes.push('min_width');
  }
  if (pathDepthMeters == null || pathDepthMeters + 1e-9 < settings.minDepthMeters) {
    failedRuleCodes.push('min_depth');
  }
  if (settings.useMaxDepth && (pathDepthMeters == null || pathDepthMeters > settings.maxDepthMeters + 1e-9)) {
    failedRuleCodes.push('max_depth');
  }

  const areaDelta = Math.abs(childAreaSquareMeters - settings.minAreaSquareMeters);
  const frontageDelta = Math.abs(frontageLengthMeters - settings.minFrontageMeters);
  const widthDelta =
    minimumSampledWidthMeters == null
      ? Number.POSITIVE_INFINITY
      : Math.abs(minimumSampledWidthMeters - settings.minWidthMeters);
  const depthDelta =
    pathDepthMeters == null ? Number.POSITIVE_INFINITY : Math.abs(pathDepthMeters - settings.minDepthMeters);
  let score = failedRuleCodes.length * 1_000_000;
  switch (settings.solutionPreference) {
    case 'smallest_area':
      score += childAreaSquareMeters;
      break;
    case 'largest_area':
      score -= childAreaSquareMeters;
      break;
    case 'most_rectangular': {
      const ratio =
        minimumSampledWidthMeters != null &&
        pathDepthMeters != null &&
        minimumSampledWidthMeters > 1e-9 &&
        pathDepthMeters > 1e-9
          ? Math.max(minimumSampledWidthMeters, pathDepthMeters) /
            Math.min(minimumSampledWidthMeters, pathDepthMeters)
          : Number.POSITIVE_INFINITY;
      score += ratio;
      break;
    }
    case 'closest_to_target_area':
      score += areaDelta;
      break;
    case 'shortest_frontage':
    default:
      score += frontageLengthMeters;
      break;
  }
  score += areaDelta * 1e-3 + frontageDelta * 1e-2 + widthDelta * 1e-2 + depthDelta * 1e-2;
  const evaluationWithoutMessages = {
    frontageLengthMeters,
    frontageAtOffsetWidthMeters,
    minimumSampledWidthMeters,
    depthMeters: pathDepthMeters,
    score,
    failedRuleCodes,
  };
  return {
    ...evaluationWithoutMessages,
    messages: cadBuildParcelLayoutConstraintMessages(settings, draft, evaluationWithoutMessages),
  };
};

export const cadBuildParcelLayoutPreviewCandidate = (
  parcel: CadParcelEntity,
  frontageLine: CadLineEntity,
  settings: CadParcelLayoutSettings,
  tool: 'slide' | 'swing',
  alternative: CadParcelLayoutSplitAlternative,
): CadParcelLayoutPreviewCandidate => {
  const targetAreaSquareMeters = settings.minAreaSquareMeters;
  return cadBuildParcelLayoutPreviewCandidateForTargetArea(
    parcel,
    frontageLine,
    settings,
    tool,
    alternative,
    targetAreaSquareMeters,
  );
};

export const cadBuildParcelLayoutPreviewCandidateForTargetArea = (
  parcel: CadParcelEntity,
  frontageLine: CadLineEntity,
  settings: CadParcelLayoutSettings,
  tool: 'slide' | 'swing',
  alternative: CadParcelLayoutSplitAlternative,
  targetAreaSquareMeters: number,
): CadParcelLayoutPreviewCandidate => {
  const draft =
    tool === 'slide'
      ? cadBuildParcelSplitBySlideDraft(
          parcel,
          frontageLine,
          targetAreaSquareMeters,
          settings.minFrontageMeters,
          alternative,
        )
      : cadBuildParcelSplitBySwingDraft(
          parcel,
          frontageLine,
          targetAreaSquareMeters,
          settings.minFrontageMeters,
          alternative,
        );
  if (!draft) {
    return {
      tool,
      alternative,
      draft: null,
      evaluation: null,
      isValid: false,
      statusMessage: `${tool === 'slide' ? 'Slide' : 'Swing'} ${alternative} preview could not be solved for the current parent, frontage, and target area.`,
    };
  }
  const evaluation = cadEvaluateParcelLayoutConstraints(draft, frontageLine, settings);
  const isValid = evaluation.failedRuleCodes.length === 0;
  return {
    tool,
    alternative,
    draft,
    evaluation,
    isValid,
    statusMessage: isValid
      ? `${tool === 'slide' ? 'Slide' : 'Swing'} ${alternative} preview valid: ${draft.childAreaSquareMeters.toFixed(3)} m2 area and ${draft.frontageLengthMeters.toFixed(3)} m frontage.`
      : `${tool === 'slide' ? 'Slide' : 'Swing'} ${alternative} preview invalid: ${evaluation.failedRuleCodes.join(', ')}.`,
  };
};

export const cadBuildAutomaticTargetAreaSquareMeters = (
  parcel: CadParcelEntity,
  frontageLine: CadLineEntity,
  settings: CadParcelLayoutSettings,
): number => {
  const frontageLengthMeters = cadDistance(
    { x: frontageLine.fromX, y: frontageLine.fromY },
    { x: frontageLine.toX, y: frontageLine.toY },
  );
  if (!settings.useMaxDepth) {
    const parcelAreaSquareMeters = cadBuildParcelClosureSummary(parcel.vertices)?.areaSquareMeters ?? 0;
    const averageDepthMeters =
      frontageLengthMeters > 1e-9 && parcelAreaSquareMeters > 1e-9
        ? parcelAreaSquareMeters / frontageLengthMeters
        : settings.minDepthMeters;
    return Math.max(
      settings.minAreaSquareMeters,
      settings.minFrontageMeters * averageDepthMeters,
      settings.minWidthMeters * averageDepthMeters,
      settings.minFrontageMeters * settings.minDepthMeters,
      settings.minWidthMeters * settings.minDepthMeters,
    );
  }
  const areaDepthFromUsableFrontageMeters =
    frontageLengthMeters > 1e-9
      ? settings.minAreaSquareMeters / Math.max(frontageLengthMeters, settings.minFrontageMeters, 1e-9)
      : settings.minDepthMeters;
  const controllingFrontageMeters = Math.max(
    settings.minFrontageMeters,
    settings.minWidthMeters,
    1e-9,
  );
  const areaDepthFromMinimumLotShapeMeters =
    settings.minAreaSquareMeters / controllingFrontageMeters;
  const targetDepthMeters = settings.useMaxDepth
    ? Math.min(
        settings.maxDepthMeters,
        Math.max(
          settings.minDepthMeters,
          areaDepthFromUsableFrontageMeters,
          areaDepthFromMinimumLotShapeMeters,
        ),
      )
    : Math.max(
        settings.minDepthMeters,
        areaDepthFromUsableFrontageMeters,
        areaDepthFromMinimumLotShapeMeters,
      );
  return Math.max(
    settings.minAreaSquareMeters,
    settings.minFrontageMeters * targetDepthMeters,
    settings.minWidthMeters * targetDepthMeters,
    settings.minFrontageMeters * settings.minDepthMeters,
    settings.minWidthMeters * settings.minDepthMeters,
  );
};

export const cadSelectPreferredParcelLayoutPreviewCandidate = (
  parcel: CadParcelEntity,
  frontageLine: CadLineEntity,
  settings: CadParcelLayoutSettings,
  tool: 'slide' | 'swing',
  forcedAlternative: CadParcelLayoutSplitAlternative | null = null,
): CadParcelLayoutPreviewCandidate => {
  const startCandidate = cadBuildParcelLayoutPreviewCandidate(
    parcel,
    frontageLine,
    settings,
    tool,
    'start',
  );
  const endCandidate = cadBuildParcelLayoutPreviewCandidate(
    parcel,
    frontageLine,
    settings,
    tool,
    'end',
  );
  if (forcedAlternative === 'start') return startCandidate;
  if (forcedAlternative === 'end') return endCandidate;
  return (
    [startCandidate, endCandidate].sort((left, right) => {
      if (left.isValid !== right.isValid) return left.isValid ? -1 : 1;
      const leftScore = left.evaluation?.score ?? Number.POSITIVE_INFINITY;
      const rightScore = right.evaluation?.score ?? Number.POSITIVE_INFINITY;
      return leftScore - rightScore;
    })[0] ?? startCandidate
  );
};
