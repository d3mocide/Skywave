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

    f107, f107_series, kp, ssn, xray = await asyncio.gather(
        safe(get_json("/products/summary/10cm-flux.json")),
        safe(get_json("/json/f107_cm_flux.json")),
        safe(get_json("/products/noaa-planetary-k-index.json")),
        safe(get_json("/json/solar-cycle/observed-solar-cycle-indices.json")),
        safe(get_json("/json/goes/primary/xray-flares-latest.json")),
    )

    # All primary sub-sources down means SWPC (or our route to it) is out —
    # treat as a failed fetch so callers fall back to stale cached data
    # instead of caching an all-null aggregate as "fresh".
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

    # Penticton F10.7 observations (~2 months at up-to-3-per-day cadence) —
    # the trend behind the SFI stat tile. Parsed defensively: rows are dicts
    # with time_tag + flux; anything else is skipped.
    sfi_history = None
    if isinstance(f107_series, list):
        sfi_history = []
        for row in f107_series:
            if not isinstance(row, dict):
                continue
            t = row.get("time_tag")
            flux = row.get("flux")
            try:
                flux = float(flux)
            except (TypeError, ValueError):
                continue
            if t:
                sfi_history.append({"time": str(t), "flux": flux})
        sfi_history = sfi_history[-180:] or None

    # Solar cycle indices: keep enough tail to show the whole current cycle
    # (96 months ≈ all of Cycle 25 plus the preceding minimum — TABS plan
    # Phase F), expose both raw ssn and smoothed ssn (SSN12). The frontend
    # must feed *smoothed* SSN into P533 (DESIGN.md §4) — surface both so it
    # can't silently mix them. Map negative values (like -1.0 missing data
    # placeholders) to None.
    ssn_series = None
    if ssn:
        ssn_series = []
        for row in ssn[-96:]:
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
        "sfi_history": sfi_history,
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


async def fetch_solar_activity(client: httpx.AsyncClient) -> dict:
    """Sunspot active regions + whole-disk flare probabilities (NOAA SWPC).
    Regions carry heliographic lat/lon so the frontend can plot them on the
    solar disk imagery; probabilities drive the flare-risk readout."""

    async def get_json(path: str) -> Any:
        r = await client.get(f"{config.SWPC_BASE}{path}")
        r.raise_for_status()
        return r.json()

    async def safe(coro: Awaitable[Any]) -> Any:
        try:
            return await coro
        except Exception as exc:
            log.warning("SWPC solar-activity sub-source failed: %s", exc)
            return None

    regions_raw, probs = await asyncio.gather(
        safe(get_json("/json/solar_regions.json")),
        safe(get_json("/json/solar_probabilities.json")),
    )
    if regions_raw is None and probs is None:
        raise RuntimeError("all solar-activity sub-sources failed")

    regions = None
    if regions_raw:
        # The feed carries a trailing history; keep only the newest
        # observation date and only rows that are actual numbered regions.
        dates = [r.get("observed_date") for r in regions_raw if r.get("observed_date")]
        latest = max(dates) if dates else None
        regions = [
            {
                "region": r.get("region"),
                "latitude": r.get("latitude"),
                "longitude": r.get("longitude"),
                "location": r.get("location"),
                "area": r.get("area"),
                "spot_class": r.get("spot_class"),
                "number_spots": r.get("number_spots"),
                "mag_class": r.get("mag_class"),
                "c_xray_events": r.get("c_xray_events"),
                "m_xray_events": r.get("m_xray_events"),
                "x_xray_events": r.get("x_xray_events"),
                "observed_date": r.get("observed_date"),
            }
            for r in regions_raw
            if r.get("observed_date") == latest and r.get("region") is not None
        ]

    probabilities = None
    if probs:
        p = probs[0] if isinstance(probs, list) and probs else probs
        if isinstance(p, dict):
            probabilities = {
                "date": p.get("date"),
                "c_class_1_day": p.get("c_class_1_day"),
                "m_class_1_day": p.get("m_class_1_day"),
                "x_class_1_day": p.get("x_class_1_day"),
                "10mev_protons_1_day": p.get("10mev_protons_1_day"),
            }

    return {"regions": regions, "probabilities": probabilities}


