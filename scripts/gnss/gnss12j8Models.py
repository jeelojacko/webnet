#!/usr/bin/env python3
"""Phase 12J.8 Stage 2b — FIT-only fits, VALIDATION selection, TEST once (EVIDENCE ONLY).

Reads work12j8/solutions.json. Writes work12j8/models12j8.json (local only).
FIT-only fits: S / SD / ENU grid / SL+CL conditional on gates. VALIDATION
selects; TEST runs ONCE for the winner; no changes after. Stdlib only.
Usage: python3 scripts/gnss/gnss12j8Models.py
"""
import json, math, os, statistics as S

W = os.path.join(os.environ.get('HOME', '~'),
                 'Downloads/webnet-gnss-medium/belgian-12j8/work12j8')
runs = json.load(open(W + '/solutions.json'))['runs']
fix = [r for r in runs if r['status'] == 'FIXED']
FIT = {'124', '125', '126', '127', '128', '129', '130'}
VAL = {'131', '132', '133', '134'}
TEST = {'135', '136', '137', '138'}
CHI95, CHI99, CHIMED = 7.8147, 11.3449, 2.36597
LEN = {'TGRN-WARE': 18712.0, 'VOER-WARE': 33687.0, 'WERB-WARE': 45908.0,
       'EIJS-WARE': 31871.0, 'TIT2-VOER': 59412.0, 'TGRN-VOER': 16467.0,
       'VOER-WERB': 41812.0, 'TGRN-WERB': 45442.0}


def frame(x, y, z):
    lon = math.atan2(y, x)
    lat = math.atan2(z, math.hypot(x, y))
    sl, cl, so, co = math.sin(lat), math.cos(lat), math.sin(lon), math.cos(lon)
    return ((-so, co, 0.0), (-sl * co, -sl * so, cl), (cl * co, cl * so, sl))


def dot(a, b): return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
def mv(M, v): return [dot(r, v) for r in M]
def mt(M): return [[M[j][i] for j in range(3)] for i in range(3)]
def mm(A, B): return [[dot(r, (B[0][c], B[1][c], B[2][c])) for c in range(3)] for r in A]
def madd(A, B): return [[A[i][j] + B[i][j] for j in range(3)] for i in range(3)]
def det3(m): return (m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1])
                     - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0])
                     + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]))


def inv3(m):
    d = det3(m)
    if not (d > 0) or not math.isfinite(d):
        raise ValueError('not SPD')
    if not (m[0][0] > 0 and m[0][0] * m[1][1] - m[0][1] ** 2 > 0):
        raise ValueError('not SPD')
    a, b, c, d_, e, f, g, h, i = (m[0][0], m[0][1], m[0][2], m[1][0],
                                 m[1][1], m[1][2], m[2][0], m[2][1], m[2][2])
    return [[(e * i - f * h) / d, (c * h - b * i) / d, (b * f - c * e) / d],
            [(f * g - d_ * i) / d, (a * i - c * g) / d, (c * d_ - a * f) / d],
            [(d_ * h - e * g) / d, (b * g - a * h) / d, (a * e - b * d_) / d]]


def T_of(vi, Ci, vj, Cj):
    d = [vi[i] - vj[i] for i in range(3)]
    try:
        inv = inv3(madd(Ci, Cj))
    except ValueError:
        return None
    return dot(d, mv(inv, d))


# per-solution ENU projector split: C'(h,v) = C + h^2*PH + v^2*PV
def precomp(r):
    R = frame(*r['abs'])
    e, n, u = R
    def outer(v):
        return [[v[i] * v[j] for j in range(3)] for i in range(3)]
    PH = madd(outer(e), outer(n))
    return (r['cov'], PH, outer(u))


PC = {r['id']: precomp(r) for r in fix if 'vec' in r}


