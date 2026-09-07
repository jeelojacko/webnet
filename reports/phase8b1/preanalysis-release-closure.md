# Phase 8B.1 preanalysis release closure (exact production route, real WASM)

- Verdict: GO (default sparse preanalysis enabled).
- browserEnabledSparseAcceptance: true.
- cleanRunnerCI: true.
- Default route: bounded sparse preanalysis (kill switch ON); failures restart in TypeScript.
- Sessions: 120 sequential mixed sessions on ONE reused worker.
- anchor: {"label":"preanalysis small anchor (accept)","expected":"sparse","sessions":15,"sparseAccepts":15,"fallbacks":0,"bitIdenticalRepeats":true,"contractPass":true,"maxCoordDiff":0,"maxCovarianceDiff":4.336808689942018e-19,"nativeCorrectionCalls":240,"nativeCovarianceCalls":480}
- closure: {"label":"preanalysis traverse closure (accept)","expected":"sparse","sessions":15,"sparseAccepts":15,"fallbacks":0,"bitIdenticalRepeats":true,"contractPass":true,"maxCoordDiff":0,"maxCovarianceDiff":0,"nativeCorrectionCalls":45,"nativeCovarianceCalls":90}
- smoke: {"label":"preanalysis cli smoke (accept)","expected":"sparse","sessions":15,"sparseAccepts":15,"fallbacks":0,"bitIdenticalRepeats":true,"contractPass":true,"maxCoordDiff":0,"maxCovarianceDiff":0,"nativeCorrectionCalls":105,"nativeCovarianceCalls":210}
- camp: {"label":"preanalysis camp traverse-only (cap fallback)","expected":"fallback","sessions":15,"sparseAccepts":0,"fallbacks":15,"bitIdenticalRepeats":true,"maxCoordDiff":0,"maxCovarianceDiff":0,"nativeCorrectionCalls":0,"nativeCovarianceCalls":0}
- cold: {"label":"preanalysis coldstream (damping fallback)","expected":"fallback","sessions":15,"sparseAccepts":0,"fallbacks":15,"bitIdenticalRepeats":true,"maxCoordDiff":0,"maxCovarianceDiff":0,"nativeCorrectionCalls":645,"nativeCovarianceCalls":645}
- campfull: {"label":"preanalysis camp full (cap fallback)","expected":"fallback","sessions":15,"sparseAccepts":0,"fallbacks":15,"bitIdenticalRepeats":true,"maxCoordDiff":0,"maxCovarianceDiff":0,"nativeCorrectionCalls":0,"nativeCovarianceCalls":0}
- adjust: {"label":"2D adjustment traverse (cross-mode)","expected":"reference","sessions":15,"sparseAccepts":0,"fallbacks":15,"bitIdenticalRepeats":true,"maxCoordDiff":0,"maxCovarianceDiff":0,"nativeCorrectionCalls":0,"nativeCovarianceCalls":0}
- adjustSparse: {"label":"2D adjustment triangulation (7C native interleave)","expected":"reference","sessions":15,"sparseAccepts":15,"fallbacks":0,"bitIdenticalRepeats":true,"maxCoordDiff":0,"maxCovarianceDiff":0,"nativeCorrectionCalls":150,"nativeCovarianceCalls":15}
- Bundle: single init across all sessions (initCount=1, realWasm=true).
- Blockers: none.

Release posture: bounded sparse preanalysis is enabled. Any failure restarts the original request clean in TypeScript exactly once.

