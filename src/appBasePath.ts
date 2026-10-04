/** Base-path helpers for static hosting (GitHub Pages serves under `/webnet/`). */

export const normalizeAppBasePath = (raw?: string): string => {
  const trimmed = (raw ?? '/').trim() || '/';
  const collapsed = trimmed.replace(/\/{2,}/g, '/');
  const leading = collapsed.startsWith('/') ? collapsed : `/${collapsed}`;
  return leading.endsWith('/') ? leading : `${leading}/`;
};

export const getAppBasePath = (): string =>
  normalizeAppBasePath(import.meta.env.BASE_URL ?? '/');

const baseSansTrailing = (base: string): string =>
  base.length > 1 && base.endsWith('/') ? base.slice(0, -1) : base;

/** Internal: strip the deploy base so route matching sees root-absolute paths. */
export const stripAppBasePrefix = (pathname: string, base: string = getAppBasePath()): string => {
  const bare = baseSansTrailing(base);
  if (bare === '' || bare === '/') return pathname;
  if (pathname === bare) return '/';
  if (pathname.startsWith(`${bare}/`)) return pathname.slice(bare.length);
  const queryOrHash = pathname.slice(bare.length);
  if ((queryOrHash.startsWith('?') || queryOrHash.startsWith('#')) && pathname.startsWith(bare)) {
    return `/${queryOrHash}`;
  }
  return pathname;
};

const hasSchemeOrSpecial = (path: string): boolean =>
  /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(path) || path.startsWith('//') || path.startsWith('#');

/** Prefix app-hosted root-absolute paths (`/examples/...`) with the deploy base. */
export const resolveAppAssetUrl = (path: string, base: string = getAppBasePath()): string => {
  if (!path.startsWith('/') || hasSchemeOrSpecial(path)) return path;
  const bare = baseSansTrailing(base);
  if (bare === '' || bare === '/') return path;
  if (path === bare || path.startsWith(`${bare}/`) || path.startsWith(`${bare}?`) || path.startsWith(`${bare}#`)) {
    return path;
  }
  return `${bare}${path}`;
};

/** Join the deploy base with a root-absolute route path (`/cad` → `/webnet/cad`). */
export const resolveAppRoutePath = (routePath: string, base: string = getAppBasePath()): string => {
  const rooted = routePath.startsWith('/') ? routePath : `/${routePath}`;
  const [pathPart, suffix] =
    rooted.includes('?') || rooted.includes('#')
      ? [rooted.split(/(?=[?#])/)[0], rooted.slice(rooted.split(/(?=[?#])/)[0].length)]
      : [rooted, ''];
  const bare = baseSansTrailing(base);
  if (bare === '' || bare === '/') return `${pathPart}${suffix}`;
  if (pathPart === '/') return `${bare}/${suffix}`;
  return `${bare}${pathPart}${suffix}`;
};