# GOES X-ray range → (SWPC product, downsample bucket size, cache TTL).
# All products are 1-min cadence; the wider windows are max-downsampled so
# 3 days is ~900 points instead of 4,320 — max (not decimate) so flare
# peaks survive, since the whole point of the wide view is spotting flares.
XRAY_RANGES: dict[str, tuple[str, int, int]] = {
    "6h": ("xrays-6-hour.json", 1, config.TTL_XRAY),
    "1d": ("xrays-1-day.json", 2, config.TTL_XRAY_1D),
    "3d": ("xrays-3-day.json", 5, config.TTL_XRAY_3D),
}


def make_xray_fetcher(range_key: str) -> Callable[[httpx.AsyncClient], Awaitable[Any]]:
    """GOES X-ray flux for the given trailing window. The long band
    (0.1–0.8 nm) is what flare classes (A/B/C/M/X) and D-layer absorption
    are defined on — the short band is dropped to keep the payload small."""
    product, bucket, _ = XRAY_RANGES[range_key]

    async def fetch(client: httpx.AsyncClient) -> Any:
        r = await client.get(f"{config.SWPC_BASE}/json/goes/primary/{product}")
        r.raise_for_status()
        rows = [
            {"time": row.get("time_tag"), "flux": row.get("flux")}
            for row in r.json()
            if row.get("energy") == "0.1-0.8nm" and row.get("flux") is not None
        ]
        if bucket <= 1 or len(rows) <= 2:
            return rows
        out = []
        for i in range(0, len(rows), bucket):
            out.append(max(rows[i : i + bucket], key=lambda s: s["flux"]))
        # The newest sample is what "now" readouts key on — keep it exact.
        if out and out[-1] is not rows[-1]:
            out.append(rows[-1])
        return out

    return fetch


async def fetch_hemi_power(client: httpx.AsyncClient) -> dict:
    """OVATION hemispheric power index (GW deposited into each auroral
    zone) — the single-number aurora summary the OVATION grid can't give at
    a glance. Text product, 5-min cadence; trailing 24 h is kept."""
    r = await client.get(f"{config.SWPC_BASE}/text/aurora-nowcast-hemi-power.txt")
    r.raise_for_status()
    series = []
    for line in r.text.splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        parts = line.split()
        if len(parts) < 4:
            continue
        # Columns: Observation Forecast North South; timestamps look like
        # 2026-07-10_03:35 and power values are integer GW or "n/a".
        try:
            north = None if parts[2].lower() == "n/a" else float(parts[2])
            south = None if parts[3].lower() == "n/a" else float(parts[3])
        except ValueError:
            continue
        if north is None and south is None:
            continue
        series.append(
            {"time": parts[0].replace("_", "T") + ":00Z", "north": north, "south": south}
        )
    if not series:
        raise RuntimeError("hemispheric power product empty or unparseable")
    return {"series": series[-288:]}  # 24 h at 5-min cadence


