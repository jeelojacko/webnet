# RTKLIB pin record (Phase 12J.4)

- Upstream: https://github.com/tomojitakasu/RTKLIB (branch `rtklib_2.5.1`)
- Pinned commit: `62d4677ed8425a4e2748c6d390b500d1afb493fc`
- Version: 2.5.1 ("Update version from 2.5.0 to 2.5.1")
- License: BSD-2-clause (`license.txt`, Copyright (c) 2007-2020 T. Takasu).
  Doc obligations: binary redistributions must reproduce the copyright
  notice, conditions, and disclaimer in documentation/materials.
  The production worker ships only `.wasm` numeric output via this bend;
  keep this notice file with the vendored source and cite RTKLIB in user
  docs wherever the rnx2rtkp results are surfaced.

## Why these files

Minimum audited set that builds the `rnx2rtkp` static-relative processor:
the 23 translation units in `RTKLIB_SRCS` (see `scripts/gnss/gnss12j1WasmStatic.ts`),
plus every `src/*.h` header the tree ships (exactly one: `src/rtklib.h`),
plus `license.txt`. No docs, binaries, test data, or unrelated apps
(`convrnx`, `strsvr`, …) are vendored.

## Evaluation (cpp/AGENTS.md third-party rule)

Chosen: vendor pinned RTKLIB source for an in-worker `rnx2rtkp` WASM build
instead of (a) shelling to a system binary (not available in-browser),
(b) reimplementing static-relative GNSS (parity risk, large scope), or
(c) fetching upstream at build time (non-reproducible, network-dependent).
RTKLIB is a vendored *processor*, not a `cpp/` build dependency: nothing
under `cpp/` includes or links it; only `scripts/gnss/buildRtklibWasm.mjs`
compiles it to `cpp/build-wasm/rtklib-rnx2rtkp.{js,wasm}` (gitignored).
Re-audit on any pin change: re-verify file list + hashes below and rerun
the 12J.1 evidence script parity check before accepting.

## Source hashes (sha256; verified against /tmp/rtklib-evidence at HEAD=62d4677)

- `87a91ae43861b3e409ed5f1c07d086c41e15967aecf52f9867b4116422927e5d  app/consapp/rnx2rtkp/rnx2rtkp.c`
- `6722c36f1bd49676a8cc385b583612276a836a0884b83fa7328fe303e493308a  src/rtkcmn.c`
- `89affdfdcb891e6a155975217985d9fd046c6cfaa010b7bd2d209c16be0d030e  src/trace.c`
- `19f27f3841e5c4ff3646b2ed232d57fb213841980302aa1d7ab9717f665bbf3c  src/rinex.c`
- `6d094d5a065c820c99f0b890d7b829d11aed9538a3a4f2ca20ea5f4004f33799  src/rtkpos.c`
- `047e4ff6fc52824f3eeffbbdd56acfa67703b36d9537fcf5db2454b4b3e54ebf  src/postpos.c`
- `5747d98113441899a5f2f5da886618923441330058d3d22fdf97b0fcbb98634b  src/solution.c`
- `52555d2b64733869325d3dffd390bc0858b784c04bbf57a3d170138014a456e1  src/lambda.c`
- `b33af035739078b8aa5a2d41d82d697f7a923ada1a1a807e0daa2bf366bedb81  src/geoid.c`
- `75eabf57e89868f23d7afdb3acbc82d70032aac61c869eec280c23e9a1b51de4  src/sbas.c`
- `84dc7dc6be91890e71070be44870ce72e7b6c4fad846c008a9b86be54f5f0123  src/preceph.c`
- `fdfce7425566fbc90bf0b39ce1aec6d85172922b014d63eac5e582bde849712f  src/pntpos.c`
- `3ff70282f5df82ab2f271abbfd2a9ddde069f00f7545660d6947f95f56ef281a  src/ephemeris.c`
- `92751e9f926f0568020dc03c725ff1329e0be95bf9dd4f3717269bfc383de80c  src/options.c`
- `121ca78fc486f92d9d103e778cd5eaf394c2928744d071b1ab36d13927a928a5  src/ppp.c`
- `8360dbfc270556149a4b974e059bd451528a07862c67dfcd07d1a2c72851b534  src/ppp_ar.c`
- `b6d063dd13b342e9c843f71052008aca919670e26b28d0b9117b6f9285ee644d  src/rtcm.c`
- `1d929423ca1d692e7bb0104aabbf713f88d066b1a0ad251cbc5bd52a0eb34212  src/rtcm2.c`
- `6fbfd2399eee72df99f1bf92505c9b9b0edf7ce001a1f865eac841875c1c783b  src/rtcm3.c`
- `3ac46759ac80c45a23c96226448dc1f6837f4bc0c079cf80fda74e71883a3361  src/rtcm3e.c`
- `bc2f3658f963f6fb6922ee4e1b9ad0db5bc9e9d35bd12964c535166a6a87dfe1  src/ionex.c`
- `fe41d01eb43f231e9734d7d81de9df8a67a62c30e2c614387c4b9996bf7836ea  src/tides.c`
- `cac2c821f3f04e8d9abe0433d897201453be2d1473fb9929d3089d1d0c27f3a6  src/sofa.c`
- `cb1c3e6b2f3bb1387740bd871f2d53dcac02bc51cd75907616c1e6fdd77938fa  src/rtklib.h`
- `219747832d49ee958457b2934080ab8d94bd9d8e45fcb1c36f89776fd2c5ed8a  license.txt`
