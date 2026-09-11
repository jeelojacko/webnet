// Study desktop version-consistency check (Phase 5A).
//
// Parses the four desktop version sources and fails on drift. The root
// package.json is intentionally NOT a source — the desktop app versions
// independently (root version drift must not break this check).
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const EXPECTED_DESKTOP_VERSION = '0.1.0-beta.1';

export const readDesktopVersions = (desktopDir) => {
  const pkg = JSON.parse(readFileSync(join(desktopDir, 'package.json'), 'utf8'));
  const lock = JSON.parse(readFileSync(join(desktopDir, 'package-lock.json'), 'utf8'));
  const tauriConf = JSON.parse(
    readFileSync(join(desktopDir, 'src-tauri', 'tauri.conf.json'), 'utf8'),
  );
  const cargoToml = readFileSync(join(desktopDir, 'src-tauri', 'Cargo.toml'), 'utf8');
  const cargoLock = readFileSync(join(desktopDir, 'src-tauri', 'Cargo.lock'), 'utf8');
  const cargoTomlMatch = cargoToml.match(/^version\s*=\s*"([^"]+)"/m);
  const cargoLockMatch = cargoLock.match(
    /\[\[package\]\]\r?\nname = "webnet-study-desktop"\r?\nversion = "([^"]+)"/,
  );
  return {
    packageJson: pkg.version,
    packageLock: lock.version,
    packageLockRoot: lock.packages?.['']?.version,
    tauriConf: tauriConf.version,
    cargoToml: cargoTomlMatch?.[1] ?? '<unparsed>',
    cargoLock: cargoLockMatch?.[1] ?? '<unparsed>',
  };
};

export const findVersionDrift = (versions, expected = EXPECTED_DESKTOP_VERSION) =>
  Object.entries(versions).flatMap(([source, value]) =>
    value === expected ? [] : [`${source}: expected ${expected}, found ${value}`],
  );

const desktopDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const versions = readDesktopVersions(desktopDir);
const drift = findVersionDrift(versions);
if (drift.length > 0) {
  console.error(`Study desktop version drift:\n - ${drift.join('\n - ')}`);
  process.exit(1);
}
console.log(`Study desktop version consistent: ${EXPECTED_DESKTOP_VERSION}`);
