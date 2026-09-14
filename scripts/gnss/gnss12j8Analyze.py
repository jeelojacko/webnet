#!/usr/bin/env python3
"""Phase 12J.8 Stage 2b — FIT/VAL/TEST analysis, F baseline (EVIDENCE ONLY).

Reads work12j8/solutions.json (stage-2a matrix, committed scripts only read it).
Writes work12j8/analysis12j8.json (local only, never committed).
Semantics mirror gnss12j7Analyze.py / src/engine/gnssStochasticEvidence.ts:
T=d'(Ci+Cj)^-1 d ~ chi2(3); thresholds 7.815/11.345/median 2.366.
Stdlib only. Usage: python3 scripts/gnss/gnss12j8Analyze.py
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

# Pre-registered objective exclusions (recorded BEFORE evaluation, never moved
# for quality): WERB DOY133-136 upstream outage + WERB DOY137-138 partial
# (undersized RINEX, mostly NODATA). No day moving for GNSS quality.
WERB_OUT = {'133', '134', '135', '136'}
WERB_PARTIAL = {'137', '138'}

LEN = {'TGRN-WARE': 18712.0, 'VOER-WARE': 33687.0, 'WERB-WARE': 45908.0,
       'EIJS-WARE': 31871.0, 'TIT2-VOER': 59412.0, 'TGRN-VOER': 16467.0,
       'VOER-WERB': 41812.0, 'TGRN-WERB': 45442.0}


def frame(x, y, z):  # engine ecefToEnuRotation (geocentric latitude)
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


def matched_T(group):
    g = sorted(group, key=lambda r: (r['doy'], r['tag']))
    return [T_of(g[i]['vec'], g[i]['cov'], g[i + 1]['vec'], g[i + 1]['cov'])
            for i in range(0, len(g) - 1, 2)]


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
          f'p95={o["p95"]} p99={o["p99"]} exc95={o["exc95"]} exc99={o["exc99"]}')
    return o


out: dict = {'partitions': {'FIT': sorted(FIT), 'VAL': sorted(VAL),
                            'TEST': sorted(TEST)},
             'exclusions': {'WERB_outage_DOY133_136': 'upstream RINEX absent, '
                            'legs never scheduled (pre-registered)',
                            'WERB_partial_DOY137_138': 'undersized RINEX, '
                            'mostly NODATA (objective, pre-registered)'}}

# ---- FIX rates (by baseline / length / duration / day / time) ----
print('--- FIX rates ---')
fr = {}
for p in sorted(set(r['pair'] for r in runs)):
    g = [r for r in runs if r['pair'] == p]
    f = sum(1 for r in g if r['status'] == 'FIXED')
    fl = sum(1 for r in g if r['status'] == 'FLOAT')
    nd = sum(1 for r in g if r['status'] == 'NODATA')
    fr[p] = {'n': len(g), 'fixed': f, 'float': fl, 'nodata': nd,
             'len_m': LEN.get(p)}
    print(f'{p} L~{LEN.get(p, "?")} n={len(g)} FIXED={f} FLOAT={fl} NODATA={nd}')
for d in ('30m', '1h', '2h', '24h'):
    g = [r for r in runs if r['dur'] == d]
    print(f'  {d}: n={len(g)} fixed={sum(1 for r in g if r["status"] == "FIXED")}')
for doy in sorted(set(r['doy'] for r in runs)):
    g = [r for r in runs if r['doy'] == doy]
    print(f'  DOY{doy}: n={len(g)} fixed={sum(1 for r in g if r["status"] == "FIXED")}'
          f' nodata={sum(1 for r in g if r["status"] == "NODATA")}')
for tag in sorted(set(r['tag'] for r in runs)):
    g = [r for r in runs if r['tag'] == tag]
    print(f'  tag {tag}: n={len(g)} fixed={sum(1 for r in g if r["status"] == "FIXED")}')
out['fix_rates'] = fr

# ---- repeatability per (pair, dur), prec FIXED ----
ref = {}
for r in fix:
    if r['eph'] != 'prec':
        continue
    ref.setdefault((r['pair'], r['dur']), []).append(r['vec'])
ref = {k: [sum(v[i] for v in vs) / len(vs) for i in range(3)]
       for k, vs in ref.items() if len(vs) >= 2}
print('--- repeatability (prec, FIXED) ---')
rep = {}
for (pair, dur), m in sorted(ref.items()):
    g = [r for r in fix if (r['pair'], r['dur']) == (pair, dur)
         and r['eph'] == 'prec']
    R = frame(*[sum(r['abs'][i] for r in g) / len(g) for i in range(3)])
    es, fo = {k: [] for k in 'ENU'}, {k: [] for k in 'ENU'}
    for r in g:
        e, nn, u = R
        for comp, frm in (('E', e), ('N', nn), ('U', u)):
            dd = [r['vec'][i] - m[i] for i in range(3)]
            es[comp].append(dot(dd, frm))
            vv = dot(frm, mv(r['cov'], frm))
            fo[comp].append(math.sqrt(vv) if vv > 0 else float('nan'))
    o = {}
    for k in 'ENU':
        sd = S.pstdev(es[k]) * 1000 if len(es[k]) > 1 else 0.0
        fm = S.median([v for v in fo[k] if v == v]) * 1000
        o[k] = {'obs_mm': round(sd, 2), 'formal_mm': round(fm, 2),
                'ratio': round(sd / fm, 2) if fm > 0 else None}
    rms3 = math.sqrt(sum((S.pstdev([r['vec'][i] - m[i] for r in g])
                          if len(g) > 1 else 0) ** 2 for i in range(3))) * 1000
    o['rms3d_mm'] = round(rms3, 2)
    o['n'] = len(g)
    rep[f'{pair}/{dur}'] = o
    print(f'{pair}/{dur} n={len(g)} ' + ' '.join(
        f'{k}:{o[k]["obs_mm"]}/{o[k]["formal_mm"]}mm' for k in 'ENU')
        + f' rms3d={rms3:.1f}mm')
out['repeatability'] = rep

# ---- F baseline: T by duration x partition (matched, each solution <=1 use) ----
print('--- F baseline T (prec FIXED, matched within (pair,dur,eph,partition)) ---')
T: dict = {}
for dur in ('30m', '1h', '2h', '24h'):
    for split, days in (('FIT', FIT), ('VAL', VAL), ('TEST', TEST)):
        pool = []
        for (pair, dd) in [k for k in ref if k[1] == dur]:
            g = [r for r in fix if r['pair'] == pair and r['dur'] == dur
                 and r['eph'] == 'prec' and r['doy'] in days]
            pool += matched_T(g)
        T[f'F/{dur}/{split}'] = tstats(pool, f'F {dur} {split} matched')
    pool = []
    for (pair, dd) in [k for k in ref if k[1] == dur]:
        g = [r for r in fix if r['pair'] == pair and r['dur'] == dur
             and r['eph'] == 'prec']
        pool += matched_T(g)  # cross-partition pairing diagnostic only
    T[f'F/{dur}/ALL_guarded'] = tstats(pool, f'F {dur} ALL matched (diagnostic)')

# ---- F baseline by length (1h prec matched, pooled per length) ----
print('--- F by length (1h prec matched) ---')
for p, L in sorted(LEN.items(), key=lambda kv: kv[1]):
    pool = []
    for split in (FIT, VAL, TEST):
        g = [r for r in fix if r['pair'] == p and r['dur'] == '1h'
             and r['eph'] == 'prec' and r['doy'] in split]
        pool += matched_T(g)
    T[f'F/len/{p}'] = tstats(pool, f'F 1h {p} ~{L / 1000:.1f}km matched')
out['F_baseline'] = T

# ---- all-pairs appendix (pseudoreplicated, do not cite) ----
print('--- appendix: all-pairs (PSEUDOREPLICATED, do not cite) ---')
apx = {}
for dur in ('30m', '1h', '2h', '24h'):
    ts = []
    for (pair, dd) in [k for k in ref if k[1] == dur]:
        g = [r for r in fix if r['pair'] == pair and r['dur'] == dur
             and r['eph'] == 'prec']
        ts += [T_of(a['vec'], a['cov'], b['vec'], b['cov'])
               for i, a in enumerate(g) for b in g[i + 1:]]
    apx[dur] = tstats(ts, f'pseudo {dur} (PSEUDOREPLICATED appendix)')
out['allpairs_appendix'] = apx

# ---- length gate (§5): distinct lengths + per-length n BEFORE any ppm fit ----
print('--- length gate (BEFORE ppm fits) ---')
gate = {}
for p, L in sorted(LEN.items(), key=lambda kv: kv[1]):
    n1h = sum(1 for r in fix if r['pair'] == p and r['dur'] == '1h'
              and r['eph'] == 'prec')
    gate[p] = {'len_m': L, 'n_1h_fixed': n1h}
    print(f'{p}: L={L:.0f}m n1hFIXED={n1h}')
nlen = sum(1 for v in gate.values() if v['n_1h_fixed'] >= 10)
print(f'distinct lengths with n>=10: {nlen}')
gate['n_useful'] = nlen
gate['verdict'] = ('LEVERAGE_OK' if nlen >= 4 else 'PPM_NOT_IDENTIFIABLE')
out['length_gate'] = gate

# ---- broadcast bounded subset (same-window prec-vs-brdc) ----
print('--- broadcast bounded (same window prec-vs-brdc T + dlen) ---')
brdc = []
for r in runs:
    if r['eph'] != 'brdc' or r['status'] == 'NODATA' or 'vec' not in r:
        continue
    a = next((x for x in fix if (x['pair'], x['doy'], x['tag'], x['eph'])
              == (r['pair'], r['doy'], r['tag'], 'prec')), None)
    if a and 'vec' in a:
        t = T_of(a['vec'], a['cov'], r['vec'], r['cov'])
        brdc.append({'pair': r['pair'], 'doy': r['doy'], 'tag': r['tag'],
                     't': t, 'dlen_mm': (r['length'] - a['length']) * 1000,
                     'brdc_status': r['status']})
ts = [x['t'] for x in brdc if x['t'] is not None]
tstats(ts, 'brdc-vs-prec T')
if brdc:
    print(f'brdc dlen mm: mean={S.mean(x["dlen_mm"] for x in brdc):.1f} '
          f'maxabs={max(abs(x["dlen_mm"]) for x in brdc):.1f} n={len(brdc)}')
    print('max-abs outlier:', max(brdc, key=lambda x: abs(x['dlen_mm'])))
out['broadcast'] = brdc

# ---- formal-cov internal consistency (duration/geometry/length/epoch order) ----
print('--- formal-cov internal consistency ---')
cons = {}
for dur in ('30m', '1h', '2h', '24h'):
    g = [r['length'] for r in fix if r['dur'] == dur and r['eph'] == 'prec'
         and 'length' in r]
    tr = [math.sqrt(r['cov'][0][0] + r['cov'][1][1] + r['cov'][2][2]) * 1000
          for r in fix if r['dur'] == dur and r['eph'] == 'prec']
    cons[dur] = {'n': len(tr),
                 'formal_trace_med_mm': round(S.median(tr), 3) if tr else None}
    print(f'{dur}: n={len(tr)} formal-trace med={cons[dur]["formal_trace_med_mm"]}mm')
# epoch ordering: formal trace should shrink 30m > 1h > 2h > 24h
meds = [cons[d]['formal_trace_med_mm'] for d in ('30m', '1h', '2h', '24h')]
cons['epoch_ordering_ok'] = (meds[0] > meds[1] > meds[2] > meds[3]
                             if all(m is not None for m in meds) else False)
print('epoch ordering 30m>1h>2h>24h:', cons['epoch_ordering_ok'], meds)
out['formal_consistency'] = cons

json.dump(out, open(W + '/analysis12j8.json', 'w'), indent=1, default=str)
print('wrote analysis12j8.json')