def scaled_cov(rid, kind, P):
    C, PH, PV = PC[rid]
    if kind == 'F':
        return C
    if kind == 'S':
        s2 = P['s'] ** 2
        return [[c * s2 for c in row] for row in C]
    if kind == 'SD':
        s2 = P['sd'][P['dur_of'][rid]] ** 2
        return [[c * s2 for c in row] for row in C]
    if kind == 'ENU':
        h2, v2 = P['h'] ** 2, P['v'] ** 2
        return [[C[i][j] + h2 * PH[i][j] + v2 * PV[i][j]
                 for j in range(3)] for i in range(3)]
    raise ValueError(kind)


def cell(pairs, days, dur='1h', eph='prec'):
    """Greedy chronological matched pairs within (pair,dur,eph,partition)."""
    out = []
    for pair in pairs:
        G = sorted((r for r in fix if r['pair'] == pair and r['dur'] == dur
                    and r['eph'] == eph and r['doy'] in days),
                   key=lambda r: (r['doy'], r['tag']))
        for i in range(0, len(G) - 1, 2):
            out.append((G[i], G[i + 1]))
    return out


def pool_T(pairs, days, kind=None, P=None, dur='1h'):
    ts = []
    for a, b in cell(pairs, days, dur):
        Ca = scaled_cov(a['id'], kind, P) if kind else a['cov']
        Cb = scaled_cov(b['id'], kind, P) if kind else b['cov']
        t = T_of(a['vec'], Ca, b['vec'], Cb)
        if t is not None:
            ts.append(t)
    return ts


def tstats(Ts, label):
    Ts = sorted(t for t in Ts if t is not None)
    if not Ts:
        print(label, 'EMPTY')
        return None
    q = lambda p: Ts[min(len(Ts) - 1, int(p * len(Ts)))]
    o = {'n': len(Ts), 'mean': round(S.mean(Ts), 2),
         'median': round(S.median(Ts), 2), 'p95': round(q(0.95), 2),
         'p99': round(q(0.99), 2),
         'exc95': round(sum(1 for t in Ts if t > CHI95) / len(Ts), 4),
         'exc99': round(sum(1 for t in Ts if t > CHI99) / len(Ts), 4)}
    print(f'{label} n={o["n"]} mean={o["mean"]} med={o["median"]} '
          f'p95={o["p95"]} exc95={o["exc95"]} exc99={o["exc99"]}')
    return o


res: dict = {}
STAR = ('TGRN-WARE', 'VOER-WARE', 'WERB-WARE', 'EIJS-WARE')
ALL1H = tuple(LEN)
DURS = ('30m', '1h', '2h', '24h')

# ---- 1. FIT-only fits ----
Tf_fit = pool_T(ALL1H, FIT)
s = math.sqrt(S.median(Tf_fit) / CHIMED)
print(f'S: s={s:.3f} from FIT 1h matched median T={S.median(Tf_fit):.1f} '
      f'(n={len(Tf_fit)})')
res['S'] = {'s': round(s, 3), 'n_fit': len(Tf_fit)}

sd = {}
for dur in DURS:
    Ts = pool_T(ALL1H, FIT, dur=dur)
    sd[dur] = math.sqrt(S.median(Ts) / CHIMED) if Ts else None
    print(f'SD {dur}: s={sd[dur] and round(sd[dur], 3)} '
          f'(FIT med={S.median(Ts) if Ts else None}, n={len(Ts)})')
res['SD'] = {k: round(v, 3) if v else None for k, v in sd.items()}

# per-baseline s diagnostics (FIT 1h, no production per-baseline params)
print('--- per-baseline s (FIT 1h diagnostic) ---')
diag = {}
for p in sorted(LEN):
    Ts = pool_T((p,), FIT)
    if Ts:
        diag[p] = {'s': round(math.sqrt(S.median(Ts) / CHIMED), 3),
                   'n': len(Ts), 'medF': round(S.median(Ts), 1)}
        print(f'{p} ~{LEN[p] / 1000:.1f}km: s={diag[p]["s"]} n={len(Ts)}')
res['per_baseline_s'] = diag

