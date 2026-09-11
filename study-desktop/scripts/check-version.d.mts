export const EXPECTED_DESKTOP_VERSION: string;
export interface DesktopVersions {
  packageJson: string;
  packageLock: string;
  packageLockRoot: string;
  tauriConf: string;
  cargoToml: string;
  cargoLock: string;
}
export const readDesktopVersions: (_desktopDir: string) => DesktopVersions;
export const findVersionDrift: (
  _versions: DesktopVersions,
  _expected?: string,
) => string[];
