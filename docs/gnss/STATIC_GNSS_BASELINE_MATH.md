# Static GNSS Baseline Mathematics (Phase 12A)

Architecture-only mathematical contract for a future static GNSS baseline
vector observation. No production code implements this yet.

Sign conventions below are stated against the verified WebNet convention:

- misclosure `L = observed − computed` (`adjustmentEquationAssembly.ts:190-191`,
  `adjustmentGpsEquationRows.ts:24-26`)
- iteration residual `v = L − A·dx` (`adjustmentIteration.ts:179-186`)
- DOF `= numObsEquations − numParams` (`adjustSolveWorkflow.ts:226-228`)

All internal units: metres, radians, m² covariance.

---

## 1. Canonical observation

One processed static baseline FROM station A TO station B is ONE correlated
vector observation:

```text
b_obs = [ d1, d2, d3 ]ᵀ        (metres, single Cartesian frame)
C     = 3×3 symmetric covariance (m²)
```

`C` layout (upper triangle stored, six values):

```text
C = [ C11 C12 C13
      C12 C22 C23
      C13 C23 C33 ]
```

The three components are never three independent scalars.

## 2. Observation equation (shared Cartesian frame)

Station unknowns in the same frame:

```text
X_A = [ XA YA ZA ]ᵀ      X_B = [ XB YB ZB ]ᵀ
```

Computed baseline:

```text
b_calc(X) = X_B − X_A
```

Misclosure (WebNet sign):

```text
w = b_obs − b_calc(X⁰)            (3×1, evaluated at current values)
```

Residual after correction `dx`:

```text
v = w − A·dx                      (3×1)
```

Linearised model:

```text
v + A·dx = w
```

No iteration is needed for the baseline itself (linear); iteration only
matters when coexisting nonlinear observations are present.

## 3. Jacobian

Unknown order `[ XA YA ZA XB YB ZB ]`:

```text
A_i = [ −I₃   +I₃ ]   =
      [ −1  0  0  +1  0  0
         0 −1  0   0 +1  0
         0  0 −1   0  0 +1 ]
```

FROM coefficients are −1, TO coefficients are +1. This matches the existing
GPS row pattern (`adjustmentGpsEquationRows.ts:29-56`: from −1 / to +1 per
component).

Row accounting: one baseline contributes **3 equations** but **1 logical
observation**. Reporting, blunder handling, and block statistics must keep
both counts (see §8).

## 4. Weight

Per-baseline weight is the inverse covariance:

```text
P_i = C_i⁻¹        (3×3, units m⁻²)
```

With independent baselines the global `P` is block-diagonal with one 3×3
block per baseline. Normal equations:

```text
N = Σ A_iᵀ P_i A_i        (each baseline stamps −P_i / +P_i 3×3 blocks)
U = Σ A_iᵀ P_i w_i
```

### 3×3 inversion

Closed-form adjugate/determinant inversion is sufficient and stable for
well-conditioned baseline covariances. Policy:

- invert at solve-preparation time (matching `adjustGpsWeighting.ts:81-137`,
  which inverts parsed covariance during preparation, not at parse);
- store covariance canonically, derive the weight;
- reject non-finite / non-symmetric / non-positive-diagonal / non-PD input
  fail-closed (Cholesky check); never add silent diagonal jitter.

## 5. Reversal

Baseline A→B is defined:

```text
b(A→B) = X_B − X_A
```

Reversed solution B→A:

```text
b' = −b
C' = (−I) C (−I)ᵀ = C
```

Proof: `(−I)C(−I)ᵀ = (−I)C(−I) = C` since `(−I)ᵀ = −I` and `(−1)² = 1`
entry-wise through the triple product. So reversal negates the vector and
leaves covariance identical. Fixture 5 (doc §34 / arch doc) proves solution
equivalence.

## 6. ECEF → local rotation (import boundary only)

For orthonormal rotation `R` (ECEF → local, rows East/North/Up):

```text
b_local   = R · b_ecef
C_local   = R · C_ecef · Rᵀ
C_ecef    = Rᵀ · C_local · R        (R⁻¹ = Rᵀ)
```

