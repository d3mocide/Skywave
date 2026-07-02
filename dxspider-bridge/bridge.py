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
_spots_lock = threading.Lock()
_status = {"connected": False, "node": None, "since": None}


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
