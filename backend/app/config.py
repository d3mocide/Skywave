"""Configuration via environment variables. No secrets required — every
upstream source is a public, unauthenticated API."""

import os


REDIS_URL = os.environ.get("REDIS_URL", "redis://localhost:6379/0")
DXSPIDER_BRIDGE_URL = os.environ.get("DXSPIDER_BRIDGE_URL", "http://localhost:7300")

# Upstream endpoints. All public. Overridable for testing.
SWPC_BASE = os.environ.get("SWPC_BASE", "https://services.swpc.noaa.gov")
DONKI_BASE = os.environ.get("DONKI_BASE", "https://kauai.ccmc.gsfc.nasa.gov/DONKI/WS/get")
KC2G_BASE = os.environ.get("KC2G_BASE", "https://prop.kc2g.com/api")
CELESTRAK_BASE = os.environ.get("CELESTRAK_BASE", "https://celestrak.org")

# Cache TTLs in seconds — DESIGN.md §7. Respect these strictly: hammering
# upstream sources risks rate limiting or bans.
TTL_SPACE_WEATHER = int(os.environ.get("TTL_SPACE_WEATHER", 300))   # 5 min
TTL_CME = int(os.environ.get("TTL_CME", 1800))                      # 30 min
TTL_FOF2 = int(os.environ.get("TTL_FOF2", 300))                     # 5 min
TTL_TLE = int(os.environ.get("TTL_TLE", 21600))                     # 6 hr
TTL_SPOTS = int(os.environ.get("TTL_SPOTS", 5))                     # 5 sec

UPSTREAM_TIMEOUT = float(os.environ.get("UPSTREAM_TIMEOUT", 20.0))
