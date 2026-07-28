export const WGS84_A = 6378137;
export const WGS84_F = 1 / 298.257223563;
export const WGS84_E2 = WGS84_F * (2 - WGS84_F);
export const GRS80_F = 1 / 298.257222101;
export const GRS80_E2 = GRS80_F * (2 - GRS80_F);
export const GRS80_EP2 = GRS80_E2 / (1 - GRS80_E2);
export const DEG_TO_RAD = Math.PI / 180;
export const RAD_TO_DEG = 180 / Math.PI;
