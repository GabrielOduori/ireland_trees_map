// Crown/BUA/filtered (municipal district / local authority) popups: DOM
// element ownership, draggable positioning, content builders, and the
// selection-highlight cleanup that closing a popup needs to perform.
//
// DOM lookups here are independent of any lookups for the same elements done
// elsewhere in the app — document.getElementById always resolves to the same
// live element regardless of how many places look it up, so no cross-file
// wiring is needed just to share a DOM reference (only genuinely mutable
// state, in state.js, needs that).
import { state } from "./state.js";
import { pickDisplayName } from "./utils.js";

const crownPopup       = document.getElementById("crownPopup");
const crownPopupHeader = document.getElementById("crownPopupHeader");
const buaPopup         = document.getElementById("buaPopup");
const buaPopupHeader   = document.getElementById("buaPopupHeader");
const buaPopupTitle    = document.getElementById("buaPopupTitle");
const buaPopupBody     = document.getElementById("buaPopupBody");
const buaChartPanel    = document.getElementById("buaChartPanel");

// Let users drag a popup off whatever it's covering — grab the header (not the
// close button) and reposition with the pointer; clamps to the viewport so it
// can't be dragged out of reach.
export function makeDraggable(popupEl, handleEl) {
  let dragging = false, startX, startY, startLeft, startTop;
  handleEl.addEventListener("pointerdown", (e) => {
    if (e.target.closest("button")) return;
    dragging = true;
    startX = e.clientX; startY = e.clientY;
    const rect = popupEl.getBoundingClientRect();
    startLeft = rect.left; startTop = rect.top;
    handleEl.setPointerCapture(e.pointerId);
    e.preventDefault();
  });
  handleEl.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    const pw = popupEl.offsetWidth, ph = popupEl.offsetHeight;
    let left = startLeft + (e.clientX - startX);
    let top  = startTop  + (e.clientY - startY);
    left = Math.max(4, Math.min(left, window.innerWidth  - pw - 4));
    top  = Math.max(4, Math.min(top,  window.innerHeight - ph - 4));
    popupEl.style.left = left + "px";
    popupEl.style.top  = top  + "px";
  });
  handleEl.addEventListener("pointerup",     () => { dragging = false; });
  handleEl.addEventListener("pointercancel", () => { dragging = false; });
}
makeDraggable(crownPopup, crownPopupHeader);
makeDraggable(buaPopup,   buaPopupHeader);

export function usesBottomPopupLayout() {
  return window.matchMedia("(max-width: 700px)").matches;
}

export function collapseMapPanelsForMobile() {
  if (!usesBottomPopupLayout()) return;
  state.collapseCountySheetForMobile();
  buaChartPanel.style.display = "none";
}

export function clearCrownSelection() {
  crownPopup.style.display = "none";
  if (state.crownHighlight) { state.crownHighlight.remove(); state.crownHighlight = null; }
}

export function closeBuaPopup() {
  buaPopup.style.display = "none";
  if (state.buaHighlight)       { state.buaHighlight.remove(); state.buaHighlight = null; }
  if (state.activeBuaItem)      { state.activeBuaItem.classList.remove("active"); state.activeBuaItem = null; }
  if (state.filteredHighlight)  { state.filteredHighlight.remove(); state.filteredHighlight = null; }
  if (state.activeFilteredItem) { state.activeFilteredItem.classList.remove("active"); state.activeFilteredItem = null; }
}

export function buildPopupContent(a) {
  // Field names vary by publish convention:
  //   standard (Dublin-style): tree_class, height_m, max_height_m, crown_area_m2, ntm_id, perimeter, county
  //   raw PostGIS export (Waterford-style): Class, Mean, Max_, crown_area_m2, NTM_ID, Perimeter, County
  const tc   = (a.tree_class || a.class || a.Class || "").toLowerCase();
  const type = tc === "ft"  ? "Forest Trees"
             : tc === "tof" ? "Trees Outside Forests"
             : tc || "—";
  const fmt  = (v, dp = 1) => v != null ? Number(v).toFixed(dp) : "—";
  const meanH = a.height_m     ?? a.mean  ?? a.Mean;
  const maxH  = a.max_height_m ?? a.max   ?? a.Max_;
  const area  = a.crown_area_m2 ?? a.area ?? a.Area;
  const treeId  = a.ntm_id    || a.NTM_ID    || "—";
  const perim   = a.perimeter ?? a.Perimeter;

  const table = document.createElement("table");
  table.style.cssText = "width:100%;table-layout:fixed;border-collapse:collapse;font-size:13px";
  [
    ["Type",        type],
    ["Tree ID",     treeId],
    ["Mean Height", `${fmt(meanH)} m`],
    ["Max Height",  `${fmt(maxH)} m`],
    ["Crown Area",  `${fmt(area, 2)} m²`],
    ["Perimeter",   `${fmt(perim)} m`],
  ].forEach(([label, value], i) => {
    const tr  = document.createElement("tr");
    const td1 = document.createElement("td");
    td1.style.cssText = "padding:3px 6px;color:#666;width:90px;white-space:nowrap;";
    td1.textContent = label;
    const td2 = document.createElement("td");
    td2.style.cssText = (i === 0 ? "padding:3px 6px;font-weight:600;" : "padding:3px 6px;") +
                         "overflow-wrap:break-word;";
    td2.textContent = value;
    tr.appendChild(td1); tr.appendChild(td2);
    table.appendChild(tr);
  });
  return table;
}

