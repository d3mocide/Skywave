"""Redis-backed cache for upstream responses.

Redis here is a shared cache only (DESIGN.md §2) — no user data ever lands in
it. Every entry carries the time it was fetched so the frontend can render an
honest "last updated" timestamp, and stale entries are served (flagged) when
the upstream is down rather than blanking a panel (§9: one outage should never
blank the whole dashboard).
"""

import json
import time
from typing import Any

import redis.asyncio as redis

from . import config

# Stale entries are kept around well past their TTL so an upstream outage
# degrades to last-known data instead of an empty panel.
STALE_RETENTION = 7 * 24 * 3600


class Cache:
    def __init__(self, url: str = config.REDIS_URL):
        self._redis = redis.from_url(url, decode_responses=True)

    async def get(self, key: str) -> tuple[Any, float, bool] | None:
        """Return (data, fetched_at, is_fresh) or None if absent entirely."""
        raw = await self._redis.get(f"skywave:{key}")
        if raw is None:
            return None
        entry = json.loads(raw)
        age = time.time() - entry["fetched_at"]
        return entry["data"], entry["fetched_at"], age <= entry["ttl"]

    async def put(self, key: str, data: Any, ttl: int) -> None:
        entry = {"data": data, "fetched_at": time.time(), "ttl": ttl}
        await self._redis.set(
            f"skywave:{key}", json.dumps(entry), ex=ttl + STALE_RETENTION
        )

    async def close(self) -> None:
        await self._redis.aclose()
