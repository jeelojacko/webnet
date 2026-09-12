# Phase 12E.2 dataset B — zero-setup-error TBC parity evidence

Evidence-only. No production math, parser semantics, tolerances, routing, UI, or CRS code was modified. Vendor files are READ-ONLY and never committed.

## Intake

- AUTHORITATIVE pre-adjustment input: `post-BL-processing-b4adjustment.gvx` — 50 vectors, 100 POINT records, 8 unique NAMEs (3, 5, P041, filter, frey, fsi, hanna, sixtwo), frame NAD83(2011)@2010, GVX v1.0.
- Post-adjustment cross-check: `post-networkadjustment.gvx` — 50 vectors, 100 POINT records, same frame.
- Adjustment report body: `netwrok adjustment report/200aae0c.html` (identified by content: carries Adjustment Statistics; TOC/wrapper siblings identified by title/frameset, same cafa0ac3.html pattern as dataset A).
- Baseline-processing summary: `process baseline report/292d12a8.html` — process baseline report/292d12a8.html: processed=50 passed=50 flagged=0 failed=0; rows=50 (50 Fixed).
- Setup errors: centering 0 / antenna 0 (ZERO setup-error case); a-priori scalar 1; 2 iterations; chi-square Failed; P041 constrained (P041).
- P041 fixed at the highest-precision datum source: pre-GVX coordinate (full double precision). Pre-vs-post GVX drift is bitwise zero (fixed datum); pre-vs-report-display agrees within the mm-display floor (gate H) — the report shows 3 decimals, the GVX carries full precision, so the GVX is strictly the highest-precision source.

## Gates

| Gate | Name | Verdict | Detail |
| --- | --- | --- | --- |
| A | GVX intake identity | PASS | pre=post-BL-processing-b4adjustment.gvx vectors=50 marks=100 frame=NAD83(2011)@2010 GVX v1.0; post=post-networkadjustment.gvx vectors=50 marks=100. |
| B | NAME grouping identity | PASS | 8 unique NAMEs; same-NAME coordinates identical within 1e-6 m. |
| C0 | TBC report parse | PASS | body=netwrok adjustment report/200aae0c.html iterations=2 refFactor=1.97 apriori=1 chiSq=Failed dof=129 redundancy=129 setup=0/0 constrained=P041 ecefRows=8 obs=50 |
| C | Observation-set identity (GVX <-> report) | PASS | all 50 pre-GVX solutionIds present in report Adjusted GNSS Observations and vice versa. |
| P | Baseline-processing counts | PASS | process baseline report/292d12a8.html: processed=50 passed=50 flagged=0 failed=0; rows=50 (50 Fixed). |
| D | Spreadsheet ID reconciliation | PASS | post-BL-processing-b4-adjustment.xlsx: colA=50 rows=50 cols=19 GVX-not-in-xlsx=0 xlsx-not-in-GVX=0 post-networkadjustment-vectorlist.xlsx: colA=50 rows=50 cols=19 GVX-not-in-xlsx=0 xlsx-not-in-GVX=0 |
| V | Pre-vs-post vector identity | PASS | matched=50/50 bitwiseEqual=32 max|dDX|=2.328e-10 max|dDY|=9.313e-10 max|dDZ|=9.313e-10 maxCovDiff=0.000e+0 class=serialization; frames identical (NAD83(2011)@2010). |
| W | Post-GVX station coordinates carry the adjustment | NOTE | markIds=100->100 maxCoordDiff=1.028e-2 m; P041 drift=0.000e+0 m (fixed datum bitwise stable); other NAMEs shifted by mm-cm (adjusted positions, cross-check only). |
| E | DOF cross-check (GATE 150/21/129) | PASS | n=150 u=21 dof=129 (TBC 150/21/129); logicalObs=50 statistics=50 iterations=2 converged=true. |
| F | SEUW vs TBC 1.97 display interval | PASS | SEUW=1.965038 (displayed TBC 1.97 => underlying in [1.965,1.975)). |
| I | vTPv vs implied TBC interval | PASS | vTPv=498.1172 (SEUW^2*dof); TBC-implied [498.0980,503.1806). |
| G | Per-station adjusted ECEF vs TBC table | PASS | n=8 max|component|=4.919e-4 m (TBC 3-decimal display => 5e-4 m floor) max3D=7.763e-4 m. |
| G2 | Adjusted ECEF vs post-GVX full precision | PASS | max3D=1.397e-9 m over 8 NAMEs (post-GVX carries TBC adjusted positions at full precision; TBC display rounding bypassed). |
| H | P041 datum (pre-GVX fixed justified) | PASS | pre-vs-post GVX drift=0.000e+0 m (bitwise stable fixed datum); pre-vs-report display d=[7.062e-5,-2.150e-4,8.795e-5] m within mm-display floor — fixed at highest-precision pre-GVX coordinate. |
| Q | Precision/covariance comparability (definitions first) | NOTE | TBC per-component errors are mm-rounded a-posteriori DRMS display (0.002-0.004 m; error ellipses 0.002-0.003 m), NOT raw Qxx — definitions differ, so NOT COMPARABLE as covariance. Outcome-level only: WebNet posterior sigmas (qxx diag x SEUW, unknowns ordered [x,y,h] per free station) round to the same mm display within the 5e-4 m floor (all finite): 3: X=0.0018 Y=0.0035 Z=0.0027; 5: X=0.0017 Y=0.0034 Z=0.0026; filter: X=0.0018 Y=0.0034 Z=0.0027; frey: X=0.0017 Y=0.0034 Z=0.0027; fsi: X=0.0018 Y=0.0038 Z=0.0029; hanna: X=0.0017 Y=0.0033 Z=0.0026; sixtwo: X=0.0017 Y=0.0033 Z=0.0026. |
| J | Residual representation NOT COMPARABLE | NOTE | TBC Adjusted GNSS Observations are Az/DeltaHt/EllipDist derived quantities per vector; WebNet solves raw ECEF DX/DY/DZ — no exact conversion derived, so residual parity is NOT COMPARABLE. |
| K | Chi-square outcome reconciliation (definitions differ) | NOTE | TBC reports "Failed"; WebNet vTPv=498.1172 vs standard 95% chi-square bounds for dof=129 [99.4,162.3] => reject (FAILED). Same reject outcome; TBC's exact test-statistic construction unverified, so outcome-consistent only. |

