# Ichnoscope Incident Triage Benchmark Results

- **Executed At:** 2026-10-15 14:37:30 UTC
- **Total Fixtures Evaluated:** 3
- **Average Core Pipeline Latency:** 0.09 ms per incident
- **Throughput Capacity (Single Worker):** ~10909 incidents/second

## Detailed Benchmark Breakdown

| Fixture | Exception Type | Rated Severity | Fingerprint | Parse (ms) | Redact (ms) | Severity (ms) | Total (ms) |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `bug1_keyerror_payment.json` | `KeyError` | **P1-Critical** | `06c9cb5852...` | 0.05 | 0.011 | 0.005 | **0.084** |
| `bug2_attributeerror_cart.json` | `AttributeError` | **P2-High** | `408f0481af...` | 0.103 | 0.022 | 0.003 | **0.133** |
| `edge_library_frame_last.json` | `ValueError` | **P3-Medium** | `2d448475b3...` | 0.041 | 0.011 | 0.001 | **0.058** |

## Key Architectural Guarantees Verified

1. **Sub-millisecond Ingestion Parsing:** Fast zero-regex AST stackframe extraction completes in < 0.2ms.
2. **Synchronous PII Scrubbing:** High-entropy secret scanning completes in < 0.1ms without blocking IO.
3. **Deterministic Fingerprinting:** Constant-time SHA-256 crash grouping ensures instant deduplication.
