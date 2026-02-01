#!/usr/bin/env python3
"""ML Training Benchmark: RandomForest with cross-validation."""
import time
import numpy as np
from sklearn.ensemble import RandomForestClassifier
from sklearn.model_selection import cross_val_score
from sklearn.datasets import make_classification

def main():
    print("ML Training Benchmark: 100k samples, 50 features, RF 5-fold CV")

    print("Generating dataset...")
    X, y = make_classification(
        n_samples=100_000,
        n_features=50,
        n_informative=25,
        n_redundant=10,
        n_classes=5,
        random_state=42,
    )

    clf = RandomForestClassifier(
        n_estimators=100,
        max_depth=20,
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