## Scorecard (MODEL B0 = raw pre-adjustment GVX covariance, robust OFF, TS dense)

- DOF GATE (E): n=150 u=21 dof=129 — must be exactly 150/21/129.
- SEUW (F): 1.965038 vs TBC displayed 1.97 (underlying in [1.965,1.975)).
- vTPv (I): 498.1172 vs TBC-implied [498.0980,503.1806).
- Coordinates vs TBC display (G): max|component| 4.919e-4 m within the 3-decimal 5e-4 m floor; max3D 7.763e-4 m.
- Coordinates vs post-GVX full precision (G2): max3D 1.397e-9 m — sub-nanometre agreement with TBC's own adjusted export.
- Phase-12D statistics blocks: 50; iterations 2, converged true, maxCorrection 4.104e-10 m.

## Parity level: 3 / 4

Rubric (brief S30): L0 input parity; L1 structural (n/u/dof); L2 coordinate (adjusted ECEF within reference resolution — here full-precision agreement via post-GVX); L3 stochastic (reference factor compatible); L4 residual UNREACHABLE (Az/DeltaHt/EllipDist vs raw ECEF, gate J).

## Per-station ECEF differences vs TBC display (WebNet minus TBC, metres)

| Station | dX | dY | dZ | 3D norm |
| --- | --- | --- | --- | --- |
| 3 | -1.846e-4 | 4.056e-4 | -1.125e-4 | 4.596e-4 |
| 5 | -4.156e-4 | -4.919e-4 | 4.254e-4 | 7.718e-4 |
| P041 | 7.062e-5 | -2.150e-4 | 8.795e-5 | 2.428e-4 |
| filter | 4.744e-4 | 4.833e-4 | 3.793e-4 | 7.763e-4 |
| frey | -2.994e-4 | 3.327e-4 | -1.114e-6 | 4.476e-4 |
| fsi | -3.789e-4 | 2.282e-4 | -2.925e-4 | 5.303e-4 |
| hanna | 1.207e-4 | 3.546e-4 | -2.678e-4 | 4.604e-4 |
| sixtwo | 2.234e-4 | 4.481e-4 | 1.478e-4 | 5.221e-4 |

## Adjusted coordinates vs post-GVX full precision (3D norm, metres)

| Station | 3D norm |
| --- | --- |
| 3 | 2.328e-10 |
| 5 | 2.328e-10 |
| P041 | 0.000e+0 |
| filter | 0.000e+0 |
| frey | 1.317e-9 |
| fsi | 1.397e-9 |
| hanna | 9.313e-10 |
| sixtwo | 1.041e-9 |

## Source manifest (all 71 files, bytes, SHA-256)

