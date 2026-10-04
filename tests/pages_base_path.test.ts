/** @vitest-environment jsdom */

import { describe, expect, it } from 'vitest';
import {
  normalizeAppBasePath,
  resolveAppAssetUrl,
  resolveAppRoutePath,
  stripAppBasePrefix,
} from '../src/appBasePath';
import {
  buildAdjustmentUrl,
  buildCadMigrationUrl,
  buildCadUrl,
  buildStudyUrl,
  resolveAppRoute,
} from '../src/cad-app/cadNavigation';

const PAGES_BASE = '/webnet/';

describe('normalizeAppBasePath', () => {
  it('defaults dev to / and normalizes bare names', () => {
    expect(normalizeAppBasePath('/')).toBe('/');
    expect(normalizeAppBasePath(undefined)).toBe('/');
    expect(normalizeAppBasePath('/webnet/')).toBe('/webnet/');
    expect(normalizeAppBasePath('webnet')).toBe('/webnet/');
    expect(normalizeAppBasePath('/webnet')).toBe('/webnet/');
  });
});

describe('resolveAppAssetUrl', () => {
  it('leaves external, data, blob, and hash refs untouched', () => {
    for (const external of [
      'https://example.com/x.wnproj',
      'http://example.com/x.wnproj',
      '//cdn.example.com/x.js',
      'data:application/json,{}',
      'blob:https://example.com/uuid',
      '#section',
      'relative/path.wnproj',
    ]) {
      expect(resolveAppAssetUrl(external, PAGES_BASE)).toBe(external);
    }
  });

  it('prefixes root-absolute app assets without double-prefixing', () => {
    expect(resolveAppAssetUrl('/examples/combined/project.wnproj', PAGES_BASE)).toBe(
      '/webnet/examples/combined/project.wnproj',
    );
    expect(resolveAppAssetUrl('/webnet/examples/combined/project.wnproj', PAGES_BASE)).toBe(
      '/webnet/examples/combined/project.wnproj',
    );
  });

  it('preserves query and hash on prefixed assets', () => {
    expect(resolveAppAssetUrl('/examples/x.wnproj?v=2', PAGES_BASE)).toBe(
      '/webnet/examples/x.wnproj?v=2',
    );
    expect(resolveAppAssetUrl('/examples/x.wnproj#frag', PAGES_BASE)).toBe(
      '/webnet/examples/x.wnproj#frag',
    );
  });

  it('is the identity at the default base', () => {
    expect(resolveAppAssetUrl('/examples/combined/project.wnproj', '/')).toBe(
      '/examples/combined/project.wnproj',
    );
  });
});

describe('resolveAppRoutePath', () => {
  it('joins the base with route paths', () => {
    expect(resolveAppRoutePath('/cad', PAGES_BASE)).toBe('/webnet/cad');
    expect(resolveAppRoutePath('/', PAGES_BASE)).toBe('/webnet/');
  });

  it('is the identity at the default base', () => {
    expect(resolveAppRoutePath('/cad', '/')).toBe('/cad');
    expect(resolveAppRoutePath('/', '/')).toBe('/');
  });
});

describe('base-prefixed routing', () => {
  it('strips the base prefix before matching', () => {
    expect(stripAppBasePrefix('/webnet/cad', PAGES_BASE)).toBe('/cad');
    expect(stripAppBasePrefix('/webnet', PAGES_BASE)).toBe('/');
    expect(resolveAppRoute('/webnet/cad', PAGES_BASE)).toBe('cad');
    expect(resolveAppRoute('/webnet/study', PAGES_BASE)).toBe('study');
    expect(resolveAppRoute('/webnet/', PAGES_BASE)).toBe('adjustment');
  });

  it('builders return base-prefixed paths and stay identical at the default base', () => {
    expect(buildCadUrl('cad-src:proj:fp', PAGES_BASE)).toBe(
      '/webnet/cad?source=cad-src%3Aproj%3Afp',
    );
    expect(buildCadUrl(null, PAGES_BASE)).toBe('/webnet/cad');
    expect(buildCadMigrationUrl(PAGES_BASE)).toBe('/webnet/cad?migrate=1');
    expect(buildStudyUrl(PAGES_BASE)).toBe('/webnet/study');
    expect(buildAdjustmentUrl(PAGES_BASE)).toBe('/webnet/');
    expect(buildCadUrl('cad-src:proj:fp')).toBe('/cad?source=cad-src%3Aproj%3Afp');
    expect(buildCadUrl(null)).toBe('/cad');
    expect(buildCadMigrationUrl()).toBe('/cad?migrate=1');
    expect(buildStudyUrl()).toBe('/study');
    expect(buildAdjustmentUrl()).toBe('/');
  });
});
