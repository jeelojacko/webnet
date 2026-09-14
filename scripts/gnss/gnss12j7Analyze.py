#!/usr/bin/env python3
"""Phase 12J.7 Stage 2 — medium-baseline analysis (EVIDENCE ONLY).

Reads work12j7/out/*.pos, writes solutions.json + analysis.json, prints summary.
Semantics mirror src/engine/gnssStochasticEvidence.ts: T=d'(Ci+Cj)^-1 d ~ chi2(3)
thresholds 7.815/11.345/median 2.366; engine ecefToEnuRotation (geocentric lat);
floors added in ENU then rotated back; SPD gate finite/symmetric/PD, no jitter.
Stdlib only. Usage: python3 scripts/gnss/gnss12j7Analyze.py
"""
import glob, json, math, os, statistics as S

W = os.path.join(os.environ.get('HOME', '~'), 'Downloads/webnet-gnss-medium/belgian/work12j7')
OUT = W + '/out'
BASE = {'WARE': (4031947.1301, 370150.7758, 4911905.3657),
        'TGRN': (4023470.1812, 385846.4845, 4917555.1248),
        'VOER': (4022975.3119, 402278.5823, 4916612.3104),
        'WERB': (4055527.7993, 403142.4181, 4890387.0011)}
KNOWN = {('TGRN', 'WARE'): 18712.0, ('VOER', 'WARE'): 33687.0, ('WERB', 'WARE'): 45905.0}
FIT = {'124', '125', '126'}
VAL = {'127', '128'}
CHI95, CHI99, CHIMED = 7.8147, 11.3449, 2.36597


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
def det3(m): return (m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]))


def inv3(m):
    d = det3(m)
    if not (d > 0) or not math.isfinite(d):
        raise ValueError('not SPD')
    if not (m[0][0] > 0 and m[0][0] * m[1][1] - m[0][1] ** 2 > 0):
        raise ValueError('not SPD')
    a, b, c, d_, e, f, g, h, i = m[0][0], m[0][1], m[0][2], m[1][0], m[1][1], m[1][2], m[2][0], m[2][1], m[2][2]
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


def enu_floor(C, xyz, h, v):
    R = [list(r) for r in frame(*xyz)]
    E = mm(mm(R, C), mt(R))
    E[0][0] += h * h
    E[1][1] += h * h
    E[2][2] += v * v
    return mm(mm(mt(R), E), R)


def parse_pos(p):
    n = fix = 0
    last = None
    with open(p, errors='replace') as f:
        for line in f:
            if line.startswith('%') or not line.strip():
                continue
            c = line.split()
            if len(c) < 15 or not c[0].startswith('2026'):
                continue
            n += 1
            try:
                q = int(c[5])
            except ValueError:
                continue
            if q == 1:
                fix += 1
                last = c
            elif q == 2 and last is None or (q == 2 and fix == 0):
                if last is None or (len(last) > 5 and int(last[5]) != 1):
                    last = c
    return n, fix, last


runs = []
for p in sorted(glob.glob(OUT + '/*.pos')):
    if p.endswith('_events.pos'):
        continue
    rov, bas, doy, tag, eph = os.path.basename(p)[:-4].split('-')
    n, fix, last = parse_pos(p)
    st = 'FIXED' if fix else ('FLOAT' if n else 'NODATA')
    r = {'id': f'{rov}-{bas}-{doy}-{tag}-{eph}', 'rov': rov, 'bas': bas, 'doy': doy,
         'tag': tag, 'eph': eph, 'dur': {'h': '1h', 'm': '30m', 'w': '2h', 'd': '24h'}[tag[0]],
         'pair': f'{rov}-{bas}', 'epochs': n, 'fix': fix, 'status': st}
    if last and st != 'NODATA':
        x, y, z = float(last[2]), float(last[3]), float(last[4])
        bx, by, bz = BASE[bas]
        sd = [float(last[7]), float(last[8]), float(last[9])]
        so = [float(last[10]), float(last[11]), float(last[12])]
        C = [[sd[0] ** 2, math.copysign(so[0] ** 2, so[0]), math.copysign(so[2] ** 2, so[2])],
             [math.copysign(so[0] ** 2, so[0]), sd[1] ** 2, math.copysign(so[1] ** 2, so[1])],
             [math.copysign(so[2] ** 2, so[2]), math.copysign(so[1] ** 2, so[1]), sd[2] ** 2]]
        r.update({'vec': [x - bx, y - by, z - bz], 'cov': C, 'ratio': float(last[14]),
                  'nsat': int(last[6]), 'abs': [x, y, z],
                  'length': math.dist((x, y, z), (bx, by, bz))})
    runs.append(r)