| File | Bytes | SHA-256 |
| --- | --- | --- |
| `netwrok adjustment report/20093806.html` | 3661 | `4ef09ce502d93cb64a7d1e2792a6c339925871cda58aa715f474709973e68c38` |
| `netwrok adjustment report/200aae0c.html` | 124716 | `c4539a4cc00a9542f5bc8488c398522422eccca550aa1b263b9ba3dd4b0947a9` |
| `netwrok adjustment report/Rpt1fd4d088.html` | 728 | `64fe521768b4d356434d354c91c90cd1531be80d1f608c5a5ad0b536f32661e3` |
| `post-BL-processing-b4-adjustment.xlsx` | 14502 | `b70b60ad4a25f10dc4f35e00761ee48e51addaff7cfb191373712c55828c5d41` |
| `post-BL-processing-b4adjustment.gvx` | 138106 | `5cc99fa6acc98f3b2ef6693d8b3fb5e76beefea14f654f6862a0fa336559bc1e` |
| `post-networkadjustment-vectorlist.xlsx` | 14499 | `e9722bf0de42d82ca304a7f5cbf83aa5ddf3f26ae7144549be5d32e250fd872e` |
| `post-networkadjustment.gvx` | 138442 | `836d8c9c9fa1eda277b60a08603a67f4fbf535a0b52d815ec2ccde2fa71ca0b6` |
| `process baseline report/10fe4ac5.html` | 638 | `164ea8c03b3a297845dcffc47b68e1407233094ec8a334e4aef56c2e4fb60ed1` |
| `process baseline report/10ff1026.html` | 8112 | `6d3ef0af17974a10eea636d6474981041e9dc77cd4cda4c0f45eaee37ba986ca` |
| `process baseline report/10ff13a4.1.html` | 19483 | `985ef8d36cd975a9c203818a8a86a1b4cf033f3d7035a47f7de6ff691fdf2247` |
| `process baseline report/292c60c9.html` | 9463 | `b1cba0477db868217f4a9c98f79fa97a4af086bc1322bdb236a968ec3f2b5955` |
| `process baseline report/292d12a8.html` | 77467 | `83e796bd5b2789ed71fb632db5b4bfead33477dc2f954ec056414f341854e772` |
| `process baseline report/292d3b4c.1.html` | 19483 | `060638b05cbe84960b6fd369b26537d7cbc313291421e1f0792c1512b26d7772` |
| `process baseline report/292d3b4c.10.html` | 18601 | `f5722fbca0a6b340f3b1236e5260b1c6b540b8477fdd2acc6f873e4dd0ab35c5` |
| `process baseline report/292d3b4c.11.html` | 18602 | `069e42a57ec0f45cdfcb0b9e70e49d9b8b2df93cccd8edccc931ca7493b19451` |
| `process baseline report/292d3b4c.12.html` | 18952 | `fe4f83e6892ea9bccb832558ab6a9bc68c693a1e490e00042ab6bc4585e42c2c` |
| `process baseline report/292d3b4c.13.html` | 19128 | `38ff727ac1fc2cdee72005da6504d98efeb23d44d680628256c1165549aba027` |
| `process baseline report/292d3b4c.14.html` | 18768 | `d14815204e7714d34954ee99f4377cb39d23d5d5ea8f80cb9e0159440a3c8a87` |
| `process baseline report/292d3b4c.15.html` | 19120 | `ec39e749c5d93250aa82b14b654d0d934f4d2309cc24abcd1ff90ae2aa073ace` |
| `process baseline report/292d3b4c.16.html` | 18948 | `87fc9ebd7607da7cb6eb558a91005397771e6d926a3a9371b0381ee491c2dd17` |
| `process baseline report/292d3b4c.17.html` | 18597 | `07f0cf674a306ebf375fb1a62a5bc1eb2258c3299f33d2632ba4c8de9bee61b4` |
| `process baseline report/292d3b4c.18.html` | 18597 | `77875be840be49fd57fe5144c0c9deb68fe09ffbf4ecae3c55d1eb6cdb186703` |
| `process baseline report/292d3b4c.19.html` | 19132 | `f863d5bbe8a976186c121f184a9a8cfdcd4b7e3e12c448ff821ffb7b9e13a54d` |
| `process baseline report/292d3b4c.2.html` | 19132 | `27c7c340c51232105bc1e23664970f116c9f83264b09a16e303d5578518515a2` |
| `process baseline report/292d3b4c.20.html` | 18605 | `1df26e530825371a21e1c8a25d0d9b9f5effa598abd727f2e731213df4ce0e1a` |
| `process baseline report/292d3b4c.21.html` | 18410 | `0f366c2bf646d8ba08a7d09b1720958d2a8d8db59ee4e1594d235167482fd34e` |
| `process baseline report/292d3b4c.22.html` | 18936 | `1e31aba536a3e1be964d7a7796db702d3f48857e2375eec22ad4bae88109d617` |
| `process baseline report/292d3b4c.23.html` | 18585 | `f0fa6b80bfed45d3d40d2107698584c004d8bdd2ff5ea21a8b0bcfe228a78d81` |
| `process baseline report/292d3b4c.24.html` | 18585 | `b6ac5d8f03e15f8046763c0985d576af2ef0e415642094caa9b87c9327b7bc58` |
| `process baseline report/292d3b4c.25.html` | 18760 | `38fbcd1fb11779edc51ddac9a408454e0eb8a9f92931d297647b42c661f83311` |
| `process baseline report/292d3b4c.26.html` | 18936 | `86857fcd7b38247484ebdf228d22df72a86df5a2294b4fd39ee6f06357e773d3` |
| `process baseline report/292d3b4c.27.html` | 18938 | `d3730f8339c5962d1e7a4aab66855daa1b7211a3e838a7a2d2b849ecdd89c54b` |
| `process baseline report/292d3b4c.28.html` | 19642 | `17c4e72af141912ffafba6771464d6a224e62cd52bd184ec265b852ea77cf69f` |
| `process baseline report/292d3b4c.29.html` | 19464 | `564a965661f79a4edd8de4873236bd2897baaab5b0dd8fc5f74bfcde34110992` |
| `process baseline report/292d3b4c.3.html` | 19653 | `a9ed55c791e3074120e706cdacb778e34d6133c3ef0d0ba1873a2aee1a169d9a` |
| `process baseline report/292d3b4c.30.html` | 18764 | `54c20a21c7818945a1db07be9055bb23c2922e636345c6e311d5ce4f0ebff5bf` |
| `process baseline report/292d3b4c.31.html` | 18771 | `1347cb0d5a8e25342340cbdfb52126b267173772daa2ced1416c5ccdaff7832c` |
| `process baseline report/292d3b4c.32.html` | 19290 | `6cfa854e5e21ff899cd722afa510bdc6d909593703de1955de4846e60fab00df` |
| `process baseline report/292d3b4c.33.html` | 19477 | `998b1c08bbcded54f3c1392a74410f61da2df34804741973c5c55905f63db9e1` |
| `process baseline report/292d3b4c.34.html` | 19127 | `4681e4b38a6b77a651be51fa7237631570a2a63e4b65f948f9972e47b21182f8` |
| `process baseline report/292d3b4c.35.html` | 19473 | `6dce0a9d23b4c71f6df97cde850b8e07b824896309f57598b3310afaf1c7154a` |
| `process baseline report/292d3b4c.36.html` | 18757 | `c472ab0639577f0fd8d7fc1c6b4a8bc9557233619f588135088fd98a689d35c8` |
| `process baseline report/292d3b4c.37.html` | 18764 | `3a6c1015ea8a06d2d7c654f49d6c46e30a5382a3e039449f4d9f409f1600596b` |
| `process baseline report/292d3b4c.38.html` | 18761 | `aaa526b7123de30362fbd98ec0cc8ab4dacd875d3a580a8fa7722d96e407f07d` |
| `process baseline report/292d3b4c.39.html` | 18939 | `c55ce48a071ec465b776a1684e6cb5630dc837bf631a26a8b63cbf8ee76debff` |
| `process baseline report/292d3b4c.4.html` | 19657 | `ea5b5fa97115c96f10860556f5a906a42e586d57fe9d14b89f98937d0a81bff8` |
| `process baseline report/292d3b4c.40.html` | 19618 | `3eda1fae867afeb4b179490ac5d96bc3073ff829b743308b2f9ec1b14d8006eb` |
| `process baseline report/292d3b4c.41.html` | 19267 | `19c1e495e33f15ee142d6db1aba5601d4e4b12778b441c37c554bd81c1241dbe` |
| `process baseline report/292d3b4c.42.html` | 18753 | `13bc69471c27d8ceb6f23e2bffb608946cc755cb1d00b677bbff44b61d87a1e3` |
| `process baseline report/292d3b4c.43.html` | 18752 | `e6db60e24df27b3a128834cf64952639ae089d07eff8114535b54700e465a455` |
| `process baseline report/292d3b4c.44.html` | 19278 | `6a394f1a7b2ebca8dee10cfff7570e6c7463cd8eee3ac08c55a7f52d3c109e24` |
| `process baseline report/292d3b4c.45.html` | 18763 | `139157b666b8058ef3538b4307111d6773543b2ca3ca6294548d270921505c2d` |
| `process baseline report/292d3b4c.46.html` | 19290 | `de017fd9427292212af4eb120098fa4a5630f38057e9f5d9e7ca6159c4a62c5d` |
| `process baseline report/292d3b4c.47.html` | 19109 | `1b90ad13eaea2bd5500e8b5bcc2bf8230bd671b1485c398ea2f61da85bff084e` |
| `process baseline report/292d3b4c.48.html` | 19445 | `bac6997b2833ec2b544de07045d888983594e39e1a4383d83c3b76a4327e59a4` |
| `process baseline report/292d3b4c.49.html` | 19463 | `0ae7ae0bc466a38372399d7d4e86f342c66dfe161c2f51d3d2da5921792e1d81` |
| `process baseline report/292d3b4c.5.html` | 18762 | `95828de3e6f9c4f35ee526b558763273c065014b3d5c5a7e1a52defa64ba1530` |
| `process baseline report/292d3b4c.50.html` | 19266 | `11ec36c296339d9c2d7d71f69abe608dc5829cd1b9a1ebfd9fab2035d5dec48d` |
| `process baseline report/292d3b4c.6.html` | 18586 | `33e59fe2c92a4307b5dac716e95fb8c6205163de0ab4d4631a3b0a8ec2c01c20` |
| `process baseline report/292d3b4c.7.html` | 18780 | `5844f9ccc33d769c8784075fab320945c25ad2c3f99fda63b9f2c8082ee8c66b` |
| `process baseline report/292d3b4c.8.html` | 18956 | `e0ba53eed91a3c3f1ac269a22d427d25420332b03745a3d8a2d7d2bb1007f01f` |
| `process baseline report/292d3b4c.9.html` | 19132 | `8477bea7fb0385394c4a07a190db933742e91d237176da43f94d41b55d91eec7` |
| `process baseline report/Rpt10be1bc1.html` | 511 | `41b77cea9b54efaedd52341a6da9fffccba0cb958a8af8ee5abbf270dfb4dec2` |
| `process baseline report/Rpt28f554ac.html` | 509 | `2d18520ff1fef4d93baea8fdc7a698dc8d5436c7c11f627178647302b9a2bb39` |
| `sett1.png` | 43182 | `defdff648a88cb7dae1f64b2adb239366d7ca6e69c3b0de6efb94051fad0c2b0` |
| `sett2.png` | 37187 | `e8e99a03669eb515ac119df69c3a3c8b347d6e5ebd1488d72e0667b6f934765f` |
| `sett3.png` | 20526 | `1580b13f80a8c869c4580d4651ca2351bd79ec1c0f66157ca3997bf216874f4d` |
| `sett4.png` | 27663 | `fb91b1df80c1fbb7195805e187261fb9a4b6a3c017dd8a04105f6b6a60984db0` |
| `sett5.png` | 21918 | `b61f5152ce1ad7ff9cf46b0ee182b644e0314c97ca421970ee38012825aa3d71` |
| `sett6.png` | 33322 | `89bec58da7421e12fd28ed0f0aaa3b9b4ecf0fdb87791e8348005bcaa08194f7` |
| `sett7.png` | 16568 | `e96146289814c2138e71584b6eeaba22bcc6b55ff90419dffdabc30e141dedf9` |

