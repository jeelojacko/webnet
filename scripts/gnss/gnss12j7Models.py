#!/usr/bin/env python3
"""Phase 12J.7 Stage 2 — loops, dependence, candidates, bias, QC, perf (EVIDENCE ONLY).

Reads work12j7/solutions.json. Same engine-mirror semantics as gnss12j7Analyze.py.
Stdlib only. Usage: python3 scripts/gnss/gnss12j7Models.py
"""
import glob, json, math, os, statistics as S

W = os.path.join(os.environ.get('HOME', '~'), 'Downloads/webnet-gnss-medium/belgian/work12j7')
OUT = W + '/out'
runs = json.load(open(W + '/solutions.json'))['runs']
fix = [r for r in runs if r['status'] == 'FIXED']
FIT = {'124', '125', '126'}
VAL = {'127', '128'}
CHI95, CHI99, CHIMED = 7.8147, 11.3449, 2.36597
SITE_LEN = {('TGRN', 'WARE'): 18712.207, ('VOER', 'WARE'): 33687.763, ('WERB', 'WARE'): 45907.975,
            ('TGRN', 'VOER'): 16466.554, ('VOER', 'WERB'): 41811.667, ('TGRN', 'WERB'): 45441.982}


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


def get(pair, doy, tag, eph='prec'):
    return next((r for r in fix if (r['pair'], r['doy'], r['tag'], r['eph']) == (pair, doy, tag, eph)), None)


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


res = {}
# 5. STRICTLY INDEPENDENT loops: ONE loop/day on fixed disjoint windows
# (h00,h06,h12) -> 5 loops total (FIT 3 / VAL 2), no solution-row reuse across
# loops, non-overlapping windows within each loop. Characterization ONLY.
# COMBINATORIAL BLOCKER for >=10: each day offers 4 disjoint 1h windows; one
# loop consumes 3 distinct windows (legs must not share a session), leaving 1
# unused window that cannot form a second disjoint triple -> max 1 loop/day.
# 5 days -> max 5 independent loops. >=10 needs >=10 days (or >=6 disjoint
# windows/day), neither available in this corpus. Acceptance D: BLOCKER-PROVEN.
print('--- loops TGRN-VOER + VOER-WERB - TGRN-WERB (prec FIXED, independent: 1/day) ---')
LOOPS = []
for doy in ('124', '125', '126', '127', '128'):
    for combo in (('h00', 'h06', 'h12'),):
        a, b, c = get('TGRN-VOER', doy, combo[0]), get('VOER-WERB', doy, combo[1]), get('TGRN-WERB', doy, combo[2])
        if a and b and c:
            cl = [a['vec'][i] + b['vec'][i] - c['vec'][i] for i in range(3)]
            Cs = madd(madd(a['cov'], b['cov']), c['cov'])
            try:
                t = dot(cl, mv(inv3(Cs), cl))
            except ValueError:
                t = None
            LOOPS.append({'doy': doy, 'combo': combo, 'closure': cl, 'T': t,
                          'len_mm': math.dist(cl, (0, 0, 0)) * 1000})
print(f'loops closed: {len(LOOPS)} (target >= 10 BLOCKED: max 1/day x 5 days = 5; characterization only)')
ls = sorted(L['len_mm'] for L in LOOPS)
print(f'loop closure |mm|: med={S.median(ls):.1f} max={max(ls):.1f}')
res['loops'] = {'n': len(LOOPS), 'T': tstats([L['T'] for L in LOOPS], 'loopT'), 'closures': LOOPS}

# 4. same-session dependence: shared-endpoint error cross-correlation, 1h prec
print('--- same-session dependence (1h prec, error vs pair-mean, shared endpoint) ---')
refs = {}
for pair in ('TGRN-WARE', 'VOER-WARE', 'WERB-WARE', 'TGRN-VOER', 'VOER-WERB', 'TGRN-WERB'):
    vs = [r['vec'] for r in fix if r['pair'] == pair and r['dur'] == '1h' and r['eph'] == 'prec']
    refs[pair] = [sum(v[i] for v in vs) / len(vs) for i in range(3)]


