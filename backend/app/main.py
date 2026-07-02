"""Skywave API — stateless aggregator/proxy/cache (DESIGN.md §6).

One job: proxy external APIs, cache in Redis, normalize responses.
No auth, no sessions, no user data.
"""

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from . import config, upstream
from .cache import Cache

logging.basicConfig(level=logging.INFO)


@asynccontextmanager
async def lifespan(app: FastAPI):
    app.state.cache = Cache()
    yield
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