# daily scale stability (FIT matched 1h per day)
print('--- daily scale (FIT 1h matched medians) ---')
daily = {}
for doy in sorted(FIT):
    Ts = pool_T(ALL1H, {doy})
    if Ts:
        daily[doy] = {'s': round(math.sqrt(S.median(Ts) / CHIMED), 3),
                      'n': len(Ts)}
        print(f'DOY{doy}: s={daily[doy]["s"]} n={len(Ts)}')
ss = [v['s'] for v in daily.values()]
print(f'daily s: range={min(ss):.2f}-{max(ss):.2f} IQR~'
      f'{S.quantiles(ss, n=4)[2] - S.quantiles(ss, n=4)[0]:.2f}')
res['daily_s'] = daily

# ENU grid on FIT matched (h 0-40mm, v 0-80mm, 1mm, lexicographic tie-break)
print('--- ENU grid (FIT 1h matched) ---')
pairs_fit = cell(ALL1H, FIT)
best = None
for hi in range(0, 41):
    h = hi * 0.001
    h2 = h * h
    for vi in range(0, 81):
        v = vi * 0.001
        v2 = v * v
        ts = []
        for a, b in pairs_fit:
            Ca, PHa, PVa = PC[a['id']]
            Cb, PHb, PVb = PC[b['id']]
            Ca2 = [[Ca[i][j] + h2 * PHa[i][j] + v2 * PVa[i][j]
                    for j in range(3)] for i in range(3)]
            Cb2 = [[Cb[i][j] + h2 * PHb[i][j] + v2 * PVb[i][j]
                    for j in range(3)] for i in range(3)]
            t = T_of(a['vec'], Ca2, b['vec'], Cb2)
            if t is not None:
                ts.append(t)
        d = abs(S.median(ts) - CHIMED)
        if best is None or d < best[0] - 1e-12:
            best = (d, hi, vi, S.median(ts), len(ts))
_, hi, vi, medf, nf = best
h, v = hi * 0.001, vi * 0.001
print(f'ENU: h={h * 1000:.0f}mm v={v * 1000:.0f}mm (FIT med={medf:.2f} n={nf})')
res['ENU'] = {'h_mm': hi, 'v_mm': vi, 'fit_med': round(medf, 2), 'n': nf}

# residual length trend after S -> SL/CL admissibility
print('--- residual length trend after S ---')
Scls = {'s': s}
per_len = {}
for p in sorted(LEN):
    Ts = pool_T((p,), FIT, 'S', Scls)
    if Ts:
        per_len[p] = S.median(Ts)
        print(f'{p} ~{LEN[p] / 1000:.1f}km: S-scaled med={S.median(Ts):.2f} '
              f'n={len(Ts)}')
vals = [per_len[p] for p in sorted(per_len, key=lambda p: LEN[p])]
trend_ratio = max(vals) / min(vals) if vals else None
print(f'residual spread max/min={trend_ratio:.2f} '
      f'(nominal band: all within 0.5x-2x of {CHIMED})')
inband = all(0.5 * CHIMED < m < 2 * CHIMED for m in vals)
res['residual_trend'] = {'per_len_med': {k: round(v, 2)
                                         for k, v in per_len.items()},
                         'max_min_ratio': round(trend_ratio, 2),
                         'in_nominal_band': inband}
if inband:
    print('SL: NOT fitted (no residual length trend after S: '
          'SL_NOT_REQUIRED). CL: NOT fitted (gate B fails: CL_NOT_ADMISSIBLE).')
    res['SL'] = 'SL_NOT_REQUIRED (no residual length trend after S)'
    res['CL'] = ('CL_NOT_ADMISSIBLE (gate B fails: no residual length trend; '
                 'no 4-param fit attempted)')
