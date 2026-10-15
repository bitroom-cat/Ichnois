"""Thread-safe Leaky-Bucket Rate Limiter for Server A Edge Gateway.

Protects against distributed denial-of-service, runaway error loops, and brute-force attacks.
"""

from collections import OrderedDict
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
    """Multi-keyed leaky-bucket limiter for Client IPs and Project IDs with LRU/TTL eviction."""

    def __init__(self, capacity: int, fill_rate_per_min: float, max_entries: int = 10000):
        self.capacity = capacity
        self.leak_rate_per_sec = fill_rate_per_min / 60.0
        self.max_entries = max_entries
        self._buckets: OrderedDict[str, LeakyBucket] = OrderedDict()
        self._lock = threading.Lock()

    def _evict_stale_or_lru(self) -> None:
        """Evict stale (fully drained) buckets, or oldest LRU entries if still over capacity."""
        now = time.monotonic()
        # 1. First pass: remove fully drained buckets idle for > 60s
        stale_keys = [
            k
            for k, b in list(self._buckets.items())[:2000]
            if b.water_level <= 0.0 and (now - b.last_leak_time > 60.0)
        ]
        for k in stale_keys:
            self._buckets.pop(k, None)

        # 2. If still exceeding max_entries, pop oldest LRU items
        while len(self._buckets) >= self.max_entries:
            self._buckets.popitem(last=False)

    def check(self, key: str) -> RateCheckResult:
        """Check if request for key can be accommodated."""
        if not key:
            return RateCheckResult(allowed=True, retry_after=0)

        with self._lock:
            if key in self._buckets:
                self._buckets.move_to_end(key)
                bucket = self._buckets[key]
            else:
                if len(self._buckets) >= self.max_entries:
                    self._evict_stale_or_lru()
                bucket = LeakyBucket(self.capacity, self.leak_rate_per_sec)
                self._buckets[key] = bucket

        return bucket.add(1.0)


# Dedicated limiters for IP and Project
edge_ip_limiter = LeakyBucketLimiter(capacity=60, fill_rate_per_min=60.0)
edge_project_limiter = LeakyBucketLimiter(capacity=120, fill_rate_per_min=120.0)

