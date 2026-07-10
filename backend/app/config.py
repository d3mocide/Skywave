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
SDO_BASE = os.environ.get("SDO_BASE", "https://sdo.gsfc.nasa.gov")
SOHO_BASE = os.environ.get("SOHO_BASE", "https://soho.nascom.nasa.gov")

# Cache TTLs in seconds — DESIGN.md §7. Respect these strictly: hammering
# upstream sources risks rate limiting or bans.
TTL_SPACE_WEATHER = int(os.environ.get("TTL_SPACE_WEATHER", 300))   # 5 min
TTL_CME = int(os.environ.get("TTL_CME", 1800))                      # 30 min
TTL_FOF2 = int(os.environ.get("TTL_FOF2", 300))                     # 5 min
TTL_TLE = int(os.environ.get("TTL_TLE", 21600))                     # 6 hr
TTL_SPOTS = int(os.environ.get("TTL_SPOTS", 5))                     # 5 sec
TTL_SOLAR_ACTIVITY = int(os.environ.get("TTL_SOLAR_ACTIVITY", 1800))  # 30 min
TTL_XRAY = int(os.environ.get("TTL_XRAY", 120))                     # 2 min
TTL_XRAY_1D = int(os.environ.get("TTL_XRAY_1D", 300))               # 5 min
TTL_XRAY_3D = int(os.environ.get("TTL_XRAY_3D", 600))               # 10 min
TTL_HEMI_POWER = int(os.environ.get("TTL_HEMI_POWER", 600))         # 10 min
TTL_SOLAR_WIND = int(os.environ.get("TTL_SOLAR_WIND", 120))         # 2 min
TTL_KP_FORECAST = int(os.environ.get("TTL_KP_FORECAST", 1800))      # 30 min
TTL_AURORA = int(os.environ.get("TTL_AURORA", 600))                 # 10 min
TTL_SUN_IMAGE = int(os.environ.get("TTL_SUN_IMAGE", 900))           # 15 min
TTL_SPOT_HISTORY = int(os.environ.get("TTL_SPOT_HISTORY", 60))      # 1 min

# Sun imagery time-lapse: a background task snapshots every channel each
# interval into a Redis ring buffer. Defaults: 48 frames × 15 min = a 12 h
# loop; 8 channels × 48 frames × ~70 KB base64 ≈ 27 MB of Redis — sized for
# a self-hosted single-station deployment. 0 frames disables the feature.
SUN_TIMELAPSE_FRAMES = int(os.environ.get("SUN_TIMELAPSE_FRAMES", 48))
SUN_TIMELAPSE_INTERVAL = int(os.environ.get("SUN_TIMELAPSE_INTERVAL", TTL_SUN_IMAGE))

UPSTREAM_TIMEOUT = float(os.environ.get("UPSTREAM_TIMEOUT", 20.0))
