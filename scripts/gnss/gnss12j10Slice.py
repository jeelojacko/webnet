#!/usr/bin/env python3
"""Phase 12J.10 — slice a RINEX OBS file to a UTC window (EVIDENCE ONLY).

Full-day Belgian files can exceed the frozen 32 MiB intake cap; sessions
stage window slices instead (headers preserved, `>` epochs filtered).
The staged slice bytes are what provenance hashes, exactly like product
intake. Stdlib only.
Usage: python3 scripts/gnss/gnss12j10Slice.py <in.rnx> <out.rnx> <startISO> <stopISO> [padMin]
"""
import datetime
import sys

src, dst, start_iso, stop_iso = sys.argv[1:5]
pad = int(sys.argv[5]) if len(sys.argv) > 5 else 10


def ms(iso):
    return datetime.datetime.fromisoformat(iso.replace('Z', '+00:00')).timestamp() * 1000


lo, hi = ms(start_iso) - pad * 60000, ms(stop_iso) + pad * 60000
with open(src, errors='replace') as f:
    lines = f.read().split('\n')

end = next(i for i, l in enumerate(lines) if 'END OF HEADER' in l)
head = lines[:end + 1]
body = lines[end + 1:]


def epoch_ms(gt):
    # '> yyyy mm dd hh mm ss.sssssss ...'
    p = gt[1:].split()
    try:
        dt = datetime.datetime(int(p[0]), int(p[1]), int(p[2]), int(p[3]),
                               int(p[4]), tzinfo=datetime.timezone.utc)
        sec = float(p[5])
        return (dt.timestamp() + sec) * 1000
    except (ValueError, IndexError):
        return None


kept, cur, take = [], [], False
for ln in body:
    if ln.startswith('>'):
        if cur and take:
            kept.extend(cur)
        m = epoch_ms(ln)
        take = m is not None and lo <= m <= hi
        cur = [ln] if take else []
    elif take:
        cur.append(ln)
if cur and take:
    kept.extend(cur)

with open(dst, 'w') as f:
    f.write('\n'.join(head + kept))
n = sum(1 for ln in kept if ln.startswith('>'))
print(f'sliced {src} -> {dst}: {n} epochs in window')
if n == 0:
    sys.exit(3)