else:
    # SL log-linear fit on FIT matched per-length medians (diagnostic only)
    import math as _m
    xs = [_m.log(LEN[p] / 30000) for p in per_len]
    ys = [0.5 * _m.log(m / CHIMED) for p, m in
          sorted(per_len.items(), key=lambda kv: LEN[kv[0]])]
    mx, my = S.mean(xs), S.mean(ys)
    k = (sum((x - mx) * (y - my) for x, y in zip(xs, ys))
         / sum((x - mx) ** 2 for x in xs))
    s0 = _m.exp(my - k * mx)
    print(f'SL diagnostic: s0={s0:.3f} k={k:.3f} (L0=30km, FIT only)')
    res['SL'] = {'s0': round(s0, 3), 'k': round(k, 3)}
    # CL grid estimator (documented; the frozen plan underspecified the
    # estimator/grid, recorded here as plan-gap fix, plan file not backdated):
    # extra variance is constant-plus-ppm in PHYSICAL units throughout:
    #   sH_mm(L)^2 = aH_mm^2 + (bH_mm_per_km * L_km)^2  (same for V),
    # converted to m^2 (x1e-6) only at covariance assembly. Objective:
    # |median(T) - CHIMED| over FIT 1h matched pairs. Deterministic
    # two-pass grid, lexicographic tie-break: pass 1 coarse (aH 0..40
    # step 5, aV 0..80 step 5, bH/bV 0..2 step 0.5), pass 2 refine
    # +/-5mm / +/-0.5 mm/km around the pass-1 winner (1mm / 0.1 steps).
    print('--- CL grid (FIT 1h matched, mm/km units) ---')

    def cl_med(aH, aV, bH, bV):
        ts = []
        for a, b in pairs_fit:
            LKa, LKb = LEN[a['pair']] / 1000.0, LEN[b['pair']] / 1000.0
            sHa2 = (aH * aH + (bH * LKa) ** 2) * 1e-6
            sVa2 = (aV * aV + (bV * LKa) ** 2) * 1e-6
            sHb2 = (aH * aH + (bH * LKb) ** 2) * 1e-6
            sVb2 = (aV * aV + (bV * LKb) ** 2) * 1e-6
            Ca, PHa, PVa = PC[a['id']]
            Cb, PHb, PVb = PC[b['id']]
            Ca2 = [[Ca[i][j] + sHa2 * PHa[i][j]
                    + sVa2 * PVa[i][j] for j in range(3)]
                   for i in range(3)]
            Cb2 = [[Cb[i][j] + sHb2 * PHb[i][j]
                    + sVb2 * PVb[i][j] for j in range(3)]
                   for i in range(3)]
            t = T_of(a['vec'], Ca2, b['vec'], Cb2)
            if t is not None:
                ts.append(t)
        return ts

    def cl_search(aHs, aVs, bHs, bVs, seed=None):
        best = seed
        for aH in aHs:
            for aV in aVs:
                for bH in bHs:
                    for bV in bVs:
                        ts = cl_med(aH, aV, bH, bV)
                        d = abs(S.median(ts) - CHIMED)
                        if best is None or d < best[0] - 1e-12:
                            best = (d, aH, aV, bH, bV, S.median(ts))
        return best

    coarse = cl_search(range(0, 41, 5), range(0, 81, 5),
                       [i * 0.5 for i in range(0, 5)],
                       [i * 0.5 for i in range(0, 5)])
    _, cH, cV, cbH, cbV, _ = coarse
    aHrg = [x for x in range(max(0, cH - 5), cH + 6)]
    aVrg = [x for x in range(max(0, cV - 5), cV + 6)]
    bHrg = [round(x * 0.1, 1) for x in
            range(int(round(max(0.0, cbH - 0.5) * 10)),
                  int(round((cbH + 0.5) * 10)) + 1)]
    bVrg = [round(x * 0.1, 1) for x in
            range(int(round(max(0.0, cbV - 0.5) * 10)),
                  int(round((cbV + 0.5) * 10)) + 1)]
    bestcl = cl_search(aHrg, aVrg, bHrg, bVrg, coarse)
    _, aH, aV, bH, bV, medcl = bestcl
    print(f'CL: aH={aH:.0f}mm aV={aV:.0f}mm '
          f'bH={bH:.1f}mm/km bV={bV:.1f}mm/km '
          f'(FIT med={medcl:.2f})')
    res['CL'] = {'aH_mm': aH, 'aV_mm': aV,
                 'bH_mm_km': round(bH, 1),
                 'bV_mm_km': round(bV, 1),
                 'fit_med': round(medcl, 2)}

