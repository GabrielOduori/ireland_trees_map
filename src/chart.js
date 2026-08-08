// Canopy stats panel (the pie chart + headline numbers) and the BUA/municipal
// district/local authority chart-tab panel, including the ?county=&tab= URL
// sync so a chart state is shareable/reloadable.
//
// Circular import with county-list.js: refreshChartPanel needs to trigger
// loadBuaList/loadFilteredList (which list belongs to the active tab), and
// county-list.js's clearBuaList needs to sync the URL via updateUrlState.
// ES modules support this — both files' exports become available once the
// whole graph finishes loading, and neither of these functions is called
// during module evaluation itself (only later, from user interaction), so
// the circular reference is never actually dereferenced before it's ready.
import { state } from "./state.js";
import { CHART_TABS } from "./config.js";
import { loadBuaList, loadFilteredList } from "./county-list.js";

const canopyStatsTitle = document.getElementById("canopyStatsTitleText");
const buaChartPanel    = document.getElementById("buaChartPanel");
const buaChartBody     = document.getElementById("buaChartBody");
const buaChartHeader   = document.getElementById("buaChartHeader");

export function drawCanopyPie(ftPct, tofPct) {
  const svg = document.getElementById("canopyPie");
  svg.innerHTML = "";
  const ns = "http://www.w3.org/2000/svg";
  const cx = 45, cy = 45, r = 40, rInner = 24;
  const total = ftPct + tofPct;
  if (total === 0) return;

  function ptAt(radius, angle) {
    const rad = (angle - 90) * Math.PI / 180;
    return [cx + radius * Math.cos(rad), cy + radius * Math.sin(rad)];
  }
  function addSlice(start, end, fill) {
    if (Math.abs(end - start) >= 359.99) {
      const c = document.createElementNS(ns, "circle");
      c.setAttribute("cx", cx); c.setAttribute("cy", cy);
      c.setAttribute("r", r);   c.setAttribute("fill", fill);
      svg.appendChild(c); return;
    }
    const [x1,y1] = ptAt(r, start), [x2,y2] = ptAt(r, end);
    const p = document.createElementNS(ns, "path");
    p.setAttribute("d", `M${cx},${cy} L${x1},${y1} A${r},${r} 0 ${end-start>180?1:0} 1 ${x2},${y2} Z`);
    p.setAttribute("fill", fill);
    svg.appendChild(p);
  }
  function addLabel(midAngle, pct) {
    const rad = (midAngle - 90) * Math.PI / 180;
    const labelR = (r + rInner) / 2;
    const pctEl = document.createElementNS(ns, "text");
    pctEl.setAttribute("x", cx + labelR * Math.cos(rad));
    pctEl.setAttribute("y", cy + labelR * Math.sin(rad));
    pctEl.setAttribute("text-anchor", "middle");
    pctEl.setAttribute("dominant-baseline", "middle");
    pctEl.setAttribute("fill", "#222");
    pctEl.setAttribute("stroke", "#fff");
    pctEl.setAttribute("stroke-width", "3");
    pctEl.setAttribute("paint-order", "stroke");
    pctEl.setAttribute("font-size", "9");
    pctEl.setAttribute("font-weight", "600");
    pctEl.textContent = pct;
    svg.appendChild(pctEl);
  }
  const ftAngle = (ftPct / total) * 360;
  addSlice(0, ftAngle, "rgba(0,255,0,0.6)");
  addSlice(ftAngle, 360, "rgba(255,0,255,0.6)");

  // Punch the donut hole
  const hole = document.createElementNS(ns, "circle");
  hole.setAttribute("cx", cx); hole.setAttribute("cy", cy);
  hole.setAttribute("r", rInner);
  hole.setAttribute("fill", "white");
  svg.appendChild(hole);

  if (ftAngle > 25)           addLabel(ftAngle / 2,                  ftPct.toFixed(1)  + "%");
  if (360 - ftAngle > 25)     addLabel(ftAngle + (360 - ftAngle) / 2, tofPct.toFixed(1) + "%");
}

export function updateCanopyStats(ft, tof, canopyPct, canopyHa, label) {
  const total = ft + tof;
  const ftPct  = total > 0 ? ft  / total * 100 : 0;
  const tofPct = total > 0 ? tof / total * 100 : 0;
  canopyStatsTitle.textContent = label || "National Canopy";

  const statsPanel = document.getElementById("canopyStatsPanel");
  statsPanel.style.display = "flex"; // re-show if the user closed it earlier — county/national switches should always bring it back
  statsPanel.classList.remove("pulse");
  void statsPanel.offsetWidth; // force reflow so the animation re-triggers on repeat updates
  statsPanel.classList.add("pulse");
  document.getElementById("statTotalPct").textContent =
    canopyPct != null ? `${canopyPct.toFixed(1)} %` : "—";
  document.getElementById("statCanopyHa").textContent =
    canopyHa  != null ? `${canopyHa.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ha` : "—";
  drawCanopyPie(ftPct, tofPct);
}

export function showChartLoading(message = "Loading…") {
  buaChartBody.innerHTML = "";
  const li = document.createElement("li");
  li.className = "list-status";
  const spinner = document.createElement("span");
  spinner.className = "chart-spinner";
  const text = document.createElement("span");
  text.textContent = message;
  li.appendChild(spinner);
  li.appendChild(text);
  buaChartBody.appendChild(li);
}

export function showChartError(message, retryHandler) {
  buaChartBody.innerHTML = "";
  const errLi = document.createElement("li");
  errLi.className = "list-status error";
  const text = document.createElement("span");
  text.textContent = message;
  errLi.appendChild(text);
  const retryBtn = document.createElement("button");
  retryBtn.type = "button";
  retryBtn.textContent = "Try again";
  retryBtn.addEventListener("click", retryHandler);
  errLi.appendChild(retryBtn);
  buaChartBody.appendChild(errLi);
  buaChartPanel.style.display = "flex";
}

// Shareable URLs: keep ?county=&tab= in sync with current view
export function updateUrlState() {
  const params = new URLSearchParams();
  if (state._activeCountyName) {
    params.set("county", state._activeCountyName.toLowerCase());
    params.set("tab", state._activeChartTab);
  }
  const qs = params.toString();
  history.replaceState(null, "", window.location.pathname + (qs ? `?${qs}` : ""));
}

export function refreshChartPanel() {
  if (!state._activeCountyName) return;
  updateUrlState();
  const cfg = CHART_TABS[state._activeChartTab];
  buaChartHeader.style.background = cfg.color;
  buaChartHeader.style.color      = cfg.text;
  document.getElementById("buaChartTitleMain").textContent = cfg.label;

  if (state._activeChartTab === "bua") {
    loadBuaList(state.activeBuaLayer, state._activeCountyName);
  } else if (state._activeChartTab === "md") {
    loadFilteredList(state.activeMdLayer, state._activeCountyName, "Municipal Districts");
  } else {
    loadFilteredList(state.activeLaLayer, state._activeCountyName, "Local Authorities");
  }
}
