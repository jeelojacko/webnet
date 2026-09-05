// Phase 6 native timing-metadata test (development diagnostics only).
//
// Verifies the additive SparsePhaseTimings breakdown is populated on success
// for all three sparse operations, untouched on failure, and that repeat
// solves stay bit-deterministic. Timing values are diagnostics: assertions
// require only finiteness, non-negativity, and measurability on a
// 200-parameter network, never exact durations.

#include "webnet/sparse_normal_solver.hpp"

#include <cmath>
#include <iostream>
#include <string>
#include <vector>

namespace {
int failures = 0;
void check(bool ok, const char* label) {
  std::cout << (ok ? "[PASS] " : "[FAIL] ") << label << '\n';
  if (!ok) ++failures;
}

bool sane(const webnet::SparsePhaseTimings& t) {
  return std::isfinite(t.assembly_ms) && t.assembly_ms >= 0.0 &&
         std::isfinite(t.equilibration_ms) && t.equilibration_ms >= 0.0 &&
         std::isfinite(t.analyze_ms) && t.analyze_ms >= 0.0 &&
         std::isfinite(t.factorize_ms) && t.factorize_ms >= 0.0 &&
         std::isfinite(t.solve_ms) && t.solve_ms >= 0.0;
}

double total(const webnet::SparsePhaseTimings& t) {
  return t.assembly_ms + t.equilibration_ms + t.analyze_ms + t.factorize_ms +
         t.solve_ms;
}

struct PackedSystem {
  std::vector<int> offsets;
  std::vector<int> columns;
  std::vector<double> values;
  std::vector<int> weight_rows;
  std::vector<int> weight_columns;
  std::vector<double> weight_values;
  std::vector<double> misclosures;
};

// Deterministic bounded-degree network: equations = 2 * parameters, row
// degree <= 3, diagonal weights. Mirrors the native benchmark structure.
PackedSystem build_network(int parameters) {
  PackedSystem s;
  const int equations = parameters * 2;
  s.offsets.resize(static_cast<std::size_t>(equations) + 1);
  for (int row = 0; row < equations; ++row) {
    s.offsets[static_cast<std::size_t>(row)] =
        static_cast<int>(s.columns.size());
    const int first = row % parameters;
    s.columns.push_back(first);
    s.values.push_back(1.0);
    if (row % 2 == 0) {
      s.columns.push_back((first + 1) % parameters);
      s.values.push_back(0.25);
    }
    if (row % 3 == 0) {
      s.columns.push_back((first + 7) % parameters);
      s.values.push_back(-0.125);
    }
    s.weight_rows.push_back(row);
    s.weight_columns.push_back(row);
    s.weight_values.push_back(1.0 + 0.5 * (row % 2));
  }
  s.offsets[static_cast<std::size_t>(equations)] =
      static_cast<int>(s.columns.size());
  s.misclosures.assign(static_cast<std::size_t>(equations), 0.5);
  return s;
}
}  // namespace

