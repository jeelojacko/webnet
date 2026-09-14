#!/usr/bin/env python3
"""Phase 12J.10 — analyze the ANTEX/session matrix (EVIDENCE ONLY, stdlib).

Reads work12j10/out/*.pos, compares FULL vs SUB solution lines (byte
identity + field-level), orientation reversals, MUT falsification,
LEGACY control, SESS4 superset, and assembles the 12-session STAR matrix
plus MST/MANUAL/six-station samples. Writes work12j10/analysis.json and
prints the parity/session scorecards.
Usage: python3 scripts/gnss/gnss12j10Analyze.py
"""
import glob
import json
import math
import os

W = os.path.join(os.environ.get('HOME', '~'),
                 'Downloads/webnet-gnss-medium/belgian-12j8/work12j10')
OUT = W + '/out'


def parse_pos(p):
    epochs = []
    with open(p, errors='replace') as f:
        for line in f:
            if line.startswith('%') or not line.strip():
                continue
            c = line.split()
            if len(c) < 15 or not c[0].startswith('2026'):
                continue
            try:
                epochs.append({
                    't': f'{c[0]} {c[1]}',
                    'x': float(c[2]), 'y': float(c[3]), 'z': float(c[4]),
                    'q': int(c[5]), 'ns': int(c[6]),
                    'sd': [float(v) for v in c[7:13]],
                })
            except ValueError:
                continue
    return epochs


def summarize(ep):
    if not ep:
        return {'epochs': 0, 'status': 'FAILED'}
    fix = sum(1 for e in ep if e['q'] == 1)
    last = ep[-1]
    return {
        'epochs': len(ep),
        'fix': fix,
        'status': 'FIXED' if last['q'] == 1 else ('FLOAT' if last['q'] == 2 else 'FAILED'),
        'lastQ': last['q'],
        'lastNs': last['ns'],
        'lastXyz': [last['x'], last['y'], last['z']],
        'lastSd': last['sd'],
    }


def sol_text(p):
    with open(p, errors='replace') as f:
        return ''.join(l for l in f if not l.startswith('%') and l.strip())


def dv(a, b):
    return math.dist(a, b)


files = {os.path.basename(p)[:-4]: p for p in glob.glob(f'{OUT}/*.pos')}
pairs, identical, mismatch = 0, 0, []
field_diffs = []
for name, p in sorted(files.items()):
    if not name.endswith('-FULL'):
        continue
    sub = name[:-5] + '-SUB'
    if sub not in files:
        mismatch.append(f'{name}: no SUB counterpart')
        continue
    pairs += 1
    ft, st = sol_text(p), sol_text(files[sub])
    if ft == st:
        identical += 1
        continue
    fe, se = parse_pos(p), parse_pos(files[sub])
    fs, ss = summarize(fe), summarize(se)
    det = {'pair': name[:-5], 'note': 'solution lines differ'}
    if fs['status'] != ss['status']:
        det['status'] = [fs['status'], ss['status']]
    if fs['epochs'] != ss['epochs']:
        det['epochs'] = [fs['epochs'], ss['epochs']]
    if fs['status'] != 'FAILED' and ss['status'] != 'FAILED':
        det['dvLastMm'] = dv(fs['lastXyz'], ss['lastXyz']) * 1000
        det['sdMaxAbs'] = max(abs(a - b) for a, b in zip(fs['lastSd'], ss['lastSd']))
    field_diffs.append(det)

print(f'FULL-vs-SUB pairs: {pairs}, byte-identical solution lines: {identical}')
for d in field_diffs:
    print('  DIFF', json.dumps(d))

# Orientation reversal (§10): WARE-TGRN rev vs TGRN-WARE fwd (SUB, h12).
# vec_fwd = fwd_rover_sol - fwd_refpos; vec_rev likewise; require sum ~ 0.
print('--- orientation reversal (SUB h12) ---')


def refpos(p):
    with open(p, errors='replace') as f:
        for line in f:
            if line.startswith('% ref pos'):
                return [float(v) for v in line.split(':')[1].split()]
    raise ValueError(f'no ref pos in {p}')


for doy in ('124', '130', '137'):
    f = files.get(f'TGRN-WARE-{doy}-h12-SUB')
    r = files.get(f'WARE-TGRN-{doy}-h12-SUB')
    if not f or not r:
        print(f'  {doy}: missing leg'); continue
    fe, re_ = summarize(parse_pos(f)), summarize(parse_pos(r))
    fr, rr = refpos(f), refpos(r)
    vf = [fe['lastXyz'][i] - fr[i] for i in range(3)]
    vr = [re_['lastXyz'][i] - rr[i] for i in range(3)]
    clos = dv([vf[i] + vr[i] for i in range(3)], [0, 0, 0]) * 1000
    print(f'  {doy}: fwd {fe["status"]} rev {re_["status"]} '
          f'vec-sum-closure={clos:.3f} mm')

# MUT falsification (§11) + LEGACY control (§12) + SESS4 (§8 extra).
print('--- falsification / legacy / superset ---')
base130 = summarize(parse_pos(files['TGRN-WARE-130-h12-SUB']))
for tag in ('MUT',):
    m = summarize(parse_pos(files[f'TGRN-WARE-130-h12-{tag}']))
    print(f"  SUB-vs-{tag}: dvLast={dv(base130['lastXyz'], m['lastXyz'])*1000:.3f} mm "
          f"status {base130['status']}->{m['status']}")
