# Study Desktop Headed Linux Run

Run from a real Hyprland terminal. This is manual GUI validation, not a CI or
browser-preview substitute.

## Isolated data

Use a temporary Linux XDG data root so imports, progress, documents, and
restarts cannot touch normal Study data or the production identifier:

```bash
cd ~/Code/webnet
git switch feat/study-desktop-tauri-port
git pull --ff-only

export SMOKE_DATA_HOME="$(mktemp -d /tmp/webnet-study-smoke.XXXXXX)"
export XDG_DATA_HOME="$SMOKE_DATA_HOME"
trap 'rm -rf "$SMOKE_DATA_HOME"' EXIT

echo "XDG_SESSION_TYPE=$XDG_SESSION_TYPE"
echo "WAYLAND_DISPLAY=$WAYLAND_DISPLAY"
echo "DISPLAY=$DISPLAY"
echo "isolated data root=$XDG_DATA_HOME"
```

Do not run destructive import tests without `XDG_DATA_HOME` set to this
throwaway directory. Keep terminal open through restart checks.

## Development run

```bash
cd ~/Code/webnet/study-desktop
npm ci
npm run tauri:dev
```

Exercise all rows in `docs/STUDY_DESKTOP_SMOKE_TEST.md`. Record PASS, FAIL,
NOT TESTED, or ENVIRONMENT BLOCKED, with console/Rust output for failures.
Close the app normally before the release-binary run.

## Release-binary run

Build first, then launch the executable with the same temporary data root:

```bash
cd ~/Code/webnet/study-desktop
npm run tauri:build
./src-tauri/target/release/webnet-study-desktop
```

Confirm application data remains under the temporary XDG root, not inside the
repository or installation directory. Inspect generated bundles under
`src-tauri/target/release/bundle/`; package installation is optional and must
also use isolated data.

This procedure validates live Linux GUI behavior only. It does not validate
Windows, Wayland compositor differences, signing, or release update behavior.
