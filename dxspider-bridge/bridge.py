"""DX Spider telnet↔HTTP bridge (DESIGN.md §6).

Browsers can't speak raw TCP, so this small standalone process holds ONE
persistent telnet connection to a DX Spider node and republishes parsed spots
over HTTP/JSON. One shared connection instead of one per browser tab, and
persistence so spots are ready immediately on page load — same architecture
as OpenHamClock's dxspider-proxy.

Node failover: works through DXSPIDER_NODES in priority order (§9), moving to
the next node when a connection drops or fails, with backoff between full
passes over the list.

Zero third-party dependencies — asyncio streams + http.server keep the
container tiny.
"""

import asyncio
import json
import logging
import os
import re
import threading
import time
from collections import deque
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

log = logging.getLogger("dxspider-bridge")

LOGIN_CALL = os.environ.get("DXSPIDER_LOGIN", "N0CALL")
NODES = [
    n.strip()
    for n in os.environ.get(
        "DXSPIDER_NODES",
        # Public DX Spider nodes, priority order. Overridable; picking the
        # final default list is an open decision (DESIGN.md §12).
        "dxspider.co.uk:7300,dx.n8noe.us:7373,dxc.nc7j.com:7373,w3lpl.net:7373",
    ).split(",")
]
HTTP_PORT = int(os.environ.get("BRIDGE_PORT", 7300))
MAX_SPOTS = int(os.environ.get("MAX_SPOTS", 500))
# Trailing spot-history window for the /history aggregate. The bridge is the
# right owner: it holds the persistent telnet connection, so the record has
# no gaps when no browser is polling (the frontend's own Dexie accumulation
# can only cover time the app was open). In-memory on purpose — a bridge
# restart losing the window is an accepted §9-style degradation.
HISTORY_WINDOW_S = int(os.environ.get("HISTORY_WINDOW_S", 24 * 3600))

# "DX de KA1ABC:    14074.0  JA3XYZ       FT8 -12dB          0123Z"
SPOT_RE = re.compile(
    r"^DX de\s+(?P<spotter>[A-Z0-9/\-#]+):?\s+"
    r"(?P<freq>\d+\.?\d*)\s+"
    r"(?P<dx>[A-Z0-9/\-]+)\s+"
    r"(?P<comment>.*?)\s*"
    r"(?P<time>\d{4}Z)?\s*$",
    re.IGNORECASE,
)

_spots: deque = deque(maxlen=MAX_SPOTS)
# (received_at, freq_khz, dx_call) tuples, oldest first — the compact record
# behind /history. ~30k tuples on a busy day; pruned by age on append.
_history: deque = deque()
_spots_lock = threading.Lock()
_status = {"connected": False, "node": None, "since": None}

# Amateur band edges in kHz — mirrors frontend/src/lib/bands.ts BAND_EDGES;
# both sides bin spots by band so the aggregate stays a few KB.
BAND_EDGES = [
    ("160m", 1800, 2000),
    ("80m", 3500, 4000),
    ("60m", 5250, 5450),
    ("40m", 7000, 7300),
    ("30m", 10100, 10150),
    ("20m", 14000, 14350),
    ("17m", 18068, 18168),
    ("15m", 21000, 21450),
    ("12m", 24890, 24990),
    ("10m", 28000, 29700),
    ("6m", 50000, 54000),
]


def band_of(freq_khz: float) -> str | None:
    for name, lo, hi in BAND_EDGES:
        if lo <= freq_khz <= hi:
            return name
    return None


# hours → seconds-per-bin for /history. 15-min bins match the frontend's
# existing 2 h heatmap; the day view halves the cell count with 30-min bins.
HISTORY_BINS = {2: 900, 6: 900, 24: 1800}


