/**
 * Phase 19D — command keys surfaced by the bounded Home ribbon
 * "Parcel Network" subgroup. Kept out of the component file so React Fast
 * Refresh stays happy; the generic Parcel ribbon loop excludes these so the
 * Parcel category does not double-render them.
 */
export const PARCEL_NETWORK_KEYS: ReadonlySet<string> = new Set([
  'PARCELDESIGNATE',
  'PARCELNUMBER',
  'PARCELLINK',
  'PARCELUNLINK',
  'PARCELCHECK',
  'PARCELSCHEDULE',
  'PARCELSHAREDEDIT',
]);