export function buildCanopyStatCard(canopyCoverPct, table) {
  const wrap = document.createElement("div");
  const numericCanopyCoverPct = canopyCoverPct != null ? Number(canopyCoverPct) : null;
  if (Number.isFinite(numericCanopyCoverPct)) {
    const hero = document.createElement("div");
    hero.style.cssText = "padding:2px 0 8px;margin-bottom:4px;border-bottom:1px solid #eee;text-align:center;";
    const label = document.createElement("div");
    label.style.cssText = "color:#666;font-size:11px;text-transform:uppercase;letter-spacing:0.04em;";
    label.textContent = "Canopy Cover";
    const value = document.createElement("div");
    value.style.cssText = "font-size:28px;font-weight:700;line-height:1.1;color:#222;";
    value.textContent = `${numericCanopyCoverPct.toFixed(1)} %`;
    hero.appendChild(label);
    hero.appendChild(value);
    wrap.appendChild(hero);
  }
  wrap.appendChild(table);
  return wrap;
}

export function buildBuaPopupContent(attrs) {
  function getVal(keys) {
    for (const k of keys) { if (attrs[k] != null) return attrs[k]; }
    return undefined;
  }

  const table = document.createElement("table");
  table.style.cssText = "width:100%;border-collapse:collapse;font-size:13px";

  function addRow(label, val, pct, dp) {
    if (val == null) return;
    const display = (pct && typeof val === "number")
      ? val.toFixed(1) + " %"
      : (dp != null && typeof val === "number")
      ? val.toLocaleString(undefined, { minimumFractionDigits: dp, maximumFractionDigits: dp })
      : (typeof val === "number" ? val.toLocaleString() : String(val));
    const tr  = document.createElement("tr");
    const td1 = document.createElement("td");
    td1.style.cssText = "padding:3px 8px 3px 0;color:#666;white-space:nowrap";
    td1.textContent = label;
    const td2 = document.createElement("td");
    td2.style.cssText = "padding:3px 0;font-weight:600";
    td2.textContent = display;
    tr.appendChild(td1); tr.appendChild(td2);
    table.appendChild(tr);
  }

  function addSeparator() {
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.colSpan = 2;
    td.style.cssText = "padding:4px 0;border-top:1px solid #eee;";
    tr.appendChild(td);
    table.appendChild(tr);
  }

  const population     = getVal(["Population", "population"]);
  const canopyCoverPct = getVal(["canopy_cover_pct", "Canopy_cover_pct"]);
  const ftCanopyPct    = getVal(["ft_canopy_cover_pct", "Ft_canopy_cover_pct", "FT_canopy_cover_pct"]);
  const tofCanopyPct   = getVal(["tof_canopy_cover_pct", "Tof_canopy_cover_pct", "TOF_canopy_cover_pct"]);
  const canopyAreaKm2  = getVal(["total_canopy_area_km2", "Total_canopy_area_km2"]);
  const landAreaKm2    = getVal(["land_area_km2", "Land_area_km2", "land_area"]);
  const avgHeightM     = getVal(["max_avg_height_m", "Max_avg_height_m", "avg_height_m", "Avg_height_m"]);

  addRow("Population",   population);
  addRow("Forest Canopy", ftCanopyPct, true);
  addRow("Canopy Outside Forest", tofCanopyPct, true);

  if (population && canopyAreaKm2 != null) {
    addSeparator();
    const perPerson = (canopyAreaKm2 * 1e6) / population;
    const tr   = document.createElement("tr");
    // Single combined icon (tree pictogram + its own "Canopy per Capita" text,
    // baked into the artwork) rather than icon + separate HTML label — sized big
    // enough (90px tall) that the embedded text is actually legible. Spans both
    // columns since at this size it doesn't share a row with the value cleanly.
    const tdIcon = document.createElement("td");
    tdIcon.colSpan = 2;
    tdIcon.style.cssText = "padding:6px 0;text-align:center;";
    const icon = document.createElement("img");
    icon.src = "assets/CanopyperCapita8.svg";
    icon.alt = "Canopy area per person";
    icon.style.cssText = "height:90px;width:auto;vertical-align:middle;";
    const val = document.createElement("span");
    val.style.cssText = "font-weight:600;margin-left:8px;vertical-align:middle;";
    val.textContent = perPerson.toFixed(0) + " m²";
    tdIcon.appendChild(icon);
    tdIcon.appendChild(val);
    tr.appendChild(tdIcon);
    table.appendChild(tr);
    addSeparator();
  }

  addRow("Canopy area (km²)", canopyAreaKm2, false, 2);
  addRow("Land area (km²)",   landAreaKm2,   false, 2);

  // Placed after Land area, away from the canopy-per-capita tree icon above —
  // otherwise that icon reads as if it's illustrating "the largest tree."
  if (avgHeightM != null) {
    addRow("Tallest Tree", `${avgHeightM.toFixed(1)} m`);
  }

  return buildCanopyStatCard(canopyCoverPct, table);
}

