"""Skywave API — stateless aggregator/proxy/cache (DESIGN.md §6).

One job: proxy external APIs, cache in Redis, normalize responses.
No auth, no sessions, no user data.
"""

import asyncio
import base64
import json
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response

from . import config, upstream
from .cache import Cache

logging.basicConfig(level=logging.INFO)


@asynccontextmanager
async def lifespan(app: FastAPI):
    app.state.cache = Cache()
    # Sun time-lapse frame collector — the one deliberately non-on-demand
    # fetch in the backend: a loop can't be assembled retroactively, so
    # frames accumulate whether or not a browser is watching. Bounded to
    # one upstream request per channel per interval.
    app.state.timelapse = asyncio.create_task(
        upstream.sun_timelapse_loop(app.state.cache)
    )
    yield
    app.state.timelapse.cancel()
    await app.state.cache.close()


app = FastAPI(title="Skywave API", version="0.1.0", lifespan=lifespan)

# Same-origin in production (Caddy fronts both frontend and API); the open
# CORS policy is for local dev where Vite serves on its own port. Harmless
# either way — every endpoint is public read-only data.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["GET"],
    allow_headers=["*"],
)


@app.get("/api/health")
async def health():
    return {"status": "ok"}


@app.get("/api/space-weather")
async def space_weather():
    return await upstream.fetch_cached(
        app.state.cache, "space-weather", config.TTL_SPACE_WEATHER,
        upstream.fetch_space_weather,
    )


@app.get("/api/cmes")
async def cmes():
    return await upstream.fetch_cached(
        app.state.cache, "cmes", config.TTL_CME, upstream.fetch_cmes
    )


@app.get("/api/fof2")
async def fof2():
    return await upstream.fetch_cached(
        app.state.cache, "fof2", config.TTL_FOF2, upstream.fetch_fof2
    )


@app.get("/api/tles")
async def tles():
    return await upstream.fetch_cached(
        app.state.cache, "tles", config.TTL_TLE, upstream.fetch_tles
    )


@app.get("/api/spots")
async def spots():
    return await upstream.fetch_cached(
        app.state.cache, "spots", config.TTL_SPOTS, upstream.fetch_spots
    )


@app.get("/api/spot-history")
async def spot_history(hours: int = 2):
    """Band×time-bin spot counts over the bridge's trailing window — feeds
    the DX Cluster heatmap/activity rail beyond the 2 h the frontend can
    accumulate on its own."""
    if hours not in upstream.SPOT_HISTORY_HOURS:
        raise HTTPException(status_code=400, detail=f"hours must be one of {upstream.SPOT_HISTORY_HOURS}")
    return await upstream.fetch_cached(
        app.state.cache, f"spot-history:{hours}", config.TTL_SPOT_HISTORY,
        upstream.make_spot_history_fetcher(hours),
    )


@app.get("/api/solar-activity")
async def solar_activity():
    return await upstream.fetch_cached(
        app.state.cache, "solar-activity", config.TTL_SOLAR_ACTIVITY,
        upstream.fetch_solar_activity,
    )


@app.get("/api/xray")
async def xray(range: str = "6h"):
    """GOES X-ray flux for a trailing window. 6 h is the live default the
    overview polls; 1 d / 3 d feed the Space WX chart's range toggle."""
    if range not in upstream.XRAY_RANGES:
        raise HTTPException(status_code=400, detail=f"unknown range {range}")
    ttl = upstream.XRAY_RANGES[range][2]
    return await upstream.fetch_cached(
        app.state.cache, f"xray:{range}", ttl, upstream.make_xray_fetcher(range)
    )


@app.get("/api/hemi-power")
async def hemi_power():
    return await upstream.fetch_cached(
        app.state.cache, "hemi-power", config.TTL_HEMI_POWER,
        upstream.fetch_hemi_power,
    )


@app.get("/api/solar-wind")
async def solar_wind():
    return await upstream.fetch_cached(
        app.state.cache, "solar-wind", config.TTL_SOLAR_WIND,
        upstream.fetch_solar_wind,
    )


@app.get("/api/kp-forecast")
async def kp_forecast():
    return await upstream.fetch_cached(
        app.state.cache, "kp-forecast", config.TTL_KP_FORECAST,
        upstream.fetch_kp_forecast,
    )


@app.get("/api/aurora")
async def aurora():
    return await upstream.fetch_cached(
        app.state.cache, "aurora", config.TTL_AURORA, upstream.fetch_aurora
    )


@app.get("/api/drap")
async def drap():
    return await upstream.fetch_cached(
        app.state.cache, "drap", config.TTL_DRAP, upstream.fetch_drap
    )


@app.get("/api/transponders")
async def transponders():
    return await upstream.fetch_cached(
        app.state.cache, "transponders", config.TTL_TRANSPONDERS,
        upstream.fetch_transponders,
    )


@app.get("/api/sun/{channel}/frames")
async def sun_frames(channel: str):
    """Time-lapse manifest: the timestamps available in the channel's frame
    ring, oldest first. Frames themselves are fetched one by one (binary,
    immutable) so the browser can cache them across loop iterations."""
    if channel not in upstream.SUN_IMAGE_CHANNELS:
        raise HTTPException(status_code=404, detail=f"unknown channel {channel}")
    raw = await app.state.cache.ring_all(f"sunframes:{channel}")
    frames = []
    for entry in raw:
        try:
            frames.append(json.loads(entry)["ts"])
        except (ValueError, KeyError):
            continue
    return {"frames": frames, "interval_s": config.SUN_TIMELAPSE_INTERVAL}


@app.get("/api/sun/{channel}/frame/{ts}")
async def sun_frame(channel: str, ts: int):
    if channel not in upstream.SUN_IMAGE_CHANNELS:
        raise HTTPException(status_code=404, detail=f"unknown channel {channel}")
    for entry in await app.state.cache.ring_all(f"sunframes:{channel}"):
        try:
            frame = json.loads(entry)
        except ValueError:
            continue
        if frame.get("ts") == ts:
            return Response(
                content=base64.b64decode(frame["b64"]),
                media_type=frame.get("content_type", "image/jpeg"),
                # A timestamped frame never changes — let the browser keep
                # it for the whole time-lapse session.
                headers={"Cache-Control": "public, max-age=86400, immutable"},
            )
    raise HTTPException(status_code=404, detail="frame expired from ring")


@app.get("/api/sun/{channel}")
async def sun_image(channel: str):
    """Latest solar disk / coronagraph image, proxied and cached. Binary
    response (not the JSON envelope) — freshness rides in headers instead."""
    if channel not in upstream.SUN_IMAGE_CHANNELS:
        raise HTTPException(status_code=404, detail=f"unknown channel {channel}")
    env = await upstream.fetch_cached(
        app.state.cache, f"sun:{channel}", config.TTL_SUN_IMAGE,
        upstream.make_sun_image_fetcher(channel),
    )
    return Response(
        content=base64.b64decode(env["data"]["b64"]),
        media_type=env["data"]["content_type"],
        headers={
            "X-Fetched-At": str(env["fetched_at"]),
            "X-Stale": "1" if env["stale"] else "0",
            "Cache-Control": f"public, max-age={config.TTL_SUN_IMAGE}",
        },
    )
