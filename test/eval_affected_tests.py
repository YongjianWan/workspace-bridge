#!/usr/bin/env python3
"""Measure workspace-bridge affected-tests against coverage ground truth.

Ground truth: for every source file, the set of test files whose tests
executed at least one of its lines (coverage dynamic_context=test_function).
Subprocess-launched code is not traced, so ground truth is a lower bound.

Usage:
  1. In the target repo, collect coverage with per-test contexts:
       printf '[run]\nsource = <abs pkg dir>\ndynamic_context = test_function\ndata_file = <abs>/repo.cov\n' > covrc
       python -m coverage run --rcfile=covrc -m pytest -q -p no:cov tests
  2. Run `workspace-bridge audit-overview --cwd <repo>` once so the cache DB exists.
  3. python eval_affected_tests.py <repo> <repo.cov> [test_dir=tests]
"""
import collections
import json
import os
import sqlite3
import sys

import coverage


def ground_truth(repo, cov_file):
    data = coverage.Coverage(data_file=cov_file)
    data.load()
    d = data.get_data()
    gt = collections.defaultdict(set)
    for f in d.measured_files():
        rel = os.path.relpath(f, repo)
        for ctxs in (d.contexts_by_lineno(f) or {}).values():
            for ctx in ctxs:
                parts = ctx.split('.') if ctx else []
                for i in range(len(parts), 0, -1):
                    candidate = '/'.join(parts[:i]) + '.py'
                    if os.path.exists(os.path.join(repo, candidate)):
                        gt[rel].add(candidate)
                        break
    return gt


def predictions(repo):
    db = sqlite3.connect(os.path.join(repo, '.workspace-bridge', 'cache.db'))
    rows = db.execute('SELECT file, affected_tests FROM precomputed_impact')
    return {os.path.relpath(f, repo): {os.path.relpath(t['file'], repo) for t in json.loads(a or '[]')}
            for f, a in rows}


def main():
    repo, cov_file = os.path.abspath(sys.argv[1]), sys.argv[2]
    test_dir = sys.argv[3] if len(sys.argv) > 3 else 'tests'
    gt, pred = ground_truth(repo, cov_file), predictions(repo)
    is_test = lambda p: p.startswith(test_dir + '/') and os.path.basename(p).startswith('test_')
    tp = fp = fn = 0
    print(f"{'source':40} {'real':>5} {'pred':>5} {'hit':>5} {'extra':>5} {'miss':>5}")
    for src, real in sorted(gt.items(), key=lambda kv: -len(kv[1])):
        guess = {p for p in pred.get(src, set()) if is_test(p)}
        h, x, m = len(guess & real), len(guess - real), len(real - guess)
        tp, fp, fn = tp + h, fp + x, fn + m
        print(f"{src:40} {len(real):>5} {len(guess):>5} {h:>5} {x:>5} {m:>5}")
    print(f"\nmicro precision={tp / max(tp + fp, 1):.2f} recall={tp / max(tp + fn, 1):.2f}")


if __name__ == '__main__':
    main()
