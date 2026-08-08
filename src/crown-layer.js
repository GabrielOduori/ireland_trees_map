// Crown tile layer construction and the transient highlight-blink effect used
// to draw attention to a newly-visible or search-landed feature.
import { state } from "./state.js";

// $arcgis is a page global provided by the ArcGIS Maps SDK <script> tag in
// <head> (confirmed by the main inline script already relying on it as a
// bare global from a separate <script type="module"> block). Dynamic imports
// through it are cached by the browser's module registry, so requesting the
// same SDK module from multiple files doesn't re-fetch or duplicate it.
const VectorTileLayer = await $arcgis.import("@arcgis/core/layers/VectorTileLayer.js");
const TileLayer       = await $arcgis.import("@arcgis/core/layers/TileLayer.js");
const MapImageLayer   = await $arcgis.import("@arcgis/core/layers/MapImageLayer.js");

// Builds the right Layer type for a discovered tile item — shared between the
// national overview (one per county, all shown at once) and per-county activation
// (one at a time, in activateCounty) so the VTL/dynamic/plain-tile branching only
// lives in one place.
export function buildCrownTileLayer(info) {
  const portalRef = state._portal ? { id: info.id, portal: state._portal } : { id: info.id };
  const tileType  = info.type || "";
  const tileUrl   = info.url  || "";
  const isVtl      = tileType === "Vector Tile Service" || tileUrl.includes("/VectorTileServer");
  // URLs on the tiles CDN are cached tile services — TileLayer, not MapImageLayer.
  const isTilesCdn = /tiles(-eu1)?\.arcgis\.com/.test(tileUrl);
  const isDynamic  = !isVtl && !isTilesCdn && (tileType === "Map Image Layer" || tileType === "Map Service");
  if (isVtl) {
    // Use direct URL when available — skips portal metadata roundtrip so tiles start loading immediately.
    return tileUrl
      ? new VectorTileLayer({ url: tileUrl, minScale: 0, maxScale: 0 })
      : new VectorTileLayer({ portalItem: portalRef, minScale: 0, maxScale: 0 });
  } else if (isDynamic) {
    return tileUrl
      ? new MapImageLayer({ url: tileUrl, minScale: 0, maxScale: 0 })
      : new MapImageLayer({ portalItem: portalRef, minScale: 0, maxScale: 0 });
  } else if (tileUrl) {
    return new TileLayer({ url: tileUrl, minScale: 0, maxScale: 0 });
  }
  return new TileLayer({ portalItem: portalRef, minScale: 0, maxScale: 0 });
}

// Blinks a highlight on/off 3 times (6 half-cycles) so a newly-relevant feature
// (a BUA scrolled into view, a search result) catches the eye without a
// persistent highlight lingering after the user has seen it.
export function blinkHighlight(layerView, target) {
  let on = false, blinks = 0, handle = null;
  const timer = setInterval(() => {
    on = !on;
    if (handle) { handle.remove(); handle = null; }
    if (on) handle = layerView.highlight(target);
    blinks++;
    if (blinks >= 6) { clearInterval(timer); if (handle) handle.remove(); }
  }, 350);
}