int main() {
  constexpr int kParams = 200;
  const PackedSystem sys = build_network(kParams);
  const int equations = kParams * 2;
  const int design_nnz = static_cast<int>(sys.columns.size());
  const int weight_nnz = static_cast<int>(sys.weight_values.size());
  std::string error;

  // --- correction: timings populated, repeat run bit-identical ---
  std::vector<double> correction(static_cast<std::size_t>(kParams), 0.0);
  std::vector<double> repeat(static_cast<std::size_t>(kParams), 0.0);
  webnet::SparseSolveResult correction_result;
  check(webnet::solve_sparse_correction(
            sys.offsets.data(), sys.columns.data(), sys.values.data(),
            design_nnz, sys.weight_rows.data(), sys.weight_columns.data(),
            sys.weight_values.data(), weight_nnz, sys.misclosures.data(),
            equations, kParams, correction.data(), {}, &correction_result,
            &error) == webnet::SparseSolveStatus::kOk,
        "timed correction returns ok");
  check(sane(correction_result.timings), "correction timings are finite/non-negative");
  check(total(correction_result.timings) > 0.0, "correction timings are measurable");
  check(correction_result.timings.analyze_ms > 0.0 &&
            correction_result.timings.factorize_ms > 0.0,
        "correction separates analyze from factorize");
  check(webnet::solve_sparse_correction(
            sys.offsets.data(), sys.columns.data(), sys.values.data(),
            design_nnz, sys.weight_rows.data(), sys.weight_columns.data(),
            sys.weight_values.data(), weight_nnz, sys.misclosures.data(),
            equations, kParams, repeat.data(), {}, nullptr,
            &error) == webnet::SparseSolveStatus::kOk,
        "timed correction repeat returns ok");
  check(correction == repeat, "timed correction repeat is bit-identical");

  // --- failure leaves caller result untouched ---
  webnet::SparseSolveResult sentinel;
  sentinel.timings.assembly_ms = -1.0;
  check(webnet::solve_sparse_correction(
            nullptr, sys.columns.data(), sys.values.data(), design_nnz,
            sys.weight_rows.data(), sys.weight_columns.data(),
            sys.weight_values.data(), weight_nnz, sys.misclosures.data(),
            equations, kParams, correction.data(), {}, &sentinel,
            &error) == webnet::SparseSolveStatus::kInvalidInput,
        "null offsets are rejected");
  check(sentinel.timings.assembly_ms == -1.0,
        "failure leaves caller timings untouched");

  // --- selected covariance: diagonal entries with timings ---
  std::vector<int> query_rows(static_cast<std::size_t>(kParams));
  std::vector<int> query_columns(static_cast<std::size_t>(kParams));
  for (int i = 0; i < kParams; ++i) {
    query_rows[static_cast<std::size_t>(i)] = i;
    query_columns[static_cast<std::size_t>(i)] = i;
  }
  std::vector<double> covariance(static_cast<std::size_t>(kParams), 0.0);
  webnet::SparseFactorInfo covariance_info;
  check(webnet::solve_sparse_selected_covariance(
            sys.offsets.data(), sys.columns.data(), sys.values.data(),
            design_nnz, sys.weight_rows.data(), sys.weight_columns.data(),
            sys.weight_values.data(), weight_nnz, equations, kParams,
            query_rows.data(), query_columns.data(), kParams,
            covariance.data(), {}, &covariance_info,
            &error) == webnet::SparseSolveStatus::kOk,
        "timed selected covariance returns ok");
  check(sane(covariance_info.timings), "covariance timings are finite/non-negative");
  check(total(covariance_info.timings) > 0.0, "covariance timings are measurable");

  // --- empty covariance query: phases measured, solve phase idle ---
  webnet::SparseFactorInfo empty_info;
  check(webnet::solve_sparse_selected_covariance(
            sys.offsets.data(), sys.columns.data(), sys.values.data(),
            design_nnz, sys.weight_rows.data(), sys.weight_columns.data(),
            sys.weight_values.data(), weight_nnz, equations, kParams, nullptr,
            nullptr, 0, nullptr, {}, &empty_info,
            &error) == webnet::SparseSolveStatus::kOk,
        "empty covariance query returns ok");
  check(empty_info.timings.solve_ms == 0.0 &&
            empty_info.timings.factorize_ms > 0.0,
        "empty covariance query idles solve but times factorization");

  // --- row products: unit rows must reproduce the covariance diagonal ---
  std::vector<int> query_offsets(static_cast<std::size_t>(kParams) + 1);
  for (int i = 0; i <= kParams; ++i) {
    query_offsets[static_cast<std::size_t>(i)] = i;
  }
  std::vector<double> query_values(static_cast<std::size_t>(kParams), 1.0);
  std::vector<double> quadratic(static_cast<std::size_t>(kParams), 0.0);
  webnet::SparseFactorInfo products_info;
  check(webnet::solve_sparse_row_products(
            sys.offsets.data(), sys.columns.data(), sys.values.data(),
            design_nnz, sys.weight_rows.data(), sys.weight_columns.data(),
            sys.weight_values.data(), weight_nnz, equations, kParams,
            query_offsets.data(), query_columns.data(), query_values.data(),
            kParams, kParams, nullptr, nullptr, 0, quadratic.data(), nullptr,
            {}, &products_info,
            &error) == webnet::SparseSolveStatus::kOk,
        "timed row products return ok");
  check(sane(products_info.timings), "row-product timings are finite/non-negative");
  check(total(products_info.timings) > 0.0, "row-product timings are measurable");
  double max_delta = 0.0;
  for (int i = 0; i < kParams; ++i) {
    max_delta = std::max(max_delta,
                         std::fabs(quadratic[static_cast<std::size_t>(i)] -
                                   covariance[static_cast<std::size_t>(i)]));
  }
  check(max_delta < 1e-9, "unit-row quadratics match covariance diagonal");
  return failures == 0 ? 0 : 1;
}