Conventions (normative for any future importer):

- component order East, North, Up;
- `R` built from the geodetic latitude/longitude of ONE explicitly declared
  origin (network origin for the shared-frame strategy — §7);
- vector and covariance always transformed together; transforming a vector
  without its covariance is forbidden;
- orthonormality verified (`R·Rᵀ ≈ I`); otherwise hard error.

Standard `R` (ECEF → ENU at latitude φ, longitude λ):

```text
R = [ −sinλ              cosλ            0
      −sinφ·cosλ   −sinφ·sinλ      cosφ
       cosφ·cosλ    cosφ·sinλ     sinφ ]
```

## 7. Why one shared frame matters

`R` above is location-dependent. Rotating EACH baseline at its own FROM
station produces vectors in DIFFERENT frames; the linear `b = X_B − X_A`
model no longer holds across the network. Admissible designs:

- (a) adjust in ECEF directly (`R = I`, no rotation at all); or
- (b) rotate every baseline with ONE constant `R` fixed at the declared
  network origin, and interpret station unknowns in that same frame.

Design (b) is valid while network extent keeps frame curvature negligible;
the origin must be recorded with the solution. Per-baseline local rotations
are rejected.

## 8. Residuals and block statistics

Component residuals `v = [v1 v2 v3]ᵀ` (observed−computed sign) plus:

- 3D magnitude `‖v‖` (descriptive only, ignores correlation);
- covariance-aware quadratic form `q = vᵀ·P·v` (descriptive; NOT a test
  until residual covariance is used — §9).

Never reduce a correlated vector to a scalar residual for testing.

## 9. Block test statistic (architecture)

Correct baseline-outlier statistic uses the residual cofactor, not the
observation weight:

```text
T_i = v_iᵀ · C_vi⁻¹ · v_i,      C_vi = cofactor of v_i from Qvv·σ̂²
```

- `T_i ~ χ²` with 3 DOF under the null (one 3-vector block);
- differs from three component-wise tests: component tests ignore
  off-diagonal correlation and triple the multiple-testing burden; the block
  test is one 3-DOF statement about the whole solution;
- requires `Qvv` blocks the current statistics path does not retain per
  block; Phase 12D must derive whether to add block-`Qvv` recovery or defer
  to descriptive `q` above plus component standardized residuals.

Redundancy for a 3-block: trace of the block redundancy matrix
`R_i = I − A_i·Qxx·A_iᵀ·P_i`; partial redundancies in [0,3] summing the
block contribution. Scalar-observation redundancy formulas must NOT be
applied entry-wise without this derivation.

## 10. Variance factor interaction

Canonical internal covariance MUST mean the a-priori stochastic model:

```text
Σ_i = σ₀²(apriori) · C_stored,i
```

Default `σ₀²(apriori) = 1` unless processing software documents a scale.
Posterior SEUW then tests the stated stochastic model; a separate
user/project GNSS scale factor multiplies `C_stored` ONCE at ingest if
offered at all. Double-scaling (importer scale × solver variance factor on
the same uncertainty) is forbidden by construction: one canonical field,
one meaning.

## 11. Rank deficiency of a baseline network

Baseline equations constrain relative geometry only. For a connected network
in a known-oriented frame (ECEF or single-origin local):

- translation defect = 3 (nothing fixes absolute position);
- NO rotation or scale defect: vectors arrive with absolute orientation and
  metric scale, unlike distance-only or angle-only terrestrial networks.

Minimum datum: one fixed 3D station (3 coordinates) removes the defect.
Each additional fixed station adds checks, not datum necessity. A connected
component with no fixed 3D station is rank-deficient by exactly 3 — the
preflight must report it before solving (free-network machinery deferred).

## 12. Loop closure (future QC)

For loop baselines `b_1..b_k` forming a closed polygon with independent
covariances:

```text
closure      s = Σ ±b_i     (signs per traversal direction)
C_s          = Σ C_i
```

Normalised closure `sᵀ·C_s⁻¹·s ~ χ²(3)` is the loop QC statistic. Belongs to
pre-adjustment QC / post-adjustment diagnostics, not to the observation
equations. Phase 12D scope.
