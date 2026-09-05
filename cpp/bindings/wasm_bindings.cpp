// WASM/ABI glue for the WebNet portable core (Phase 1).
//
// This is the ONLY translation unit that may include Emscripten headers.
// It contains no math and no business logic: the portable core in
// cpp/include/webnet + cpp/src owns all numerics, and every entry point
// here forwards to it.
//
// Stable C ABI (usable synchronously from TS after module init):
//   int webnet_dense_solve(const double* normal, const double* rhs,
//                          double* correction, int n,
//                          double* damping_out, int* attempts_out,
//                          char* err_buf, int err_cap);
//   int webnet_dense_solve_opts(... same ..., double initial_factor,
//                               double growth_factor, int max_attempts,
//                               double min_damping, ... outs ...);
//   const char* webnet_dense_status_message(int code);
// All buffers are contiguous row-major doubles; err_buf always holds a
// NUL-terminated message (empty on success) when err_cap > 0. Null out
// pointers are accepted and skipped. Return codes match DenseStatus ints:
// 0 ok, 1 invalid dimension, 2 non-finite input, 3 irrecoverable. The core
// equilibrates (unit-diagonal scaling) around the solve exactly like
// solveNormalEquations, so no scaling flags are needed at the boundary.
//
// Compiling without Emscripten (native builds) is fully supported: the
// Embind block is guarded by __EMSCRIPTEN__ and EMSCRIPTEN_KEEPALIVE falls
// back to empty, so native tests link this file to exercise the exact ABI.

#include "webnet/core.hpp"
#include "webnet/dense_solver.hpp"
#include "webnet/sparse_normal_solver.hpp"

#include <cmath>
#include <cstddef>
#include <cstring>
#include <string>
#include <vector>

#ifdef __EMSCRIPTEN__
#include <emscripten/bind.h>
#include <emscripten/emscripten.h>
#include <emscripten/val.h>
#else
#define EMSCRIPTEN_KEEPALIVE
#endif

namespace {

void write_message(const std::string& msg, char* buf, int cap) {
  if (buf == nullptr || cap <= 0) {
    return;
  }
  const std::size_t room = static_cast<std::size_t>(cap) - 1;
  const std::size_t len = msg.size() < room ? msg.size() : room;
  if (len > 0) {
    std::memcpy(buf, msg.data(), len);
  }
  buf[len] = '\0';
}

int run_solve(const double* normal, const double* rhs, double* correction,
              int n, const webnet::DenseSolveOptions& options,
              double* damping_out, int* attempts_out, char* err_buf,
              int err_cap) {
  webnet::DenseSolveResult result;
  std::string error;
  const webnet::DenseStatus status = webnet::solve_dense_correction(
      normal, rhs, correction, n, options, &result, &error);
  if (status == webnet::DenseStatus::kOk) {
    if (damping_out != nullptr) {
      *damping_out = result.damping;
    }
    if (attempts_out != nullptr) {
      *attempts_out = result.attempts;
    }
    write_message("", err_buf, err_cap);
  } else {
    write_message(error, err_buf, err_cap);
  }
  return static_cast<int>(status);
}

}  // namespace