async def fetch_solar_wind(client: httpx.AsyncClient) -> dict:
    """DSCOVR/ACE solar wind at L1: plasma (speed/density) and IMF (Bt/Bz).
    Bz south + high speed is the storm-onset signature — this is the ~1 h
    early warning the Kp index only confirms after the fact. Downsampled
    from 1-min to 5-min cadence; the latest sample is kept exact."""

    async def get_product(path: str) -> list:
        r = await client.get(f"{config.SWPC_BASE}{path}")
        r.raise_for_status()
        return r.json()

    async def safe(coro: Awaitable[Any]) -> Any:
        try:
            return await coro
        except Exception as exc:
            log.warning("solar-wind sub-source failed: %s", exc)
            return None

    plasma_raw, mag_raw = await asyncio.gather(
        safe(get_product("/json/rtsw/rtsw_wind_1m.json")),
        safe(get_product("/json/rtsw/rtsw_mag_1m.json")),
    )
    if plasma_raw is None and mag_raw is None:
        raise RuntimeError("all solar-wind sub-sources failed")

    def series(
        raw: list | None,
        dict_keys: dict[str, str],
        list_indices: dict[str, int],
    ) -> list | None:
        if not raw:
            return None

        is_dict_list = isinstance(raw[0], dict) if len(raw) > 0 else False
        if is_dict_list:
            rows = raw
        else:
            if len(raw) < 2:
                return None
            rows = raw[1:]

        out = []
        for i, row in enumerate(rows):
            if i % 5 and i != len(rows) - 1:
                continue
            try:
                if is_dict_list:
                    time_val = row.get("time_tag")
                    if time_val is None:
                        continue
                    item = {"time": time_val}
                    ok = False
                    for name, key in dict_keys.items():
                        v = row.get(key)
                        if v is None:
                            if name == "speed":
                                v = row.get("speed")
                            elif name == "density":
                                v = row.get("density")
                            elif name == "bz":
                                v = row.get("bz")
                        item[name] = float(v) if v not in (None, "") else None
                        ok = ok or item[name] is not None
                    if ok:
                        out.append(item)
                else:
                    item = {"time": row[0]}
                    ok = False
                    for name, idx in list_indices.items():
                        v = row[idx]
                        item[name] = float(v) if v not in (None, "") else None
                        ok = ok or item[name] is not None
                    if ok:
                        out.append(item)
            except (ValueError, IndexError, KeyError, TypeError):
                continue
        return out

    return {
        "plasma": series(
            plasma_raw,
            {"density": "proton_density", "speed": "proton_speed"},
            {"density": 1, "speed": 2},
        ),
        "mag": series(
            mag_raw,
            {"bz": "bz_gsm", "bt": "bt"},
            {"bz": 3, "bt": 6},
        ),
    }


async def fetch_kp_forecast(client: httpx.AsyncClient) -> Any:
    """NOAA 3-day planetary K forecast (3-hour bins, observed → estimated →
    predicted). Lets the map's time scrubber use the *forecast* Kp for the
    hour being previewed instead of freezing today's value."""
    r = await client.get(
        f"{config.SWPC_BASE}/products/noaa-planetary-k-index-forecast.json"
    )
    r.raise_for_status()
    raw = r.json()
    out = []
    if not isinstance(raw, list):
        return out

    if len(raw) > 0 and isinstance(raw[0], dict):
        for row in raw:
            try:
                time_val = row.get("time_tag")
                kp_val = row.get("kp")
                if kp_val is None:
                    kp_val = row.get("Kp")
                state_val = row.get("observed")
                if time_val is not None and kp_val is not None:
                    out.append({
                        "time": time_val,
                        "kp": float(kp_val),
                        "state": state_val if state_val is not None else "",
                    })
            except (ValueError, KeyError, TypeError):
                continue
    elif len(raw) > 1 and isinstance(raw[0], list):
        for row in raw[1:]:  # first row is the header
            try:
                out.append({
                    "time": row[0],
                    "kp": float(row[1]),
                    "state": row[2],
                })
            except (ValueError, IndexError, TypeError):
                continue
    return out


async def fetch_aurora(client: httpx.AsyncClient) -> dict:
    """OVATION Prime aurora nowcast — the real modeled oval, replacing the
    dipole approximation on the map. The full 360×181 grid is mostly zeros;
    only cells with ≥2% probability survive, cutting ~65k points to a few
    thousand."""
    r = await client.get(f"{config.SWPC_BASE}/json/ovation_aurora_latest.json")
    r.raise_for_status()
    raw = r.json()
    pts = [
        [c[0], c[1], c[2]]
        for c in raw.get("coordinates", [])
        if len(c) >= 3 and c[2] is not None and c[2] >= 2
    ]
    return {"forecast_time": raw.get("Forecast Time"), "points": pts}