for leg in ('TGRN-WARE', 'VOER-WARE', 'WERB-WARE'):
    s = summarize(parse_pos(files[f'{leg}-130-h12-SUB']))
    g = summarize(parse_pos(files[f'{leg}-130-h12-LEGACY']))
    print(f"  SUB-vs-LEGACY {leg}: dvLast={dv(s['lastXyz'], g['lastXyz'])*1000:.3f} mm "
          f"epochs {s['epochs']}/{g['epochs']} status {s['status']}/{g['status']}")
for doy in ('124', '130', '137'):
    s = summarize(parse_pos(files[f'TGRN-WARE-{doy}-h06-SUB']))
    s4 = summarize(parse_pos(files[f'TGRN-WARE-{doy}-h06-SESS4']))
    same = sol_text(files[f'TGRN-WARE-{doy}-h06-SUB']) == sol_text(files[f'TGRN-WARE-{doy}-h06-SESS4'])
    print(f'  SUB-vs-SESS4 {doy} h06: {"IDENTICAL" if same else "DIFFER"}')

# Session assembly (§§20-23): STAR/hub 3-edge sessions from SUB legs.
# Fourth station is WERB where data exist, else EIJS (objective gap cover:
# WERB-137 partial file 13:24-19:40 only; WERB-130 gap 17-20h). Missing
# legs are NODATA exclusions, never failures.
print('--- session matrix (STAR, SUB legs) ---')
SESSIONS = [
    ('124', 'h00', 'WARE', ['TGRN-WARE', 'VOER-WARE', 'WERB-WARE']),
    ('124', 'h06', 'WARE', ['TGRN-WARE', 'VOER-WARE', 'WERB-WARE']),
    ('124', 'h12', 'WARE', ['TGRN-WARE', 'VOER-WARE', 'WERB-WARE']),
    ('124', 'h18', 'WARE', ['TGRN-WARE', 'VOER-WARE', 'WERB-WARE']),
    ('130', 'h00', 'WARE', ['TGRN-WARE', 'VOER-WARE', 'WERB-WARE']),
    ('130', 'h06', 'WARE', ['TGRN-WARE', 'VOER-WARE', 'WERB-WARE']),
    ('130', 'h12', 'WARE', ['TGRN-WARE', 'VOER-WARE', 'WERB-WARE']),
    ('130', 'h18', 'WARE', ['TGRN-WARE', 'VOER-WARE', 'EIJS-WARE']),
    ('137', 'h00', 'WARE', ['TGRN-WARE', 'VOER-WARE', 'EIJS-WARE']),
    ('137', 'h06', 'WARE', ['TGRN-WARE', 'VOER-WARE', 'EIJS-WARE']),
    ('137', 'h12', 'WARE', ['TGRN-WARE', 'VOER-WARE', 'EIJS-WARE']),
    ('137', 'h18', 'WARE', ['TGRN-WARE', 'VOER-WARE', 'WERB-WARE']),
]
attempted = complete = partial = failed = nodata = 0
fix_total = float_total = fail_total = 0
for doy, win, hub, legs in SESSIONS:
    attempted += 1
    edges = []
    missing = [f'{leg}-{doy}-{win}-SUB' for leg in legs
               if f'{leg}-{doy}-{win}-SUB' not in files]
    if missing:
        nodata += 1
        print(f'  {doy} {win}: NODATA {missing}')
        continue
    for leg in legs:
        s = summarize(parse_pos(files[f'{leg}-{doy}-{win}-SUB']))
        edges.append(s)
        if s['status'] == 'FIXED':
            fix_total += 1
        elif s['status'] == 'FLOAT':
            float_total += 1
        else:
            fail_total += 1
    ok = sum(1 for e in edges if e['status'] in ('FIXED', 'FLOAT'))
    state = 'COMPLETE' if ok == 3 else ('PARTIAL' if ok > 0 else 'FAILED')
    if state == 'COMPLETE':
        complete += 1
    elif state == 'PARTIAL':
        partial += 1
    else:
        failed += 1
    print(f"  {doy} {win} hub={hub} 4th={[l.split('-')[0] for l in legs][-1]}:"
          f' {state} ' + ','.join(e['status'] for e in edges))
print(f'sessions attempted={attempted} COMPLETE={complete} PARTIAL={partial} FAILED={failed} NODATA={nodata}')
print(f'baseline jobs={fix_total+float_total+fail_total} FIXED={fix_total} FLOAT={float_total} failed={fail_total}')

out = {
    'pairs': pairs, 'identical': identical, 'mismatches': field_diffs,
    'sessions': {'attempted': attempted, 'complete': complete,
                 'partial': partial, 'failed': failed, 'nodata': nodata},
    'edges': {'fixed': fix_total, 'float': float_total, 'failed': fail_total},
}
with open(f'{W}/analysis.json', 'w') as f:
    json.dump(out, f, indent=2)
print(f'wrote {W}/analysis.json')
