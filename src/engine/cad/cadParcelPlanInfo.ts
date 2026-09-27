// Phase 19D Wave 1 — plan designation / role read seam.
//
// The persisted `planInfo` shape lives on the parcel entity in `cadTypes.ts`
// (Worker A). This module only re-exports those types and centralizes the
// defensive read + role policy used by the network + schedule modules:
// "Plan Role" is display/QA only, never a legal conclusion, and never
// rewrites parcel identity.

import type { CadParcelEntity, CadParcelPlanInfo, CadParcelPlanRole } from './cadTypes';

export type { CadParcelPlanInfo, CadParcelPlanRole };

/**
 * Defensive read of the optional persisted `planInfo` field. Returns
 * `undefined` for legacy parcels (no plan info) and for non-object payloads
 * (never throws on hand-edited files).
 */
export const cadParcelPlanInfo = (parcel: CadParcelEntity): CadParcelPlanInfo | undefined => {
  const value = (parcel as { planInfo?: unknown }).planInfo;
  if (value == null || typeof value !== 'object') return undefined;
  return value as CadParcelPlanInfo;
};

/**
 * Plan role with the legacy default. A parcel with no `planInfo` is treated
 * as a `'lot'` (the primary fabric) so pre-19D overlap QA keeps its existing
 * ERROR behavior. Road/right-of-way/easement/other are overlay roles.
 */
export const cadParcelPlanRole = (parcel: CadParcelEntity): CadParcelPlanRole =>
  cadParcelPlanInfo(parcel)?.role ?? 'lot';

/** Designation for display; falls back to the persisted parcel name. */
export const cadParcelPlanDesignation = (parcel: CadParcelEntity): string =>
  cadParcelPlanInfo(parcel)?.designation ?? parcel.parcelName ?? parcel.id;

/** Primary roles whose mutual overlap is a plan QA ERROR (not legal). */
export const CAD_PARCEL_PRIMARY_ROLES: readonly CadParcelPlanRole[] = ['lot', 'remainder'];

export const isCadParcelPrimaryRole = (role: CadParcelPlanRole): boolean =>
  CAD_PARCEL_PRIMARY_ROLES.includes(role);
