# Vendored RTKLIB source (rnx2rtkp only)

Pinned RTKLIB v2.5.1 source needed to build the raw-GNSS `rnx2rtkp` WASM
module. See `PIN.md` for upstream URL, commit, license, file list, hashes,
and the third-party evaluation note.

Rebuild:

```bash
npm run wasm:build:rtklib
```

That compiles this tree (never `/tmp`) with the certified evidence flags
(`scripts/gnss/gnss12j1WasmStatic.ts`) plus ES-module glue, and writes
`cpp/build-wasm/rtklib-rnx2rtkp.{js,wasm}` + provenance JSON.