json.dump({'runs': runs}, open(W + '/solutions.json', 'w'), indent=1)

att = lambda rs: [r for r in runs if r['status'] in ('FIXED', 'FLOAT')]
fix = [r for r in runs if r['status'] == 'FIXED']
print(f'runs={len(runs)} attempted=210 fixed={len(fix)} float={len(runs) - len(fix) - sum(1 for r in runs if r["status"] == "NODATA")}')
by_dur = {}
for d in ('30m', '1h', '2h', '24h'):
    g = [r for r in runs if r['dur'] == d]
    f = [r for r in g if r['status'] == 'FIXED']
    print(f'  {d}: attempted={len(g)} fixed={len(f)} float={len(g) - len(f)}')
    by_dur[d] = (len(g), len(f))

# references: per (pair,dur,eph) FIXED mean (all days)
ref = {}
for r in fix:
    ref.setdefault((r['pair'], r['dur'], r['eph']), []).append(r['vec'])
ref = {k: [sum(v[i] for v in vs) / len(vs) for i in range(3)] for k, vs in ref.items() if len(vs) >= 2}

# 1. repeatability per baseline/duration (prec)
print('--- repeatability (prec, FIXED) ---')
rep = {}
for (pair, dur, eph), m in sorted(ref.items()):
    if eph != 'prec':
        continue
    g = [r for r in fix if (r['pair'], r['dur'], r['eph']) == (pair, dur, eph)]
    R = frame(*[sum(r['abs'][i] for r in g) / len(g) for i in range(3)])
    es, fo = {k: [] for k in 'ENU'}, {k: [] for k in 'ENU'}
    for r in g:
        e, nn, u = R
        for comp, frm in (('E', e), ('N', nn), ('U', u)):
            dd = [r['vec'][i] - m[i] for i in range(3)]
            es[comp].append(dot(dd, frm))
            vv = dot(frm, mv(r['cov'], frm))
            fo[comp].append(math.sqrt(vv) if vv > 0 else float('nan'))
    out = {}
    for k in 'ENU':
        sd = S.pstdev(es[k]) * 1000 if len(es[k]) > 1 else 0.0
        fm = S.median([v for v in fo[k] if v == v]) * 1000
        out[k] = {'obs_mm': round(sd, 2), 'formal_mm': round(fm, 2),
                  'ratio': round(sd / fm, 2) if fm > 0 else None}
    rms3 = math.sqrt(sum((S.pstdev([r['vec'][i] - m[i] for r in g]) if len(g) > 1 else 0) ** 2 for i in range(3))) * 1000
    out['rms3d_mm'] = round(rms3, 2)
    out['n'] = len(g)
    ln = S.mean([r['length'] for r in g])
    out['meanlen_m'] = round(ln, 4)
    rep[f'{pair}/{dur}'] = out
    print(f'{pair}/{dur} n={len(g)} ' + ' '.join(f'{k}:{out[k]["obs_mm"]}/{out[k]["formal_mm"]}mm' for k in 'ENU') + f' rms3d={rms3:.1f}mm len={ln:.3f}m')