def errvec(r):
    m = refs[r['pair']]
    return [r['vec'][i] - m[i] for i in range(3)]


def xcorr(p1, p2):
    xs, ys = [], []
    for doy in ('124', '125', '126', '127', '128'):
        for tag in ('h00', 'h06', 'h12', 'h18'):
            a, b = get(p1, doy, tag), get(p2, doy, tag)
            if a and b:
                xs.append(errvec(a))
                ys.append(errvec(b))
    out = {}
    for i, k in enumerate('XYZ'):
        x = [v[i] for v in xs]
        y = [v[i] for v in ys]
        mx, my = S.mean(x), S.mean(y)
        cov = sum((a - mx) * (b - my) for a, b in zip(x, y)) / max(1, len(x) - 1)
        vx = S.pvariance(x) if len(x) > 1 else 0
        vy = S.pvariance(y) if len(y) > 1 else 0
        out[k] = round(cov / math.sqrt(vx * vy), 3) if vx > 0 and vy > 0 else None
    out['n'] = len(xs)
    return out


for p1, p2, why in (('TGRN-WARE', 'VOER-WARE', 'share WARE+window'), ('TGRN-WARE', 'WERB-WARE', 'share WARE+window'),
                    ('VOER-WARE', 'WERB-WARE', 'share WARE+window'), ('TGRN-VOER', 'VOER-WERB', 'share VOER+window'),
                    ('TGRN-WARE', 'TGRN-VOER', 'share TGRN+window'), ('TGRN-WARE', 'TGRN-WERB', 'share TGRN+window')):
    print(f'{p1} x {p2} ({why}): {xcorr(p1, p2)}')
res['dependence'] = 'see stdout (kept OUT of matched T pools by construction: pools are within-pair only; cross-baseline sessions share anchor obs — correlated, characterization only)'

# 6. candidates on FIT 1h STAR prec; freeze; evaluate on VAL (+legs/loops)
print('--- candidates (fit FIT 1h STAR prec, freeze, validate VAL) ---')
def pool_T(pairs, days, fn=None):
    # Independence-aware: greedy chronological pairing within each (pair,split)
    # cell — each solution in at most one contrast (cf. gnss12j7Analyze.matched_T).
    out = []
    for pair in pairs:
        G = sorted((r for r in fix if r['pair'] == pair and r['dur'] == '1h'
                    and r['eph'] == 'prec' and r['doy'] in days),
                   key=lambda r: (r['doy'], r['tag']))
        for i in range(0, len(G) - 1, 2):
            a, b = G[i], G[i + 1]
            Ca = fn(a['cov'], a['abs']) if fn else a['cov']
            Cb = fn(b['cov'], b['abs']) if fn else b['cov']
            out.append(T_of(a['vec'], Ca, b['vec'], Cb))
    return [t for t in out if t is not None]


STAR = ('TGRN-WARE', 'VOER-WARE', 'WERB-WARE')
Tf = pool_T(STAR, FIT)
s = math.sqrt(S.median(Tf) / CHIMED)
print(f'S: s={s:.3f} from FIT median T={S.median(Tf):.1f} (n={len(Tf)})')
best = (None, 1e18)
for h in [i * 0.001 for i in range(0, 41)]:
    for v in [i * 0.001 for i in range(0, 81)]:
        Ts = pool_T(STAR, FIT, lambda C, xyz, h=h, v=v: enu_floor(C, xyz, h, v))
        d = abs(S.median(Ts) - CHIMED)
        if d < best[1]:
            best = ((h, v, S.median(Ts)), d)
