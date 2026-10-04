import { getAppBasePath, resolveAppRoutePath, stripAppBasePrefix } from '../appBasePath';
import type { AppControllerProps } from '../hooks/useAppController';

/** Which top-level application a pathname selects. No router dependency. */
export type AppRoute = 'study' | 'cad' | 'adjustment';

export const CAD_ROUTE_PATH = '/cad';
export const STUDY_ROUTE_PATH = '/study';

export const resolveAppRoute = (pathname: string, base: string = getAppBasePath()): AppRoute => {
  const stripped = stripAppBasePrefix(pathname, base);
  if (stripped === STUDY_ROUTE_PATH || stripped.startsWith(`${STUDY_ROUTE_PATH}/`)) return 'study';
  if (stripped === CAD_ROUTE_PATH || stripped.startsWith(`${CAD_ROUTE_PATH}/`)) return 'cad';
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

export const buildCadUrl = (sourceId: string | null, base: string = getAppBasePath()): string => {
  const cadPath = resolveAppRoutePath(CAD_ROUTE_PATH, base);
  return sourceId ? `${cadPath}?source=${encodeURIComponent(sourceId)}` : cadPath;
};

export const buildCadMigrationUrl = (base: string = getAppBasePath()): string =>
  `${resolveAppRoutePath(CAD_ROUTE_PATH, base)}?migrate=1`;

export const buildStudyUrl = (base: string = getAppBasePath()): string =>
  resolveAppRoutePath(STUDY_ROUTE_PATH, base);

export const buildAdjustmentUrl = (base: string = getAppBasePath()): string =>
  resolveAppRoutePath('/', base);

export type { AppControllerProps };
