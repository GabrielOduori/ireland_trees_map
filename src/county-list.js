// BUA / municipal district / local authority list panels: querying the
// active layer for the selected county, rendering the list, and handling
// selection (zoom-to, highlight, open the matching popup).
//
// Circular import with chart.js — see the note at the top of chart.js for
// why this is safe here (neither side calls into the other during module
// evaluation, only later from user interaction).
import { state } from "./state.js";
import { BOUNDARY_STATS_FIELDS } from "./config.js";
import { existingOutFields, pickDisplayName, escapeSql } from "./utils.js";
import { closeBuaPopup, clearCrownSelection, openBuaPopup, openFilteredPopup } from "./popups.js";
import { showChartLoading, showChartError, updateUrlState } from "./chart.js";

const buaChartPanel = document.getElementById("buaChartPanel");
const buaChartBody  = document.getElementById("buaChartBody");

export async function selectFilteredFeature(graphic, li, layer) {
  if (state.activeFilteredItem) state.activeFilteredItem.classList.remove("active");
  li.classList.add("active");
  state.activeFilteredItem = li;
  closeBuaPopup();
  if (state.filteredHighlight) { state.filteredHighlight.remove(); state.filteredHighlight = null; }
  try {
    const ext = graphic.geometry.extent;
    await state.view.goTo(ext.expand(1.5));
    const lv = await state.view.whenLayerView(layer);
    state.filteredHighlight = lv.highlight(graphic);
    // Anchor away from the polygon's center, same as selectBua — the
    // goTo(expand(1.5)) margin keeps this corner clear of the feature.
    const anchor = ext.center.clone();
    anchor.x = ext.xmax;
    anchor.y = ext.ymax;
    openFilteredPopup(graphic.attributes || {}, anchor);
  } catch (e) {
    console.error("[selectFilteredFeature] error:", e?.message || e);
  }
}

export async function loadFilteredList(layer, countyName, layerLabel) {
  buaChartPanel.style.display = "flex";
  state.activeFilteredItem = null;
  if (state.filteredHighlight) { state.filteredHighlight.remove(); state.filteredHighlight = null; }

  document.getElementById("buaChartTitleCounty").textContent =
    countyName.charAt(0).toUpperCase() + countyName.slice(1).toLowerCase();

  if (!layer) return;
  showChartLoading(`Loading ${layerLabel || "features"}…`);
  try {
    await layer.load();
    const q = layer.createQuery();
    q.outFields            = existingOutFields(layer, BOUNDARY_STATS_FIELDS);
    q.returnGeometry       = true;
    q.outSpatialReference  = state.view.spatialReference;
    const { features } = await layer.queryFeatures(q);

    buaChartBody.innerHTML = "";
    const ul = document.createElement("ul");
    ul.style.cssText = "list-style:none;padding:0;margin:0";
    features.forEach(graphic => {
      const a  = graphic.attributes || {};
      const nm = pickDisplayName(a);
      const li = document.createElement("li");
      li.style.cssText = "cursor:pointer;padding:7px 12px;border-bottom:1px solid #eee;" +
                          "border-left:3px solid transparent;transition:background 0.15s";
      const nameEl = document.createElement("span");
      nameEl.className = "bua-name";
      nameEl.style.fontSize = "13px";
      nameEl.textContent = nm;
      li.appendChild(nameEl);
      li.addEventListener("mouseenter", () => { if (li !== state.activeFilteredItem) li.style.background = "#f5f5f5"; });
      li.addEventListener("mouseleave", () => { if (li !== state.activeFilteredItem) li.style.background = ""; });
      li.addEventListener("click", () => selectFilteredFeature(graphic, li, layer));
      ul.appendChild(li);
    });
    buaChartBody.appendChild(ul);
    if (features.length === 0) {
      const empty = document.createElement("li");
      empty.style.cssText = "padding:10px 12px;color:#999;font-size:12px;line-height:1.4;";
      const label = layerLabel || "features";
      empty.textContent = `${countyName.charAt(0).toUpperCase() + countyName.slice(1).toLowerCase()} has no ${label}. Some counties are structured without this division (e.g. city/county boroughs).`;
      buaChartBody.appendChild(empty);
    }
    buaChartPanel.style.display = "flex";
  } catch (e) {
    console.error("[loadFilteredList] error:", e?.message || e);
    showChartError(`${layerLabel || "This list"} could not be loaded.`, () => loadFilteredList(layer, countyName, layerLabel));
  }
}

