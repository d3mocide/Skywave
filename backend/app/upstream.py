"""Fetch-through-cache for upstream sources.

The pattern for every endpoint is identical: serve fresh cache if present,
otherwise fetch upstream and cache; if the upstream fails and we hold stale
data, serve it marked stale instead of erroring (DESIGN.md §9).
"""

import asyncio
import logging
import time
from typing import Any, Awaitable, Callable

import httpx
from fastapi import HTTPException

from . import config
from .cache import Cache

log = logging.getLogger("skywave.upstream")

# Per-key locks so a cache miss triggers one upstream fetch, not one per
# concurrent client.
_locks: dict[str, asyncio.Lock] = {}


def _lock(key: str) -> asyncio.Lock:
    if key not in _locks:
        _locks[key] = asyncio.Lock()
    return _locks[key]


async def fetch_cached(
    cache: Cache,
    key: str,
    ttl: int,
    fetch: Callable[[httpx.AsyncClient], Awaitable[Any]],
) -> dict:
    """Returns {"data": ..., "fetched_at": ..., "stale": bool}."""
    hit = await cache.get(key)
    if hit is not None and hit[2]:
        data, fetched_at, _ = hit
        return {"data": data, "fetched_at": fetched_at, "stale": False}

    async with _lock(key):
        # Re-check: another request may have refreshed while we waited.
        hit = await cache.get(key)
        if hit is not None and hit[2]:
            data, fetched_at, _ = hit
            return {"data": data, "fetched_at": fetched_at, "stale": False}

        try:
            async with httpx.AsyncClient(
                timeout=config.UPSTREAM_TIMEOUT, follow_redirects=True
            ) as client:
                data = await fetch(client)
        except Exception as exc:
            log.warning("upstream fetch failed for %s: %s", key, exc)
            if hit is not None:
                data, fetched_at, _ = hit
                return {"data": data, "fetched_at": fetched_at, "stale": True}
            raise HTTPException(
                status_code=502, detail=f"upstream unavailable and no cached data for {key}"
            )

        await cache.put(key, data, ttl)
        return {"data": data, "fetched_at": time.time(), "stale": False}


# ── Source-specific fetchers ────────────────────────────────────────────────