extern "C" {

EMSCRIPTEN_KEEPALIVE
int webnet_dense_solve(const double* normal, const double* rhs,
                       double* correction, int n, double* damping_out,
                       int* attempts_out, char* err_buf, int err_cap) {
  return run_solve(normal, rhs, correction, n, webnet::DenseSolveOptions{},
                   damping_out, attempts_out, err_buf, err_cap);
}

EMSCRIPTEN_KEEPALIVE
int webnet_dense_solve_opts(const double* normal, const double* rhs,
                            double* correction, int n, double initial_factor,
                            double growth_factor, int max_attempts,
                            double min_damping, double* damping_out,
                            int* attempts_out, char* err_buf, int err_cap) {
  webnet::DenseSolveOptions options;
  options.initial_factor = initial_factor;
  options.growth_factor = growth_factor;
  options.max_attempts = max_attempts;
  options.min_damping = min_damping;
  return run_solve(normal, rhs, correction, n, options, damping_out,
                   attempts_out, err_buf, err_cap);
}

EMSCRIPTEN_KEEPALIVE
int webnet_sparse_equation_solve(
    const int* row_offsets, const int* design_columns,
    const double* design_values, int design_nnz, const int* weight_rows,
    const int* weight_columns, const double* weight_values, int weight_nnz,
    const double* misclosures, int equation_count, int parameter_count,
    double* correction_out, int* design_nnz_out, int* weight_nnz_out,
    int* normal_nnz_out, int* factor_nnz_out, double* damping_out,
    int* attempts_out, double* condition_estimate_out, char* err_buf,
    int err_cap) {
  webnet::SparseSolveResult result;
  std::string error;
  const webnet::SparseSolveStatus status = webnet::solve_sparse_correction(
      row_offsets, design_columns, design_values, design_nnz, weight_rows,
      weight_columns, weight_values, weight_nnz, misclosures, equation_count,
      parameter_count, correction_out, {}, &result, &error);
  if (status == webnet::SparseSolveStatus::kOk) {
    if (design_nnz_out != nullptr) *design_nnz_out = result.design_nnz;
    if (weight_nnz_out != nullptr) *weight_nnz_out = result.weight_nnz;
    if (normal_nnz_out != nullptr) *normal_nnz_out = result.normal_nnz;
    if (factor_nnz_out != nullptr) *factor_nnz_out = result.factor_nnz;
    if (damping_out != nullptr) *damping_out = result.damping;
    if (attempts_out != nullptr) *attempts_out = result.attempts;
    // Raw-N condition metadata: written only on success when finite;
    // a null out pointer is accepted and skipped, and failure paths
    // leave the caller's buffer untouched.
    if (condition_estimate_out != nullptr &&
        std::isfinite(result.condition_estimate)) {
      *condition_estimate_out = result.condition_estimate;
    }
  }
  write_message(status == webnet::SparseSolveStatus::kOk ? "" : error,
                err_buf, err_cap);
  return static_cast<int>(status);
}

EMSCRIPTEN_KEEPALIVE
int webnet_sparse_selected_covariance(
    const int* row_offsets, const int* design_columns,
    const double* design_values, int design_nnz, const int* weight_rows,
    const int* weight_columns, const double* weight_values, int weight_nnz,
    int equation_count, int parameter_count, const int* query_rows,
    const int* query_columns, int query_count, double* covariance_out,
    int* normal_nnz_out, int* factor_nnz_out, double* damping_out,
    int* attempts_out, char* err_buf, int err_cap) {
  webnet::SparseFactorInfo info;
  std::string error;
  const webnet::SparseSolveStatus status =
      webnet::solve_sparse_selected_covariance(
          row_offsets, design_columns, design_values, design_nnz,
          weight_rows, weight_columns, weight_values, weight_nnz,
          equation_count, parameter_count, query_rows, query_columns,
          query_count, covariance_out, {}, &info, &error);
  if (status == webnet::SparseSolveStatus::kOk) {
    if (normal_nnz_out != nullptr) *normal_nnz_out = info.normal_nnz;
    if (factor_nnz_out != nullptr) *factor_nnz_out = info.factor_nnz;
    if (damping_out != nullptr) *damping_out = info.damping;
    if (attempts_out != nullptr) *attempts_out = info.attempts;
  }
  write_message(status == webnet::SparseSolveStatus::kOk ? "" : error,
                err_buf, err_cap);
  return static_cast<int>(status);
}

EMSCRIPTEN_KEEPALIVE
int webnet_sparse_row_products(
    const int* row_offsets, const int* design_columns,
    const double* design_values, int design_nnz, const int* weight_rows,
    const int* weight_columns, const double* weight_values, int weight_nnz,
    int equation_count, int parameter_count, const int* query_row_offsets,
    const int* query_columns, const double* query_values, int query_nnz,
    int query_row_count, const int* cross_a, const int* cross_b,
    int cross_count, double* quadratic_out, double* cross_out,
    int* normal_nnz_out, int* factor_nnz_out, double* damping_out,
    int* attempts_out, char* err_buf, int err_cap) {
  webnet::SparseFactorInfo info;
  std::string error;
  const webnet::SparseSolveStatus status = webnet::solve_sparse_row_products(
      row_offsets, design_columns, design_values, design_nnz, weight_rows,
      weight_columns, weight_values, weight_nnz, equation_count,
      parameter_count, query_row_offsets, query_columns, query_values,
      query_nnz, query_row_count, cross_a, cross_b, cross_count,
      quadratic_out, cross_out, {}, &info, &error);
  if (status == webnet::SparseSolveStatus::kOk) {
    if (normal_nnz_out != nullptr) *normal_nnz_out = info.normal_nnz;
    if (factor_nnz_out != nullptr) *factor_nnz_out = info.factor_nnz;
    if (damping_out != nullptr) *damping_out = info.damping;
    if (attempts_out != nullptr) *attempts_out = info.attempts;
  }
  write_message(status == webnet::SparseSolveStatus::kOk ? "" : error,
                err_buf, err_cap);
  return static_cast<int>(status);
}

EMSCRIPTEN_KEEPALIVE
const char* webnet_sparse_status_message(int code) {
  switch (code) {
    case 0:
      return webnet::sparse_status_message(webnet::SparseSolveStatus::kOk);
    case 1:
      return webnet::sparse_status_message(webnet::SparseSolveStatus::kInvalidInput);
    case 2:
      return webnet::sparse_status_message(webnet::SparseSolveStatus::kNonFiniteInput);
    case 3:
      return webnet::sparse_status_message(webnet::SparseSolveStatus::kFactorizationFailed);
    default:
      return "unknown sparse status";
  }
}

EMSCRIPTEN_KEEPALIVE
const char* webnet_dense_status_message(int code) {
  switch (code) {
    case 0:
      return webnet::dense_status_message(webnet::DenseStatus::kOk);
    case 1:
      return webnet::dense_status_message(
          webnet::DenseStatus::kInvalidDimension);
    case 2:
      return webnet::dense_status_message(webnet::DenseStatus::kNonFiniteInput);
    case 3:
      return webnet::dense_status_message(webnet::DenseStatus::kIrrecoverable);
    default:
      break;
  }
  return "unknown dense status";
}

}  // extern "C"