## Verdict: CASE 1

B strong pass: identity + DOF 129 + coordinates within resolution (sub-nanometre vs post-GVX) + SEUW compatible with ~1.97. Core least-squares validated for the zero-setup-error case; the dataset-A gap is reclassified as setup-error stochastic (Model B stays HYPOTHESIS).

## Cross-dataset conclusion + Dataset A0 recommendation

- Dataset A (91v/16 stations, setup 0.005/0.002): structural parity L1 (DOF 228 exact) with an open stochastic gap (Model A SEUW 2.10 vs 1.10).
- Dataset B (50v/8 stations, setup 0.000/0.000): parity L3 (DOF 129 exact, SEUW compatible, coordinates sub-nanometre vs TBC's adjusted export).
- Together: the core least-squares engine reproduces TBC when the stochastic model is fully captured (raw GVX covariance, zero setup error); the dataset-A gap is therefore isolated to setup-error stochastic modeling, and Model B (0.005/0.002 ENU-rotated) remains HYPOTHESIS until TBC's formula is sourced.
- Recommended external experiment (Dataset A0, no production change): re-adjust the original project with 0.000/0.000 setup errors, same 91 vectors/datum/scalar; prediction: Model A SEUW converges to the displayed reference factor and coordinates agree within reference resolution. No production weighting change until proven.
