#include "webnet/sparse_normal_solver.hpp"

#include <cmath>
#include <iostream>
#include <limits>
#include <string>

namespace {
int failures = 0;
void check(bool ok, const char* label) {
  std::cout << (ok ? "[PASS] " : "[FAIL] ") << label << '\n';
  if (!ok) ++failures;
}
}

int main() {
  // A=[[1,2],[3,4]], P=[[2,.5],[.5,3]], L=A*[1,2] => x=[1,2].
  const int offsets[] = {0, 2, 4};
  const int columns[] = {0, 1, 0, 1};
  const double values[] = {1, 2, 3, 4};
  const int weight_rows[] = {0, 0, 1};
  const int weight_columns[] = {0, 1, 1};
  const double weight_values[] = {2, 0.5, 3};
  const double l[] = {5, 11};
  double correction[] = {0, 0};
  webnet::SparseSolveResult result;
  std::string error;
  const auto status = webnet::solve_sparse_correction(
      offsets, columns, values, 4, weight_rows, weight_columns, weight_values,
      3, l, 2, 2, correction, {}, &result, &error);
  check(status == webnet::SparseSolveStatus::kOk, "correlated sparse solve returns ok");
  check(std::fabs(correction[0] - 1) < 1e-12 && std::fabs(correction[1] - 2) < 1e-12,
        "correlated sparse solve recovers planted correction");
  check(result.design_nnz == 4 && result.weight_nnz == 3 && result.normal_nnz > 0 &&
            result.factor_nnz > 0 && result.damping == 0 && result.attempts == 0,
        "sparse metadata is populated");
  check(error.empty(), "successful sparse solve clears error");
  // Raw-N condition: N=[[32,45],[45,64]] => rowMax=colMax=109 => 11881.
  check(std::isfinite(result.condition_estimate),
        "sparse condition estimate is finite");
  check(std::fabs(result.condition_estimate - 11881.0) <=
            1e-9 * 11881.0,
        "sparse condition estimate matches rowMax*colMax parity");

  const double diagonal_weights[] = {2, 3};
  const int diagonal_rows[] = {0, 1};
  const int diagonal_columns[] = {0, 1};
  correction[0] = correction[1] = 0;
  check(webnet::solve_sparse_correction(
            offsets, columns, values, 4, diagonal_rows, diagonal_columns,
            diagonal_weights, 2, l, 2, 2, correction, {}, nullptr, &error) ==
              webnet::SparseSolveStatus::kOk,
        "diagonal sparse solve returns ok");
  check(std::fabs(correction[0] - 1) < 1e-12 && std::fabs(correction[1] - 2) < 1e-12,
        "diagonal sparse solve recovers planted correction");

  check(webnet::solve_sparse_correction(
            nullptr, columns, values, 4, weight_rows, weight_columns,
            weight_values, 3, l, 2, 2, correction, {}, nullptr, &error) ==
              webnet::SparseSolveStatus::kInvalidInput,
        "null row offsets are rejected");
  const double nan = std::numeric_limits<double>::quiet_NaN();
  const double bad_l[] = {5, nan};
  check(webnet::solve_sparse_correction(
            offsets, columns, values, 4, diagonal_rows, diagonal_columns,
            diagonal_weights, 2, bad_l, 2, 2, correction, {}, nullptr, &error) ==
              webnet::SparseSolveStatus::kNonFiniteInput,
        "non-finite misclosure is rejected");
  check(!error.empty(), "non-finite misclosure writes an error message");

  // Truncated offsets: the final offset must equal design_nnz.
  const int truncated_offsets[] = {0, 2, 3};
  check(webnet::solve_sparse_correction(
            truncated_offsets, columns, values, 4, diagonal_rows,
            diagonal_columns, diagonal_weights, 2, l, 2, 2, correction, {},
            nullptr, &error) == webnet::SparseSolveStatus::kInvalidInput,
        "truncated row offsets are rejected");

  // Non-monotonic offsets are rejected.
  const int shuffled_offsets[] = {0, 3, 2, 4};
  const double l3[] = {5, 11, 7};
  check(webnet::solve_sparse_correction(
            shuffled_offsets, columns, values, 4, diagonal_rows,
            diagonal_columns, diagonal_weights, 2, l3, 3, 2, correction, {},
            nullptr, &error) == webnet::SparseSolveStatus::kInvalidInput,
        "non-monotonic row offsets are rejected");

  // Invalid input leaves a provided result object at its default estimate.
  webnet::SparseSolveResult failed_result;
  failed_result.condition_estimate = -999.0;
  check(webnet::solve_sparse_correction(
            truncated_offsets, columns, values, 4, diagonal_rows,
            diagonal_columns, diagonal_weights, 2, l, 2, 2, correction, {},
            &failed_result, &error) ==
              webnet::SparseSolveStatus::kInvalidInput,
        "failed solve reports invalid input with result out");
  check(failed_result.condition_estimate == -999.0,
        "failed solve leaves condition estimate untouched");
  check(!error.empty(), "failed solve with result out writes an error message");

  // Null correction output is rejected without crashing.
  check(webnet::solve_sparse_correction(
            offsets, columns, values, 4, diagonal_rows, diagonal_columns,
            diagonal_weights, 2, l, 2, 2, nullptr, {}, nullptr, &error) ==
              webnet::SparseSolveStatus::kInvalidInput,
        "null correction output is rejected");
  check(!error.empty(), "null correction output writes an error message");

  // Null misclosures are rejected.
  check(webnet::solve_sparse_correction(
            offsets, columns, values, 4, diagonal_rows, diagonal_columns,
            diagonal_weights, 2, nullptr, 2, 2, correction, {}, nullptr,
            &error) == webnet::SparseSolveStatus::kInvalidInput,
        "null misclosures are rejected");

  // Design column indexes must lie in [0, parameter_count).
  const int bad_columns[] = {0, 2, 0, 1};
  check(webnet::solve_sparse_correction(
            offsets, bad_columns, values, 4, diagonal_rows, diagonal_columns,
            diagonal_weights, 2, l, 2, 2, correction, {}, nullptr, &error) ==
              webnet::SparseSolveStatus::kInvalidInput,
        "out-of-range design column is rejected");
  const int negative_columns[] = {-1, 1, 0, 1};
  check(webnet::solve_sparse_correction(
            offsets, negative_columns, values, 4, diagonal_rows,
            diagonal_columns, diagonal_weights, 2, l, 2, 2, correction, {},
            nullptr, &error) == webnet::SparseSolveStatus::kInvalidInput,
        "negative design column is rejected");

  // Weight entries must be upper-triangle, in range, and nonzero.
  const int lower_rows[] = {1, 0, 1};
  const int lower_columns[] = {0, 0, 1};
  check(webnet::solve_sparse_correction(
            offsets, columns, values, 4, lower_rows, lower_columns,
            weight_values, 3, l, 2, 2, correction, {}, nullptr, &error) ==
              webnet::SparseSolveStatus::kInvalidInput,
        "lower-triangle weight entry is rejected");
  const int far_rows[] = {0, 2};
  const int far_columns[] = {0, 2};
  const double far_weights[] = {2, 3};
  check(webnet::solve_sparse_correction(
            offsets, columns, values, 4, far_rows, far_columns, far_weights, 2,
            l, 2, 2, correction, {}, nullptr, &error) ==
              webnet::SparseSolveStatus::kInvalidInput,
        "out-of-range weight entry is rejected");
  const double zero_weights[] = {2, 0};
  check(webnet::solve_sparse_correction(
            offsets, columns, values, 4, diagonal_rows, diagonal_columns,
            zero_weights, 2, l, 2, 2, correction, {}, nullptr, &error) ==
              webnet::SparseSolveStatus::kInvalidInput,
        "zero weight entry is rejected");

  // Non-finite design and weight values are rejected.
  const double bad_values[] = {1, 2, 3, nan};
  check(webnet::solve_sparse_correction(
            offsets, columns, bad_values, 4, diagonal_rows, diagonal_columns,
            diagonal_weights, 2, l, 2, 2, correction, {}, nullptr, &error) ==
              webnet::SparseSolveStatus::kNonFiniteInput,
        "non-finite design value is rejected");
  const double bad_weights[] = {2, nan};
  check(webnet::solve_sparse_correction(
            offsets, columns, values, 4, diagonal_rows, diagonal_columns,
            bad_weights, 2, l, 2, 2, correction, {}, nullptr, &error) ==
              webnet::SparseSolveStatus::kNonFiniteInput,
        "non-finite weight value is rejected");

  // Null result/error outputs are tolerated on the success path.
  correction[0] = correction[1] = 0;
  check(webnet::solve_sparse_correction(
            offsets, columns, values, 4, diagonal_rows, diagonal_columns,
            diagonal_weights, 2, l, 2, 2, correction, {}, nullptr,
            nullptr) == webnet::SparseSolveStatus::kOk &&
              std::fabs(correction[0] - 1) < 1e-12 &&
              std::fabs(correction[1] - 2) < 1e-12,
        "null result and error outputs are tolerated on success");

  // Invalid damping options are rejected.
  webnet::SparseSolveOptions bad_options;
  bad_options.max_attempts = -1;
  check(webnet::solve_sparse_correction(
            offsets, columns, values, 4, diagonal_rows, diagonal_columns,
            diagonal_weights, 2, l, 2, 2, correction, bad_options, nullptr,
            &error) == webnet::SparseSolveStatus::kInvalidInput,
        "negative max attempts are rejected");

  // Non-positive equation counts are rejected.
  check(webnet::solve_sparse_correction(
            offsets, columns, values, 4, diagonal_rows, diagonal_columns,
            diagonal_weights, 2, l, 0, 2, correction, {}, nullptr, &error) ==
              webnet::SparseSolveStatus::kInvalidInput,
        "zero equation count is rejected");

  // Unguarded off-diagonal mirror-write: one-parameter rows [2],[3] with
  // P=[[1,0.5],[0.5,1]] give N = 4 + 9 + 2*(0.5*2*3) = 19, so the raw
  // estimate is 19*19 = 361 (a guarded single-write would give 256).
  {
    const int single_offsets[] = {0, 1, 2};
    const int single_columns[] = {0, 0};
    const double single_values[] = {2, 3};
    const int single_weight_rows[] = {0, 0, 1};
    const int single_weight_columns[] = {0, 1, 1};
    const double single_weight_values[] = {1, 0.5, 1};
    const double single_l[] = {2, 3};
    double single_correction[] = {0};
    webnet::SparseSolveResult single_result;
    check(webnet::solve_sparse_correction(
                single_offsets, single_columns, single_values, 2,
                single_weight_rows, single_weight_columns,
                single_weight_values, 3, single_l, 2, 1,
                single_correction, {}, &single_result, &error) ==
                webnet::SparseSolveStatus::kOk,
            "single-parameter correlated solve returns ok");
    check(std::isfinite(single_result.condition_estimate) &&
                std::fabs(single_result.condition_estimate - 361.0) <=
                    1e-9 * 361.0,
            "single-parameter condition doubles the shared-column pair");
  }
  return failures == 0 ? 0 : 1;
}
