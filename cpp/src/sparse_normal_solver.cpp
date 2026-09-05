#include "webnet/sparse_normal_solver.hpp"

#include <Eigen/OrderingMethods>
#include <Eigen/SparseCholesky>

#include <algorithm>
#include <chrono>
#include <cmath>
#include <cstddef>
#include <limits>
#include <sstream>
#include <vector>

namespace webnet {
namespace {
using SparseMatrix = Eigen::SparseMatrix<double>;
using Triplet = Eigen::Triplet<double>;
using CholFactor =
    Eigen::SimplicialLLT<SparseMatrix, Eigen::Lower, Eigen::AMDOrdering<int>>;
constexpr double kScaleThreshold = 1e-30;

// Development-only phase timing helpers. steady_clock deltas in
// milliseconds; diagnostics only, never fed back into numerics.
using SteadyClock = std::chrono::steady_clock;
double elapsed_ms(const SteadyClock::time_point& start,
                  const SteadyClock::time_point& end) {
  return std::chrono::duration<double, std::milli>(end - start).count();
}

bool finite_values(const double* values, int count) {
  for (int i = 0; i < count; ++i) {
    if (!std::isfinite(values[i])) return false;
  }
  return true;
}

bool valid_options(const SparseSolveOptions& options) {
  return options.max_attempts >= 0 && std::isfinite(options.initial_factor) &&
         options.initial_factor >= 0 && std::isfinite(options.growth_factor) &&
         options.growth_factor > 0 && std::isfinite(options.min_damping) &&
         options.min_damping >= 0;
}

SparseSolveStatus fail(SparseSolveStatus status, const char* message,
                       std::string* error) {
  if (error != nullptr) *error = message;
  return status;
}

SparseSolveStatus fail_text(SparseSolveStatus status, const std::string& message,
                            std::string* error) {
  if (error != nullptr) *error = message;
  return status;
}

// Validates the packed equation system shared by the correction, selected
// covariance, and row-product paths. Mirrors the Phase 2 checks exactly so
// all three entry points accept identical inputs.
SparseSolveStatus validate_packed_system(
    const int* row_offsets, const int* design_columns,
    const double* design_values, int design_nnz, const int* weight_rows,
    const int* weight_columns, const double* weight_values, int weight_nnz,
    int equation_count, int parameter_count,
    const SparseSolveOptions& options, std::string* error_out) {
  if (equation_count <= 0 || parameter_count <= 0 || design_nnz < 0 ||
      weight_nnz < 0 || design_nnz > std::numeric_limits<int>::max() / 4 ||
      weight_nnz > std::numeric_limits<int>::max() / 2 ||
      row_offsets == nullptr ||
      (design_nnz > 0 &&
       (design_columns == nullptr || design_values == nullptr)) ||
      (weight_nnz > 0 && (weight_rows == nullptr ||
                          weight_columns == nullptr ||
                          weight_values == nullptr))) {
    return fail(SparseSolveStatus::kInvalidInput,
                sparse_status_message(SparseSolveStatus::kInvalidInput),
                error_out);
  }
  if (!valid_options(options)) {
    return fail(SparseSolveStatus::kInvalidInput,
                "invalid sparse damping options", error_out);
  }
  if (row_offsets[0] != 0 || row_offsets[equation_count] != design_nnz) {
    return fail(SparseSolveStatus::kInvalidInput,
                "invalid sparse row offsets", error_out);
  }
  for (int row = 0; row < equation_count; ++row) {
    if (row_offsets[row] < 0 || row_offsets[row] > row_offsets[row + 1]) {
      return fail(SparseSolveStatus::kInvalidInput,
                  "non-monotonic sparse row offsets", error_out);
    }
  }
  if (!finite_values(design_values, design_nnz) ||
      !finite_values(weight_values, weight_nnz)) {
    return fail(SparseSolveStatus::kNonFiniteInput,
                sparse_status_message(SparseSolveStatus::kNonFiniteInput),
                error_out);
  }
  for (int entry = 0; entry < design_nnz; ++entry) {
    if (design_columns[entry] < 0 ||
        design_columns[entry] >= parameter_count) {
      return fail(SparseSolveStatus::kInvalidInput,
                  "design column is out of range", error_out);
    }
  }
  for (int entry = 0; entry < weight_nnz; ++entry) {
    const int row = weight_rows[entry];
    const int column = weight_columns[entry];
    if (row < 0 || column < row || column >= equation_count ||
        weight_values[entry] == 0) {
      return fail(SparseSolveStatus::kInvalidInput,
                  "invalid upper-triangle weight entry", error_out);
    }
  }
  return SparseSolveStatus::kOk;
}

struct EquationPairInput {
  const int* row_offsets;
  const int* columns;
  const double* values;
  int left_row;
  int right_row;
  double weight;
  double left_misclosure;
  double right_misclosure;
};

void add_equation_pair(const EquationPairInput& input,
                       std::vector<Triplet>& triplets, Eigen::VectorXd& rhs) {
  const int left_begin = input.row_offsets[input.left_row];
  const int left_end = input.row_offsets[input.left_row + 1];
  const int right_begin = input.row_offsets[input.right_row];
  const int right_end = input.row_offsets[input.right_row + 1];
  if (left_begin == left_end || right_begin == right_end) return;
  for (int a = left_begin; a < left_end; ++a) {
    const int left_column = input.columns[a];
    rhs[left_column] += input.values[a] * input.weight * input.right_misclosure;
    for (int b = right_begin; b < right_end; ++b) {
      const int right_column = input.columns[b];
      triplets.emplace_back(left_column, right_column,
                             input.values[a] * input.weight * input.values[b]);
    }
  }
  if (input.left_row == input.right_row) return;
  for (int b = right_begin; b < right_end; ++b) {
    const int right_column = input.columns[b];
    rhs[right_column] += input.values[b] * input.weight * input.left_misclosure;
    for (int a = left_begin; a < left_end; ++a) {
      triplets.emplace_back(right_column, input.columns[a],
                             input.values[b] * input.weight * input.values[a]);
    }
  }
}

void accumulate_normal(const int* row_offsets, const int* design_columns,
                       const double* design_values, const int* weight_rows,
                       const int* weight_columns, const double* weight_values,
                       int weight_nnz, const double* misclosures_or_null,
                       std::vector<Triplet>& triplets, Eigen::VectorXd& rhs) {
  for (int entry = 0; entry < weight_nnz; ++entry) {
    const int row = weight_rows[entry];
    const int column = weight_columns[entry];
    const double left_l =
        misclosures_or_null != nullptr ? misclosures_or_null[row] : 0.0;
    const double right_l =
        misclosures_or_null != nullptr ? misclosures_or_null[column] : 0.0;
    const EquationPairInput pair{row_offsets, design_columns, design_values,
                                 row,         column,
                                 weight_values[entry], left_l, right_l};
    add_equation_pair(pair, triplets, rhs);
  }
}

// Unit-diagonal equilibration shared by every path: scale[i] =
// 1/sqrt(|N[i][i]|) with a 1.0 fallback, matching the dense solver.
SparseSolveStatus equilibrate(const SparseMatrix& normal, Eigen::VectorXd& scale,
                              SparseMatrix& scaled, std::string* error_out) {
  const int n = static_cast<int>(normal.rows());
  scale = Eigen::VectorXd::Ones(n);
  for (int i = 0; i < n; ++i) {
    const double diagonal = std::abs(normal.coeff(i, i));
    if (std::isfinite(diagonal) && diagonal > kScaleThreshold) {
      scale[i] = 1.0 / std::sqrt(diagonal);
    }
  }
  std::vector<Triplet> scaled_triplets;
  scaled_triplets.reserve(static_cast<std::size_t>(normal.nonZeros()));
  for (int outer = 0; outer < normal.outerSize(); ++outer) {
    for (SparseMatrix::InnerIterator it(normal, outer); it; ++it) {
      const double value = it.value() * scale[it.row()] * scale[it.col()];
      if (!std::isfinite(value)) {
        return fail(SparseSolveStatus::kNonFiniteInput,
                    "non-finite scaled sparse normal entry", error_out);
      }
      scaled_triplets.emplace_back(it.row(), it.col(), value);
    }
  }
  scaled.resize(n, n);
  scaled.setFromTriplets(scaled_triplets.begin(), scaled_triplets.end());
  scaled.makeCompressed();
  return SparseSolveStatus::kOk;
}

bool factorize_with_damping(const SparseMatrix& scaled,
                            const SparseSolveOptions& options, CholFactor& factor,
                            double& damping, int& attempts,
                            SparsePhaseTimings* timings = nullptr) {
  const double diagonal_scale =
      std::max(1.0, scaled.diagonal().cwiseAbs().maxCoeff());
  damping = 0.0;
  for (int attempt = 0; attempt <= options.max_attempts; ++attempt) {
    SparseMatrix candidate = scaled;
    if (attempt > 0) {
      damping = std::max(options.min_damping,
                         diagonal_scale * options.initial_factor);
      for (int step = 1; step < attempt; ++step) {
        damping *= options.growth_factor;
      }
      for (int i = 0; i < candidate.rows(); ++i) {
        candidate.coeffRef(i, i) += damping;
      }
      candidate.makeCompressed();
    }
    // analyzePattern + factorize per attempt is exactly what compute()
    // does; the split only exposes separate phase timings. No symbolic
    // reuse: every attempt re-analyzes its own damped candidate.
    const auto analyze_start = SteadyClock::now();
    factor.analyzePattern(candidate);
    const auto factorize_start = SteadyClock::now();
    factor.factorize(candidate);
    const auto factorize_end = SteadyClock::now();
    if (timings != nullptr) {
      timings->analyze_ms += elapsed_ms(analyze_start, factorize_start);
      timings->factorize_ms += elapsed_ms(factorize_start, factorize_end);
    }
    if (factor.info() != Eigen::Success) continue;
    attempts = attempt;
    return true;
  }
  return false;
}

// Full shared pipeline: validate, assemble N, equilibrate, factorize.
// On success holds a usable factor plus scale/metadata.
struct FactoredNormal {
  CholFactor factor;
  Eigen::VectorXd scale;
  double damping = 0.0;
  int attempts = 0;
  int normal_nnz = 0;
};

SparseSolveStatus factor_packed_system(
    const int* row_offsets, const int* design_columns,
    const double* design_values, int design_nnz, const int* weight_rows,
    const int* weight_columns, const double* weight_values, int weight_nnz,
    int equation_count, int parameter_count,
    const SparseSolveOptions& options, FactoredNormal& factored,
    std::string* error_out, SparsePhaseTimings* timings = nullptr) {
  const SparseSolveStatus valid = validate_packed_system(
      row_offsets, design_columns, design_values, design_nnz, weight_rows,
      weight_columns, weight_values, weight_nnz, equation_count,
      parameter_count, options, error_out);
  if (valid != SparseSolveStatus::kOk) return valid;
  const auto assembly_start = SteadyClock::now();
  std::vector<Triplet> triplets;
  triplets.reserve(static_cast<std::size_t>(design_nnz) * 4U);
  Eigen::VectorXd rhs = Eigen::VectorXd::Zero(parameter_count);
  accumulate_normal(row_offsets, design_columns, design_values, weight_rows,
                    weight_columns, weight_values, weight_nnz,
                    /*misclosures_or_null=*/nullptr, triplets, rhs);
  SparseMatrix normal(parameter_count, parameter_count);
  normal.setFromTriplets(triplets.begin(), triplets.end());
  normal.makeCompressed();
  const auto equilibration_start = SteadyClock::now();
  if (normal.nonZeros() == 0) {
    return fail(SparseSolveStatus::kFactorizationFailed,
                sparse_status_message(
                    SparseSolveStatus::kFactorizationFailed),
                error_out);
  }
  SparseMatrix scaled;
  const SparseSolveStatus scaled_ok =
      equilibrate(normal, factored.scale, scaled, error_out);
  if (scaled_ok != SparseSolveStatus::kOk) return scaled_ok;
  if (timings != nullptr) {
    const auto factor_start = SteadyClock::now();
    timings->assembly_ms += elapsed_ms(assembly_start, equilibration_start);
    timings->equilibration_ms += elapsed_ms(equilibration_start, factor_start);
  }
  if (!factorize_with_damping(scaled, options, factored.factor,
                              factored.damping, factored.attempts, timings)) {
    if (error_out != nullptr) {
      std::ostringstream message;
      message << "sparse normal matrix could not be regularized (last lambda="
              << factored.damping << ")";
      *error_out = message.str();
    }
    return SparseSolveStatus::kFactorizationFailed;
  }
  factored.normal_nnz = normal.nonZeros();
  return SparseSolveStatus::kOk;
}

void fill_factor_info(const FactoredNormal& factored,
                      const SparsePhaseTimings& timings,
                      SparseFactorInfo* out) {
  if (out == nullptr) return;
  out->damping = factored.damping;
  out->attempts = factored.attempts;
  out->normal_nnz = factored.normal_nnz;
  out->factor_nnz = factored.factor.matrixL().nestedExpression().nonZeros();
  out->timings = timings;
}

// Sorted unique copy of an index list (deterministic solve order).
std::vector<int> sorted_unique(const int* values, int count) {
  std::vector<int> out(values, values + count);
  std::sort(out.begin(), out.end());
  out.erase(std::unique(out.begin(), out.end()), out.end());
  return out;
}

}  // namespace

const char* sparse_status_message(SparseSolveStatus status) noexcept {
  switch (status) {
    case SparseSolveStatus::kOk:
      return "ok";
    case SparseSolveStatus::kInvalidInput:
      return "invalid sparse equation input";
    case SparseSolveStatus::kNonFiniteInput:
      return "non-finite sparse equation input";
    case SparseSolveStatus::kFactorizationFailed:
      return "sparse normal matrix could not be regularized";
  }
  return "unknown sparse status";
}

SparseSolveStatus solve_sparse_correction(
    const int* row_offsets, const int* design_columns,
    const double* design_values, int design_nnz, const int* weight_rows,
    const int* weight_columns, const double* weight_values, int weight_nnz,
    const double* misclosures, int equation_count, int parameter_count,
    double* correction_out, const SparseSolveOptions& options,
    SparseSolveResult* result_out, std::string* error_out) {
  if (correction_out == nullptr || misclosures == nullptr) {
    return fail(SparseSolveStatus::kInvalidInput,
                sparse_status_message(SparseSolveStatus::kInvalidInput),
                error_out);
  }
  if (!finite_values(misclosures, equation_count)) {
    return fail(SparseSolveStatus::kNonFiniteInput,
                sparse_status_message(SparseSolveStatus::kNonFiniteInput),
                error_out);
  }
  FactoredNormal factored;
  // Assemble rhs with misclosures after validation; the normal itself comes
  // from the shared factor pipeline (which revalidates the packed system).
  const SparseSolveStatus valid = validate_packed_system(
      row_offsets, design_columns, design_values, design_nnz, weight_rows,
      weight_columns, weight_values, weight_nnz, equation_count,
      parameter_count, options, error_out);
  if (valid != SparseSolveStatus::kOk) return valid;
  SparsePhaseTimings timings;
  const auto assembly_start = SteadyClock::now();
  std::vector<Triplet> triplets;
  triplets.reserve(static_cast<std::size_t>(design_nnz) * 4U);
  Eigen::VectorXd rhs = Eigen::VectorXd::Zero(parameter_count);
  accumulate_normal(row_offsets, design_columns, design_values, weight_rows,
                    weight_columns, weight_values, weight_nnz, misclosures,
                    triplets, rhs);
  SparseMatrix normal(parameter_count, parameter_count);
  normal.setFromTriplets(triplets.begin(), triplets.end());
  normal.makeCompressed();
  const auto equilibration_start = SteadyClock::now();
  if (normal.nonZeros() == 0) {
    return fail(SparseSolveStatus::kFactorizationFailed,
                sparse_status_message(
                    SparseSolveStatus::kFactorizationFailed),
                error_out);
  }
  Eigen::VectorXd scale;
  SparseMatrix scaled;
  const SparseSolveStatus scaled_ok = equilibrate(normal, scale, scaled,
                                                  error_out);
  if (scaled_ok != SparseSolveStatus::kOk) return scaled_ok;
  const auto factor_start = SteadyClock::now();
  timings.assembly_ms += elapsed_ms(assembly_start, equilibration_start);
  timings.equilibration_ms += elapsed_ms(equilibration_start, factor_start);
  CholFactor factor;
  double damping = 0.0;
  int attempts = 0;
  if (!factorize_with_damping(scaled, options, factor, damping, attempts,
                              &timings)) {
    if (error_out != nullptr) {
      std::ostringstream message;
      message << "sparse normal matrix could not be regularized (last lambda="
              << damping << ")";
      *error_out = message.str();
    }
    return SparseSolveStatus::kFactorizationFailed;
  }
  const Eigen::VectorXd scaled_rhs = rhs.cwiseProduct(scale);
  const auto solve_start = SteadyClock::now();
  const Eigen::VectorXd scaled_solution = factor.solve(scaled_rhs);
  timings.solve_ms += elapsed_ms(solve_start, SteadyClock::now());
  if (factor.info() != Eigen::Success || !scaled_solution.allFinite()) {
    return fail(SparseSolveStatus::kFactorizationFailed,
                sparse_status_message(
                    SparseSolveStatus::kFactorizationFailed),
                error_out);
  }
  const Eigen::VectorXd solution = scaled_solution.cwiseProduct(scale);
  if (!solution.allFinite()) {
    return fail(SparseSolveStatus::kFactorizationFailed,
                sparse_status_message(
                    SparseSolveStatus::kFactorizationFailed),
                error_out);
  }
  for (int i = 0; i < parameter_count; ++i) correction_out[i] = solution[i];
  if (result_out != nullptr) {
    result_out->damping = damping;
    result_out->attempts = attempts;
    result_out->design_nnz = design_nnz;
    result_out->weight_nnz = weight_nnz;
    result_out->normal_nnz = normal.nonZeros();
    result_out->factor_nnz = factor.matrixL().nestedExpression().nonZeros();
    result_out->timings = timings;
  }
  if (error_out != nullptr) error_out->clear();
  return SparseSolveStatus::kOk;
}

SparseSolveStatus solve_sparse_selected_covariance(
    const int* row_offsets, const int* design_columns,
    const double* design_values, int design_nnz, const int* weight_rows,
    const int* weight_columns, const double* weight_values, int weight_nnz,
    int equation_count, int parameter_count, const int* query_rows,
    const int* query_columns, int query_count, double* covariance_out,
    const SparseSolveOptions& options, SparseFactorInfo* result_out,
    std::string* error_out) {
  if (query_count < 0) {
    return fail(SparseSolveStatus::kInvalidInput,
                "invalid sparse covariance query count", error_out);
  }
  if (query_count > 0 &&
      (query_rows == nullptr || query_columns == nullptr ||
       covariance_out == nullptr)) {
    return fail(SparseSolveStatus::kInvalidInput,
                sparse_status_message(SparseSolveStatus::kInvalidInput),
                error_out);
  }
  for (int k = 0; k < query_count; ++k) {
    if (query_rows[k] < 0 || query_rows[k] >= parameter_count ||
        query_columns[k] < 0 || query_columns[k] >= parameter_count) {
      return fail(SparseSolveStatus::kInvalidInput,
                  "covariance query index is out of range", error_out);
    }
  }
  FactoredNormal factored;
  SparsePhaseTimings timings;
  const SparseSolveStatus factored_ok = factor_packed_system(
      row_offsets, design_columns, design_values, design_nnz, weight_rows,
      weight_columns, weight_values, weight_nnz, equation_count,
      parameter_count, options, factored, error_out, &timings);
  if (factored_ok != SparseSolveStatus::kOk) return factored_ok;
  if (query_count == 0) {
    fill_factor_info(factored, timings, result_out);
    if (error_out != nullptr) error_out->clear();
    return SparseSolveStatus::kOk;
  }
  // One triangular solve per unique queried column of the scaled inverse;
  // Qxx[i][j] = scale[i] * S[i][j] * scale[j].
  const std::vector<int> columns =
      sorted_unique(query_columns, query_count);
  const int n = parameter_count;
  std::vector<Eigen::VectorXd> solved(columns.size());
  const auto solve_start = SteadyClock::now();
  for (std::size_t c = 0; c < columns.size(); ++c) {
    Eigen::VectorXd unit = Eigen::VectorXd::Zero(n);
    unit[columns[c]] = 1.0;
    solved[c] = factored.factor.solve(unit);
    if (factored.factor.info() != Eigen::Success ||
        !solved[c].allFinite()) {
      return fail(SparseSolveStatus::kFactorizationFailed,
                  sparse_status_message(
                      SparseSolveStatus::kFactorizationFailed),
                  error_out);
    }
  }
  timings.solve_ms += elapsed_ms(solve_start, SteadyClock::now());
  for (int k = 0; k < query_count; ++k) {
    const std::size_t slot = static_cast<std::size_t>(
        std::lower_bound(columns.begin(), columns.end(), query_columns[k]) -
        columns.begin());
    const double scaled_entry = solved[slot][query_rows[k]];
    const double value = scaled_entry * factored.scale[query_rows[k]] *
                         factored.scale[query_columns[k]];
    if (!std::isfinite(value)) {
      return fail(SparseSolveStatus::kNonFiniteInput,
                  "non-finite sparse covariance entry", error_out);
    }
    covariance_out[k] = value;
  }
  fill_factor_info(factored, timings, result_out);
  if (error_out != nullptr) error_out->clear();
  return SparseSolveStatus::kOk;
}

// Validates CSR query rows and cross-product pairs for the row-product path.
// Mirrors the Phase 3 checks exactly so behavior is unchanged.
SparseSolveStatus validate_row_product_queries(
    const int* query_row_offsets, const int* query_columns,
    const double* query_values, int query_nnz, int query_row_count,
    const int* cross_a, const int* cross_b, int cross_count,
    const double* quadratic_out, const double* cross_out, int parameter_count,
    std::string* error_out) {
  if (query_row_count < 0 || query_nnz < 0 || cross_count < 0) {
    return fail(SparseSolveStatus::kInvalidInput,
                "invalid sparse row-product batch size", error_out);
  }
  if (query_row_count > 0 &&
      (query_row_offsets == nullptr || quadratic_out == nullptr)) {
    return fail(SparseSolveStatus::kInvalidInput,
                sparse_status_message(SparseSolveStatus::kInvalidInput),
                error_out);
  }
  if (query_row_count == 0 && cross_count > 0) {
    return fail(SparseSolveStatus::kInvalidInput,
                "cross-product index is out of range", error_out);
  }
  if (query_nnz > 0 &&
      (query_columns == nullptr || query_values == nullptr)) {
    return fail(SparseSolveStatus::kInvalidInput,
                sparse_status_message(SparseSolveStatus::kInvalidInput),
                error_out);
  }
  if (query_row_count > 0) {
    if (query_row_offsets[0] != 0 ||
        query_row_offsets[query_row_count] != query_nnz) {
      return fail(SparseSolveStatus::kInvalidInput,
                  "invalid sparse query row offsets", error_out);
    }
    for (int row = 0; row < query_row_count; ++row) {
      if (query_row_offsets[row] < 0 ||
          query_row_offsets[row] > query_row_offsets[row + 1]) {
        return fail(SparseSolveStatus::kInvalidInput,
                    "non-monotonic sparse query row offsets", error_out);
      }
    }
  }
  if (!finite_values(query_values, query_nnz)) {
    return fail(SparseSolveStatus::kNonFiniteInput,
                sparse_status_message(SparseSolveStatus::kNonFiniteInput),
                error_out);
  }
  for (int entry = 0; entry < query_nnz; ++entry) {
    if (query_columns[entry] < 0 ||
        query_columns[entry] >= parameter_count) {
      return fail(SparseSolveStatus::kInvalidInput,
                  "query column is out of range", error_out);
    }
  }
  if (cross_count > 0 &&
      (cross_a == nullptr || cross_b == nullptr || cross_out == nullptr)) {
    return fail(SparseSolveStatus::kInvalidInput,
                sparse_status_message(SparseSolveStatus::kInvalidInput),
                error_out);
  }
  for (int c = 0; c < cross_count; ++c) {
    if (cross_a[c] < 0 || cross_a[c] >= query_row_count || cross_b[c] < 0 ||
        cross_b[c] >= query_row_count) {
      return fail(SparseSolveStatus::kInvalidInput,
                  "cross-product index is out of range", error_out);
    }
  }
  return SparseSolveStatus::kOk;
}

SparseSolveStatus solve_sparse_row_products(
    const int* row_offsets, const int* design_columns,
    const double* design_values, int design_nnz, const int* weight_rows,
    const int* weight_columns, const double* weight_values, int weight_nnz,
    int equation_count, int parameter_count, const int* query_row_offsets,
    const int* query_columns, const double* query_values, int query_nnz,
    int query_row_count, const int* cross_a, const int* cross_b,
    int cross_count, double* quadratic_out, double* cross_out,
    const SparseSolveOptions& options, SparseFactorInfo* result_out,
    std::string* error_out) {
  const SparseSolveStatus queries_ok = validate_row_product_queries(
      query_row_offsets, query_columns, query_values, query_nnz,
      query_row_count, cross_a, cross_b, cross_count, quadratic_out, cross_out,
      parameter_count, error_out);
  if (queries_ok != SparseSolveStatus::kOk) return queries_ok;
  FactoredNormal factored;
  SparsePhaseTimings timings;
  const SparseSolveStatus factored_ok = factor_packed_system(
      row_offsets, design_columns, design_values, design_nnz, weight_rows,
      weight_columns, weight_values, weight_nnz, equation_count,
      parameter_count, options, factored, error_out, &timings);
  if (factored_ok != SparseSolveStatus::kOk) return factored_ok;
  // Solve y_k = Qxx * r_k per query row via the equilibrated factor:
  // t = r_k .* scale, u = S^-1 t, y = u .* scale. Quadratics and crosses
  // are dot products against the original sparse rows.
  const int n = parameter_count;
  std::vector<Eigen::VectorXd> image(static_cast<std::size_t>(query_row_count),
                                     Eigen::VectorXd::Zero(n));
  const auto solve_start = SteadyClock::now();
  for (int row = 0; row < query_row_count; ++row) {
    Eigen::VectorXd scaled_row = Eigen::VectorXd::Zero(n);
    for (int e = query_row_offsets[row]; e < query_row_offsets[row + 1];
         ++e) {
      scaled_row[query_columns[e]] +=
          query_values[e] * factored.scale[query_columns[e]];
    }
    const Eigen::VectorXd solved = factored.factor.solve(scaled_row);
    if (factored.factor.info() != Eigen::Success ||
        !solved.allFinite()) {
      return fail_text(SparseSolveStatus::kFactorizationFailed,
                       sparse_status_message(
                           SparseSolveStatus::kFactorizationFailed),
                       error_out);
    }
    image[static_cast<std::size_t>(row)] =
        solved.cwiseProduct(factored.scale);
    if (!image[static_cast<std::size_t>(row)].allFinite()) {
      return fail(SparseSolveStatus::kNonFiniteInput,
                  "non-finite sparse row-product vector", error_out);
    }
  }
  timings.solve_ms += elapsed_ms(solve_start, SteadyClock::now());
  for (int row = 0; row < query_row_count; ++row) {
    double total = 0.0;
    for (int e = query_row_offsets[row]; e < query_row_offsets[row + 1];
         ++e) {
      total +=
          query_values[e] * image[static_cast<std::size_t>(row)]
                                    [query_columns[e]];
    }
    if (!std::isfinite(total)) {
      return fail(SparseSolveStatus::kNonFiniteInput,
                  "non-finite sparse quadratic form", error_out);
    }
    quadratic_out[row] = total;
  }
  for (int c = 0; c < cross_count; ++c) {
    const int a = cross_a[c];
    const int b = cross_b[c];
    double total = 0.0;
    for (int e = query_row_offsets[a]; e < query_row_offsets[a + 1]; ++e) {
      total += query_values[e] *
               image[static_cast<std::size_t>(b)][query_columns[e]];
    }
    if (!std::isfinite(total)) {
      return fail(SparseSolveStatus::kNonFiniteInput,
                  "non-finite sparse cross product", error_out);
    }
    cross_out[c] = total;
  }
  fill_factor_info(factored, timings, result_out);
  if (error_out != nullptr) error_out->clear();
  return SparseSolveStatus::kOk;
}

}  // namespace webnet
