import { RAD_TO_DEG } from './angles';
import { geoidGridMetadataSummary, interpolateGeoidUndulation, loadGeoidGridModel } from './geoid';
import type { GeoidGridModel } from './geoid';
import type { AdjustmentSolveWorkflowContext } from './adjustSolveWorkflowSettings';

export const loadAndApplySolveWorkflowGeoidModel = (
  ctx: AdjustmentSolveWorkflowContext,
): GeoidGridModel | null => {
  ctx.log(
    `Coordinate system mode: ${ctx.coordSystemMode.toUpperCase()}${ctx.coordSystemMode === 'grid' ? ` (CRS=${ctx.crsId})` : ` (datum=${ctx.localDatumScheme}, scale=${ctx.averageScaleFactor.toFixed(8)}, commonElev=${ctx.commonElevation.toFixed(4)}m)`}`,
  );
  if (ctx.crsGridScaleEnabled) {
    ctx.log(`CRS grid-ground scale active: factor=${ctx.crsGridScaleFactor.toFixed(8)}`);
  }
  if (ctx.crsConvergenceEnabled) {
    ctx.log(
      `CRS convergence active: angle=${(ctx.crsConvergenceAngleRad * RAD_TO_DEG).toFixed(6)} deg`,
    );
  }
  let geoidModel: GeoidGridModel | null = null;
  ctx.activeGeoidModel = null;
  if (ctx.geoidModelEnabled) {
    const loaded = loadGeoidGridModel({
      modelId: ctx.geoidModelId,
      sourceFormat: ctx.geoidSourceFormat ?? 'builtin',
      sourcePath: ctx.geoidSourcePath,
      sourceData: ctx.geoidSourceData,
    });
    if (loaded.model) {
      geoidModel = loaded.model;
      ctx.activeGeoidModel = geoidModel;
      const metadata = geoidGridMetadataSummary(loaded.model);
      if (ctx.parseState) {
        ctx.parseState.geoidModelLoaded = true;
        ctx.parseState.geoidModelMetadata = metadata;
        ctx.parseState.geoidModelId = loaded.model.id;
        ctx.parseState.geoidInterpolation = ctx.geoidInterpolation ?? 'bilinear';
        ctx.parseState.geoidSourceResolvedFormat = loaded.resolvedFormat;
        ctx.parseState.geoidSourceFallbackUsed = loaded.fallbackUsed;
      }
      if (loaded.warning) ctx.log(`Warning: ${loaded.warning}`);
      ctx.log(
        `Geoid/grid model loaded: ${metadata} (interp=${(ctx.geoidInterpolation ?? 'bilinear').toUpperCase()}, format=${loaded.resolvedFormat.toUpperCase()}, fallback=${loaded.fallbackUsed ? 'YES' : 'NO'}, cache=${loaded.fromCache ? 'HIT' : 'MISS'})`,
      );
      const originLat = ctx.parseState?.originLatDeg;
      const originLon = ctx.parseState?.originLonDeg;
      if (originLat != null && originLon != null) {
        const undulation = interpolateGeoidUndulation(
          loaded.model,
          originLat,
          originLon,
          ctx.geoidInterpolation ?? 'bilinear',
        );
        if (undulation != null && Number.isFinite(undulation)) {
          if (ctx.parseState) ctx.parseState.geoidSampleUndulationM = undulation;
          ctx.log(
            `Geoid sample at geodetic origin: N=${undulation.toFixed(4)} m (lat=${originLat.toFixed(
              6,
            )}, lon=${originLon.toFixed(6)})`,
          );
        } else {
          ctx.log(
            `Geoid sample unavailable: origin (${originLat.toFixed(6)}, ${originLon.toFixed(
              6,
            )}) is outside model coverage.`,
          );
        }
      }
    } else {
      ctx.activeGeoidModel = null;
      if (ctx.parseState) {
        ctx.parseState.geoidModelLoaded = false;
        ctx.parseState.geoidModelMetadata = loaded.warning ?? '';
        ctx.parseState.geoidSourceResolvedFormat = loaded.resolvedFormat;
        ctx.parseState.geoidSourceFallbackUsed = loaded.fallbackUsed;
      }
      ctx.log(`Warning: ${loaded.warning ?? 'failed to load geoid/grid model.'}`);
    }
  }
  if (ctx.geoidHeightConversionEnabled) {
    if (!ctx.geoidModelEnabled) {
      ctx.applyAverageGeoidHeightConversions();
    } else if (!geoidModel) {
      ctx.applyAverageGeoidHeightConversions();
    } else {
      ctx.applyGeoidHeightConversions(geoidModel);
    }
  }
  return geoidModel;
};
