#include "webnet/sparse_normal_solver.hpp"

#include <Eigen/OrderingMethods>
#include <Eigen/SparseCholesky>

#include <cmath>
#include <cstddef>
#include <limits>
#include <sstream>
#include <vector>

namespace webnet {
namespace {
using SparseMatrix = Eigen::SparseMatrix<double>;
using Triplet = Eigen::Triplet<double>;
constexpr double kScaleThreshold = 1e-30;

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

SparseSolveStatus fail(SparseSolveStatus status, const char* message,
                       std::string* error) {
  if (error != nullptr) *error = message;
  return status;
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
  if (equation_count <= 0 || parameter_count <= 0 || design_nnz < 0 ||
      weight_nnz < 0 || design_nnz > std::numeric_limits<int>::max() / 4 ||
      weight_nnz > std::numeric_limits<int>::max() / 2 ||
      row_offsets == nullptr || correction_out == nullptr ||
      (design_nnz > 0 && (design_columns == nullptr || design_values == nullptr)) ||
      (weight_nnz > 0 &&
       (weight_rows == nullptr || weight_columns == nullptr || weight_values == nullptr)) ||
      misclosures == nullptr) {
    return fail(SparseSolveStatus::kInvalidInput, sparse_status_message(SparseSolveStatus::kInvalidInput), error_out);
  }
  if (!valid_options(options)) {
    return fail(SparseSolveStatus::kInvalidInput, "invalid sparse damping options", error_out);
  }
  if (row_offsets[0] != 0 || row_offsets[equation_count] != design_nnz) {
    return fail(SparseSolveStatus::kInvalidInput, "invalid sparse row offsets", error_out);
  }
  for (int row = 0; row < equation_count; ++row) {
    if (row_offsets[row] < 0 || row_offsets[row] > row_offsets[row + 1]) {
      return fail(SparseSolveStatus::kInvalidInput, "non-monotonic sparse row offsets", error_out);
    }
  }
  if (!finite_values(design_values, design_nnz) ||
      !finite_values(weight_values, weight_nnz) ||
      !finite_values(misclosures, equation_count)) {
    return fail(SparseSolveStatus::kNonFiniteInput, sparse_status_message(SparseSolveStatus::kNonFiniteInput), error_out);
  }

  std::vector<Triplet> triplets;
  triplets.reserve(static_cast<std::size_t>(design_nnz) * 4U);
  Eigen::VectorXd rhs = Eigen::VectorXd::Zero(parameter_count);
  for (int entry = 0; entry < design_nnz; ++entry) {
    if (design_columns[entry] < 0 || design_columns[entry] >= parameter_count) {
      return fail(SparseSolveStatus::kInvalidInput, "design column is out of range", error_out);
    }
  }
  for (int entry = 0; entry < weight_nnz; ++entry) {
    const int row = weight_rows[entry];
    const int column = weight_columns[entry];
    if (row < 0 || column < row || column >= equation_count || weight_values[entry] == 0) {
      return fail(SparseSolveStatus::kInvalidInput, "invalid upper-triangle weight entry", error_out);
    }
    const EquationPairInput pair{row_offsets, design_columns, design_values,
                                 row, column, weight_values[entry],
                                 misclosures[row], misclosures[column]};
    add_equation_pair(pair, triplets, rhs);
  }

  SparseMatrix normal(parameter_count, parameter_count);
  normal.setFromTriplets(triplets.begin(), triplets.end());
  normal.makeCompressed();
  if (normal.nonZeros() == 0) {
    return fail(SparseSolveStatus::kFactorizationFailed, sparse_status_message(SparseSolveStatus::kFactorizationFailed), error_out);
  }
  Eigen::VectorXd scale = Eigen::VectorXd::Ones(parameter_count);
  for (int i = 0; i < parameter_count; ++i) {
    const double diagonal = std::abs(normal.coeff(i, i));
    if (std::isfinite(diagonal) && diagonal > kScaleThreshold) scale[i] = 1.0 / std::sqrt(diagonal);
  }
  std::vector<Triplet> scaled_triplets;
  scaled_triplets.reserve(static_cast<std::size_t>(normal.nonZeros()));
  for (int outer = 0; outer < normal.outerSize(); ++outer) {
    for (SparseMatrix::InnerIterator it(normal, outer); it; ++it) {
      const double value = it.value() * scale[it.row()] * scale[it.col()];
      if (!std::isfinite(value)) return fail(SparseSolveStatus::kNonFiniteInput, "non-finite scaled sparse normal entry", error_out);
      scaled_triplets.emplace_back(it.row(), it.col(), value);
    }
  }
  SparseMatrix scaled(parameter_count, parameter_count);
  scaled.setFromTriplets(scaled_triplets.begin(), scaled_triplets.end());
  scaled.makeCompressed();
  const Eigen::VectorXd scaled_rhs = rhs.cwiseProduct(scale);

  const double diagonal_scale = std::max(1.0, scaled.diagonal().cwiseAbs().maxCoeff());
  double damping = 0.0;
  for (int attempt = 0; attempt <= options.max_attempts; ++attempt) {
    SparseMatrix candidate = scaled;
    if (attempt > 0) {
      damping = std::max(options.min_damping, diagonal_scale * options.initial_factor);
      for (int step = 1; step < attempt; ++step) damping *= options.growth_factor;
      for (int i = 0; i < parameter_count; ++i) candidate.coeffRef(i, i) += damping;
      candidate.makeCompressed();
    }
    Eigen::SimplicialLLT<SparseMatrix, Eigen::Lower, Eigen::AMDOrdering<int>> factor;
    factor.compute(candidate);
    if (factor.info() != Eigen::Success) continue;
    const Eigen::VectorXd scaled_solution = factor.solve(scaled_rhs);
    if (factor.info() != Eigen::Success || !scaled_solution.allFinite()) continue;
    const Eigen::VectorXd solution = scaled_solution.cwiseProduct(scale);
    if (!solution.allFinite()) continue;
    for (int i = 0; i < parameter_count; ++i) correction_out[i] = solution[i];
    if (result_out != nullptr) {
      result_out->damping = damping;
      result_out->attempts = attempt;
      result_out->design_nnz = design_nnz;
      result_out->weight_nnz = weight_nnz;
      result_out->normal_nnz = normal.nonZeros();
      result_out->factor_nnz = factor.matrixL().nestedExpression().nonZeros();
    }
    if (error_out != nullptr) error_out->clear();
    return SparseSolveStatus::kOk;
  }
  if (error_out != nullptr) {
    std::ostringstream message;
    message << "sparse normal matrix could not be regularized (last lambda=" << damping << ")";
    *error_out = message.str();
  }
  return SparseSolveStatus::kFactorizationFailed;
}

}  // namespace webnet