# Solar disk / coronagraph imagery. Whitelist of channel → upstream URL;
# anything else 404s rather than becoming an open proxy.
SUN_IMAGE_CHANNELS: dict[str, str] = {
    # SDO latest 512px quicklooks
    "hmi": "{sdo}/assets/img/latest/latest_512_HMIIF.jpg",     # intensitygram — visible sunspots
    "mag": "{sdo}/assets/img/latest/latest_512_HMIB.jpg",      # magnetogram
    "aia304": "{sdo}/assets/img/latest/latest_512_0304.jpg",   # chromosphere — filaments/prominences
    "aia193": "{sdo}/assets/img/latest/latest_512_0193.jpg",   # corona — coronal holes
    "aia171": "{sdo}/assets/img/latest/latest_512_0171.jpg",   # quiet corona — loops
    "aia211": "{sdo}/assets/img/latest/latest_512_0211.jpg",   # active regions
    # SOHO LASCO coronagraphs — where CMEs are actually seen leaving
    "lascoc2": "{soho}/data/realtime/c2/512/latest.jpg",
    "lascoc3": "{soho}/data/realtime/c3/512/latest.jpg",
}


def make_sun_image_fetcher(channel: str) -> Callable[[httpx.AsyncClient], Awaitable[dict]]:
    """Binary image proxied as base64 inside the standard JSON cache entry —
    reuses the whole fetch/stale pipeline for the price of ~33% size."""
    url = SUN_IMAGE_CHANNELS[channel].format(
        sdo=config.SDO_BASE, soho=config.SOHO_BASE
    )

    async def fetch(client: httpx.AsyncClient) -> dict:
        import base64

        r = await client.get(url)
        r.raise_for_status()
        ctype = r.headers.get("content-type", "image/jpeg")
        if not ctype.startswith("image/"):
            raise RuntimeError(f"sun image {channel}: unexpected content-type {ctype}")
        return {
            "b64": base64.b64encode(r.content).decode("ascii"),
            "content_type": ctype,
        }

    return fetch


async def fetch_spots(client: httpx.AsyncClient) -> Any:
    """DX spots come from our own dxspider-bridge, not an external API, but
    the cache keeps many browser tabs from hitting the bridge in lockstep."""
    r = await client.get(f"{config.DXSPIDER_BRIDGE_URL}/spots")
    r.raise_for_status()
    return r.json()


SPOT_HISTORY_HOURS = (2, 6, 24)


def make_spot_history_fetcher(hours: int) -> Callable[[httpx.AsyncClient], Awaitable[Any]]:
    """Aggregated band×time-bin spot counts from the bridge's trailing
    window (the bridge owns history: its telnet connection has no gaps
    while browsers only poll when open)."""

    async def fetch(client: httpx.AsyncClient) -> Any:
        r = await client.get(
            f"{config.DXSPIDER_BRIDGE_URL}/history", params={"hours": hours}
        )
        r.raise_for_status()
        return r.json()

    return fetch


async def fetch_drap(client: httpx.AsyncClient) -> dict:
    """NOAA D-Region Absorption Prediction (D-RAP) global grid — the
    authoritative highest-affected-frequency map. Unlike the client-side
    flare model (blackout.ts) it includes polar cap absorption from proton
    events, which no amount of X-ray flux math can reproduce. Text grid:
    a row of longitudes, then `lat | v v v …` rows; sparsified to cells
    with ≥1 MHz affected, which on a quiet Sun is nothing at all."""
    r = await client.get(f"{config.SWPC_BASE}/text/drap_global_frequencies.txt")
    r.raise_for_status()
    lons: list[float] | None = None
    points: list[list[float]] = []
    max_mhz = 0.0
    valid = None
    for line in r.text.splitlines():
        s = line.strip()
        if not s:
            continue
        if s.startswith("#"):
            if "Valid" in s and ":" in s:
                valid = s.split(":", 1)[1].strip()
            continue
        if set(s) <= set("- "):
            continue  # the dashed separator under the longitude row
        if "|" in s:
            if lons is None:
                continue
            lat_part, _, vals_part = s.partition("|")
            try:
                lat = float(lat_part)
            except ValueError:
                continue
            for i, tok in enumerate(vals_part.split()):
                if i >= len(lons):
                    break
                try:
                    mhz = float(tok)
                except ValueError:
                    continue
                if mhz >= 1.0:
                    points.append([lons[i], lat, mhz])
                    if mhz > max_mhz:
                        max_mhz = mhz
        elif lons is None:
            try:
                row = [float(tok) for tok in s.split()]
            except ValueError:
                continue
            if len(row) > 10:
                lons = row
    if lons is None:
        raise RuntimeError("DRAP grid unparseable — no longitude row found")
    return {"valid": valid, "points": points, "max_mhz": max_mhz}


