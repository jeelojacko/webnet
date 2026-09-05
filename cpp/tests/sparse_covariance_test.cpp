// Phase 3 covariance tests: selected Qxx entries and batched row
// quadratic/cross products against a small dense reference inverse.
//
// Reference math lives in this file (Gauss-Jordan with partial pivoting);
// the core under test never forms a dense inverse.

#include "webnet/sparse_normal_solver.hpp"

#include <cmath>
#include <cstring>
#include <iostream>
#include <string>
#include <vector>

namespace {
int failures = 0;
void check(bool ok, const char* label) {
  std::cout << (ok ? "[PASS] " : "[FAIL] ") << label << '\n';
  if (!ok) ++failures;
}

// Phase 3 C ABI entry points (linked from the bindings glue, same library
// TS will call through WASM). Declared here so this test exercises the
// exact exported signatures natively.
extern "C" {
int webnet_sparse_selected_covariance(
    const int*, const int*, const double*, int, const int*, const int*,
    const double*, int, int, int, const int*, const int*, int, double*, int*,
    int*, double*, int*, char*, int);
int webnet_sparse_row_products(
    const int*, const int*, const double*, int, const int*, const int*,
    const double*, int, int, int, const int*, const int*, const double*, int,
    int, const int*, const int*, int, double*, double*, int*, int*, double*,
    int*, char*, int);
}  // extern "C"
bool near(double a, double b, double tol) {
  return std::fabs(a - b) <= tol;
}

// Packed 4-equation / 3-parameter system with one correlated weight pair.
// A = [[1,0,2],[0,1,1],[1,1,0],[2,0,1]], P = diag(1,2,1,3) + P01 = 0.25.
constexpr int kEquations = 4;
constexpr int kParams = 3;
const int kOffsets[] = {0, 2, 4, 6, 8};
const int kColumns[] = {0, 2, 1, 2, 0, 1, 0, 2};
const double kValues[] = {1, 2, 1, 1, 1, 1, 2, 1};
const int kWeightRows[] = {0, 0, 1, 2, 3};
const int kWeightColumns[] = {0, 1, 1, 2, 3};
const double kWeightValues[] = {1, 0.25, 2, 1, 3};
constexpr int kDesignNnz = 8;
constexpr int kWeightNnz = 5;

void dense_normal(double n[kParams][kParams]) {
  const double a[kEquations][kParams] = {
      {1, 0, 2}, {0, 1, 1}, {1, 1, 0}, {2, 0, 1}};
  double p[kEquations][kEquations] = {};
  p[0][0] = 1;
  p[0][1] = p[1][0] = 0.25;
  p[1][1] = 2;
  p[2][2] = 1;
  p[3][3] = 3;
  for (int i = 0; i < kParams; ++i) {
    for (int j = 0; j < kParams; ++j) {
      double sum = 0.0;
      for (int r = 0; r < kEquations; ++r) {
        for (int c = 0; c < kEquations; ++c) sum += a[r][i] * p[r][c] * a[c][j];
      }
      n[i][j] = sum;
    }
  }
}

bool dense_inverse(const double n[kParams][kParams],
                   double q[kParams][kParams]) {
  double aug[kParams][2 * kParams] = {};
  for (int i = 0; i < kParams; ++i) {
    for (int j = 0; j < kParams; ++j) aug[i][j] = n[i][j];
    aug[i][kParams + i] = 1.0;
  }
  for (int col = 0; col < kParams; ++col) {
    int pivot = col;
    for (int row = col + 1; row < kParams; ++row) {
      if (std::fabs(aug[row][col]) > std::fabs(aug[pivot][col])) pivot = row;
    }
    if (aug[pivot][col] == 0.0) return false;
    if (pivot != col) {
      for (int j = 0; j < 2 * kParams; ++j) {
        const double t = aug[col][j];
        aug[col][j] = aug[pivot][j];
        aug[pivot][j] = t;
      }
    }
    const double div = aug[col][col];
    for (int j = 0; j < 2 * kParams; ++j) aug[col][j] /= div;
    for (int row = 0; row < kParams; ++row) {
      if (row == col) continue;
      const double f = aug[row][col];
      for (int j = 0; j < 2 * kParams; ++j) aug[row][j] -= f * aug[col][j];
    }
  }
  for (int i = 0; i < kParams; ++i) {
    for (int j = 0; j < kParams; ++j) q[i][j] = aug[i][kParams + j];
  }
  return true;
}

double row_form(const double q[kParams][kParams], const double* r_cols,
                const double* r_vals, int r_nnz, const double* s_cols,
                const double* s_vals, int s_nnz) {
  double total = 0.0;
  for (int a = 0; a < r_nnz; ++a) {
    for (int b = 0; b < s_nnz; ++b) {
      total += r_vals[a] * q[static_cast<int>(r_cols[a])]
                             [static_cast<int>(s_cols[b])] *
               s_vals[b];
    }
  }
  return total;
}
}  // namespace