def history_summary(hours: int) -> dict:
    """Aggregate the trailing window into band×time-bin counts plus a
    most-spotted list. Computed per request — a linear pass over ≤ ~30k
    tuples is well under a millisecond, not worth caching here."""
    bin_s = HISTORY_BINS[hours]
    window_s = hours * 3600
    until = time.time()
    since = until - window_s
    n_bins = window_s // bin_s
    bands: dict[str, list[int]] = {}
    top: dict[str, dict] = {}
    total = 0
    with _spots_lock:
        rows = list(_history)
    for t, freq, call in rows:
        if t < since:
            continue
        band = band_of(freq)
        if band is None:
            continue
        total += 1
        idx = min(n_bins - 1, int((t - since) / bin_s))
        bands.setdefault(band, [0] * n_bins)[idx] += 1
        info = top.setdefault(call, {"count": 0, "bands": set(), "last_at": 0.0})
        info["count"] += 1
        info["bands"].add(band)
        info["last_at"] = max(info["last_at"], t)
    top_list = [
        {"call": call, "count": i["count"], "bands": sorted(i["bands"]), "last_at": i["last_at"]}
        for call, i in sorted(top.items(), key=lambda kv: -kv[1]["count"])[:8]
    ]
    return {
        "window_s": window_s,
        "bin_s": bin_s,
        "until": until,
        "bands": bands,  # oldest bin first, newest last
        "top": top_list,
        "total": total,
    }


def parse_spot(line: str) -> dict | None:
    m = SPOT_RE.match(line.strip())
    if not m:
        return None
    try:
        freq = float(m.group("freq"))
    except ValueError:
        return None
    return {
        "spotter": m.group("spotter").rstrip(":").upper(),
        "freq_khz": freq,
        "dx_call": m.group("dx").upper(),
        "comment": (m.group("comment") or "").strip(),
        "spot_time": m.group("time"),
        "received_at": time.time(),
    }


async def run_node(host: str, port: int) -> None:
    """Connect, log in, and stream spots until the connection drops."""
    reader, writer = await asyncio.wait_for(
        asyncio.open_connection(host, port), timeout=15
    )
    log.info("connected to %s:%s", host, port)
    _status.update(connected=True, node=f"{host}:{port}", since=time.time())
    try:
        writer.write(f"{LOGIN_CALL}\n".encode())
        await writer.drain()
        while True:
            line = await asyncio.wait_for(reader.readline(), timeout=600)
            if not line:
                raise ConnectionError("connection closed by node")
            spot = parse_spot(line.decode(errors="replace"))
            if spot:
                with _spots_lock:
                    _spots.appendleft(spot)
                    _history.append(
                        (spot["received_at"], spot["freq_khz"], spot["dx_call"])
                    )
                    cutoff = spot["received_at"] - HISTORY_WINDOW_S
                    while _history and _history[0][0] < cutoff:
                        _history.popleft()
    finally:
        _status.update(connected=False)
        writer.close()


async def telnet_loop() -> None:
    backoff = 5
    while True:
        for node in NODES:
            host, _, port = node.partition(":")
            try:
                await run_node(host, int(port or 7300))
            except Exception as exc:
                log.warning("node %s failed: %s", node, exc)
        log.info("all nodes failed; retrying in %ss", backoff)
        await asyncio.sleep(backoff)
        backoff = min(backoff * 2, 300)


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path.startswith("/spots"):
            with _spots_lock:
                body = json.dumps({"spots": list(_spots), "status": _status})
        elif self.path.startswith("/history"):
            from urllib.parse import parse_qs, urlparse

            qs = parse_qs(urlparse(self.path).query)
            try:
                hours = int(qs.get("hours", ["2"])[0])
            except ValueError:
                hours = 0
            if hours not in HISTORY_BINS:
                self.send_error(400, "hours must be one of 2, 6, 24")
                return
            body = json.dumps(history_summary(hours))
        elif self.path.startswith("/health"):
            body = json.dumps(_status)
        else:
            self.send_error(404)
            return
        payload = body.encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def log_message(self, *args):
        pass  # quiet; uvicorn-style access logs are noise here


def main() -> None:
    logging.basicConfig(level=logging.INFO)
    server = ThreadingHTTPServer(("0.0.0.0", HTTP_PORT), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    log.info("HTTP listening on :%s, telnet login %s", HTTP_PORT, LOGIN_CALL)
    asyncio.run(telnet_loop())


if __name__ == "__main__":
    main()