async def fetch_transponders(client: httpx.AsyncClient) -> list:
    """SatNOGS DB transmitter catalog, reduced to what the Satellites view
    needs: active entries with a frequency, keyed by NORAD id. Replaces the
    static table as primary source (TABS plan Phase F); the static table
    stays as the offline/outage fallback client-side."""
    r = await client.get(
        f"{config.SATNOGS_BASE}/api/transmitters/", params={"format": "json"}
    )
    r.raise_for_status()
    raw = r.json()
    if not isinstance(raw, list):
        raise RuntimeError("unexpected SatNOGS payload shape")
    out = []
    for t in raw:
        if not isinstance(t, dict):
            continue
        norad = t.get("norad_cat_id")
        status = t.get("status")
        alive = t.get("alive", True)
        if norad is None or (status is not None and status != "active") or not alive:
            continue
        if t.get("downlink_low") is None and t.get("uplink_low") is None:
            continue
        out.append({
            "norad": norad,
            "desc": t.get("description") or "",
            "mode": t.get("mode"),
            "type": t.get("type") or "",
            "uplink_low": t.get("uplink_low"),
            "uplink_high": t.get("uplink_high"),
            "downlink_low": t.get("downlink_low"),
            "downlink_high": t.get("downlink_high"),
            "invert": bool(t.get("invert")),
            "baud": t.get("baud"),
        })
    if not out:
        raise RuntimeError("SatNOGS returned no usable transmitters")
    return out


# ── Sun imagery time-lapse ─────────────────────────────────────────────────

TIMELAPSE_LOG = logging.getLogger("skywave.timelapse")


async def sun_timelapse_loop(cache: Cache) -> None:
    """Background frame collector: every interval, refresh each channel's
    image (through the same fetch_cached path /api/sun uses, so this doubles
    as keeping that cache warm) and append it to a per-channel Redis ring.
    Consecutive identical frames are skipped — upstream quicklooks update on
    their own schedule, and duplicates would waste ring slots."""
    import hashlib

    if config.SUN_TIMELAPSE_FRAMES <= 0:
        TIMELAPSE_LOG.info("time-lapse disabled (SUN_TIMELAPSE_FRAMES=0)")
        return
    last_hash: dict[str, str] = {}
    while True:
        for channel in SUN_IMAGE_CHANNELS:
            try:
                env = await fetch_cached(
                    cache, f"sun:{channel}", config.TTL_SUN_IMAGE,
                    make_sun_image_fetcher(channel),
                )
                b64 = env["data"]["b64"]
                digest = hashlib.sha256(b64.encode("ascii")).hexdigest()
                if last_hash.get(channel) == digest:
                    continue
                last_hash[channel] = digest
                import json as _json

                await cache.ring_append(
                    f"sunframes:{channel}",
                    _json.dumps({
                        "ts": int(env["fetched_at"]),
                        "b64": b64,
                        "content_type": env["data"]["content_type"],
                    }),
                    config.SUN_TIMELAPSE_FRAMES,
                )
            except Exception as exc:
                # One channel failing must not stall the others (§9).
                TIMELAPSE_LOG.warning("frame capture failed for %s: %s", channel, exc)
        await asyncio.sleep(config.SUN_TIMELAPSE_INTERVAL)
