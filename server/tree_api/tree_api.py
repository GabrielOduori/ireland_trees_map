"""Per-tree lookup service for the Ireland Trees Map.

GET /api/tree?lon=<x>&lat=<y>  ->  200 + the one tree crown under that point,
                                    204 if there is none, 400 for bad input.

The crown Feature Services on ArcGIS Online are not public (bulk scraping of
the licensed NTM data), so the browser can't query them. This service holds an
ArcGIS credential and answers point lookups only:

  - Only `lon` and `lat` are accepted. No `where`, no ID lookups, no paging -
    enumerating trees would mean grid-sampling the whole country. Keep it that
    way: never add lookups by ntm_id / objectid.
  - Only layers whose bounding box contains the point are queried
    (crown_layers.json, built by build_layer_index.py).
  - ArcGIS errors are logged and returned as a generic 502; the token never
    appears in a response.
  - Rate limiting is done by nginx in front of this (docs/nginx-config.txt).

Standard library only. Listens on 127.0.0.1 so it is reachable only via nginx.

  Credential (env, or server/tree_api/.env locally), either:
    ARCGIS_CLIENT_ID + ARCGIS_CLIENT_SECRET  OAuth 2.0 app credential; tokens
                                             are requested and renewed here
    ARCGIS_API_KEY                           API key credential

  Production:  python3 tree_api.py
  Local dev:   python3 tree_api.py --static ../..  (also serves the site on the
               same port so the app's same-origin /api/tree works)
"""

import argparse
import json
import logging
import os
import threading
import time
import urllib.parse
import urllib.request
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

HERE = Path(__file__).resolve().parent

# Republic of Ireland, with a small margin.
LON_RANGE = (-10.8, -5.3)
LAT_RANGE = (51.3, 55.5)

# Popup fields (see buildPopupContent in src/popups.js). Anything else the
# service returns is dropped.
FIELDS = ["tree_class", "ntm_id", "height_m", "max_height_m", "crown_area_m2", "perimeter", "county"]

UPSTREAM_TIMEOUT_S = 10
TOKEN_URL = "https://www.arcgis.com/sharing/rest/oauth2/token"
TOKEN_LIFETIME_MIN = 1440      # request day-long app tokens...
TOKEN_RENEW_MARGIN_S = 600     # ...and renew them 10 minutes before expiry
INVALID_TOKEN_CODES = {498, 499}

log = logging.getLogger("tree_api")


def load_env_file(path):
    """Minimal KEY=VALUE reader for the local-dev .env (production uses systemd's EnvironmentFile)."""
    if not path.exists():
        return
    for line in path.read_text().splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            key, value = line.split("=", 1)
            os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


class UpstreamError(Exception):
    def __init__(self, message, code=None):
        super().__init__(message)
        self.code = code


