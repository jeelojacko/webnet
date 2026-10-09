/**
 * STRUCT-195.3 — volume command payload type leaf.
 *
 * Type-only extraction of the nine volume tagged object variants from the
 * `CadCommand` union in `cadTransactions.types.ts` (VOLUME_SURFACE_CREATE
 * through VOLUME_STYLE_DELETE), verbatim bodies/comments/optionality. The
 * transaction hub imports `CadVolumeCommandPayload` and joins it back into
 * the union at the original position, so every existing consumer keeps
 * compiling unchanged.
 *
 * No runtime values, no classes, no barrel aggregation, no
 * `cadTransactions`/`CadCommand` import. All three imports below are
 * `import type` and fully erased.
 */
import type { CadLayerId } from './cadCorePrimitiveTypes';
import type { CadVolumeSurfaceStyle } from './cadTypes';
import type { CadVolumeSurfaceStylePatch } from './cadVolumeSurfaces';

export type CadVolumeCommandPayload =
  | {
      key: 'VOLUME_SURFACE_CREATE';
      name?: string;
      layerId?: CadLayerId;
      styleId?: string;
      baseSurfaceId: string;
      comparisonSurfaceId: string;
    }
  | {
      key: 'VOLUME_SURFACE_DELETE';
      volumeSurfaceId: string;
    }
  | {
      key: 'VOLUME_SURFACE_UPDATE_SOURCES';
      volumeSurfaceId: string;
      baseSurfaceId: string;
      comparisonSurfaceId: string;
    }
  | {
      key: 'VOLUME_SURFACE_SET_LAYER_STYLE';
      volumeSurfaceId: string;
      layerId?: CadLayerId;
      /** Undefined = leave, null = clear, id = set (must exist). */
      styleId?: string | null;
    }
  | {
      key: 'VOLUME_STYLE_CREATE';
      style: CadVolumeSurfaceStyle;
    }
  | {
      key: 'VOLUME_STYLE_DUPLICATE';
      styleId: string;
      newId: string;
      name: string;
    }
  | {
      key: 'VOLUME_STYLE_RENAME';
      styleId: string;
      name: string;
    }
  | {
      key: 'VOLUME_STYLE_UPDATE';
      styleId: string;
      patch: CadVolumeSurfaceStylePatch;
    }
  | {
      key: 'VOLUME_STYLE_DELETE';
      styleId: string;
      /** Required when volumes reference the style; refs rewire to it. */
      replacementId?: string;
    };