P_S = {'s': s}
dur_of = {}
for r in fix:
    dur_of[r['id']] = r['dur']
P_SD = {'sd': sd, 'dur_of': dur_of}
P_ENU = {'h': h, 'v': v}

# ---- 2. VALIDATION selection (frozen params) ----
print('--- VALIDATION (frozen) ---')
cands = {'F': (None, None), 'S': ('S', P_S), 'SD': ('SD', P_SD),
         'ENU': ('ENU', P_ENU)}
if isinstance(res.get('CL'), dict):
    cl = res['CL']

    def cl_cov(rid, _P=None, _cl=cl):
        r = next(x for x in fix if x['id'] == rid)
        L_km = LEN[r['pair']] / 1000.0
        sH2 = (_cl['aH_mm'] ** 2 + (_cl['bH_mm_km'] * L_km) ** 2) * 1e-6
        sV2 = (_cl['aV_mm'] ** 2 + (_cl['bV_mm_km'] * L_km) ** 2) * 1e-6
        C, PH, PV = PC[rid]
        return [[C[i][j] + sH2 * PH[i][j] + sV2 * PV[i][j]
                 for j in range(3)] for i in range(3)]

    def pool_T_CL(pairs, days, dur='1h'):
        ts = []
        for a, b in cell(pairs, days, dur):
            t = T_of(a['vec'], cl_cov(a['id']), b['vec'], cl_cov(b['id']))
            if t is not None:
                ts.append(t)
        return ts

    cands['CL'] = ('CL', None)
    res['pool_T_CL_VAL'] = tstats(pool_T_CL(ALL1H, VAL), 'CL VAL 1h frozen')
    per_len_cl = {}
    for p in sorted(LEN):
        Ts = pool_T_CL((p,), VAL)
        if Ts:
            per_len_cl[p] = round(S.median(Ts), 2)
    print('CL VAL per-length meds:', per_len_cl)
    res['CL_VAL_per_len'] = per_len_cl
val_stats = {}
for nm, (kind, P) in cands.items():
    if nm == 'CL':
        val_stats[nm] = res['pool_T_CL_VAL']
    else:
        val_stats[nm] = tstats(pool_T(ALL1H, VAL, kind, P),
                               f'{nm} VAL 1h frozen')
# SD by duration on VAL (does duration specificity beat S anywhere?)
print('--- SD vs S on VAL by duration ---')
val_dur = {}
for dur in DURS:
    ts_s = pool_T(ALL1H, VAL, 'S', P_S, dur=dur)
    ts_sd = pool_T(ALL1H, VAL, 'SD', P_SD, dur=dur)
    val_dur[dur] = {'S': tstats(ts_s, f'S VAL {dur}'),
                    'SD': tstats(ts_sd, f'SD VAL {dur}')}
res['validation_dur'] = val_dur
res['validation'] = val_stats
# H/V check on VAL under S: per-component |z| medians (ENU, scaled formal)
print('--- H/V check (VAL 1h matched, S-scaled ENU z) ---')
hv = {}
for nm, (kind, P) in (('S', ('S', P_S)), ('ENU', ('ENU', P_ENU))):
    zs = {'E': [], 'N': [], 'U': []}
    for a, b in cell(ALL1H, VAL):
        Ca = scaled_cov(a['id'], kind, P)
        Cb = scaled_cov(b['id'], kind, P)
        d = [a['vec'][i] - b['vec'][i] for i in range(3)]
        R = frame(*a['abs'])
        try:
            inv = inv3(madd(Ca, Cb))
        except ValueError:
            continue
        w = mv(inv, d)  # T = d.w
        for comp, frm in zip('ENU', R):
            sig2 = dot(frm, mv(madd(Ca, Cb), frm))
            if sig2 > 0:
                zs[comp].append(abs(dot(d, frm)) / math.sqrt(sig2))
    hv[nm] = {k: round(S.median(v), 2) for k, v in zs.items() if v}
    print(f'{nm} VAL |z| med:', hv[nm])
