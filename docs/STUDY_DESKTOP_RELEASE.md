# Study Desktop version + release policy (Phase 5)

## Version (Phase 5A)

Study desktop versions independently at `0.1.0-beta.1`. The version is
stamped consistently in:

- `study-desktop/package.json` (+ `package-lock.json` root entries)
- `study-desktop/src-tauri/tauri.conf.json` (identifier `com.webnet.study`
  and product name `WebNet Study` preserved)
- `study-desktop/src-tauri/Cargo.toml` (+ `Cargo.lock`
  `webnet-study-desktop` entry)

Check: `npm run check:version` (from `study-desktop/`), backed by
`scripts/check-version.mjs` and covered by
`tests/study_app_version.test.ts`. The root `package.json` is deliberately
NOT a source — root version drift must not break the desktop check.

## Commit identity (Phase 5B)

`study-desktop/vite.config.ts` bakes `STUDY_COMMIT` (or `GITHUB_SHA` in CI)
into `__STUDY_APP_COMMIT__` (plus `__STUDY_APP_VERSION__`); local builds
fall back to `"local"`. `src/studyAppInfo.ts` is the single runtime seam.

## Diagnostics (Phase 5I)

Manage shows a read-only **Application** section (product, version, commit,
platform, storage) and offers Copy diagnostics. Copied diagnostics contain only
safe build/package metadata, never private paths or study content. Deeper native
status stays behind the existing `study_native_status` IPC — no new Rust
commands.

## Release workflow (Phase 5J/5K)

`.github/workflows/study-desktop-release.yml` is manual (`workflow_dispatch`)
or tag-triggered (`study-v*`) only: Linux + Windows Tauri builds (with
`STUDY_COMMIT=${{ github.sha }}`), artifact gathering, and a `SHA256SUMS`
final artifact. It never creates or publishes a GitHub Release — attaching
binaries to a release stays a manual step after verifying checksums.
Per-push CI stays in `study-desktop.yml`, untouched.

## Signing strategy (Phase 5L — deferred)

No code signing is configured yet. Unsigned bundles install with the
platform-default warnings (Linux: none beyond normal permissions; Windows:
SmartScreen/unknown-publisher prompt). Before any public distribution:
decide on a Windows Authenticode certificate (EV vs OV) and Linux
checksum-signing (GPG-detached `.asc` over `SHA256SUMS`), then add the
secrets + sign steps to the release workflow only.

## Updater (Phase 5M — deferred)

No auto-updater is bundled (`tauri-plugin-updater` not added, no update
endpoint, no public key shipped). Updates are manual re-downloads verified
against `SHA256SUMS`. If an updater is wanted later: add the plugin + a
versioned feed endpoint first, then wire staged rollout notes here.
