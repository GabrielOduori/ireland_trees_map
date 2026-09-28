"""Build the list of urban Built-Up Areas (BUAs) used for the urban/rural TOF split.

How the table is generated
--------------------------
1. Query the public BUA stats layer (ArcGIS Online item a7b962ccd97e4ba3a1e2587cedb6dee6,
   service `ireland_trees_bua_stats_population`) for every BUA with
   `population >= 1500`. This is the CSO urban threshold, and it matches
   URBAN_BUA_MIN_POPULATION in src/config.js.
2. For each qualifying BUA, keep its settlement name, county, population and
   `trees_outside_forests` (the count of TOF crowns inside the BUA boundary).
3. Query the county stats layer (item 259ee297ee034edaa3d22b082ab03732) for each
   county's total `trees_outside_forests`.
4. Urban TOF (county) = sum of TOF over that county's urban BUAs.
   Urban %            = Urban TOF / county total TOF * 100.
   Rural TOF          = county total TOF - Urban TOF. This includes TOF in BUAs
                        below 1,500 population and TOF outside any BUA.
   The national figure is the same calculation over all counties.

The web app does the same calculation live in src/app.js (the BUA stats block
near the top of the startup code), so these CSVs are a snapshot of what the map
displays.

Outputs (written next to this script):
  urban_bua_list.csv         one row per qualifying BUA (218 as of 2026-09-28)
  urban_tof_by_county.csv    per-county summary plus a national row

Usage:  python3 data/urban_bua_tof.py        (standard library only)
"""

import csv
import json
import urllib.parse
import urllib.request
from pathlib import Path

URBAN_BUA_MIN_POPULATION = 1500
BUA_LAYER = ("https://services-eu1.arcgis.com/d6WajiXkixlJUEtR/arcgis/rest/services/"
             "ireland_trees_bua_stats_population/FeatureServer/0")
COUNTY_ITEM_ID = "259ee297ee034edaa3d22b082ab03732"
OUT_DIR = Path(__file__).resolve().parent


def get_json(url, **params):
    if params:
        url = f"{url}?{urllib.parse.urlencode({**params, 'f': 'json'})}"
    with urllib.request.urlopen(url) as resp:
        data = json.load(resp)
    if "error" in data:
        raise RuntimeError(f"{url}: {data['error']}")
    return data


def query(layer_url, where, out_fields):
    # Both layers are well under the 2000-record service limit, so one page is enough.
    data = get_json(f"{layer_url}/query", where=where, outFields=out_fields,
                    returnGeometry="false")
    if data.get("exceededTransferLimit"):
        raise RuntimeError(f"{layer_url}: result truncated, add paging")
    return [f["attributes"] for f in data["features"]]


def main():
    county_url = get_json(f"https://www.arcgis.com/sharing/rest/content/items/{COUNTY_ITEM_ID}",
                          f="json")["url"] + "/0"

    buas = query(BUA_LAYER, f"population >= {URBAN_BUA_MIN_POPULATION}",
                 "settlement,county,population,trees_outside_forests")
    buas.sort(key=lambda a: (a["county"], -a["population"]))

    county_tof = {a["county_name"].title(): a["trees_outside_forests"]
                  for a in query(county_url, "1=1", "county_name,trees_outside_forests")}

    with open(OUT_DIR / "urban_bua_list.csv", "w", newline="") as fh:
        w = csv.writer(fh)
        w.writerow(["settlement", "county", "population", "trees_outside_forests"])
        for a in buas:
            w.writerow([a["settlement"], a["county"], a["population"], a["trees_outside_forests"]])

    urban, n_bua = {}, {}
    for a in buas:
        urban[a["county"]] = urban.get(a["county"], 0) + a["trees_outside_forests"]
        n_bua[a["county"]] = n_bua.get(a["county"], 0) + 1

    def row(name, n, u, total):
        return [name, n, u, total, total - u, round(100 * u / total, 1), round(100 - 100 * u / total, 1)]

    with open(OUT_DIR / "urban_tof_by_county.csv", "w", newline="") as fh:
        w = csv.writer(fh)
        w.writerow(["county", "urban_bua_count", "urban_tof", "total_tof", "rural_tof",
                    "urban_tof_pct", "rural_tof_pct"])
        for county in sorted(county_tof):
            w.writerow(row(county, n_bua.get(county, 0), urban.get(county, 0), county_tof[county]))
        w.writerow(row("Ireland", len(buas), sum(urban.values()), sum(county_tof.values())))

    print(f"{len(buas)} urban BUAs (population >= {URBAN_BUA_MIN_POPULATION}) -> {OUT_DIR}")


if __name__ == "__main__":
    main()