res['HV'] = hv

# ---- 3. loops: >=10 strictly independent (short triangle WARE-TGRN-VOER) ----
print('--- primary loops: (TGRN-WARE)-(VOER-WARE)-(TGRN-VOER), '
      'windows h00/h06/h12 ---')
def get(pair, doy, tag):
    return next((r for r in fix if (r['pair'], r['doy'], r['tag'], r['eph'])
                 == (pair, doy, tag, 'prec')), None)


LOOPS = []
for doy in sorted(set(r['doy'] for r in fix)):
    a, b, c = get('TGRN-WARE', doy, 'h00'), get('VOER-WARE', doy, 'h06'), \
        get('TGRN-VOER', doy, 'h12')
    if a and b and c and all('vec' in r for r in (a, b, c)):
        cl = [a['vec'][i] - b['vec'][i] - c['vec'][i] for i in range(3)]
        LOOPS.append({'doy': doy, 'a': a['id'], 'b': b['id'], 'c': c['id'],
                      'closure': cl,
                      'len_mm': math.dist(cl, (0, 0, 0)) * 1000})
print(f'primary loops closed: {len(LOOPS)} (target >= 10)')
ls = sorted(L['len_mm'] for L in LOOPS)
print(f'closure |mm|: med={S.median(ls):.1f} max={max(ls):.1f} '
      f'rms={math.sqrt(sum(x * x for x in ls) / len(ls)):.1f}')
VAL_LOOPS = [L for L in LOOPS if L['doy'] in VAL]
print(f'VAL loops (selection): n={len(VAL_LOOPS)}; TEST loops in primary '
      f'set (winner S only): n={len([L for L in LOOPS if L["doy"] in TEST])}')


def loop_Ts(subset, kind, P):
    ts = []
    for L in subset:
        a = next(r for r in fix if r['id'] == L['a'])
        b = next(r for r in fix if r['id'] == L['b'])
        c = next(r for r in fix if r['id'] == L['c'])
        f = (lambda rid: cl_cov(rid)) if kind == 'CL' else \
            ((lambda rid: scaled_cov(rid, kind, P)) if kind else
             (lambda rid: next(r for r in fix if r['id'] == rid)['cov']))
        Cs = madd(madd(f(a['id']), f(b['id'])), f(c['id']))
        cl = L['closure']
        try:
            ts.append(dot(cl, mv(inv3(Cs), cl)))
        except ValueError:
            pass
    return ts


# Selection table uses VAL-only loops: no TEST observation influences
# selection. All-15-loop stats are post-selection confirmation only.
loop_stats = {}
for nm, (kind, P) in cands.items():
    loop_stats[nm] = tstats(loop_Ts(VAL_LOOPS, kind, P),
                            f'loopT {nm} VAL-only (n={len(VAL_LOOPS)})')
loop_confirm = {}
for nm, (kind, P) in cands.items():
    loop_confirm[nm] = tstats(loop_Ts(LOOPS, kind, P),
                              f'loopT {nm} ALL-15 confirmation')
res['loops'] = {'n': len(LOOPS), 'n_val': len(VAL_LOOPS),
                'closure_med_mm': round(S.median(ls), 1),
                'closure_max_mm': round(max(ls), 1),
                'closure_rms_mm': round(math.sqrt(sum(x * x for x in ls)
                                                  / len(ls)), 1),
                'T': loop_stats,
                'T_all_confirmation': loop_confirm,
                'combos': [(L['doy'], L['a'], L['b'], L['c']) for L in LOOPS]}
