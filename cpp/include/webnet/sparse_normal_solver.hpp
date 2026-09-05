#pragma once

#include <string>
#include <vector>

namespace webnet {

enum class SparseSolveStatus : int {
  kOk = 0,
  kInvalidInput = 1,
  kNonFiniteInput = 2,
  kFactorizationFailed = 3,
};

struct SparseSolveOptions {
  double initial_factor = 1e-18;
  double growth_factor = 10.0;
  int max_attempts = 24;
  double min_damping = 1e-18;
};

struct SparseSolveResult {
  double damping = 0.0;
  int attempts = 0;
  int design_nnz = 0;
  int weight_nnz = 0;
  int normal_nnz = 0;
  int factor_nnz = 0;
  const char* ordering = "AMD";
  const char* solver = "SimplicialLLT";
};

struct SparseFactorInfo {
  double damping = 0.0;
  int attempts = 0;
  int normal_nnz = 0;
  int factor_nnz = 0;
};

SparseSolveStatus solve_sparse_correction(
    const int* row_offsets, const int* design_columns,
    const double* design_values, int design_nnz, const int* weight_rows,
    const int* weight_columns, const double* weight_values, int weight_nnz,
    const double* misclosures, int equation_count, int parameter_count,
    double* correction_out, const SparseSolveOptions& options = {},
    SparseSolveResult* result_out = nullptr, std::string* error_out = nullptr);

const char* sparse_status_message(SparseSolveStatus status) noexcept;

// Selected covariance entries of the normal-equation inverse Qxx = N^-1.
//
// Accepts the same packed equation system as solve_sparse_correction (CSR
// design rows plus upper-triangle weight entries) but no misclosures: the
// covariance depends only on N = A^T*P*A. Each query asks for
// Qxx[query_rows[k]][query_columns[k]]; duplicates and symmetric pairs such
// as (i,j)/(j,i) are allowed and return identical values. The equilibrated
// (unit-diagonal) scaling around the factorize matches the correction path,
// and no dense inverse is ever formed: one sparse triangular solve runs per
// unique queried column. Indices must lie in [0, parameter_count).
SparseSolveStatus solve_sparse_selected_covariance(
    const int* row_offsets, const int* design_columns,
    const double* design_values, int design_nnz, const int* weight_rows,
    const int* weight_columns, const double* weight_values, int weight_nnz,
    int equation_count, int parameter_count, const int* query_rows,
    const int* query_columns, int query_count, double* covariance_out,
    const SparseSolveOptions& options = {},
    SparseFactorInfo* result_out = nullptr,
    std::string* error_out = nullptr);

// Batched row quadratic and cross products with the normal-equation inverse:
//   quadratic_out[k] = r_k^T * Qxx * r_k
//   cross_out[c] = r_{cross_a[c]}^T * Qxx * r_{cross_b[c]}
//
// Query rows arrive as CSR over parameter space (query_row_offsets has
// query_row_count + 1 entries, columns in [0, parameter_count)). Empty rows
// are allowed and yield a zero quadratic. Cross indices address query rows.
// One sparse solve runs per query row; no dense inverse is formed. Scaling
// matches the correction path. Either output may be null when its count is
// zero, but at least the requested outputs must be present.
SparseSolveStatus solve_sparse_row_products(
    const int* row_offsets, const int* design_columns,
    const double* design_values, int design_nnz, const int* weight_rows,
    const int* weight_columns, const double* weight_values, int weight_nnz,
    int equation_count, int parameter_count, const int* query_row_offsets,
    const int* query_columns, const double* query_values, int query_nnz,
    int query_row_count, const int* cross_a, const int* cross_b,
    int cross_count, double* quadratic_out, double* cross_out,
    const SparseSolveOptions& options = {},
    SparseFactorInfo* result_out = nullptr,
    std::string* error_out = nullptr);

}  // namespace webnet
