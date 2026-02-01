#!/usr/bin/env python3
"""Data Processing Benchmark: pandas pipeline with size scaled to RAM."""
import os
import time
import numpy as np
import pandas as pd

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

def main():
    mem_mb = read_mem_total_mb()
    if "STRESS_ROWS" in os.environ:
        n = int(os.environ["STRESS_ROWS"])
    else:
        # Target ~15% of RAM, cap at 1M rows, floor 200k rows.
        # Roughly assumes ~200 bytes/row.
        if mem_mb is None:
            n = 1_000_000
        else:
            target_mb = min(int(mem_mb * 0.15), 800)
            n = int((target_mb * 1024 * 1024) / 200)
            n = max(200_000, min(1_000_000, n))

    print(f"Data Processing Benchmark: {n:,} rows")
    np.random.seed(42)

    print("Generating data...")
    df = pd.DataFrame({
        'id': np.arange(n),
        'group': np.random.choice(['A', 'B', 'C', 'D', 'E'], n),
        'category': np.random.choice([f'cat_{i}' for i in range(20)], n),
        'value1': np.random.randn(n) * 100,
        'value2': np.random.rand(n) * 1000,
        'value3': np.random.randint(0, 10000, n),
        'timestamp': pd.date_range('2020-01-01', periods=n, freq='s'),
    })

    df2 = pd.DataFrame({
        'category': [f'cat_{i}' for i in range(20)],
        'weight': np.random.rand(20),
        'label': [f'label_{i}' for i in range(20)],
    })

    print("Starting pipeline...")
    start = time.time()

    # Step 1: Merge
    merged = df.merge(df2, on='category', how='left')

    # Step 2: Computed columns
    merged['weighted_value'] = merged['value1'] * merged['weight']
    merged['value_ratio'] = merged['value2'] / (merged['value3'] + 1)

    # Step 3: GroupBy aggregation
    grouped = merged.groupby(['group', 'category']).agg(
        mean_val1=('value1', 'mean'),
        sum_val2=('value2', 'sum'),
        max_val3=('value3', 'max'),
        mean_weighted=('weighted_value', 'mean'),
        count=('id', 'count'),
    ).reset_index()

    # Step 4: Pivot table
    pivot = merged.pivot_table(
        values='weighted_value',
        index='group',
        columns='category',
        aggfunc='mean',
    )

    # Step 5: Rolling window
    ts = merged.set_index('timestamp').sort_index()
    rolling = ts['value1'].rolling('1h').mean()

    # Step 6: Sorting
    sorted_df = merged.sort_values(['group', 'weighted_value'], ascending=[True, False])

    # Step 7: Filtering chains
    filtered = merged[
        (merged['value1'] > 0) &
        (merged['value2'] < 500) &
        (merged['group'].isin(['A', 'B']))
    ]

    elapsed = time.time() - start

    print(f"Merged shape: {merged.shape}")
    print(f"Grouped shape: {grouped.shape}")
    print(f"Pivot shape: {pivot.shape}")
    print(f"Rolling points: {len(rolling)}")
    print(f"Sorted shape: {sorted_df.shape}")
    print(f"Filtered shape: {filtered.shape}")
    print(f"Time: {elapsed:.3f}s")
    print(f"RESULT:python_data_processing:{elapsed:.4f}")

if __name__ == '__main__':
    main()
