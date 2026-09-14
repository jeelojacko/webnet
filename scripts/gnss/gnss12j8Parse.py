#!/usr/bin/env python3
"""Phase 12J.8 Stage 2a — parse .pos to solutions.json + FIX-rate summary.

Clone of the gnss12j7Analyze.py parse section (no model fitting here).
Reads work12j8/out/*.pos, writes work12j8/solutions.json, prints FIX-rate
summary by baseline/length/duration/day/time + attempted/FIXED/FLOAT counts.
Stdlib only. Usage: python3 scripts/gnss/gnss12j8Parse.py
"""
import glob
import json
import math
import os

W = os.path.join(os.environ.get('HOME', '~'),
                 'Downloads/webnet-gnss-medium/belgian-12j8/work12j8')
OUT = W + '/out'
BASE = {'WARE': (4031947.1301, 370150.7758, 4911905.3657),
        'TGRN': (4023470.1812, 385846.4845, 4917555.1248),
        'VOER': (4022975.3119, 402278.5823, 4916612.3104),
        'WERB': (4055527.7993, 403142.4181, 4890387.0011),
        'EIJS': (4023086.533, 400394.875, 4916655.319),
        'TIT2': (3993787.100, 450204.200, 4936131.800)}


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
            elif q == 2 and fix == 0 and last is None:
                last = c
    return n, fix, last


runs = []
for p in sorted(glob.glob(OUT + '/*.pos')):
    if p.endswith('_events.pos'):
        continue
    rov, bas, doy, tag, eph = os.path.basename(p)[:-4].split('-')
    n, fix, last = parse_pos(p)
    st = 'FIXED' if fix else ('FLOAT' if n else 'NODATA')
    r = {'id': f'{rov}-{bas}-{doy}-{tag}-{eph}', 'rov': rov, 'bas': bas,
         'doy': doy, 'tag': tag, 'eph': eph,
         'dur': {'h': '1h', 'm': '30m', 'w': '2h', 'd': '24h'}[tag[0]],
         'pair': f'{rov}-{bas}', 'epochs': n, 'fix': fix, 'status': st}
    if last and st != 'NODATA':
        x, y, z = float(last[2]), float(last[3]), float(last[4])
        bx, by, bz = BASE[bas]
        sd = [float(last[7]), float(last[8]), float(last[9])]
        so = [float(last[10]), float(last[11]), float(last[12])]
        C = [[sd[0] ** 2, math.copysign(so[0] ** 2, so[0]),
              math.copysign(so[2] ** 2, so[2])],
             [math.copysign(so[0] ** 2, so[0]), sd[1] ** 2,
              math.copysign(so[1] ** 2, so[1])],
             [math.copysign(so[2] ** 2, so[2]),
              math.copysign(so[1] ** 2, so[1]), sd[2] ** 2]]
        r.update({'vec': [x - bx, y - by, z - bz], 'cov': C,
                  'ratio': float(last[14]), 'nsat': int(last[6]),
                  'abs': [x, y, z],
                  'length': math.dist((x, y, z), (bx, by, bz))})
    runs.append(r)
json.dump({'runs': runs}, open(W + '/solutions.json', 'w'), indent=1)

att = [r for r in runs if r['status'] in ('FIXED', 'FLOAT')]
fix = [r for r in runs if r['status'] == 'FIXED']
flo = [r for r in runs if r['status'] == 'FLOAT']
nod = [r for r in runs if r['status'] == 'NODATA']
print(f'runs={len(runs)} attempted={len(att)} '
      f'fixed={len(fix)} float={len(flo)} nodata={len(nod)}')
for d in ('30m', '1h', '2h', '24h'):
    g = [r for r in runs if r['dur'] == d]
    f = [r for r in g if r['status'] == 'FIXED']
    print(f'  {d}: attempted={len(g)} fixed={len(f)} '
          f'float={len([r for r in g if r["status"] == "FLOAT"])}')
print('--- by baseline (prec) ---')
for p in sorted({r['pair'] for r in runs}):
    g = [r for r in runs if r['pair'] == p and r['eph'] == 'prec']
    f = [r for r in g if r['status'] == 'FIXED']
    ln = (sum(r['length'] for r in f) / len(f)) if f else float('nan')
    print(f'  {p}: attempted={len(g)} fixed={len(f)} len~{ln:.0f}m')
print('--- by day (prec 1h) ---')
for d in sorted({r['doy'] for r in runs}):
    g = [r for r in runs if r['doy'] == d and r['dur'] == '1h'
         and r['eph'] == 'prec']
    f = [r for r in g if r['status'] == 'FIXED']
    print(f'  doy{d}: attempted={len(g)} fixed={len(f)}')
print('--- by window (prec 1h) ---')
for t in ('h00', 'h06', 'h12', 'h18'):
    g = [r for r in runs if r['tag'] == t and r['eph'] == 'prec']
    f = [r for r in g if r['status'] == 'FIXED']
    print(f'  {t}: attempted={len(g)} fixed={len(f)}')
print('--- broadcast ---')
for s in ('FIXED', 'FLOAT', 'NODATA'):
    g = [r for r in runs if r['eph'] == 'brdc' and r['status'] == s]
    print(f'  brdc {s}: {len(g)}')
print('wrote solutions.json')
