# WebNet Study release signing

Phase 5 beta artifacts are unsigned. Checksums prove file identity and
integrity; they do not prove publisher authenticity.

## Windows

Unsigned MSI and NSIS installers may show SmartScreen and unknown-publisher
warnings. Later releases should use managed Authenticode signing, with
certificate choice, timestamping, and secrets kept in CI. Do not change
`com.webnet.study` or its app-data identity when signing is introduced.

## Linux

Release bundles remain unsigned. Publish `SHA256SUMS.txt` with AppImage, deb,
rpm, MSI, and EXE hashes. A later distribution policy may add detached GPG
signatures (`SHA256SUMS.txt.asc`) or use a signed package repository.

## Updater

Auto-updater is **DEFERRED**. No updater plugin, permission, endpoint, or key
is configured. Future updater work requires signed artifacts, release hosting,
key custody/rotation, and an explicit beta/stable channel policy. Until then,
users download releases manually and verify checksums.