int main() {
  using webnet::SparseSolveStatus;
  double n[kParams][kParams] = {};
  double q[kParams][kParams] = {};
  dense_normal(n);
  check(dense_inverse(n, q), "reference dense inverse factors");
  std::string error;

  // 1. Full selected inverse plus duplicate and symmetric queries.
  {
    const int rows[] = {0, 0, 0, 1, 1, 1, 2, 2, 2, 0, 1, 0};
    const int cols[] = {0, 1, 2, 0, 1, 2, 0, 1, 2, 1, 0, 1};
    constexpr int count = 12;
    double got[count] = {};
    webnet::SparseFactorInfo info;
    const auto status = webnet::solve_sparse_selected_covariance(
        kOffsets, kColumns, kValues, kDesignNnz, kWeightRows, kWeightColumns,
        kWeightValues, kWeightNnz, kEquations, kParams, rows, cols, count, got,
        {}, &info, &error);
    check(status == SparseSolveStatus::kOk, "selected covariance returns ok");
    bool match = true;
    for (int k = 0; k < 9; ++k) {
      if (!near(got[k], q[rows[k]][cols[k]], 1e-9)) match = false;
    }
    check(match, "selected entries match dense inverse");
    check(near(got[9], got[10], 1e-12) && near(got[9], q[0][1], 1e-9),
          "symmetric queries agree");
    check(near(got[9], got[11], 0.0), "duplicate queries agree");
    check(info.normal_nnz > 0 && info.factor_nnz > 0,
          "covariance factor metadata populated");
    check(error.empty(), "covariance success clears error");
  }

  // 2. Badly scaled columns keep matching the dense reference.
  {
    const double scaled_values[] = {1e3, 2e3, 1, 1, 1e3, 1, 2e3, 1e3};
    const int rows[] = {0, 1, 2, 2};
    const int cols[] = {0, 1, 2, 0};
    double got[4] = {};
    const auto status = webnet::solve_sparse_selected_covariance(
        kOffsets, kColumns, scaled_values, kDesignNnz, kWeightRows,
        kWeightColumns, kWeightValues, kWeightNnz, kEquations, kParams, rows,
        cols, 4, got, {}, nullptr, &error);
    double ns[kParams][kParams] = {};
    {
      const double a[kEquations][kParams] = {
          {1e3, 0, 2e3}, {0, 1, 1}, {1e3, 1, 0}, {2e3, 0, 1e3}};
      double p[kEquations][kEquations] = {};
      p[0][0] = 1;
      p[0][1] = p[1][0] = 0.25;
      p[1][1] = 2;
      p[2][2] = 1;
      p[3][3] = 3;
      for (int i = 0; i < kParams; ++i) {
        for (int j = 0; j < kParams; ++j) {
          double sum = 0.0;
          for (int r = 0; r < kEquations; ++r) {
            for (int c = 0; c < kEquations; ++c) {
              sum += a[r][i] * p[r][c] * a[c][j];
            }
          }
          ns[i][j] = sum;
        }
      }
    }
    double qs[kParams][kParams] = {};
    check(status == SparseSolveStatus::kOk, "scaled covariance returns ok");
    check(dense_inverse(ns, qs), "scaled reference inverse factors");
    bool match = true;
    for (int k = 0; k < 4; ++k) {
      const double tol = 1e-9 * (1.0 + std::fabs(qs[rows[k]][cols[k]]));
      if (!near(got[k], qs[rows[k]][cols[k]], tol)) match = false;
    }
    check(match, "scaled covariance matches dense inverse");
  }

  // 3. Invalid query indices are rejected.
  {
    double one = 0.0;
    const int bad_row[] = {3};
    const int ok_col[] = {0};
    check(webnet::solve_sparse_selected_covariance(
              kOffsets, kColumns, kValues, kDesignNnz, kWeightRows,
              kWeightColumns, kWeightValues, kWeightNnz, kEquations, kParams,
              bad_row, ok_col, 1, &one, {}, nullptr, &error) ==
              SparseSolveStatus::kInvalidInput,
          "row index at parameter_count is rejected");
    const int ok_row[] = {0};
    const int bad_col[] = {-1};
    check(webnet::solve_sparse_selected_covariance(
              kOffsets, kColumns, kValues, kDesignNnz, kWeightRows,
              kWeightColumns, kWeightValues, kWeightNnz, kEquations, kParams,
              ok_row, bad_col, 1, &one, {}, nullptr, &error) ==
              SparseSolveStatus::kInvalidInput,
          "negative column index is rejected");
    check(webnet::solve_sparse_selected_covariance(
              kOffsets, kColumns, kValues, kDesignNnz, kWeightRows,
              kWeightColumns, kWeightValues, kWeightNnz, kEquations, kParams,
              nullptr, ok_col, 1, &one, {}, nullptr, &error) ==
              SparseSolveStatus::kInvalidInput,
          "null query rows are rejected");
    check(webnet::solve_sparse_selected_covariance(
              kOffsets, kColumns, kValues, kDesignNnz, kWeightRows,
              kWeightColumns, kWeightValues, kWeightNnz, kEquations, kParams,
              ok_row, ok_col, -1, &one, {}, nullptr, &error) ==
              SparseSolveStatus::kInvalidInput,
          "negative query count is rejected");
    check(!error.empty(), "invalid query writes an error message");
    check(webnet::solve_sparse_selected_covariance(
              kOffsets, kColumns, kValues, kDesignNnz, kWeightRows,
              kWeightColumns, kWeightValues, kWeightNnz, kEquations, kParams,
              nullptr, nullptr, 0, nullptr, {}, nullptr, nullptr) ==
              SparseSolveStatus::kOk,
          "empty query batch succeeds");
  }

  // 4. Batched quadratics and crosses match r^T Q s references.
  {
    // r0 = e0 + 2 e2, r1 = -e1 + e2, r2 = empty.
    const int q_offsets[] = {0, 2, 4, 4};
    const int q_cols[] = {0, 2, 1, 2};
    const double q_vals[] = {1, 2, -1, 1};
    const double r0c[] = {0, 2};
    const double r0v[] = {1, 2};
    const double r1c[] = {1, 2};
    const double r1v[] = {-1, 1};
    const int cross_a[] = {0, 1, 0, 2};
    const int cross_b[] = {1, 0, 0, 0};
    double quad[3] = {-1, -1, -1};
    double cross[4] = {-7, -7, -7, -7};
    const auto status = webnet::solve_sparse_row_products(
        kOffsets, kColumns, kValues, kDesignNnz, kWeightRows, kWeightColumns,
        kWeightValues, kWeightNnz, kEquations, kParams, q_offsets, q_cols,
        q_vals, 4, 3, cross_a, cross_b, 4, quad, cross, {}, nullptr, &error);
    check(status == SparseSolveStatus::kOk, "row products return ok");
    check(near(quad[0], row_form(q, r0c, r0v, 2, r0c, r0v, 2), 1e-9),
          "quadratic of row 0 matches reference");
    check(near(quad[1], row_form(q, r1c, r1v, 2, r1c, r1v, 2), 1e-9),
          "quadratic of row 1 matches reference");
    check(quad[2] == 0.0, "empty row yields zero quadratic");
    const double ref01 = row_form(q, r0c, r0v, 2, r1c, r1v, 2);
    check(near(cross[0], ref01, 1e-9) && near(cross[1], ref01, 1e-9),
          "symmetric cross pairs agree with reference");
    check(near(cross[2], quad[0], 1e-12), "self cross equals quadratic");
    check(cross[3] == 0.0, "cross with empty row is zero");
    check(error.empty(), "row products clear error on success");
  }

  // 5. Invalid row-product batches are rejected.
  {
    const int q_offsets[] = {0, 1};
    const int q_cols[] = {0};
    const double q_vals[] = {1.0};
    double quad[1] = {0.0};
    double cross[1] = {0.0};
    const int bad_col[] = {3};
    check(webnet::solve_sparse_row_products(
              kOffsets, kColumns, kValues, kDesignNnz, kWeightRows,
              kWeightColumns, kWeightValues, kWeightNnz, kEquations, kParams,
              q_offsets, bad_col, q_vals, 1, 1, nullptr, nullptr, 0, quad,
              nullptr, {}, nullptr, &error) ==
              SparseSolveStatus::kInvalidInput,
          "out-of-range query column is rejected");
    const int cross_a[] = {0};
    const int cross_b[] = {5};
    check(webnet::solve_sparse_row_products(
              kOffsets, kColumns, kValues, kDesignNnz, kWeightRows,
              kWeightColumns, kWeightValues, kWeightNnz, kEquations, kParams,
              q_offsets, q_cols, q_vals, 1, 1, cross_a, cross_b, 1, quad,
              cross, {}, nullptr, &error) == SparseSolveStatus::kInvalidInput,
          "out-of-range cross index is rejected");
    const int truncated[] = {0, 0};
    check(webnet::solve_sparse_row_products(
              kOffsets, kColumns, kValues, kDesignNnz, kWeightRows,
              kWeightColumns, kWeightValues, kWeightNnz, kEquations, kParams,
              truncated, q_cols, q_vals, 1, 1, nullptr, nullptr, 0, quad,
              nullptr, {}, nullptr, &error) == SparseSolveStatus::kInvalidInput,
          "truncated query offsets are rejected");
    check(!error.empty(), "invalid row batch writes an error message");
  }

  // 6. C ABI wrappers forward with metadata and bounded error strings.
  {
    const int rows[] = {0, 1};
    const int cols[] = {0, 2};
    double got[2] = {0.0, 0.0};
    int normal_nnz = 0;
    int factor_nnz = 0;
    double damping = -1.0;
    int attempts = -1;
    char err[128] = "stale";
    const int status = webnet_sparse_selected_covariance(
        kOffsets, kColumns, kValues, kDesignNnz, kWeightRows, kWeightColumns,
        kWeightValues, kWeightNnz, kEquations, kParams, rows, cols, 2, got,
        &normal_nnz, &factor_nnz, &damping, &attempts, err, sizeof(err));
    check(status == 0, "covariance ABI returns 0");
    check(near(got[0], q[0][0], 1e-9) && near(got[1], q[1][2], 1e-9),
          "covariance ABI matches dense reference");
    check(normal_nnz > 0 && factor_nnz > 0 && damping == 0 && attempts == 0,
          "covariance ABI populates metadata");
    check(std::string(err).empty(), "covariance ABI clears error");

    const int q_offsets[] = {0, 1, 2};
    const int q_cols[] = {0, 1};
    const double q_vals[] = {1.0, 1.0};
    const int cross_a[] = {0};
    const int cross_b[] = {1};
    double quad[2] = {0.0, 0.0};
    double cross[1] = {0.0};
    char err2[128] = "stale";
    const int pstatus = webnet_sparse_row_products(
        kOffsets, kColumns, kValues, kDesignNnz, kWeightRows, kWeightColumns,
        kWeightValues, kWeightNnz, kEquations, kParams, q_offsets, q_cols,
        q_vals, 2, 2, cross_a, cross_b, 1, quad, cross, nullptr, nullptr,
        nullptr, nullptr, err2, sizeof(err2));
    const double e0[] = {0.0};
    const double v0[] = {1.0};
    const double e1[] = {1.0};
    const double v1[] = {1.0};
    check(pstatus == 0, "row-product ABI returns 0");
    check(near(quad[0], row_form(q, e0, v0, 1, e0, v0, 1), 1e-9) &&
                near(cross[0], row_form(q, e0, v0, 1, e1, v1, 1), 1e-9),
          "row-product ABI matches dense reference");
    check(std::string(err2).empty(), "row-product ABI clears error");

    char tiny[8];
    std::memset(tiny, 'X', sizeof(tiny));
    const int bad_row[] = {9};
    double one = 0.0;
    check(webnet_sparse_selected_covariance(
              kOffsets, kColumns, kValues, kDesignNnz, kWeightRows,
              kWeightColumns, kWeightValues, kWeightNnz, kEquations, kParams,
              bad_row, cols, 1, &one, nullptr, nullptr, nullptr, nullptr,
              tiny, sizeof(tiny)) == 1 &&
                tiny[7] == '\0' && std::string(tiny).size() > 0,
          "covariance ABI rejects bad index with truncated message");
  }

  if (failures == 0) {
    std::cout << "sparse covariance test: all checks passed\n";
  } else {
    std::cout << "sparse covariance test: " << failures
              << " check(s) failed\n";
  }
  return failures == 0 ? 0 : 1;
}
