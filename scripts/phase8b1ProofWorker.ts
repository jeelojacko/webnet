/**
 * Phase 8B.1 browser proof worker (TEST ONLY, never imported by the app).
 *
 * Bundled standalone (scripts/phase8b1BuildProofWorker.mjs) and served from
 * dist/ for the browser proof only. Imports the REAL production worker
 * module for its protocol side effects, then flips the preanalysis sparse
 * route kill switch ON inside this worker instance only. Production default
 * stays OFF (fresh module state per worker; the shipped bundle and the
 * production worker chunk are untouched) and the worker protocol is
 * unchanged.
 */
import '../src/workers/adjustmentWorker';
import { setPreanalysisSparseAutoRouteEnabled } from '../src/workers/preanalysisSparseAutoRoute';

setPreanalysisSparseAutoRouteEnabled(true);
