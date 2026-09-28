"""Build crown_layers.json: the service URL and lon/lat bounding box of every
crown Feature Service, so tree_api.py only queries layers that can contain a
clicked point.

Item ids come from the sharing backup written by lockdown_crown_sharing.py
(it lists all Ireland_Trees_Crowns_* Feature Services). Re-run this whenever
crown layers are republished or re-split.

  python3 build_layer_index.py [path/to/crown_sharing_backup_*.json]

Needs the same credential as tree_api.py (ARCGIS_CLIENT_ID + ARCGIS_CLIENT_SECRET,
or ARCGIS_API_KEY; env or server/tree_api/.env) with item access to those items.
"""

import json
import math
import sys
import urllib.parse
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
DEFAULT_BACKUP = Path.home() / "Dropbox/Ireland_trees/scripts/crown_publish/crown_sharing_backup_20260929_001310.json"
LAYER_PREFIX = "Ireland_Trees_Crowns_"
PAD_DEG = 0.001   # ~100 m, so crowns on a part's edge still match


def get_json(url, token, **params):
    req = urllib.request.Request(f"{url}?{urllib.parse.urlencode({**params, 'f': 'json'})}",
                                 headers={"X-Esri-Authorization": f"Bearer {token}"})
    with urllib.request.urlopen(req, timeout=30) as resp:
        data = json.load(resp)
    if "error" in data:
        raise RuntimeError(f"{url}: {data['error'].get('code')} {data['error'].get('message')}")
    return data


def to_lonlat(x, y, wkid):
    if wkid == 4326:
        return x, y
    if wkid in (3857, 102100):
        r = 6378137.0
        return math.degrees(x / r), math.degrees(2 * math.atan(math.exp(y / r)) - math.pi / 2)
    raise ValueError(f"unexpected spatial reference {wkid}")


def main():
    sys.path.insert(0, str(HERE))
    from tree_api import TokenProvider, load_env_file
    load_env_file(HERE / ".env")
    try:
        token = TokenProvider.from_env().get()
    except ValueError as e:
        raise SystemExit(str(e))

    backup = Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_BACKUP
    items = [i for i in json.loads(backup.read_text()) if i["title"].startswith(LAYER_PREFIX)]

    layers = []
    for item in sorted(items, key=lambda i: i["title"]):
        meta = get_json(f"https://www.arcgis.com/sharing/rest/content/items/{item['id']}", token)
        url = meta["url"].rstrip("/") + "/0"
        ext = get_json(url, token)["extent"]
        sr = ext["spatialReference"]
        wkid = sr.get("latestWkid") or sr.get("wkid")
        xmin, ymin = to_lonlat(ext["xmin"], ext["ymin"], wkid)
        xmax, ymax = to_lonlat(ext["xmax"], ext["ymax"], wkid)
        bbox = [round(xmin - PAD_DEG, 5), round(ymin - PAD_DEG, 5), round(xmax + PAD_DEG, 5), round(ymax + PAD_DEG, 5)]
        layers.append({"title": item["title"], "url": url, "bbox": bbox})
        print(f"  {item['title']:<40} {bbox}")

    out = HERE / "crown_layers.json"
    out.write_text(json.dumps(layers, indent=1) + "\n")
    print(f"{len(layers)} layers -> {out}")


if __name__ == "__main__":
    main()