async def fetch_space_weather(client: httpx.AsyncClient) -> dict:
    """Aggregate NOAA SWPC: 10.7cm flux (SFI), planetary K index, sunspot
    number series, GOES X-ray flux. Fetched concurrently; a sub-source
    failure nulls that field rather than failing the aggregate."""

    async def get_json(path: str) -> Any:
        r = await client.get(f"{config.SWPC_BASE}{path}")
        r.raise_for_status()
        return r.json()

    async def safe(coro: Awaitable[Any]) -> Any:
        try:
            return await coro
        except Exception as exc:
            log.warning("SWPC sub-source failed: %s", exc)
            return None

    f107, kp, ssn, xray = await asyncio.gather(
        safe(get_json("/products/summary/10cm-flux.json")),
        safe(get_json("/products/noaa-planetary-k-index.json")),
        safe(get_json("/json/solar-cycle/observed-solar-cycle-indices.json")),
        safe(get_json("/json/goes/primary/xray-flares-latest.json")),
    )

    # All four down means SWPC (or our route to it) is out — treat as a
    # failed fetch so callers fall back to stale cached data instead of
    # caching an all-null aggregate as "fresh".
    if f107 is None and kp is None and ssn is None and xray is None:
        raise RuntimeError("all SWPC sub-sources failed")

    # Format f107 to match the frontend expectations:
    # frontend/src/lib/api.ts: sfi: { Flux: string; TimeStamp: string } | null;
    sfi_data = None
    if f107:
        if isinstance(f107, list) and len(f107) > 0:
            item = f107[0]
            if isinstance(item, dict):
                flux_val = item.get("flux") or item.get("Flux")
                time_val = item.get("time_tag") or item.get("TimeStamp")
                if flux_val is not None:
                    sfi_data = {
                        "Flux": str(flux_val),
                        "TimeStamp": str(time_val) if time_val else ""
                    }
        elif isinstance(f107, dict):
            flux_val = f107.get("flux") or f107.get("Flux")
            time_val = f107.get("time_tag") or f107.get("TimeStamp")
            if flux_val is not None:
                sfi_data = {
                    "Flux": str(flux_val),
                    "TimeStamp": str(time_val) if time_val else ""
                }

    # noaa-planetary-k-index.json is parsed as a list of dicts (or fallback to header+rows)
    kp_series = None
    if kp:
        if len(kp) > 0 and isinstance(kp[0], dict):
            kp_series = [
                {"time": row.get("time_tag"), "kp": float(row.get("Kp"))}
                for row in kp
                if row.get("Kp") not in (None, "")
            ]
        elif len(kp) > 1 and isinstance(kp[0], list):
            kp_series = [
                {"time": row[0], "kp": float(row[1])}
                for row in kp[1:]
                if row[1] not in (None, "")
            ]

    # Solar cycle indices: keep the recent tail for the sparkline, expose both
    # raw ssn and smoothed ssn (SSN12). The frontend must feed *smoothed* SSN
    # into P533 (DESIGN.md §4) — surface both so it can't silently mix them.
    # Map negative values (like -1.0 missing data placeholders) to None.
    ssn_series = None
    if ssn:
        ssn_series = []
        for row in ssn[-24:]:
            raw_ssn = row.get("ssn")
            smoothed_ssn = row.get("smoothed_ssn")
            if raw_ssn is not None and raw_ssn < 0:
                raw_ssn = None
            if smoothed_ssn is not None and smoothed_ssn < 0:
                smoothed_ssn = None
            ssn_series.append({
                "time_tag": row.get("time-tag"),
                "ssn": raw_ssn,
                "smoothed_ssn": smoothed_ssn,
            })

    return {
        "sfi": sfi_data,
        "kp_series": kp_series,
        "solar_cycle": ssn_series,
        "xray_latest": xray,
    }


async def fetch_cmes(client: httpx.AsyncClient) -> Any:
    """NASA DONKI CME analyses for the trailing 30 days. Arrival estimation
    happens client-side (drag-based model) — we only relay the catalog."""
    from datetime import date, timedelta

    end = date.today()
    start = end - timedelta(days=30)
    r = await client.get(
        f"{config.DONKI_BASE}/CMEAnalysis",
        params={
            "startDate": start.isoformat(),
            "endDate": end.isoformat(),
            "mostAccurateOnly": "true",
        },
    )
    r.raise_for_status()
    return r.json()


async def fetch_fof2(client: httpx.AsyncClient) -> Any:
    """kc2g GIRO ionosonde nowcast — the real-time correction layer over the
    climatological P533 baseline."""
    r = await client.get(f"{config.KC2G_BASE}/stations.json")
    r.raise_for_status()
    return r.json()


async def fetch_tles(client: httpx.AsyncClient) -> Any:
    """Amateur radio satellite TLEs from CelesTrak, normalized to
    {name, line1, line2} records. SGP4 runs client-side (satellite.js
    consumes classic two-line elements)."""
    r = await client.get(
        f"{config.CELESTRAK_BASE}/NORAD/elements/gp.php",
        params={"GROUP": "amateur", "FORMAT": "tle"},
    )
    r.raise_for_status()
    lines = [ln.rstrip() for ln in r.text.splitlines() if ln.strip()]
    sats = []
    for i in range(0, len(lines) - 2, 3):
        name, l1, l2 = lines[i], lines[i + 1], lines[i + 2]
        if l1.startswith("1 ") and l2.startswith("2 "):
            sats.append({"name": name.strip(), "line1": l1, "line2": l2})
    return sats


async def fetch_spots(client: httpx.AsyncClient) -> Any:
    """DX spots come from our own dxspider-bridge, not an external API, but
    the cache keeps many browser tabs from hitting the bridge in lockstep."""
    r = await client.get(f"{config.DXSPIDER_BRIDGE_URL}/spots")
    r.raise_for_status()
    return r.json()
