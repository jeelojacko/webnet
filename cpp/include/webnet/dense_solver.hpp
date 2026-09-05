// Portable dense normal-equation correction solver (Phase 1).
//
// Mirrors src/engine/matrixCholesky.ts exactly:
//   - Equilibration first (scaleNormalMatrix/scaleNormalRhs/
//     unscaleNormalSolution): unit-diagonal scaling around the solve.
//   - Cholesky with symmetrized off-diagonals: 0.5 * (a[i][j] + a[j][i]).
//   - Pivot rejection when the pivot is non-finite or <= 1e-12.
//   - Damped fallback on the scaled matrix: scale = max(1, |diag|), first
//     lambda = max(minDamping, scale * initialFactor), geometric growth.
// No covariance recovery, no LDLT here: this translation unit solves the
// single-RHS correction system N * dx = rhs with N in contiguous row-major
// order.
//
// This header must stay Emscripten-free: no <emscripten/...> includes, no
// EMSCRIPTEN_* macros. WASM/ABI glue lives in cpp/bindings/ only.
#pragma once

#include <string>

namespace webnet {

// Threshold below which a Cholesky pivot is treated as non-SPD.
// Matches the `sum <= 1e-12` guard in matrixCholesky.ts.
inline constexpr double kDensePivotTolerance = 1e-12;

// Diagonal floor for equilibration scaling. Matches the `diag > 1e-30`
// guard in scaleNormalMatrix (adjustNormalMatrixHelpers.ts): smaller or
// non-finite diagonals fall back to a scale factor of 1.
inline constexpr double kDenseScaleDiagThreshold = 1e-30;

// Damping defaults. Mirror choleskyDecomposeWithDamping() defaults.
inline constexpr double kDenseDefaultInitialFactor = 1e-18;
inline constexpr double kDenseDefaultGrowthFactor = 10.0;
inline constexpr int kDenseDefaultMaxAttempts = 24;
inline constexpr double kDenseDefaultMinDamping = 1e-18;

struct DenseSolveOptions {
  double initial_factor = kDenseDefaultInitialFactor;
  double growth_factor = kDenseDefaultGrowthFactor;
  int max_attempts = kDenseDefaultMaxAttempts;
  double min_damping = kDenseDefaultMinDamping;
};

struct DenseSolveResult {
  double damping = 0.0;
  int attempts = 0;
};

// Deterministic status codes. Stable across native and WASM builds; the C
// ABI in cpp/bindings reuses the same integer values.
enum class DenseStatus : int {
  kOk = 0,
  kInvalidDimension = 1,
  kNonFiniteInput = 2,
  kIrrecoverable = 3,
};

// Short static description per status. Never returns nullptr.
const char* dense_status_message(DenseStatus status) noexcept;

// Solves N * correction = rhs for a symmetric (numerically near-symmetric)
// positive-definite normal matrix N, mirroring the correction path of
// solveNormalEquations (adjustNormalEquationHelpers.ts):
//   1. Equilibrate: scale[i] = 1/sqrt(|N[i][i]|) (or 1), scaled
//      N[i][j] = N[i][j]*scale[i]*scale[j], scaled rhs[i] = rhs[i]*scale[i].
//   2. Damped Cholesky on the scaled matrix (damping schedule included).
//   3. Unscale: correction[i] = scaled_solution[i] * scale[i], with
//      finiteness checks on both the scaled and unscaled solutions.
//
// normal_row_major: n*n doubles, row-major, not modified.
// rhs:              n doubles, not modified.
// correction_out:   n doubles, written on success only (alias-safe vs rhs).
// result_out:       damping/attempts on success; untouched on failure.
// error_out:        cleared on success; failure detail on error (may be null).
DenseStatus solve_dense_correction(const double* normal_row_major,
                                   const double* rhs, double* correction_out,
                                   int n, const DenseSolveOptions& options,
                                   DenseSolveResult* result_out,
                                   std::string* error_out);

// Same, with default damping options.
inline DenseStatus solve_dense_correction(const double* normal_row_major,
                                          const double* rhs,
                                          double* correction_out, int n,
                                          DenseSolveResult* result_out,
                                          std::string* error_out) {
  return solve_dense_correction(normal_row_major, rhs, correction_out, n,
                                DenseSolveOptions{}, result_out, error_out);
}

}  // namespace webnet
