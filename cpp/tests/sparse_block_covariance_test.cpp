// Phase 12F.2 native tests: batched selected-covariance blocks against a
// small dense reference inverse (Gauss-Jordan with partial pivoting).
//
// Covers: block-vs-dense agreement, block-vs-scalar agreement, duplicate
// blocks bitwise-identical, (B,A) answered as transpose of (A,B), Q_ii
// symmetry, determinism (same request twice bitwise identical), and error
// paths (OOB start, blockSize <= 0, count 0 ok, NaN detection).

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

bool near(double a, double b, double tol) {
  return std::fabs(a - b) <= tol;
}

// Packed 6-equation / 6-parameter system: A has a 6x6 dense-ish design with
// mild correlations; P = diag(1,2,1,3,2,1) + P01 = P23 = 0.25.
constexpr int kEquations = 6;
constexpr int kParams = 6;
const int kOffsets[] = {0, 2, 4, 6, 8, 10, 12};
const int kColumns[] = {0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 0, 5};
const double kValues[] = {1, 2, 1, 1, 1, 1, 2, 1, 1, 2, 1, 1};
const int kWeightRows[] = {0, 0, 1, 2, 2, 3, 4, 5};
const int kWeightColumns[] = {0, 1, 1, 2, 3, 3, 4, 5};
const double kWeightValues[] = {1, 0.25, 2, 1, 0.25, 3, 2, 1};
constexpr int kDesignNnz = 12;
constexpr int kWeightNnz = 8;

void dense_normal(const double* a, const double* p, double* n) {
  for (int i = 0; i < kParams; ++i) {
    for (int j = 0; j < kParams; ++j) {
      double sum = 0.0;
      for (int r = 0; r < kEquations; ++r) {
        for (int c = 0; c < kEquations; ++c) {
          sum += a[r * kParams + i] * p[r * kEquations + c] *
                 a[c * kParams + j];
        }
      }
      n[i * kParams + j] = sum;
    }
  }
}

bool dense_inverse(const double* n, double* q) {
  constexpr int w = 2 * kParams;
  double aug[kParams][w] = {};
  for (int i = 0; i < kParams; ++i) {
    for (int j = 0; j < kParams; ++j) aug[i][j] = n[i * kParams + j];
    aug[i][kParams + i] = 1.0;
  }
  for (int col = 0; col < kParams; ++col) {
    int pivot = col;
    for (int row = col + 1; row < kParams; ++row) {
      if (std::fabs(aug[row][col]) > std::fabs(aug[pivot][col])) pivot = row;
    }
    if (aug[pivot][col] == 0.0) return false;
    if (pivot != col) {
      for (int j = 0; j < w; ++j) {
        const double t = aug[col][j];
        aug[col][j] = aug[pivot][j];
        aug[pivot][j] = t;
      }
    }
    const double div = aug[col][col];
    for (int j = 0; j < w; ++j) aug[col][j] /= div;
    for (int row = 0; row < kParams; ++row) {
      if (row == col) continue;
      const double f = aug[row][col];
      for (int j = 0; j < w; ++j) aug[row][j] -= f * aug[col][j];
    }
  }
  for (int i = 0; i < kParams; ++i) {
    for (int j = 0; j < kParams; ++j) q[i * kParams + j] = aug[i][kParams + j];
  }
  return true;
}
}  // namespace

