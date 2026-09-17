import type { AppControllerProps } from '../hooks/useAppController';

/** Which top-level application a pathname selects. No router dependency. */
export type AppRoute = 'study' | 'cad' | 'adjustment';

export const CAD_ROUTE_PATH = '/cad';
export const STUDY_ROUTE_PATH = '/study';

export const resolveAppRoute = (pathname: string): AppRoute => {
  if (pathname === STUDY_ROUTE_PATH || pathname.startsWith(`${STUDY_ROUTE_PATH}/`)) return 'study';
  if (pathname === CAD_ROUTE_PATH || pathname.startsWith(`${CAD_ROUTE_PATH}/`)) return 'cad';
  return 'adjustment';
};

/** Small descriptor only — never a snapshot payload. */
export const readCadSourceIdFromLocation = (search: string): string | null => {
  try {
    const params = new URLSearchParams(search);
    const source = params.get('source');
    return source && source.length > 0 ? source : null;
  } catch {
    return null;
  }
};

export const hasCadMigrationRequest = (search: string): boolean => {
  try {
    return new URLSearchParams(search).get('migrate') === '1';
  } catch {
    return false;
  }
};

export const buildCadUrl = (sourceId: string | null): string =>
  sourceId ? `${CAD_ROUTE_PATH}?source=${encodeURIComponent(sourceId)}` : CAD_ROUTE_PATH;

export const buildAdjustmentUrl = (): string => '/';

export type { AppControllerProps };