#ifdef __EMSCRIPTEN__

// Convenience Embind wrapper for callers that prefer JS arrays over raw
// heap pointers. Takes plain JS arrays; malformed values may throw an
// Embind conversion error; the numeric solver failures are result objects.
std::vector<double> to_vector(const emscripten::val& arr, int n) {
  std::vector<double> out;
  if (n > 0) {
    out.reserve(static_cast<std::size_t>(n));
    const int len = arr["length"].as<int>();
    for (int i = 0; i < len; ++i) {
      out.push_back(arr[i].as<double>());
    }
  }
  return out;
}

emscripten::val solveDenseCorrection(const emscripten::val& normal,
                                     const emscripten::val& rhs, int n) {
  emscripten::val out = emscripten::val::object();
  const std::vector<double> normal_vec = to_vector(normal, n);
  const std::vector<double> rhs_vec = to_vector(rhs, n);
  if (n <= 0 ||
      normal_vec.size() !=
          static_cast<std::size_t>(n) * static_cast<std::size_t>(n) ||
      rhs_vec.size() != static_cast<std::size_t>(n)) {
    out.set("status", static_cast<int>(webnet::DenseStatus::kInvalidDimension));
    out.set("correction", emscripten::val::array());
    out.set("damping", 0.0);
    out.set("attempts", 0);
    out.set("error", "Dense solve requires n > 0 with matching buffers.");
    return out;
  }
  std::vector<double> correction(static_cast<std::size_t>(n), 0.0);
  webnet::DenseSolveResult result;
  std::string error;
  const webnet::DenseStatus status = webnet::solve_dense_correction(
      normal_vec.data(), rhs_vec.data(), correction.data(), n,
      webnet::DenseSolveOptions{}, &result, &error);
  emscripten::val js_correction = emscripten::val::array();
  for (int i = 0; i < n; ++i) {
    js_correction.call<void>("push", correction[static_cast<std::size_t>(i)]);
  }
  out.set("status", static_cast<int>(status));
  out.set("correction", js_correction);
  out.set("damping", result.damping);
  out.set("attempts", result.attempts);
  out.set("error", error);
  return out;
}

EMSCRIPTEN_BINDINGS(webnet_core) {
  emscripten::function("version", &webnet::version_string);
  emscripten::function("add", &webnet::add);
  emscripten::function("solveDenseCorrection", &solveDenseCorrection);
}

#endif
