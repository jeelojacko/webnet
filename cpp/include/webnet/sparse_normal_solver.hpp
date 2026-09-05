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

SparseSolveStatus solve_sparse_correction(
    const int* row_offsets, const int* design_columns,
    const double* design_values, int design_nnz, const int* weight_rows,
    const int* weight_columns, const double* weight_values, int weight_nnz,
    const double* misclosures, int equation_count, int parameter_count,
    double* correction_out, const SparseSolveOptions& options = {},
    SparseSolveResult* result_out = nullptr, std::string* error_out = nullptr);

const char* sparse_status_message(SparseSolveStatus status) noexcept;

}  // namespace webnet