class TokenProvider:
    """Hands out a valid ArcGIS token: a fixed API key, or an OAuth 2.0 app
    token obtained from the client id/secret and renewed before it expires."""

    def __init__(self, api_key=None, client_id=None, client_secret=None):
        if not api_key and not (client_id and client_secret):
            raise ValueError("set ARCGIS_CLIENT_ID + ARCGIS_CLIENT_SECRET, or ARCGIS_API_KEY")
        self._api_key = api_key
        self._client = (client_id, client_secret)
        self._token, self._expires_at = None, 0.0
        self._lock = threading.Lock()

    @classmethod
    def from_env(cls):
        env = lambda k: os.environ.get(k, "").strip() or None
        return cls(env("ARCGIS_API_KEY"), env("ARCGIS_CLIENT_ID"), env("ARCGIS_CLIENT_SECRET"))

    def get(self):
        if self._api_key:
            return self._api_key
        with self._lock:
            if not self._token or time.time() > self._expires_at - TOKEN_RENEW_MARGIN_S:
                self._fetch()
            return self._token

    def invalidate(self):
        with self._lock:
            self._token = None

    def _fetch(self):
        body = urllib.parse.urlencode({
            "client_id": self._client[0], "client_secret": self._client[1],
            "grant_type": "client_credentials", "expiration": TOKEN_LIFETIME_MIN, "f": "json",
        }).encode()
        try:
            with urllib.request.urlopen(TOKEN_URL, data=body, timeout=UPSTREAM_TIMEOUT_S) as resp:
                data = json.load(resp)
        except Exception as e:
            raise UpstreamError(f"token request: {type(e).__name__}") from None
        if "access_token" not in data:
            err = data.get("error") or {}
            raise UpstreamError(f"token request: {err.get('code')} {err.get('error_description') or err.get('message')}")
        self._token = data["access_token"]
        self._expires_at = time.time() + int(data.get("expires_in", TOKEN_LIFETIME_MIN * 60))
        log.info("obtained app token (valid %d min)", int(data.get("expires_in", 0)) // 60)


def candidate_layers(layers, lon, lat):
    return [l for l in layers
            if l["bbox"][0] <= lon <= l["bbox"][2] and l["bbox"][1] <= lat <= l["bbox"][3]]


def query_layer(url, lon, lat, token):
    params = urllib.parse.urlencode({
        "geometry": f"{lon},{lat}",
        "geometryType": "esriGeometryPoint",
        "inSR": 4326,
        "spatialRel": "esriSpatialRelIntersects",
        "outFields": ",".join(FIELDS),
        "returnGeometry": "true",
        "outSR": 4326,
        "resultRecordCount": 1,
        "f": "json",
    })
    # Token goes in a header, not the URL, so it can't leak into upstream logs/errors we print.
    req = urllib.request.Request(f"{url}/query?{params}", headers={"X-Esri-Authorization": f"Bearer {token}"})
    try:
        with urllib.request.urlopen(req, timeout=UPSTREAM_TIMEOUT_S) as resp:
            data = json.load(resp)
    except Exception as e:
        raise UpstreamError(f"{url}: {type(e).__name__}") from None
    if "error" in data:
        err = data["error"]
        raise UpstreamError(f"{url}: code {err.get('code')} {err.get('message')}", err.get("code"))
    features = data.get("features") or []
    if not features:
        return None
    f = features[0]
    return {
        "attributes": {k: f.get("attributes", {}).get(k) for k in FIELDS},
        "geometry": {"rings": (f.get("geometry") or {}).get("rings", [])},
    }


def find_tree(layers, lon, lat, tokens):
    for layer in candidate_layers(layers, lon, lat):
        try:
            tree = query_layer(layer["url"], lon, lat, tokens.get())
        except UpstreamError as e:
            if e.code not in INVALID_TOKEN_CODES:
                raise
            tokens.invalidate()   # expired/revoked early: get a fresh token, retry once
            tree = query_layer(layer["url"], lon, lat, tokens.get())
        if tree:
            return tree
    return None


def parse_point(query):
    """Return (lon, lat) or None. Rejects any parameter other than lon/lat."""
    params = urllib.parse.parse_qs(query, keep_blank_values=True)
    if set(params) != {"lon", "lat"} or any(len(v) != 1 for v in params.values()):
        return None
    try:
        lon, lat = float(params["lon"][0]), float(params["lat"][0])
    except ValueError:
        return None
    if not (LON_RANGE[0] <= lon <= LON_RANGE[1] and LAT_RANGE[0] <= lat <= LAT_RANGE[1]):
        return None
    return lon, lat


class Handler(SimpleHTTPRequestHandler):
    layers = []
    tokens = None
    static_dir = None   # local dev only

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=self.static_dir or str(HERE), **kwargs)

    def do_GET(self):
        url = urllib.parse.urlsplit(self.path)
        if url.path == "/api/tree":
            return self.handle_tree(url.query)
        if self.static_dir:
            return super().do_GET()
        self.reply(404, {"error": "not found"})

    def do_HEAD(self):
        if self.static_dir and not self.path.startswith("/api/"):
            return super().do_HEAD()
        self.send_error(405)

    def handle_tree(self, query):
        point = parse_point(query)
        if point is None:
            return self.reply(400, {"error": "expected lon and lat inside Ireland"})
        try:
            tree = find_tree(self.layers, *point, self.tokens)
        except UpstreamError as e:
            log.error("upstream: %s", e)
            return self.reply(502, {"error": "tree lookup unavailable"})
        if tree is None:
            # 204, not 404: browsers log every 4xx fetch as a console error, and
            # clicking empty map is normal.
            self.send_response(204)
            self.end_headers()
            return
        self.reply(200, tree)

    def reply(self, code, body):
        data = json.dumps(body).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        super().end_headers()

    def log_message(self, fmt, *args):
        log.info("%s %s", self.address_string(), fmt % args)


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--port", type=int, default=int(os.environ.get("TREE_API_PORT", 8081)))
    ap.add_argument("--static", metavar="DIR", help="local dev only: also serve the site from DIR")
    args = ap.parse_args()

    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    load_env_file(HERE / ".env")
    try:
        tokens = TokenProvider.from_env()
    except ValueError as e:
        raise SystemExit(f"{e} (server: /etc/tree-api.env, local: server/tree_api/.env)")

    Handler.layers = json.loads((HERE / "crown_layers.json").read_text())
    Handler.tokens = tokens
    Handler.static_dir = str(Path(args.static).resolve()) if args.static else None

    log.info("%d crown layers loaded; listening on %s:%d%s", len(Handler.layers), args.host, args.port,
             f" (also serving {Handler.static_dir})" if Handler.static_dir else "")
    ThreadingHTTPServer((args.host, args.port), Handler).serve_forever()


if __name__ == "__main__":
    main()