def tstats(Ts, label):
    Ts = sorted(t for t in Ts if t is not None)
    if not Ts:
        print(label, 'EMPTY')
        return None
    q = lambda p: Ts[min(len(Ts) - 1, int(p * len(Ts)))]
    o = {'n': len(Ts), 'mean': round(S.mean(Ts), 2), 'median': round(S.median(Ts), 2),
         'p95': round(q(0.95), 2), 'p99': round(q(0.99), 2),
         'exc95': round(sum(1 for t in Ts if t > CHI95) / len(Ts), 4),
         'exc99': round(sum(1 for t in Ts if t > CHI99) / len(Ts), 4)}
    print(f'{label} n={o["n"]} mean={o["mean"]} med={o["median"]} p95={o["p95"]} p99={o["p99"]} exc95={o["exc95"]} exc99={o["exc99"]}')
    return o


# 2. T per duration class, by length, FIT/VAL (prec, FIXED, within-pair).
# PRIMARY pools are MATCHED PAIRS: greedy chronological pairing within each
# (pair,dur,eph[,split]) cell — sort by (doy,tag), pair adjacent solutions.
# Each solution appears in AT MOST ONE contrast per pool (matched pairs:
# within-baseline no-reuse; cross-baseline sessions share anchor obs —
# correlated, characterization only).
# ALL-PAIRS contrasts are kept ONLY as a pseudoreplicated diagnostic appendix
# (each solution reused many times; n inflated) and MUST NOT be cited as evidence.
print('--- T pools (prec FIXED, within-pair, matched) ---')
T = {}
Tp = {}
Mp = {}
def matched_T(group):
    g = sorted(group, key=lambda r: (r['doy'], r['tag']))
    return [T_of(g[i]['vec'], g[i]['cov'], g[i + 1]['vec'], g[i + 1]['cov'])
            for i in range(0, len(g) - 1, 2)]
for (pair, dur, eph), m in ref.items():
    if eph != 'prec':
        continue
    g = [r for r in fix if (r['pair'], r['dur'], r['eph']) == (pair, dur, eph)]
    Tp[(pair, dur)] = [T_of(a['vec'], a['cov'], b['vec'], b['cov'])
                       for i, a in enumerate(g) for b in g[i + 1:]]
    Mp[(pair, dur)] = matched_T(g)
for dur in ('30m', '1h', '2h', '24h'):
    T[f'pseudo/{dur}'] = tstats([t for (p, d), ts in Tp.items() if d == dur for t in ts],
                                f'T-pseudo {dur} all (PSEUDOREPLICATED appendix, do not cite)')
    pool = [t for (p, d), ts in Mp.items() if d == dur for t in ts]
    T[dur] = tstats(pool, f'T {dur} matched')
for pair in ('TGRN-WARE', 'VOER-WARE', 'WERB-WARE', 'TGRN-VOER', 'VOER-WERB', 'TGRN-WERB'):
    T[f'pseudo/1h/{pair}'] = tstats([t for (p, d), ts in Tp.items() if p == pair and d == '1h' for t in ts],
                                    f'T-pseudo 1h {pair} (PSEUDOREPLICATED appendix)')
    pool = [t for (p, d), ts in Mp.items() if p == pair and d == '1h' for t in ts]
    T[f'1h/{pair}'] = tstats(pool, f'T 1h {pair} matched')
for split, days in (('FIT', FIT), ('VAL', VAL)):
    pool = []
    for (pair, dur) in Mp:
        if dur != '1h' or not pair.endswith('WARE'):
            continue
        g = [r for r in fix if r['pair'] == pair and r['dur'] == '1h' and r['eph'] == 'prec' and r['doy'] in days]
        pool += matched_T(g)  # matched WITHIN split cell: FIT 12->6/baseline (18), VAL 8->4 (12)
    T[f'1hSTAR/{split}'] = tstats(pool, f'T 1h STAR {split} matched')