int main() {
  using webnet::SparseSolveStatus;
  double a[kEquations * kParams] = {};
  // Rows: e0+e1-ish pairs plus wrap-around couplings.
  const double rows[kEquations][kParams] = {
      {1, 2, 0, 0, 0, 0}, {0, 1, 1, 0, 0, 0}, {0, 0, 1, 1, 0, 0},
      {0, 0, 0, 2, 1, 0}, {0, 0, 0, 0, 1, 2}, {1, 0, 0, 0, 0, 1}};
  for (int r = 0; r < kEquations; ++r) {
    for (int c = 0; c < kParams; ++c) a[r * kParams + c] = rows[r][c];
  }
  double p[kEquations * kEquations] = {};
  const double diag[kEquations] = {1, 2, 1, 3, 2, 1};
  for (int i = 0; i < kEquations; ++i) p[i * kEquations + i] = diag[i];
  p[0 * kEquations + 1] = p[1 * kEquations + 0] = 0.25;
  p[2 * kEquations + 3] = p[3 * kEquations + 2] = 0.25;
  double n[kParams * kParams] = {};
  double q[kParams * kParams] = {};
  dense_normal(a, p, n);
  check(dense_inverse(n, q), "reference dense inverse factors");
  std::string error;

  // Blocks: Q00, Q01, Q11 diagonal/off-diagonal plus transpose (1,0) and a
  // duplicate of Q00. blockSize = 2, p = 6.
  const int row_starts[] = {0, 0, 2, 2, 0};
  const int col_starts[] = {0, 2, 2, 0, 0};
  constexpr int kBlocks = 5;
  constexpr int kSize = 2;
  double got[kBlocks * kSize * kSize] = {};
  webnet::SparseFactorInfo info;
  const auto status = webnet::solve_sparse_selected_covariance_blocks(
      kOffsets, kColumns, kValues, kDesignNnz, kWeightRows, kWeightColumns,
      kWeightValues, kWeightNnz, kEquations, kParams, row_starts, col_starts,
      kBlocks, kSize, got, {}, &info, &error);
  check(status == SparseSolveStatus::kOk, "block query returns ok");

  // 1. Every entry matches the dense reference (1e-9 contract, as the
  // scalar selected-vs-full path).
  bool match = true;
  double max_abs = 0.0;
  for (int b = 0; b < kBlocks; ++b) {
    for (int i = 0; i < kSize; ++i) {
      for (int j = 0; j < kSize; ++j) {
        const double ref = q[(row_starts[b] + i) * kParams + col_starts[b] + j];
        const double diff =
            std::fabs(got[(b * kSize + i) * kSize + j] - ref);
        max_abs = std::max(max_abs, diff);
        if (!near(got[(b * kSize + i) * kSize + j], ref, 1e-9)) match = false;
      }
    }
  }
  check(match, "every block entry matches the dense inverse");
  std::cout << "[INFO] max block-vs-dense abs diff: " << max_abs << '\n';

  // 2. Block entries match the scalar querySelected API over the same
  // (row,col) pairs.
  {
    std::vector<int> srows;
    std::vector<int> scols;
    for (int b = 0; b < kBlocks; ++b) {
      for (int i = 0; i < kSize; ++i) {
        for (int j = 0; j < kSize; ++j) {
          srows.push_back(row_starts[b] + i);
          scols.push_back(col_starts[b] + j);
        }
      }
    }
    std::vector<double> scalar(srows.size(), 0.0);
    const auto sstatus = webnet::solve_sparse_selected_covariance(
        kOffsets, kColumns, kValues, kDesignNnz, kWeightRows, kWeightColumns,
        kWeightValues, kWeightNnz, kEquations, kParams, srows.data(),
        scols.data(), static_cast<int>(srows.size()), scalar.data(), {},
        nullptr, &error);
    check(sstatus == SparseSolveStatus::kOk, "scalar reference returns ok");
    // NOTE: bitwise identity is NOT expected here: the scalar path runs
    // one single-RHS solve per unique column while the block path runs one
    // multi-RHS solve, so entries agree to solver ulps. The contract is the
    // shared 1e-9 selected-vs-full tolerance.
    bool agree = true;
    double max_diff = 0.0;
    for (std::size_t k = 0; k < scalar.size(); ++k) {
      max_diff = std::max(max_diff, std::fabs(got[k] - scalar[k]));
      if (!near(got[k], scalar[k], 1e-9)) agree = false;
    }
    check(agree, "block entries match scalar queries within 1e-9");
    std::cout << "[INFO] max block-vs-scalar abs diff: " << max_diff << '\n';
  }

  // 3. Duplicate Q00 blocks are bitwise identical; (2,0) is the transpose
  // of (0,2); Q_ii blocks are symmetric.
  {
    bool dup = true;
    for (int k = 0; k < kSize * kSize; ++k) {
      if (got[k] != got[4 * kSize * kSize + k]) dup = false;
    }
    check(dup, "duplicate blocks return identical values");
    bool transpose = true;
    for (int i = 0; i < kSize; ++i) {
      for (int j = 0; j < kSize; ++j) {
        if (got[(3 * kSize + i) * kSize + j] !=
            got[(1 * kSize + j) * kSize + i]) {
          transpose = false;
        }
      }
    }
    check(transpose, "Q_ji answers as the transpose of Q_ij");
    bool symmetric = true;
    for (int b : {0, 2}) {
      for (int i = 0; i < kSize; ++i) {
        for (int j = 0; j < kSize; ++j) {
          if (!near(got[(b * kSize + i) * kSize + j],
                    got[(b * kSize + j) * kSize + i], 1e-9)) {
            symmetric = false;
          }
        }
      }
    }
    check(symmetric, "Q_ii blocks are symmetric");
    check(info.normal_nnz > 0 && info.factor_nnz > 0,
          "block factor metadata populated");
    check(error.empty(), "block success clears error");
  }

  // 4. Determinism: same request twice is bitwise identical.
  {
    double again[kBlocks * kSize * kSize] = {};
    const auto dstatus = webnet::solve_sparse_selected_covariance_blocks(
        kOffsets, kColumns, kValues, kDesignNnz, kWeightRows, kWeightColumns,
        kWeightValues, kWeightNnz, kEquations, kParams, row_starts, col_starts,
        kBlocks, kSize, again, {}, nullptr, &error);
    check(dstatus == SparseSolveStatus::kOk, "repeat block query returns ok");
    bool identical = true;
    for (int k = 0; k < kBlocks * kSize * kSize; ++k) {
      if (got[k] != again[k]) identical = false;
    }
    check(identical, "repeat request is bitwise identical");
  }

  // 5. Error paths.
  {
    double one = 0.0;
    const int ok[] = {0};
    check(webnet::solve_sparse_selected_covariance_blocks(
              kOffsets, kColumns, kValues, kDesignNnz, kWeightRows,
              kWeightColumns, kWeightValues, kWeightNnz, kEquations, kParams,
              ok, ok, 1, 0, &one, {}, nullptr, &error) ==
              SparseSolveStatus::kInvalidInput,
          "blockSize 0 is rejected");
    check(webnet::solve_sparse_selected_covariance_blocks(
              kOffsets, kColumns, kValues, kDesignNnz, kWeightRows,
              kWeightColumns, kWeightValues, kWeightNnz, kEquations, kParams,
              ok, ok, 1, -2, &one, {}, nullptr, &error) ==
              SparseSolveStatus::kInvalidInput,
          "negative blockSize is rejected");
    const int oob[] = {5};
    check(webnet::solve_sparse_selected_covariance_blocks(
              kOffsets, kColumns, kValues, kDesignNnz, kWeightRows,
              kWeightColumns, kWeightValues, kWeightNnz, kEquations, kParams,
              oob, ok, 1, 2, &one, {}, nullptr, &error) ==
              SparseSolveStatus::kInvalidInput,
          "out-of-range block start is rejected");
    check(webnet::solve_sparse_selected_covariance_blocks(
              kOffsets, kColumns, kValues, kDesignNnz, kWeightRows,
              kWeightColumns, kWeightValues, kWeightNnz, kEquations, kParams,
              nullptr, nullptr, 0, 2, nullptr, {}, nullptr, nullptr) ==
              SparseSolveStatus::kOk,
          "empty block batch succeeds");
    const double nan_values[kDesignNnz] = {1, 2, 1, 1, 1, 1, 2, 1, 1, 2,
                                           1, std::nan("")};
    // NaN design input must not return ok (non-finite detection).
    const auto nan_status = webnet::solve_sparse_selected_covariance_blocks(
        kOffsets, kColumns, nan_values, kDesignNnz, kWeightRows, kWeightColumns,
        kWeightValues, kWeightNnz, kEquations, kParams, ok, ok, 1, 2, &one, {},
        nullptr, &error);
    check(nan_status != SparseSolveStatus::kOk,
          "NaN design input is detected");
    check(!error.empty(), "NaN detection writes an error message");
  }

  if (failures == 0) {
    std::cout << "sparse block covariance test: all checks passed\n";
  } else {
    std::cout << "sparse block covariance test: " << failures
              << " check(s) failed\n";
  }
  return failures == 0 ? 0 : 1;
}