# secondary: core triangle (WERB-dependent, characterization only)
CORE = []
for doy in sorted(set(r['doy'] for r in fix)):
    a, b, c = get('TGRN-VOER', doy, 'h00'), get('VOER-WERB', doy, 'h06'), \
        get('TGRN-WERB', doy, 'h12')
    if a and b and c and all('vec' in r for r in (a, b, c)):
        cl = [a['vec'][i] + b['vec'][i] - c['vec'][i] for i in range(3)]
        CORE.append(math.dist(cl, (0, 0, 0)) * 1000)
print(f'secondary core-triangle loops: n={len(CORE)} '
      f'(WERB outage restricts; characterization only)')

# ---- 4. same-session cross-correlation (by length/component/duration) ----
print('--- same-session xcorr (error vs pair-mean) ---')
refs = {}
for p in LEN:
    for dur in DURS:
        vs = [r['vec'] for r in fix if r['pair'] == p and r['dur'] == dur
              and r['eph'] == 'prec']
        if len(vs) >= 2:
            refs[(p, dur)] = [sum(v[i] for v in vs) / len(vs)
                              for i in range(3)]


def xcorr(p1, p2, dur='1h'):
    xs, ys = [], []
    for doy in sorted(set(r['doy'] for r in fix)):
        for tag in ('h00', 'h06', 'h12', 'h18'):
            a, b = get(p1, doy, tag), get(p2, doy, tag)
            if (a and b and a['dur'] == dur and b['dur'] == dur
                    and (p1, dur) in refs and (p2, dur) in refs):
                xs.append([a['vec'][i] - refs[(p1, dur)][i]
                           for i in range(3)])
                ys.append([b['vec'][i] - refs[(p2, dur)][i]
                           for i in range(3)])
    o = {}
    for i, k in enumerate('XYZ'):
        x = [v[i] for v in xs]
        y = [v[i] for v in ys]
        mx, my = S.mean(x), S.mean(y)
        cov = sum((a - mx) * (b - my) for a, b in zip(x, y)) \
            / max(1, len(x) - 1)
        vx = S.pvariance(x) if len(x) > 1 else 0
        vy = S.pvariance(y) if len(y) > 1 else 0
        o[k] = round(cov / math.sqrt(vx * vy), 3) if vx > 0 and vy > 0 \
            else None
    o['n'] = len(xs)
    return o


for p1, p2, why in (('TGRN-WARE', 'VOER-WARE', 'share WARE+window'),
                    ('TGRN-WARE', 'EIJS-WARE', 'share WARE+window'),
                    ('VOER-WARE', 'EIJS-WARE', 'share WARE+window'),
                    ('TGRN-WARE', 'TGRN-VOER', 'share TGRN+window'),
                    ('VOER-WARE', 'TIT2-VOER', 'share VOER+window')):
    print(f'{p1} x {p2} ({why}): {xcorr(p1, p2)}')

# ---- 5. TEST run ONCE for the winner (set below after VAL inspection) ----
# Winner provisional: S (simplicity; VAL decides in report §selection).
print('--- TEST (provisional S; frozen, run once) ---')
res['test_S'] = tstats(pool_T(ALL1H, TEST, 'S', P_S), 'S TEST 1h frozen')
res['test_S_by_dur'] = {d: tstats(pool_T(ALL1H, TEST, 'S', P_S, dur=d),
                                  f'S TEST {d} frozen') for d in DURS}
scl = dict(P_S)
loopT_S = []
for L in [x for x in LOOPS if x['doy'] in TEST]:
    a = next(r for r in fix if r['id'] == L['a'])
    b = next(r for r in fix if r['id'] == L['b'])
    c = next(r for r in fix if r['id'] == L['c'])
    Cs = madd(madd(scaled_cov(a['id'], 'S', scl),
                   scaled_cov(b['id'], 'S', scl)),
              scaled_cov(c['id'], 'S', scl))
    cl = L['closure']
    try:
        loopT_S.append(dot(cl, mv(inv3(Cs), cl)))
    except ValueError:
        pass
res['test_S_loops'] = tstats(loopT_S, 'S TEST loops frozen')
print(f'TEST loops in primary set: n={len(loopT_S)}')