brdc = []
for pair in ('TGRN-WARE', 'VOER-WARE', 'WERB-WARE'):
    for tag in ('h00', 'h12'):
        a = next((r for r in fix if r['pair'] == pair and r['tag'] == tag and r['eph'] == 'prec'), None)
        b = next((r for r in fix if r['pair'] == pair and r['tag'] == tag and r['eph'] == 'brdc'), None)
print('--- broadcast comparison (same window prec-vs-brdc T + length delta) ---')
for (pair, doy, tag) in [(p, d, t) for p in ('TGRN-WARE', 'VOER-WARE', 'WERB-WARE') for d in ('124', '125', '126', '127', '128') for t in ('h00', 'h12')]:
    a = next((r for r in fix if (r['pair'], r['doy'], r['tag'], r['eph']) == (pair, doy, tag, 'prec')), None)
    b = [r for r in runs if (r['pair'], r['doy'], r['tag'], r['eph']) == (pair, doy, tag, 'brdc') and r['status'] in ('FIXED', 'FLOAT')]
    b = b[0] if b else None
    if a and b and 'vec' in b:
        t = T_of(a['vec'], a['cov'], b['vec'], b['cov'])
        dl = (b['length'] - a['length']) * 1000
        brdc.append({'pair': pair, 't': t, 'dlen_mm': dl, 'brdc_status': b['status']})
ts = [x['t'] for x in brdc if x['t'] is not None]
tstats(ts, 'brdc-vs-prec T')
print(f'brdc dlen mm: mean={S.mean(x["dlen_mm"] for x in brdc):.1f} maxabs={max(abs(x["dlen_mm"]) for x in brdc):.1f} n={len(brdc)}')

# 3b. length dependence: raw observed/formal ratios FIRST, then constant vs constant+ppm fit
print('--- length dependence (STAR 1h prec: observed scatter vs formal, then fit) ---')
LENPTS = []
for pair, L in (('TGRN-WARE', 18712.0), ('VOER-WARE', 33688.0), ('WERB-WARE', 45908.0)):
    o = rep[f'{pair}/1h']
    h_obs = math.sqrt((o['E']['obs_mm'] ** 2 + o['N']['obs_mm'] ** 2) / 2)
    h_fm = math.sqrt((o['E']['formal_mm'] ** 2 + o['N']['formal_mm'] ** 2) / 2)
    LENPTS.append((L, h_obs, h_fm, o['U']['obs_mm'], o['U']['formal_mm']))
    print(f'L={L:.0f}m H:obs={h_obs:.1f}mm/form={h_fm:.1f}mm V:obs={o["U"]["obs_mm"]:.1f}mm/form={o["U"]["formal_mm"]:.1f}mm')
lengthfit = {}
for nm, io, ifm in (('H', 0, 1), ('V', 2, 3)):
    xs = [(L, p[io], p[ifm]) for (L, *p) in LENPTS]
    fl = S.mean(math.sqrt(max(0, o ** 2 - f ** 2)) for _, o, f in xs)
    n = len(xs)
    sx, sy, sxx, sxy = sum(L for L, _, _ in xs), 0.0, sum(L * L for L, _, _ in xs), 0.0
    for L, o, f in xs:
        y = math.sqrt(max(0, o ** 2 - f ** 2))
        sy += y
        sxy += L * y
    b = (n * sxy - sx * sy) / (n * sxx - sx * sx)
    a = (sy - b * sx) / n
    lengthfit[nm] = {'floor_mm': round(fl, 2), 'a_mm': round(a, 2), 'ppm': round(b * 1000, 3)}
    print(f'{nm}: constant-floor={fl:.2f}mm; const+ppm: a={a:.2f}mm b={b * 1000:.3f}mm/km (3pts,1dof-WEAK)')
json.dump({'repeatability': rep, 'T': T, 'brdc': brdc, 'lengthfit': lengthfit}, open(W + '/analysis.json', 'w'), indent=1)
print('wrote solutions.json + analysis.json')
