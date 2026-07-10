import type { CadLineEntity, CadParcelLayoutSettings } from './cadTypes';
import { cadBuildParcelClosureSummary } from './cadCogoParcelGeometry';
import { cadBuildParcelLayoutLocalPoints, type CadParcelLayoutLocalPoint } from './cadCogoParcelLocalGeometry';
import type {
  CadParcelLayoutConstraintEvaluation,
  CadParcelLayoutGeneratedParcelDraft,
  CadParcelLayoutSplitDraft,
} from './cadCogoParcelLayoutTypes';

const PARCEL_LAYOUT_EVALUATION_SAMPLE_COUNT = 7;

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
