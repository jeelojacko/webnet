#include <Eigen/SparseCholesky>

#include <chrono>
#include <cmath>
#include <iostream>
#include <vector>

namespace {
using Matrix = Eigen::SparseMatrix<double>;
using Triplet = Eigen::Triplet<double>;

Matrix network(int n) {
  std::vector<Triplet> triplets;
  for (int i = 0; i < n; ++i) {
    triplets.emplace_back(i, i, 4.0);
    if (i + 1 < n) { triplets.emplace_back(i, i + 1, -1.0); triplets.emplace_back(i + 1, i, -1.0); }
    if (i + 7 < n) { triplets.emplace_back(i, i + 7, -0.25); triplets.emplace_back(i + 7, i, -0.25); }
  }
  Matrix matrix(n, n);
  matrix.setFromTriplets(triplets.begin(), triplets.end());
  return matrix;
}

template <typename Ordering>
void run(const Matrix& matrix, const Eigen::VectorXd& rhs, const char* name) {
  Eigen::SimplicialLLT<Matrix, Eigen::Lower, Ordering> solver;
  const auto start = std::chrono::steady_clock::now();
  solver.compute(matrix);
  const Eigen::VectorXd first = solver.solve(rhs);
  const auto end = std::chrono::steady_clock::now();
  const Eigen::VectorXd second = solver.solve(rhs);
  std::cout << name << " ms=" << std::chrono::duration<double, std::milli>(end - start).count()
            << " factor_nnz=" << solver.matrixL().nestedExpression().nonZeros()
            << " max_repeat_delta=" << (first - second).cwiseAbs().maxCoeff() << '\n';
}
}

int main() {
  const Matrix matrix = network(1000);
  const Eigen::VectorXd rhs = Eigen::VectorXd::Ones(1000);
  run<Eigen::NaturalOrdering<int>>(matrix, rhs, "NaturalOrdering");
  run<Eigen::AMDOrdering<int>>(matrix, rhs, "AMDOrdering");
  return 0;
}
