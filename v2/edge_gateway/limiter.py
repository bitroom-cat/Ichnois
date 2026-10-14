"""Thread-safe Leaky-Bucket Rate Limiter for Server A Edge Gateway.

Protects against distributed denial-of-service, runaway error loops, and brute-force attacks.
"""

import threading
import time
from typing import NamedTuple


class RateCheckResult(NamedTuple):
    allowed: bool
    retry_after: int


class LeakyBucket:
    """Individual leaky token bucket."""

    def __init__(self, capacity: int, leak_rate_per_sec: float):
        self.capacity = float(capacity)
        self.leak_rate_per_sec = leak_rate_per_sec
        self.water_level = 0.0
        self.last_leak_time = time.monotonic()
        self.lock = threading.Lock()

    def add(self, amount: float = 1.0) -> RateCheckResult:
        with self.lock:
            now = time.monotonic()
            elapsed = now - self.last_leak_time
            self.last_leak_time = now

            # Leak water proportional to elapsed time
            self.water_level = max(0.0, self.water_level - (elapsed * self.leak_rate_per_sec))

            if self.water_level + amount <= self.capacity:
                self.water_level += amount
                return RateCheckResult(allowed=True, retry_after=0)

            # Calculate retry after in seconds
            overflow = (self.water_level + amount) - self.capacity
            retry_after = int(overflow / self.leak_rate_per_sec) + 1
            return RateCheckResult(allowed=False, retry_after=retry_after)


class LeakyBucketLimiter:
    """Multi-keyed leaky-bucket limiter for Client IPs and Project IDs."""

    def __init__(self, capacity: int, fill_rate_per_min: float):
        self.capacity = capacity
        self.leak_rate_per_sec = fill_rate_per_min / 60.0
        self._buckets: dict[str, LeakyBucket] = {}
        self._lock = threading.Lock()

    def check(self, key: str) -> RateCheckResult:
        """Check if request for key can be accommodated."""
        if not key:
            return RateCheckResult(allowed=True, retry_after=0)

        with self._lock:
            if key not in self._buckets:
                # Evict entries if dictionary grows too large
                if len(self._buckets) > 10000:
                    self._buckets.clear()
                self._buckets[key] = LeakyBucket(self.capacity, self.leak_rate_per_sec)
            bucket = self._buckets[key]

        return bucket.add(1.0)


# Dedicated limiters for IP and Project
edge_ip_limiter = LeakyBucketLimiter(capacity=60, fill_rate_per_min=60.0)
edge_project_limiter = LeakyBucketLimiter(capacity=120, fill_rate_per_min=120.0)
