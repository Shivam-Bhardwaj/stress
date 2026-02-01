#!/usr/bin/env python3
"""ML Training Benchmark: RandomForest with cross-validation."""
import argparse
import os
import time
import numpy as np
import sklearn
from sklearn.ensemble import RandomForestClassifier
from sklearn.model_selection import cross_val_score
from sklearn.datasets import make_classification

def read_mem_total_mb():
    try:
        with open("/proc/meminfo", "r", encoding="utf-8") as f:
            for line in f:
                if line.startswith("MemTotal:"):
                    parts = line.split()
                    return int(parts[1]) // 1024
    except OSError:
        return None
    return None

def print_diagnostics():
    print("=== Diagnostics ===")
    print(f"Python: {os.sys.version.split()[0]}")
    print(f"NumPy: {np.__version__}")
    print(f"scikit-learn: {sklearn.__version__}")
    print(f"CPU count: {os.cpu_count()}")
    env_keys = [
        "OMP_NUM_THREADS",
        "OPENBLAS_NUM_THREADS",
        "MKL_NUM_THREADS",
        "NUMEXPR_NUM_THREADS",
        "VECLIB_MAXIMUM_THREADS",
    ]
    for key in env_keys:
        if key in os.environ:
            print(f"{key}={os.environ[key]}")
    try:
        from threadpoolctl import threadpool_info
        info = threadpool_info()
        for item in info:
            print(f"threadpool: {item.get('internal_api')} {item.get('version')} threads={item.get('num_threads')}")
    except Exception:
        print("threadpoolctl: not available")
    print("===================")

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--diagnose", action="store_true", help="Print ML threading diagnostics")
    args = parser.parse_args()

    env_diag = os.environ.get("STRESS_DIAGNOSE", "0") == "1"
    if args.diagnose or env_diag:
        print_diagnostics()

    mem_mb = read_mem_total_mb()
    small_mode = os.environ.get("STRESS_SMALL", "0") == "1"
    if mem_mb is not None and mem_mb < 2048:
        small_mode = True

    if small_mode:
        n_samples = 30_000
        n_estimators = 50
        max_depth = 16
        print("ML Training Benchmark: SMALL mode")
    else:
        n_samples = 100_000
        n_estimators = 100
        max_depth = 20
        print("ML Training Benchmark: 100k samples, 50 features, RF 5-fold CV")

    print("Generating dataset...")
    X, y = make_classification(
        n_samples=n_samples,
        n_features=50,
        n_informative=25,
        n_redundant=10,
        n_classes=5,
        random_state=42,
    )

    clf = RandomForestClassifier(
        n_estimators=n_estimators,
        max_depth=max_depth,
        n_jobs=-1,
        random_state=42,
    )

    print("Starting 5-fold cross-validation...")
    start = time.time()
    scores = cross_val_score(clf, X, y, cv=5, scoring='accuracy', n_jobs=-1)
    elapsed = time.time() - start

    print(f"Accuracy: {scores.mean():.4f} (+/- {scores.std():.4f})")
    print(f"Fold scores: {[f'{s:.4f}' for s in scores]}")
    print(f"Time: {elapsed:.3f}s")
    print(f"RESULT:python_ml_training:{elapsed:.4f}")

if __name__ == '__main__':
    main()
