import { cadDistance } from './cadGeometry';
import type { CadLineEntity, CadParcelLayoutSettings, CadParcelEntity } from './cadTypes';
import { cadBuildParcelClosureSummary } from './cadCogoParcelGeometry';
import { cadBuildParcelSplitBySlideDraft, cadBuildParcelSplitBySwingDraft } from './cadCogoParcelLayoutPrimitives';
import {
  type CadParcelLayoutConstraintEvaluation,
  type CadParcelLayoutGeneratedParcelDraft,
  type CadParcelLayoutPreviewCandidate,
  type CadParcelLayoutSplitAlternative,
  type CadParcelLayoutSplitDraft,
} from './cadCogoParcelLayoutTypes';
import {
  cadBuildParcelLayoutConstraintMessages,
  cadEvaluateGeneratedParcelLayoutConstraints,
  cadEvaluateParcelLayoutConstraints,
} from './cadCogoParcelLayoutConstraints';

export {
  cadBuildParcelLayoutConstraintMessages,
  cadEvaluateGeneratedParcelLayoutConstraints,
  cadEvaluateParcelLayoutConstraints,
} from './cadCogoParcelLayoutConstraints';

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
