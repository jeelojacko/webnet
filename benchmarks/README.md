# Adjustment benchmarks

These benchmarks measure the TypeScript adjustment engine directly through the production `LSAEngine` path. They are development baselines, not CI gates.

```bash
npm run bench:adjust:quick
npm run bench:adjust
npm run bench:adjust:write-baseline
```

Warmup and measured-run counts can be overridden with `BENCH_WARMUPS` and `BENCH_RUNS`. The committed baseline, when refreshed, is labeled with its machine and commit metadata. Compare TypeScript, native C++, and WASM using the same case manifest and report format; do not compare across machines as a pass/fail threshold.