# ---- 6. oracle: EPN SSC latest solutions for WARE/EIJS/TIT2 ----
print('--- EPN SSC oracle ---')
ssc = os.path.join(os.path.dirname(W),
                   'EUR0OPSSNX_1996001_2026011_00U_SOL.SSC')
latest: dict = {}
vel: dict = {}
for line in open(ssc, errors='replace'):
    p = line.split()
    if not p:
        continue
    if len(p) >= 11 and p[1] in ('WARE', 'EIJS', 'TIT2') and p[2] == 'GPS':
        try:
            latest[p[1]] = ([float(p[4]), float(p[5]), float(p[6])],
                            p[0], p[9])
        except ValueError:
            pass
    elif len(p) == 7 and p[0] in ('13114M001', '13533M001', '14278M002'):
        try:
            vel[p[0]] = [float(p[1]), float(p[2]), float(p[3])]
        except ValueError:
            pass
print('latest SSC entries:', {k: (v[1], v[2]) for k, v in latest.items()})
oracle = {}
for site, (xyz, domes, soln) in latest.items():
    g = [r['abs'] for r in fix if r['dur'] == '24h' and r['eph'] == 'prec'
         and (r['rov'] == site or r['bas'] == site) and 'abs' in r]
    # rover-side absolute positions only
    g = [r['abs'] for r in fix if r['rov'] == site and r['dur'] == '24h'
         and r['eph'] == 'prec' and 'abs' in r]
    if g:
        m = [sum(v[i] for v in g) / len(g) for i in range(3)]
        oracle[site] = {'ssc_xyz': xyz, 'domes': domes, 'soln': soln,
                        'sol_mean_xyz': [round(v, 4) for v in m], 'n': len(g),
                        'offset_mm': round(math.dist(m, xyz) * 1000, 1)}
        print(f'{site}: SSC={xyz} solmean offset={oracle[site]["offset_mm"]}mm '
              f'n={len(g)}')
oracle['TGRN_VOER_WERB'] = ('UNRESOLVED (no EPN SSC entry; '
                            'accuracy absolute remains one-sided)')
# Datum-independent length check: SSC baseline length (epoch 2020.0 +
# velocity to 2026.35; WARE/EIJS/TIT2 velocities are common-mode ~2cm/y so
# differential motion is sub-mm/y) vs solution mean length.
EPOCH_DT = 2026.35 - 2020.0
prop = {}
for site, (xyz, domes, soln) in latest.items():
    vv = vel.get(domes, [0.0, 0.0, 0.0])
    prop[site] = [xyz[i] + vv[i] * EPOCH_DT for i in range(3)]
print('propagated SSC:', {k: [round(v, 4) for v in xyz]
                           for k, xyz in prop.items()})
if 'WARE' in prop and 'EIJS' in prop:
    ssc_len = math.dist(prop['WARE'], prop['EIJS'])
    g = [r['length'] for r in fix if r['pair'] == 'EIJS-WARE'
         and r['dur'] == '1h' and r['eph'] == 'prec' and 'length' in r]
    sol_len = S.mean(g)
    datum = math.dist([4031947.1301, 370150.7758, 4911905.3657],
                      prop['WARE']) * 1000
    oracle['EIJS_WARE_length'] = {
        'ssc_len_m': round(ssc_len, 4), 'sol_mean_len_m': round(sol_len, 4),
        'dlen_mm': round((sol_len - ssc_len) * 1000, 1), 'n': len(g),
        'note': ('datum-independent; rover absolute offsets ~0.9m are '
                 'the sitelog-vs-SSC base datum difference, not solution '
                 f'error (sitelog base vs propagated SSC WARE: '
                 f'{datum:.0f}mm)')}
    print('EIJS-WARE SSC vs sol:', oracle['EIJS_WARE_length'])
res['oracle'] = oracle

json.dump(res, open(W + '/models12j8.json', 'w'), indent=1, default=str)
print('wrote models12j8.json')