export function showPopupAt(title, contentEl, mapPoint) {
  buaPopupTitle.textContent = title;
  buaPopupBody.innerHTML = "";
  buaPopupBody.appendChild(contentEl);
  const pt = state.view.toScreen(mapPoint);
  const vr = document.getElementById("viewDiv").getBoundingClientRect();
  let left = vr.left + pt.x + 14;
  let top  = vr.top  + pt.y - 40;
  buaPopup.style.display = "block";
  if (usesBottomPopupLayout()) {
    collapseMapPanelsForMobile();
    buaPopup.style.left = "";
    buaPopup.style.top = "";
    return;
  }
  const pw = buaPopup.offsetWidth, ph = buaPopup.offsetHeight;

  // The right side panel sits on top of the map (fixed, right:0) but below the
  // popup's z-index — treat its left edge as the right-hand boundary too, so the
  // popup doesn't render on top of it when expanded.
  const sidePanel = document.getElementById("sidePanelWrapper");
  let rightBound = window.innerWidth - 8;
  if (sidePanel && !sidePanel.classList.contains("collapsed")) {
    rightBound = Math.min(rightBound, sidePanel.getBoundingClientRect().left - 8);
  }

  if (left + pw > rightBound) left = vr.left + pt.x - pw - 14;
  if (left < 8) left = 8;
  if (top  + ph > window.innerHeight - 8) top  = window.innerHeight - ph - 8;
  if (top < 60) top = 60;
  buaPopup.style.left = left + "px";
  buaPopup.style.top  = top  + "px";
}

export function openBuaPopup(attrs, mapPoint) {
  const title = pickDisplayName(attrs);
  showPopupAt(`Built-up Area: ${title === "—" ? "—" : title}`, buildBuaPopupContent(attrs), mapPoint);
}

export function buildFilteredPopupContent(attrs) {
  function getVal(keys) {
    for (const k of keys) { if (attrs[k] != null) return attrs[k]; }
    return undefined;
  }

  const table = document.createElement("table");
  table.style.cssText = "width:100%;border-collapse:collapse;font-size:13px";

  function addRow(label, val, pct, dp) {
    if (val == null) return;
    const display = (pct && typeof val === "number")
      ? val.toFixed(1) + " %"
      : (dp != null && typeof val === "number")
      ? val.toLocaleString(undefined, { minimumFractionDigits: dp, maximumFractionDigits: dp })
      : (typeof val === "number" ? val.toLocaleString() : String(val));
    const tr  = document.createElement("tr");
    const td1 = document.createElement("td");
    td1.style.cssText = "padding:3px 8px 3px 0;color:#666;white-space:nowrap";
    td1.textContent = label;
    const td2 = document.createElement("td");
    td2.style.cssText = "padding:3px 0;font-weight:600";
    td2.textContent = display;
    tr.appendChild(td1); tr.appendChild(td2);
    table.appendChild(tr);
  }

  const canopyAreaKm2 = getVal(["total_canopy_area_km2", "Total_canopy_area_km2", "canopy_area_km2", "Canopy_area_km2"]);
  const landAreaKm2   = getVal(["land_area_km2", "Land_area_km2", "land_area"]);
  const ftCanopyPct   = getVal(["ft_canopy_cover_pct", "Ft_canopy_cover_pct", "FT_canopy_cover_pct"]);
  const tofCanopyPct  = getVal(["tof_canopy_cover_pct", "Tof_canopy_cover_pct", "TOF_canopy_cover_pct"]);
  let   canopyPct     = getVal(["canopy_cover_pct", "Canopy_cover_pct", "canopy_pct", "Canopy_pct"]);
  if (canopyPct == null && canopyAreaKm2 != null && landAreaKm2) {
    canopyPct = (canopyAreaKm2 / landAreaKm2) * 100;
  }

  addRow("Forest Canopy", ftCanopyPct, true);
  addRow("Canopy Outside Forest", tofCanopyPct, true);
  addRow("Canopy area (km²)", canopyAreaKm2, false, 2);
  addRow("Land area (km²)",   landAreaKm2,   false, 2);

  return buildCanopyStatCard(canopyPct, table);
}

export function openFilteredPopup(attrs, mapPoint) {
  const label = state._activeChartTab === "md" ? "Municipal District" : "Local Authority";
  const name = pickDisplayName(attrs);
  const title = name.toLowerCase().startsWith(label.toLowerCase())
    ? name
    : `${label}: ${name}`;
  showPopupAt(title, buildFilteredPopupContent(attrs), mapPoint);
}