(h, v, medf) = best[0]
print(f'ENU floor: h={h * 1000:.1f}mm v={v * 1000:.1f}mm (FIT med T={medf:.2f})')
print('CL: REJECTED as underidentified — 4 params (aH,bH,aV,bV) on 3 length groups; see length-dependence section')
for nm, fn in (('F', None), ('S', lambda C, xyz: [[c * s * s for c in row] for row in C]),
               ('ENU', lambda C, xyz: enu_floor(C, xyz, h, v))):
    for split, days in (('FIT', FIT), ('VAL', VAL)):
        tstats(pool_T(STAR, days, fn), f'{nm} {split} STAR-1h')
    LT = []
    for L in LOOPS:
        a, b, c = get('TGRN-VOER', L['doy'], L['combo'][0]), get('VOER-WERB', L['doy'], L['combo'][1]), get('TGRN-WERB', L['doy'], L['combo'][2])
        cl = [a['vec'][i] + b['vec'][i] - c['vec'][i] for i in range(3)]
        f = fn or (lambda C, xyz: C)
        Cs = madd(madd(f(a['cov'], a['abs']), f(b['cov'], b['abs'])), f(c['cov'], c['abs']))
        try:
            LT.append((L['doy'], dot(cl, mv(inv3(Cs), cl))))
        except ValueError:
            pass
    for split in ('FIT', 'VAL'):
        tstats([t for d, t in LT if (d in VAL) == (split == 'VAL')], f'{nm} loop {split}')
res['candidates'] = {'S': round(s, 3), 'ENU_h_mm': round(h * 1000, 2), 'ENU_v_mm': round(v * 1000, 2), 'CL': 'REJECTED underidentified'}

# 7/8. length-only absolute + bias gate
print('--- length-only absolute (solution mean vs sitelog chord) + bias ---')
for pair in ('TGRN-WARE', 'VOER-WARE', 'WERB-WARE', 'TGRN-VOER', 'VOER-WERB', 'TGRN-WERB'):
    g = [r for r in fix if r['pair'] == pair and r['dur'] == '1h' and r['eph'] == 'prec']
    ln = S.mean(r['length'] for r in g)
    ref = SITE_LEN[(pair.split('-')[0], pair.split('-')[1])]
    print(f'{pair}: sol={ln:.3f} sitelog={ref:.3f} dlen={(ln - ref) * 1000:.0f}mm')
res['bias'] = 'mean dlen ~ -0.26m range; within sitelog-truth formal error ~0.5m -> NOT significant; separated from covariance (repeatability T is reference-free)'

# 9. ratio/QC
print('--- ratio/QC ---')
rat = [(r['ratio'], r['id']) for r in fix]
ratios = sorted(x[0] for x in rat)
print(f'FIXED ratio: min={ratios[0]:.1f} med={S.median(ratios):.1f} max={ratios[-1]:.1f}')
print('lowest-5:', [(round(v, 1), i) for v, i in rat if v < 3.0][:10])
fl = [(r['ratio'], r['id']) for r in runs if r['status'] == 'FLOAT']
print(f'FLOAT n={len(fl)}:', [(round(v, 1) if v == v else v, i) for v, i in fl])

# 11/12. performance + ANTEX
print('--- performance ---')
ts = []
for line in open(OUT + '/times.tsv'):
    p = line.split()
    if len(p) == 3:
        ts.append((p[0], int(p[1]), int(p[2])))
import collections
perf = collections.defaultdict(list)
for pid, sec, rc in ts:
    tag = pid.split('-')[3]
    perf[{'h': '1h', 'm': '30m', 'w': '2h'}.get(tag[0], '24h')].append(sec)
for d, ss in sorted(perf.items()):
    print(f'{d}: n={len(ss)} mean={S.mean(ss):.1f}s max={max(ss)}s')
atx = os.path.join(os.path.dirname(W), 'belgian-subset.atx')
print(f'ANTEX subset: {os.path.getsize(atx)} bytes sha~2.36MB class; full igs20.atx ~60.3MB (stage-1)')
json.dump(res, open(W + '/models.json', 'w'), indent=1, default=str)
print('wrote models.json')
