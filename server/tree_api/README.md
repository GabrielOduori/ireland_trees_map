# tree-api

This is the per-tree lookup behind the map's crown popups: `GET /api/tree?lon=<x>&lat=<y>` returns the one crown under that point (attributes and outline), or 204 if there is none.

The crown Feature Services on ArcGIS Online are **not public**, because the NTM data is licensed. This service holds an ArcGIS credential and only answers point lookups. There are no queries, ID lookups or paging, so the data can't be enumerated. nginx rate-limits it. **Never add a lookup by `ntm_id` or `objectid`.**

This folder is **not** part of the website deploy. It never goes into `/var/www`.

## 1. Credential (once)

This setup uses an **OAuth 2.0 app credential**. The UCD organisation doesn't allow members to create API key credentials, and `tree_api.py` accepts either type.

1. In ArcGIS Online, go to **Content → New item → Developer credentials → OAuth 2.0 (App authentication)** and choose **Private application**.
2. **Item access:** add the `Ireland_Trees_Crowns_*` Feature Service items (55 as of 2026-09-29), and nothing else.
3. **Privileges:** none. **Referrer:** leave empty.
4. Title the item `treemap-tree-api-key` and keep it private.
5. Copy the **client ID** and **client secret**. Ignore the "temporary token"; the service requests its own day-long tokens and renews them automatically.
   - local: `server/tree_api/.env` (git-ignored)
   - server: `/etc/tree-api.env`

   ```
   ARCGIS_CLIENT_ID=...
   ARCGIS_CLIENT_SECRET=...
   ```

   If you later get API key credentials instead, set `ARCGIS_API_KEY=...` and nothing else in the code changes.

**If the secret leaks:** reset it on the credential item's page, then update the env file.

**If crown layers are republished (new items):** add them to the credential's item access and re-run step 2.

## 2. Layer index

`crown_layers.json` lists each crown layer's URL and lon/lat bounding box. Regenerate it whenever crown layers are republished or re-split:

```bash
python3 server/tree_api/build_layer_index.py
```

By default it reads item ids from the lockdown backup in `~/Dropbox/Ireland_trees/scripts/crown_publish/`. You can pass a different backup JSON as the first argument.

## 3. Run locally

This serves the site and the API on one port, so the app's `/api/tree` works:

```bash
python3 server/tree_api/tree_api.py --port 8000 --static .
```

Open http://localhost:8000, zoom in below 1:25,000 and click a crown.

## 4. Install on the server

```bash
sudo mkdir -p /opt/tree-api
sudo cp tree_api.py crown_layers.json /opt/tree-api/
sudo cp tree-api.service /etc/systemd/system/
sudo install -m 640 -o root -g deploy /dev/null /etc/tree-api.env
sudoedit /etc/tree-api.env   # ARCGIS_CLIENT_ID=... and ARCGIS_CLIENT_SECRET=... (an editor keeps the secret out of shell history)
sudo systemctl daemon-reload && sudo systemctl enable --now tree-api
curl -s "http://127.0.0.1:8081/api/tree?lon=-6.26&lat=53.35"
```

Then add the rate limits and the `/api/tree` location from `docs/nginx-config.txt`, and run `sudo nginx -t && sudo systemctl reload nginx`.

## 5. Limits and monitoring

There are three layers of limits:
- **nginx, per visitor:** 30 lookups a minute.
- **nginx, everyone together:** 3 lookups a second.
- **tree-api, per visitor per day:** 1000 lookups (UTC day). An IPv6 visitor counts per /64. Change it with `TREE_API_DAILY_QUOTA=` in `/etc/tree-api.env`.

When a visitor hits the daily quota, the service logs `daily quota (N) reached by <client>`. To check for scraping:

```bash
journalctl -u tree-api --since today | grep "daily quota"
```

Several clients hitting the quota on the same day, or the global limit being hit for hours, is a sign of scraping. Look at `/var/log/nginx/error.log` for `limiting requests`.

**Changing the credential:** edit `/etc/tree-api.env`, then run `sudo systemctl restart tree-api`.
