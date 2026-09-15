#!/usr/bin/env node
/**
 * Cross-platform portable-path check.
 *
 * Fails on tracked paths that break on Windows/macOS checkouts:
 * reserved device basenames, forbidden characters, trailing space/period,
 * `.`/`..` components, control characters, and case-only collisions.
 */
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const RESERVED_BASENAMES = new Set([
  'CON',
  'PRN',
  'AUX',
  'NUL',
  ...Array.from({ length: 9 }, (_, i) => `COM${i + 1}`),
  ...Array.from({ length: 9 }, (_, i) => `LPT${i + 1}`),
]);

const FORBIDDEN_CHARS = /[<>:"\\|?*]/;
const CONTROL_CHARS = /[\x00-\x1f\x7f]/;

export function validatePortablePaths(paths) {
  const violations = [];
  const seen = new Map();
  for (const raw of Array.isArray(paths) ? paths : []) {
    if (typeof raw !== 'string' || raw.length === 0) {
      violations.push({ path: String(raw), reason: 'empty or non-string path' });
      continue;
    }
    for (const component of raw.split('/')) {
      if (component === '' || component === '.' || component === '..') {
        if (component === '.' || component === '..') {
          violations.push({ path: raw, reason: `reserved path component "${component}"` });
        }
        continue;
      }
      const push = (reason) => violations.push({ path: raw, reason: `"${component}": ${reason}` });
      if (CONTROL_CHARS.test(component)) {
        push('contains control character');
        continue;
      }
      if (FORBIDDEN_CHARS.test(component)) {
        push('contains forbidden character (< > : " \\ | ? *)');
        continue;
      }
      if (component.endsWith(' ') || component.endsWith('.')) {
        push('has trailing space or period');
        continue;
      }
      if (RESERVED_BASENAMES.has(component.split('.')[0].toUpperCase())) {
        push('is a Windows reserved device name (extension does not exempt it)');
      }
    }
    const key = raw.replaceAll('\\', '/').toLowerCase();
    const first = seen.get(key);
    if (first !== undefined && first !== raw) {
      violations.push({ path: raw, reason: `case-insensitive collision with "${first}"` });
    } else {
      seen.set(key, raw);
    }
  }
  return violations;
}

function trackedPathsFromGit() {
  // git ls-files reflects the working tree (including staged renames),
  // so the check validates the current tree — not just the last commit.
  // On a clean CI checkout this matches HEAD exactly.
  return execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' })
    .split('\0')
    .filter((entry) => entry.length > 0);
}

if (fileURLToPath(import.meta.url) === resolve(process.argv[1] ?? '')) {
  const paths = trackedPathsFromGit();
  const violations = validatePortablePaths(paths);
  if (violations.length > 0) {
    for (const violation of violations) {
      console.error(`portable-path violation: ${violation.path}: ${violation.reason}`);
    }
    console.error(`${violations.length} portable-path violation(s) in ${paths.length} tracked paths`);
    process.exit(1);
  }
  console.log(`portable-paths: ${paths.length} tracked paths, 0 violations`);
}