export function clearBuaList() {
  buaChartPanel.style.display = "none";
  buaChartBody.innerHTML      = "";
  if (state.buaHighlight) { state.buaHighlight.remove(); state.buaHighlight = null; }
  state.activeBuaItem = null;
  state._buaLayer     = null;
  state._buaPanelCollapsed = false;
  buaChartBody.style.display = "";
  const collapseBtn = document.getElementById("buaChartCollapse");
  if (collapseBtn) collapseBtn.innerHTML = "&#9660;";
  if (state.filteredHighlight) { state.filteredHighlight.remove(); state.filteredHighlight = null; }
  state.activeFilteredItem = null;
  state._activeCountyName  = null;
  updateUrlState();
}

export async function selectBua(attrs, li) {
  if (state.activeBuaItem) state.activeBuaItem.classList.remove("active");
  li.classList.add("active");
  state.activeBuaItem = li;

  closeBuaPopup();
  clearCrownSelection();
  if (state.buaHighlight) { state.buaHighlight.remove(); state.buaHighlight = null; }

  const keys  = Object.keys(attrs);
  const oidKey = keys.find(k => k.toLowerCase() === "objectid")
              || keys.find(k => k.toLowerCase() === "id");
  const oid    = oidKey ? attrs[oidKey] : null;
  const settlement = attrs.settlement || attrs.Settlement;
  const county     = attrs.county     || attrs.County;
  if (!state._nationalBuaLayer) return;

  // Build where clause: prefer numeric id, fall back to settlement+county
  const whereClause = (oid != null && oidKey)
    ? `${oidKey} = ${oid}`
    : `settlement = '${escapeSql(settlement||"")}' AND county = '${escapeSql(county||"")}'`;

  try {
    const gq = state._nationalBuaLayer.createQuery();
    gq.where          = whereClause;
    gq.returnGeometry = true;
    gq.outSpatialReference = state.view.spatialReference;
    gq.outFields      = existingOutFields(state._nationalBuaLayer, BOUNDARY_STATS_FIELDS);
    const { features } = await state._nationalBuaLayer.queryFeatures(gq);
    if (features.length) {
      const g = features[0];
      const ext = g.geometry.extent;
      await state.view.goTo(ext.expand(1.5));
      if (state._buaLayer) {
        const lv = await state.view.whenLayerView(state._buaLayer);
        state.buaHighlight = lv.highlight(g);
      }
      // Anchor away from the polygon's center so the popup doesn't sit on top of
      // the feature it describes — the goTo(expand(1.5)) margin keeps this corner clear.
      const anchor = ext.center.clone();
      anchor.x = ext.xmax;
      anchor.y = ext.ymax;
      openBuaPopup(attrs, anchor);
    } else {
      console.warn("[selectBua] no feature returned for", oidKey, "=", oid);
    }
  } catch (e) {
    console.error("[selectBua] zoom error:", e?.message || e);
  }
}

export async function loadBuaList(layer, countyName) {
  state._buaLayer = layer;
  buaChartPanel.style.display = "flex";
  showChartLoading("Loading built-up areas…");

  try {
    // Await the national top-100 (already loading in background)
    const top100    = await state._buaTop100Promise;
    const cLower    = countyName.toLowerCase();
    const features  = top100.filter(g => {
      const c = g.attributes.county || g.attributes.County || "";
      return c.toLowerCase() === cLower;
    });

    document.getElementById("buaChartTitleCounty").textContent =
      countyName.charAt(0).toUpperCase() + countyName.slice(1).toLowerCase();

    buaChartBody.innerHTML = "";
    const ul = document.createElement("ul");
    ul.style.cssText = "list-style:none;padding:0;margin:0";

    features.forEach(graphic => {
      const a  = graphic.attributes || {};
      const nm = a.settlement || a.Settlement || "—";

      const li = document.createElement("li");
      li.style.cssText = "cursor:pointer;padding:7px 12px;border-bottom:1px solid #f5ece0;" +
                         "border-left:3px solid transparent;transition:background 0.15s";

      const nameEl = document.createElement("span");
      nameEl.className = "bua-name";
      nameEl.style.fontSize = "13px";
      nameEl.textContent = nm;
      li.appendChild(nameEl);

      li.addEventListener("mouseenter", () => {
        if (li !== state.activeBuaItem) li.style.background = "#fff3e0";
      });
      li.addEventListener("mouseleave", () => {
        if (li !== state.activeBuaItem) li.style.background = "";
      });
      li.addEventListener("click", () => selectBua(a, li));

      ul.appendChild(li);
    });

    buaChartBody.appendChild(ul);
    if (features.length === 0) {
      const empty = document.createElement("li");
      empty.style.cssText = "padding:10px 12px;color:#999;font-size:12px;";
      empty.textContent = "No built-up areas found for this county.";
      buaChartBody.appendChild(empty);
    }
  } catch (e) {
    console.error("[buaList] error:", e?.message || e?.details || e);
    showChartError("Built-up areas could not be loaded.", () => loadBuaList(layer, countyName));
  }
}
