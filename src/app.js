    import {
      MUNICIPAL_DISTRICT_LAYER_ITEM_ID, BUA_LAYER_ITEM_ID, LOCAL_AUTHORITY_LAYER_ITEM_ID,
      COUNTY_LAYER_ITEM_ID, COUNTY_STATS_FIELDS, BOUNDARY_STATS_FIELDS, CROWN_POPUP_FIELDS,
      BUA_FLASH_SCALE, CHART_TABS,
    } from "./config.js";
    import { state } from "./state.js";
    import {
      existingOutFields, applyExistingOutFields, escapeSql,
      titleCase, maybeTitleCase, pickDisplayName,
    } from "./utils.js";
    import {
      usesBottomPopupLayout, collapseMapPanelsForMobile, clearCrownSelection, closeBuaPopup,
      buildPopupContent, showPopupAt, openBuaPopup, openFilteredPopup,
    } from "./popups.js";
    import { buildCrownTileLayer, blinkHighlight } from "./crown-layer.js";
    import { updateCanopyStats, refreshChartPanel } from "./chart.js";
    import { clearBuaList } from "./county-list.js";

    const startupStatusBadge = document.getElementById("crownLoadingBadge");
    const startupStatusText = startupStatusBadge?.querySelector("span:last-child");
    function showStartupStatus(message, isError = false) {
      if (!startupStatusBadge || !startupStatusText) return;
      startupStatusText.textContent = message;
      startupStatusBadge.classList.toggle("error", isError);
      startupStatusBadge.classList.add("visible");
    }

    const esriConfig      = await $arcgis.import("@arcgis/core/config.js");
    const OAuthInfo       = await $arcgis.import("@arcgis/core/identity/OAuthInfo.js");
    const IdentityManager = await $arcgis.import("@arcgis/core/identity/IdentityManager.js");

    const oauthInfo = new OAuthInfo({
      appId: "C8Y5qInEMyUQtRm6",
      popup: false
    });
    IdentityManager.registerOAuthInfos([oauthInfo]);

    // Reuse existing session silently; redirect to sign-in only if needed
    let _cred;
    try {
      _cred = await IdentityManager.checkSignInStatus("https://www.arcgis.com/sharing");
    } catch (_) {
      try {
        _cred = await IdentityManager.getCredential("https://www.arcgis.com/sharing");
      } catch (e) {
        console.error("[auth] ArcGIS sign-in failed:", e?.message || e);
        showStartupStatus("ArcGIS sign-in failed. Check the registered redirect URL.", true);
        throw e;
      }
    }

    // Explicitly register the portal credential for the tile CDN so VTL requests are authenticated
    if (_cred) {
      try {
        IdentityManager.registerToken({
          server:  "https://tiles-eu1.arcgis.com",
          token:   _cred.token,
          expires: _cred.expires,
          ssl:     true,
          userId:  _cred.userId
        });
      } catch (_) {}
    }

    const SimpleFillSymbol   = await $arcgis.import("@arcgis/core/symbols/SimpleFillSymbol.js");
    const SimpleRenderer     = await $arcgis.import("@arcgis/core/renderers/SimpleRenderer.js");
    const UniqueValueRenderer = await $arcgis.import("@arcgis/core/renderers/UniqueValueRenderer.js");
    const geometryEngine     = await $arcgis.import("@arcgis/core/geometry/geometryEngine.js");
    const Polygon            = await $arcgis.import("@arcgis/core/geometry/Polygon.js");
    const Map               = await $arcgis.import("@arcgis/core/Map.js");
    const MapView           = await $arcgis.import("@arcgis/core/views/MapView.js");
    const Search            = await $arcgis.import("@arcgis/core/widgets/Search.js");
    const ScaleBar          = await $arcgis.import("@arcgis/core/widgets/ScaleBar.js");
    const FeatureLayer      = await $arcgis.import("@arcgis/core/layers/FeatureLayer.js");
    const GraphicsLayer     = await $arcgis.import("@arcgis/core/layers/GraphicsLayer.js");
    const Graphic           = await $arcgis.import("@arcgis/core/Graphic.js");
    const VectorTileLayer   = await $arcgis.import("@arcgis/core/layers/VectorTileLayer.js");
    const TileLayer         = await $arcgis.import("@arcgis/core/layers/TileLayer.js");
    const MapImageLayer     = await $arcgis.import("@arcgis/core/layers/MapImageLayer.js");
    const Portal            = await $arcgis.import("@arcgis/core/portal/Portal.js");
    const PortalQueryParams = await $arcgis.import("@arcgis/core/portal/PortalQueryParams.js");
    const Basemap           = await $arcgis.import("@arcgis/core/Basemap.js");

    // ---------------------------------------------------------------------------
    // Discover published county crown layers from ArcGIS Online
    // ---------------------------------------------------------------------------
    // Populated live below from the county stats hosted feature layer
    // (COUNTY_LAYER_ITEM_ID) — replaces the old hardcoded per-county snapshot.


    try {
      const portal = new Portal({ url: "https://www.arcgis.com", authMode: "immediate" });
      await portal.load();
      state._portal = portal;

      // County stats — replaces the old hardcoded state.countyStatsMap with a live query
      // against mv_county_stats, published the same way as BUA/MD/LA.
      try {
        const countyPortalRef = { id: COUNTY_LAYER_ITEM_ID, portal };
        const countyStatsLayer = new FeatureLayer({ portalItem: countyPortalRef });
        await countyStatsLayer.load();
        const csq = countyStatsLayer.createQuery();
        csq.where          = "1=1";
        csq.outFields      = existingOutFields(countyStatsLayer, COUNTY_STATS_FIELDS);
        csq.returnGeometry = false;
        const { features: countyFeatures } = await countyStatsLayer.queryFeatures(csq);
        countyFeatures.forEach(f => {
          const a   = f.attributes;
          const key = (a.county_name || "").toUpperCase();
          if (!key) return;
          state.countyStatsMap[key] = {
            ft:                 a.forest_trees,
            tof:                a.trees_outside_forests,
            canopy_pct:         a.canopy_cover_pct,
            ft_canopy_pct:      a.ft_canopy_cover_pct,
            tof_canopy_pct:     a.tof_canopy_cover_pct,
            // mv_county_stats stores km² — state.countyStatsMap/updateCanopyStats expect ha.
            canopy_ha:          a.total_canopy_area_km2 != null ? a.total_canopy_area_km2 * 100 : null,
            land_area_km2:       a.land_area_km2,
            max_height_m:       a.max_height_m,
            max_crown_area_m2:  a.max_canopy_area_m2
          };
        });
      } catch (e) {
        console.warn("County stats layer query failed — canopy stats panel/county list will be empty:", e);
        showStartupStatus("County canopy statistics could not be loaded.", true);
      }

      // Feature layers — tagged IrelandsTREEMAP
      const crownItems = await portal.queryItems(new PortalQueryParams({
        query: 'tags:"IrelandsTREEMAP" AND type:"Feature Service" AND title:"Ireland_Trees_Crowns"',
        num: 50, sortField: "title", sortOrder: "asc"
      }));

      // Tile layers — search by owner to bypass type ambiguity and index lag.
      // UploadServiceDefinition_server can produce "Tile Layer", "Map Service", or
      // "Hosted Tile Layer" depending on ArcGIS Pro version — owner: avoids all that.
      const tileQuery = `tags:"IrelandsTREEMAP" AND title:"Ireland_Trees_Crowns_VTL"`;
      const tileItems = await portal.queryItems(new PortalQueryParams({
        query: tileQuery, num: 50, sortField: "title", sortOrder: "asc"
      }));


      crownItems.results.forEach(item => {
        const raw    = item.title.replace("Ireland_Trees_Crowns_", "").toUpperCase();
        // Strip alphabetic split suffix (_A, _B, _C …) so all parts map to the same county key
        const county = raw.replace(/_[A-Z]$/, "");
        if (!state.crownLayerMap[county]) state.crownLayerMap[county] = [];
        state.crownLayerMap[county].push(item.id);
      });
      // Prefer Map Service / Tile Layer over Service Definition staging artifacts.
      // Build a map keyed by county, keeping the best-typed item.
      const TILE_TYPES = ["Vector Tile Service", "Tile Layer", "Map Service", "Hosted Tile Layer", "Map Image Layer"];
      // Unknown types (e.g. Feature Service, Service Definition) get Infinity so they never win.
      const tilePriority = t => { const i = TILE_TYPES.indexOf(t); return i === -1 ? Infinity : i; };

      tileItems.results.forEach(item => {
        if (tilePriority(item.type) === Infinity) return;   // skip non-tile types
        const county = item.title.replace("Ireland_Trees_Crowns_VTL_", "").toUpperCase();
        const existing = state.crownTileLayerMap[county];
        if (!existing || tilePriority(item.type) < tilePriority(existing.type)) {
          state.crownTileLayerMap[county] = { id: item.id, type: item.type, url: item.url };
        }
      });
    } catch (e) {
      console.warn("Crown layer discovery failed:", e);
      showStartupStatus("Canopy layer discovery failed.", true);
    }

    // ---------------------------------------------------------------------------
    // Canopy stats panel (bottom-left)
    // ---------------------------------------------------------------------------
    document.getElementById("canopyStatsClose").addEventListener("click", () => {
      document.getElementById("canopyStatsPanel").style.display = "none";
    });


    // Initialise with national totals
    {
      const allVals  = Object.values(state.countyStatsMap);
      const natFt    = allVals.reduce((s, c) => s + (c.ft       || 0), 0);
      const natTof   = allVals.reduce((s, c) => s + (c.tof      || 0), 0);
      const natHa    = allVals.reduce((s, c) => s + (c.canopy_ha || 0), 0);
      const natPct   = natHa > 0 ? natHa / 7027300 * 100 : null;  // 7,027,300 ha = ROI land area (70,273 km²)
      updateCanopyStats(natFt, natTof, natPct, natHa > 0 ? natHa : null);
    }

    // Shared renderer for crown polygon layers (uses renamed field tree_class).
    // Colours from docs/deployment/symbology_tips.txt Part 2.
    // 40% transparency = alpha 0.6.
    const crownRenderer = new UniqueValueRenderer({
      valueExpression: "var cls = $feature.tree_class; if (IsEmpty(cls)) cls = $feature.Class; return Lower(cls);",
      uniqueValueInfos: [
        {
          value: "ft",
          symbol: new SimpleFillSymbol({
            color: [0, 255, 0, 0.6],
            outline: { color: [0, 255, 0, 0.6], width: 0.5 }
          }),
          label: "Forest Trees"
        },
        {
          value: "tof",
          symbol: new SimpleFillSymbol({
            color: [255, 0, 255, 0.6],
            outline: { color: [255, 0, 255, 0.6], width: 0.5 }
          }),
          label: "Trees Outside Forests"
        }
      ],
      defaultSymbol: null,
      defaultLabel: ""
    });

    const crownPopupTemplate = {
      title: "Tree Crown — {county}",
      expressionInfos: [{
        name: "treeType",
        title: "Tree Type",
        expression: "IIF(Lower($feature.tree_class) == 'ft', 'Forest Trees', IIF(Lower($feature.tree_class) == 'tof', 'Trees Outside Forests', $feature.tree_class))",
        returnType: "string"
      }],
      content: [{
        type: "fields",
        fieldInfos: [
          { fieldName: "expression/treeType", label: "Type",           visible: true },
          { fieldName: "ntm_id",              label: "Tree ID",        visible: true },
          { fieldName: "height_m",            label: "Mean Height (m)", visible: true, format: { places: 1, digitSeparator: true } },
          { fieldName: "max_height_m",        label: "Max Height (m)",  visible: true, format: { places: 1, digitSeparator: true } },
          { fieldName: "crown_area_m2",       label: "Crown Area (m²)", visible: true, format: { places: 1, digitSeparator: true } },
          { fieldName: "perimeter",           label: "Perimeter (m)",   visible: true, format: { places: 1, digitSeparator: true } },
        ]
      }]
    };

    const map = new Map({ basemap: "hybrid" });

    // National overview — one VTL per county (Ireland_Trees_Crowns_VTL_<COUNTY>,
    // discovered above into state.crownTileLayerMap) shown together, replacing the old
    // 28-service groupServiceNames split.
    const vectorTileLayers = Object.entries(state.crownTileLayerMap).map(([county, info]) => {
      const layer = buildCrownTileLayer(info);
      layer.on("layerview-create-error", e =>
        console.error(`[national-vtl] failed to render ${county} tile layer:`, e.error));
      map.add(layer);
      return layer;
    });
    if (!vectorTileLayers.length) {
      console.warn("[national-vtl] No per-county VTLs found — landing page will have no national overview layer.");
    }

    const countyLayer = new FeatureLayer({
      portalItem: state._portal
        ? { id: COUNTY_LAYER_ITEM_ID, portal: state._portal }
        : { id: COUNTY_LAYER_ITEM_ID },
      outFields: ["*"],
      visible: false
    });

    function getCountyName(attrs = {}) {
      return attrs.county_name || attrs.COUNTY || attrs.ENGLISH || "";
    }

    const countyOutlineLayer = new GraphicsLayer();
    map.add(countyOutlineLayer);

    const view = new MapView({
      container: "viewDiv",
      map: map,
      center: [-8, 53],
      zoom: 7
    });

    // Published into shared state for modules that don't have direct access to
    // these locals (e.g. popups.js's showPopupAt needs view.toScreen()). Safe as a
    // one-time mirror since none of these four are ever reassigned after creation
    // — only mutated via their own methods (map.add/map.remove etc).
    state.map = map;
    state.view = view;
    state.countyLayer = countyLayer;
    state.countyOutlineLayer = countyOutlineLayer;

    // Default highlight (subtle cyan glow) was hard to spot against both basemaps —
    // brighten it for every highlight() call in the app (BUA/MD/LA selection, search flash).
    view.highlightOptions = {
      color:       [255, 255, 0, 1],
      haloOpacity: 0.9,
      fillOpacity: 0.25
    };



    // BUA discoverability — "other BUAs" give no cue they're clickable (original
    // feedback). Each BUA's object id is blinked here at most once per session,
    // whether the trigger is a search landing on it or normal zoom/pan bringing it
    // into view — shared so the two triggers don't double-blink the same BUA.
    const _flashedBuaIds = new Set();

    async function flashNewlyVisibleBuas() {
      const layer = state.activeBuaLayer;
      if (!layer || view.scale > BUA_FLASH_SCALE) return;
      try {
        const lv = await view.whenLayerView(layer);
        const oidField = layer.objectIdField || "OBJECTID";
        const q = layer.createQuery();
        q.geometry            = view.extent;
        q.spatialRelationship = "intersects";
        q.returnGeometry      = false;
        q.outFields           = [oidField];
        const { features } = await layer.queryFeatures(q);
        const newIds = [];
        features.forEach(f => {
          const id = f.attributes[oidField];
          if (id == null || _flashedBuaIds.has(id)) return;
          _flashedBuaIds.add(id);
          newIds.push(id);
        });
        if (newIds.length) blinkHighlight(lv, newIds);
      } catch (_) {}
    }
    view.watch("stationary", (stationary) => { if (stationary) flashNewlyVisibleBuas(); });


    view.when(() => {
      const countyList      = document.getElementById("countyList");
      const countyPanel     = document.getElementById("countyPanel");
      const countySortSelect = document.getElementById("countySortSelect");
      const countySortMetricHint = document.getElementById("countySortMetricHint");
      const layerToggleRow    = document.getElementById("layerToggleRow");
      const crownLayerToggle  = document.getElementById("crownLayerToggle");
      let activeItem           = null;
      let activeCrownTileLayer = null;
      let _vtlHandoffHandle   = null;   // scale watcher cleaned up on county change
      let panelCollapsed       = false;
      const _countyLookup      = {};    // lowercase county name -> { item, feature, name }, built as the list loads

      state.collapseCountySheetForMobile = () => {
        if (!usesBottomPopupLayout() || panelCollapsed) return;
        panelCollapsed = true;
        sidePanelWrapper.classList.add("collapsed");
        collapseBtn.innerHTML = "&#8249;";
        collapseBtn.style.right = "0";
        updateViewPadding();
      };

      // ---------------------------------------------------------------------------
      // Shareable URLs: restore ?county=&tab= on initial page load
      // ---------------------------------------------------------------------------
      function restoreFromUrl() {
        const params     = new URLSearchParams(window.location.search);
        const countyParam = params.get("county");
        if (!countyParam) return;
        const entry = _countyLookup[countyParam.toLowerCase()];
        if (!entry) return;
        const tabParam = params.get("tab");
        if (tabParam && CHART_TABS[tabParam]) {
          state._activeChartTab = tabParam;
          document.querySelectorAll(".chart-tab").forEach(b =>
            b.classList.toggle("active", b.dataset.tab === tabParam));
        }
        activateCounty(entry.name, entry.feature, entry.item, true);
      }

      // ---------------------------------------------------------------------------
      // County list filter: type-to-search with highlighting + keyboard nav
      // ---------------------------------------------------------------------------
      function setUpCountySearch() {
        const input = document.getElementById("countySearchInput");
        let kbdFocusIndex = -1;

        function visibleItems() {
          return Array.from(countyList.querySelectorAll("li")).filter(li => !li.classList.contains("no-match"));
        }

        function highlightMatch(nameSpan, fullName, query) {
          nameSpan.innerHTML = "";
          if (!query) { nameSpan.textContent = fullName; return; }
          const idx = fullName.toLowerCase().indexOf(query.toLowerCase());
          if (idx === -1) { nameSpan.textContent = fullName; return; }
          if (idx > 0) nameSpan.appendChild(document.createTextNode(fullName.slice(0, idx)));
          const mark = document.createElement("mark");
          mark.textContent = fullName.slice(idx, idx + query.length);
          nameSpan.appendChild(mark);
          if (idx + query.length < fullName.length) {
            nameSpan.appendChild(document.createTextNode(fullName.slice(idx + query.length)));
          }
        }

        function updateKbdFocus(visible) {
          visible.forEach((li, i) => li.classList.toggle("kbd-focus", i === kbdFocusIndex));
          const focused = visible[kbdFocusIndex];
          if (focused) focused.scrollIntoView({ block: "nearest" });
        }

        function applyFilter() {
          const query = input.value.trim();
          kbdFocusIndex = -1;
          countyList.querySelectorAll("li").forEach(li => {
            const fullName = li.dataset.name;
            const nameSpan = li.querySelector(".county-name");
            const matches  = !query || fullName.toLowerCase().includes(query.toLowerCase());
            li.classList.remove("kbd-focus");
            li.classList.toggle("no-match", !matches);
            highlightMatch(nameSpan, fullName, matches ? query : "");
          });
        }

        input.addEventListener("input", applyFilter);
        countyList.applyFilter = applyFilter;

        input.addEventListener("keydown", (e) => {
          const visible = visibleItems();
          if (e.key === "ArrowDown") {
            e.preventDefault();
            kbdFocusIndex = Math.min(kbdFocusIndex + 1, visible.length - 1);
            updateKbdFocus(visible);
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            kbdFocusIndex = Math.max(kbdFocusIndex - 1, 0);
            updateKbdFocus(visible);
          } else if (e.key === "Enter") {
            e.preventDefault();
            const target = visible[kbdFocusIndex] || visible[0];
            if (target) target.click();
          } else if (e.key === "Escape") {
            input.value = "";
            applyFilter();
            input.blur();
          }
        });
      }

      const buaLayerToggle   = document.getElementById("buaLayerToggle");
      const mdLayerToggle    = document.getElementById("mdLayerToggle");
      const laLayerToggle    = document.getElementById("laLayerToggle");

      crownLayerToggle.addEventListener("change", () => {
        state.activeCrownLayers.forEach(l => l.visible = crownLayerToggle.checked);
        if (activeCrownTileLayer) activeCrownTileLayer.visible = crownLayerToggle.checked;
      });
      buaLayerToggle.addEventListener("change", () => {
        if (state.activeBuaLayer) state.activeBuaLayer.visible = buaLayerToggle.checked;
      });
      mdLayerToggle.addEventListener("change", () => {
        if (state.activeMdLayer) state.activeMdLayer.visible = mdLayerToggle.checked;
      });
      laLayerToggle.addEventListener("change", () => {
        if (state.activeLaLayer) state.activeLaLayer.visible = laLayerToggle.checked;
      });

      // ---------------------------------------------------------------------------
      // view.padding tells ArcGIS the panel obscures the right side, so all
      // UI widgets are placed in the visible map area
      // ---------------------------------------------------------------------------
      function updateViewPadding() {
        if (usesBottomPopupLayout()) {
          view.padding = { right: 0, bottom: panelCollapsed ? 0 : Math.min(countyPanel.offsetHeight, window.innerHeight * 0.42) };
        } else {
          view.padding = { right: panelCollapsed ? 0 : countyPanel.offsetWidth, bottom: 0 };
        }
      }
      updateViewPadding();
      new ResizeObserver(updateViewPadding).observe(countyPanel);
      window.addEventListener("resize", updateViewPadding);

      // ---------------------------------------------------------------------------
      // Panel collapse toggle
      // ---------------------------------------------------------------------------
      const collapseBtn = document.getElementById("collapseBtn");
      const sidePanelWrapper = document.getElementById("sidePanelWrapper");
      collapseBtn.style.right = `${countyPanel.offsetWidth}px`;
      collapseBtn.addEventListener("click", () => {
        panelCollapsed = !panelCollapsed;
        sidePanelWrapper.classList.toggle("collapsed", panelCollapsed);
        collapseBtn.innerHTML = panelCollapsed ? "&#8249;" : "&#8250;";
        collapseBtn.style.right = panelCollapsed ? "0" : `${countyPanel.offsetWidth}px`;
        updateViewPadding();
      });

      // ---------------------------------------------------------------------------
      // Home button (in header — always visible)
      // ---------------------------------------------------------------------------
      document.getElementById("homeBtn").addEventListener("click", goHome);

      // ---------------------------------------------------------------------------
      // Info modal
      // ---------------------------------------------------------------------------
      const infoOverlay = document.getElementById("infoOverlay");
      document.getElementById("currentYear").textContent = new Date().getFullYear();
      function closeInfoModal() {
        infoOverlay.classList.remove("visible");
      }
      document.getElementById("infoBtn").addEventListener("click", () => {
        infoOverlay.classList.add("visible");
      });
      document.getElementById("infoModalClose").addEventListener("click", () => {
        closeInfoModal();
      });
      infoOverlay.addEventListener("click", (e) => {
        if (e.target === infoOverlay) closeInfoModal();
      });

      // ---------------------------------------------------------------------------
      // Search (floating overlay)
      // ---------------------------------------------------------------------------
      const search = new Search({
        view,
        container: "floatingSearch",
        popupEnabled: false,
        placeholder: "Search by address or Eircode..."
      });

      // ---------------------------------------------------------------------------
      // Zoom buttons
      // ---------------------------------------------------------------------------
      document.getElementById("zoomInBtn").addEventListener("click",  () => { view.zoom += 1; });
      document.getElementById("zoomOutBtn").addEventListener("click", () => { view.zoom -= 1; });

      // ---------------------------------------------------------------------------
      // Map widgets (rendered in HTML containers — not view.ui.add)
      // ---------------------------------------------------------------------------
      const basemapOptions = [
        { id: "hybrid", label: "Hybrid", swatch: "hybrid" },
        { id: "satellite", label: "Satellite", swatch: "satellite" },
        { id: "streets-vector", label: "Streets", swatch: "streets" },
        { id: "topo-vector", label: "Topographic", swatch: "topo" },
        { id: "dark-gray-vector", label: "Dark", swatch: "dark" },
      ];
      const basemapPanel = document.getElementById("basemapPanel");
      const basemapBtn = document.getElementById("basemapBtn");
      const mobileToolsBtn = document.getElementById("mobileToolsBtn");
      const mapTools = document.getElementById("mapTools");

      function closeMobileTools() {
        document.body.classList.remove("tools-open");
        mobileToolsBtn.setAttribute("aria-expanded", "false");
      }

      function renderBasemapPicker(activeId) {
        basemapPanel.innerHTML = "";
        const title = document.createElement("div");
        title.className = "basemap-panel-title";
        title.textContent = "Choose basemap";
        basemapPanel.appendChild(title);
        basemapOptions.forEach(option => {
          const btn = document.createElement("button");
          btn.type = "button";
          btn.className = `basemap-option${option.id === activeId ? " active" : ""}`;
          btn.setAttribute("aria-pressed", option.id === activeId ? "true" : "false");

          const swatch = document.createElement("span");
          swatch.className = `basemap-swatch ${option.swatch}`;
          const label = document.createElement("span");
          label.className = "basemap-option-label";
          label.textContent = option.label;
          const check = document.createElement("span");
          check.className = "basemap-check";
          check.textContent = "✓";
          btn.appendChild(swatch);
          btn.appendChild(label);
          btn.appendChild(check);

          btn.addEventListener("click", () => {
            map.basemap = Basemap.fromId(option.id);
            renderBasemapPicker(option.id);
            basemapPanel.style.display = "none";
          });
          basemapPanel.appendChild(btn);
        });
      }

      renderBasemapPicker("hybrid");
      basemapBtn.addEventListener("click", () => {
        basemapPanel.style.display = basemapPanel.style.display === "block" ? "none" : "block";
      });
      mobileToolsBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        const isOpen = document.body.classList.toggle("tools-open");
        mobileToolsBtn.setAttribute("aria-expanded", isOpen ? "true" : "false");
        if (!isOpen) basemapPanel.style.display = "none";
      });
      document.addEventListener("click", (e) => {
        if (e.target === basemapBtn || basemapPanel.contains(e.target)) return;
        basemapPanel.style.display = "none";
        if (e.target === mobileToolsBtn || mapTools.contains(e.target)) return;
        closeMobileTools();
      });
      document.addEventListener("keydown", (e) => {
        if (e.key !== "Escape") return;
        closeInfoModal();
        basemapPanel.style.display = "none";
        closeMobileTools();
        clearCrownSelection();
        closeBuaPopup();
        document.getElementById("buaChartPanel").style.display = "none";
      });

      const scaleBar = new ScaleBar({ view, unit: "metric", container: "scaleBarPanel" });

      const zoomLevelPanel    = document.getElementById("zoomLevelPanel");
      const crownLoadingBadge = document.getElementById("crownLoadingBadge");
      const crownLoadingText  = crownLoadingBadge.querySelector("span:last-child");
      view.watch("zoom", z => { zoomLevelPanel.textContent = `Zoom: ${z.toFixed(2)}`; });

      function setCrownLoading(message = "Loading Canopy Layer…") {
        crownLoadingText.textContent = message;
        crownLoadingBadge.classList.remove("error");
        crownLoadingBadge.classList.add("visible");
      }

      function setCrownError(message = "Canopy layer could not be loaded.") {
        crownLoadingText.textContent = message;
        crownLoadingBadge.classList.add("visible", "error");
      }

      function clearCrownLoading() {
        crownLoadingBadge.classList.remove("visible", "error");
        crownLoadingText.textContent = "Loading Canopy Layer…";
      }

      function clearActiveCounty() {
        if (activeItem) {
          activeItem.classList.remove("active");
          activeItem = null;
        }
        if (_vtlHandoffHandle) { _vtlHandoffHandle.remove(); _vtlHandoffHandle = null; }
        if (state.activeBuaLayer) { map.remove(state.activeBuaLayer); state.activeBuaLayer = null; }
        if (state.activeMdLayer)  { map.remove(state.activeMdLayer);  state.activeMdLayer  = null; }
        if (state.activeLaLayer)  { map.remove(state.activeLaLayer);  state.activeLaLayer  = null; }
        if (activeCrownTileLayer) {
          map.remove(activeCrownTileLayer);
          activeCrownTileLayer = null;
        }
        countyOutlineLayer.removeAll();
        layerToggleRow.style.display = "none";
        clearCrownSelection();
        closeBuaPopup();
        clearBuaList();
        // Reset canopy stats to national totals
        const allVals = Object.values(state.countyStatsMap);
        const natFt   = allVals.reduce((s, c) => s + (c.ft       || 0), 0);
        const natTof  = allVals.reduce((s, c) => s + (c.tof      || 0), 0);
        const natHa   = allVals.reduce((s, c) => s + (c.canopy_ha || 0), 0);
        const natPct  = natHa > 0 ? natHa / 7027300 * 100 : null;
        updateCanopyStats(natFt, natTof, natPct, natHa > 0 ? natHa : null);
      }

      // ---------------------------------------------------------------------------
      // Activate a county
      // ---------------------------------------------------------------------------
      function activateCounty(name, countyFeature, listItem, zoomToCounty = true) {
        clearActiveCounty();
        if (listItem) {
          activeItem = listItem;
          listItem.classList.add("active");
        }

        vectorTileLayers.forEach(l => l.visible = false);

        // Remove previous per-county layers
        state.activeCrownLayers.forEach(l => map.remove(l));
        state.activeCrownLayers = [];
        clearCrownLoading();

        const crownTileItemId = state.crownTileLayerMap[name.toUpperCase()];

        // Tile overview layer — visible at all scales down to 1:25,000 where the
        // feature layer takes over.  maxScale:25000 hides it cleanly at that threshold.
        if (crownTileItemId) {
          activeCrownTileLayer = buildCrownTileLayer(crownTileItemId);
          activeCrownTileLayer.on("layerview-create-error", e => {
            console.error(`[tile] failed to render ${name} tile layer:`, e.error);
            setCrownError("County canopy overview could not be loaded.");
          });
          map.add(activeCrownTileLayer);
        }

        // Built-up areas — filtered to the active county, sits above VTL below crowns
        const buaPortalRef = state._portal
          ? { id: BUA_LAYER_ITEM_ID, portal: state._portal }
          : { id: BUA_LAYER_ITEM_ID };
        state.activeBuaLayer = new FeatureLayer({
          portalItem:          buaPortalRef,
          definitionExpression: `County = '${escapeSql(name)}'`,
          opacity: 0.4,
          popupEnabled:        false,
          renderer: new SimpleRenderer({
            symbol: new SimpleFillSymbol({
              style:   "none",
              outline: { color: [255, 87, 34, 255], width: 4, style: "solid" }
            })
          }),
          minScale: 0, maxScale: 0
        });
        applyExistingOutFields(state.activeBuaLayer, BOUNDARY_STATS_FIELDS);
        state.activeBuaLayer.on("layerview-create-error", e => {
          console.error(`[bua] failed to render BUA layer for ${name}:`, e.error);
          setCrownError("Built-up area boundaries could not be loaded.");
        });
        buaLayerToggle.checked  = true;
        mdLayerToggle.checked   = true;
        layerToggleRow.style.display = "block";
        map.add(state.activeBuaLayer, 0);  // insert below all operational layers, just above basemap

        // Municipal districts — filtered to active county, sits above BUAs
        const mdPortalRef = state._portal
          ? { id: MUNICIPAL_DISTRICT_LAYER_ITEM_ID, portal: state._portal }
          : { id: MUNICIPAL_DISTRICT_LAYER_ITEM_ID };
        state.activeMdLayer = new FeatureLayer({
          portalItem:           mdPortalRef,
          definitionExpression: `County = '${escapeSql(name)}'`,
          opacity:              0.8,
          popupEnabled:         false,
          minScale:             0,
          maxScale:             0,
          renderer: new SimpleRenderer({
            symbol: new SimpleFillSymbol({
              style:   "none",
              outline: { color: [255, 237, 160, 255], width: 2, style: "solid" }
            })
          }),
        });
        applyExistingOutFields(state.activeMdLayer, BOUNDARY_STATS_FIELDS);
        state.activeMdLayer.on("layerview-create-error", e => {
          console.error(`[md] layer error:`, e.error);
          setCrownError("Municipal district boundaries could not be loaded.");
        });
        map.add(state.activeMdLayer, 1);  // just above BUA layer

        // Local authorities — filtered to active county, sits above Municipal Districts
        const laPortalRef = state._portal
          ? { id: LOCAL_AUTHORITY_LAYER_ITEM_ID, portal: state._portal }
          : { id: LOCAL_AUTHORITY_LAYER_ITEM_ID };
        state.activeLaLayer = new FeatureLayer({
          portalItem:           laPortalRef,
          definitionExpression: `County = '${escapeSql(name)}'`,
          opacity:              0.8,
          popupEnabled:         false,
          minScale:             0,
          maxScale:             0,
          renderer: new SimpleRenderer({
            symbol: new SimpleFillSymbol({
              style:   "none",
              outline: { color: [254, 178, 76, 255], width: 2, style: "solid" }
            })
          }),
        });
        applyExistingOutFields(state.activeLaLayer, BOUNDARY_STATS_FIELDS);
        state.activeLaLayer.on("layerview-create-error", e => {
          console.error(`[la] layer error:`, e.error);
          setCrownError("Local authority boundaries could not be loaded.");
        });
        laLayerToggle.checked = true;
        map.add(state.activeLaLayer, 2);  // just above Municipal Districts

        // Load national top-100 BUAs once (no county filter) and cache the promise
        if (!state._buaTop100Promise) {
          state._nationalBuaLayer = new FeatureLayer({ portalItem: buaPortalRef });
          state._buaTop100Promise = (async () => {
            await state._nationalBuaLayer.load();
            const nq = state._nationalBuaLayer.createQuery();
            nq.returnGeometry = false;
            nq.outFields      = existingOutFields(state._nationalBuaLayer, BOUNDARY_STATS_FIELDS);
            const { features } = await state._nationalBuaLayer.queryFeatures(nq);
            return features
              .sort((a, b) =>
                (b.attributes.population ?? b.attributes.Population ?? 0) -
                (a.attributes.population ?? a.attributes.Population ?? 0))
              .slice(0, 100);
          })();
        }
        state._activeCountyName = name;
        refreshChartPanel();

        const crownItemIds = state.crownLayerMap[name.toUpperCase()] || [];
        if (crownItemIds.length) {
          // Load one FeatureLayer per item ID (single county = one ID; split county = two IDs)
          state.activeCrownLayers = crownItemIds.map(itemId => {
            const featurePortalRef = state._portal ? { id: itemId, portal: state._portal } : { id: itemId };
            const fl = new FeatureLayer({
              portalItem: featurePortalRef,
              renderer: crownRenderer,
              popupEnabled: false,
              minScale: 25000,
              maxScale: 0
            });
            applyExistingOutFields(fl, CROWN_POPUP_FIELDS);
            fl.on("layerview-create-error", e => {
              console.error(`[feature] failed to render ${name} crown layer (item id: ${itemId}):`, e.error);
              setCrownError("Tree crown layer could not be loaded.");
            });
            map.add(fl);
            return fl;
          });
          crownLayerToggle.checked = true;
          layerToggleRow.style.display = "block";
          setCrownLoading(`Loading ${name} canopy…`);

          // Use pre-computed stats — statistics queries are disabled on the layer
          const stats    = state.countyStatsMap[name.toUpperCase()] || {};
          const ftCount  = stats.ft  || 0;
          const tofCount = stats.tof || 0;
          const total    = ftCount + tofCount;
          updateCanopyStats(ftCount, tofCount, stats.canopy_pct ?? null, stats.canopy_ha ?? null,
            name.charAt(0).toUpperCase() + name.slice(1).toLowerCase());

          // Track when every feature layer finishes its initial load — hides the
          // loading badge regardless of whether this county has a VTL fallback.
          const _readyLayers  = new Set();
          const _featureTotal = state.activeCrownLayers.length;
          state.activeCrownLayers.forEach((fl, idx) => {
            view.whenLayerView(fl).then(lv => {
              lv.watch("updating", updating => {
                if (!updating) {
                  _readyLayers.add(idx);
                  if (_readyLayers.size >= _featureTotal) {
                    clearCrownLoading();
                    if (activeCrownTileLayer && view.scale <= 25000) activeCrownTileLayer.visible = false;
                  }
                }
              });
            });
          });

          // VTL ↔ feature handoff: keep VTL visible while features load, then hide it.
          // Restore VTL whenever the user zooms back out past 1:25,000.
          if (activeCrownTileLayer) {
            const _tileRef = activeCrownTileLayer;
            _vtlHandoffHandle = view.watch("scale", scale => {
              if (!crownLayerToggle.checked) return;
              if (scale > 25000) {
                _tileRef.visible = true;
                _readyLayers.clear();
              } else if (_readyLayers.size >= _featureTotal) {
                _tileRef.visible = false;
              }
            });
          }
        } else {
        }

        if (countyFeature?.geometry) {
          // Mask: large WGS84 bounding box minus the county = dimmed surround
          try {
            const outerBox = new Polygon({
              rings: [[[-25, 45], [10, 45], [10, 60], [-25, 60], [-25, 45]]],
              spatialReference: { wkid: 4326 }
            });
            const maskGeom = geometryEngine.difference(outerBox, countyFeature.geometry);
            if (maskGeom) {
              countyOutlineLayer.add(new Graphic({
                geometry: maskGeom,
                symbol: new SimpleFillSymbol({ color: [20, 20, 20, 0.45], outline: null })
              }));
            }
          } catch (_) {}

          if (zoomToCounty) {
            view.goTo(countyFeature.geometry.extent || countyFeature.geometry).catch(() => {});
          }
        }
      }

      // ---------------------------------------------------------------------------
      // Home
      // ---------------------------------------------------------------------------
      function goHome() {
        view.goTo({ center: [-8, 53], zoom: 7 });
        vectorTileLayers.forEach(l => l.visible = true);
        state.activeCrownLayers.forEach(l => map.remove(l));
        state.activeCrownLayers = [];
        clearCrownLoading();
        clearActiveCounty();
      }

      document.getElementById("countyResetBtn").addEventListener("click", () => {
        const input = document.getElementById("countySearchInput");
        input.value = "";
        countySortSelect.value = "az";
        countySortSelect.dispatchEvent(new Event("change"));
        if (countyList.applyFilter) countyList.applyFilter();
        goHome();
      });

      // ---------------------------------------------------------------------------
      // Eircode / address search
      // ---------------------------------------------------------------------------
      search.on("select-result", async (event) => {
        const geometry = event.result?.feature?.geometry;
        if (!geometry) return;
        setCrownLoading("Finding county for location…");
        try {
          const result = await countyLayer.queryFeatures({
            geometry,
            spatialRelationship: "intersects",
            outFields: ["*"],
            returnGeometry: true,
            outSpatialReference: { wkid: 4326 }
          });
          if (result.features.length === 0) {
            setCrownError("Location found, but no county boundary matched it.");
            return;
          }
          const feat = result.features[0];
          const name = getCountyName(feat.attributes);
          if (!name) {
            setCrownError("Location found, but the county name could not be read.");
            return;
          }
          let matchItem = null;
          countyList.querySelectorAll("li").forEach(li => {
            if (li.querySelector(".county-name")?.textContent === name) matchItem = li;
          });
          activateCounty(name, feat, matchItem, false);

          // Searching an address gives no clue that the BUA boundary around it is
          // clickable — briefly flash it (not a persistent selection/highlight)
          // without changing the search result zoom.
          const landedBuaLayer = state.activeBuaLayer;
          if (landedBuaLayer) {
            try {
              const lv = await view.whenLayerView(landedBuaLayer);
              const oidField = landedBuaLayer.objectIdField || "OBJECTID";
              const bq = landedBuaLayer.createQuery();
              bq.geometry            = geometry;
              bq.spatialRelationship = "intersects";
              bq.returnGeometry      = true;
              bq.outSpatialReference = view.spatialReference;
              bq.outFields           = [oidField];
              const { features: hits } = await landedBuaLayer.queryFeatures(bq);
              if (hits.length) {
                const id = hits[0].attributes[oidField];
                if (id != null) _flashedBuaIds.add(id);
                blinkHighlight(lv, hits[0]);
              }
            } catch (e) {
              console.warn("[search] BUA flash failed:", e?.message || e);
            }
          }
        } catch (e) {
          console.error("[search] county lookup failed:", e?.message || e);
          setCrownError("Location found, but county data could not be loaded.");
        }
      });

      // ---------------------------------------------------------------------------
      // Build county list
      // ---------------------------------------------------------------------------
      function setCountyListStatus(type, message, retryHandler) {
        countyList.innerHTML = "";
        const item = document.createElement("li");
        item.className = `list-status${type === "error" ? " error" : ""}`;
        if (type === "loading") {
          const spinner = document.createElement("span");
          spinner.className = "chart-spinner";
          item.appendChild(spinner);
        }
        const text = document.createElement("span");
        text.textContent = message;
        item.appendChild(text);
        if (retryHandler) {
          const retryBtn = document.createElement("button");
          retryBtn.type = "button";
          retryBtn.textContent = "Try again";
          retryBtn.addEventListener("click", retryHandler);
          item.appendChild(retryBtn);
        }
        countyList.appendChild(item);
      }

      function loadCountyListData() {
        setCountyListStatus("loading", "Loading county canopy stats…");
        countyLayer.queryFeatures({
          where: "1=1",
          outFields: ["*"],
          returnGeometry: true,
          outSpatialReference: { wkid: 4326 }
        }).then(result => {
        const countyFeatures = result.features.slice();

        function countyName(feature) {
          return getCountyName(feature.attributes);
        }

        function countyStats(feature) {
          return state.countyStatsMap[countyName(feature).toUpperCase()] || {};
        }

        function countyLandAreaKm2(feature) {
          const statsArea = Number(countyStats(feature).land_area_km2);
          if (Number.isFinite(statsArea) && statsArea > 0) return statsArea;
          const geometryArea = geometryEngine.geodesicArea(feature.geometry, "square-kilometers");
          return Number.isFinite(geometryArea) ? Math.abs(geometryArea) : 0;
        }

        // Reference point for the county-list canopy bars: whatever the highest
        // county canopy_pct actually is becomes the value that fills the bar to
        // 100%. This keeps the bar a genuine, unclipped multiple of the real
        // figure (previously a flat ×10 that clipped anything ≥10% canopy) and
        // stays correct automatically if the underlying data changes.
        const maxCountyCanopyPct = countyFeatures.reduce((max, feature) => {
          return Math.max(max, countyStats(feature).canopy_pct || 0);
        }, 0);

        function activeMetricValue(stats) {
          if (countySortSelect.value === "canopyArea") return stats.canopy_ha || 0;
          if (countySortSelect.value === "forest") return stats.ft_canopy_pct || 0;
          if (countySortSelect.value === "outside") return stats.tof_canopy_pct || 0;
          return stats.canopy_pct || 0;
        }

        function activeMetricLabel(value) {
          if (countySortSelect.value === "canopyArea") {
            return value.toLocaleString(undefined, { maximumFractionDigits: 0 });
          }
          return `${value.toFixed(1)}%`;
        }

        function updateCountyMetricHint() {
          const labels = {
            az: "Metric: canopy cover %",
            canopy: "Metric: canopy cover %",
            canopyArea: "Metric: canopy area (ha)",
            forest: "Metric: Forest Canopy %",
            outside: "Metric: Canopy Outside Forest %"
          };
          countySortMetricHint.textContent = labels[countySortSelect.value] || labels.az;
        }

        function sortCountyFeatures(features) {
          const sorted = features.slice();
          const sortMode = countySortSelect.value;
          sorted.sort((a, b) => {
            if (sortMode === "canopy") {
              return (countyStats(b).canopy_pct || 0) - (countyStats(a).canopy_pct || 0);
            }
            if (sortMode === "canopyArea") {
              return (countyStats(b).canopy_ha || 0) - (countyStats(a).canopy_ha || 0);
            }
            if (sortMode === "forest") {
              return (countyStats(b).ft_canopy_pct || 0) - (countyStats(a).ft_canopy_pct || 0);
            }
            if (sortMode === "outside") {
              return (countyStats(b).tof_canopy_pct || 0) - (countyStats(a).tof_canopy_pct || 0);
            }
            const na = countyName(a).toLowerCase();
            const nb = countyName(b).toLowerCase();
            return na.localeCompare(nb);
          });
          return sorted;
        }

        function renderCountyList() {
          updateCountyMetricHint();
          const sorted = sortCountyFeatures(countyFeatures);
          countyList.innerHTML = "";
          Object.keys(_countyLookup).forEach(key => delete _countyLookup[key]);

          sorted.forEach(feature => {
            const name = countyName(feature);
            if (!name) return;
            const item = document.createElement("li");

            const nameSpan = document.createElement("span");
            nameSpan.className = "county-name";
            nameSpan.textContent = name.charAt(0).toUpperCase() + name.slice(1).toLowerCase();
            item.dataset.name = nameSpan.textContent;
            item.appendChild(nameSpan);

            const stats   = countyStats(feature);
            const total   = stats.canopy_pct || 0;
            const ftCanopyPct  = stats.ft_canopy_pct  || 0;
            const tofCanopyPct = stats.tof_canopy_pct || 0;
            const activeMetric = activeMetricValue(stats);
            const canopySplitTotal = ftCanopyPct + tofCanopyPct;
            if (total > 0) {
              const ftPct  = canopySplitTotal > 0 ? (ftCanopyPct  / canopySplitTotal * 100).toFixed(1) : "0";
              const tofPct = canopySplitTotal > 0 ? (tofCanopyPct / canopySplitTotal * 100).toFixed(1) : "0";
              // Scale so the highest-canopy county fills the bar to 100% — a real,
              // unclipped multiple of the true figure rather than a flat ×10 that
              // truncated anything at or above 10% canopy cover.
              const barScaleFactor = maxCountyCanopyPct > 0 ? 100 / maxCountyCanopyPct : 1;
              const barPct = Math.min(total * barScaleFactor, 100).toFixed(1);
              const totalLabel = `${total.toFixed(1)}%`;
              const ftLabel = `${ftCanopyPct.toFixed(2)}%`;
              const tofLabel = `${tofCanopyPct.toFixed(2)}%`;
              const landAreaKm2 = countyLandAreaKm2(feature);
              const landAreaLabel = `${landAreaKm2.toLocaleString(undefined, { maximumFractionDigits: 0 })} km²`;
              const metricLabel = activeMetricLabel(activeMetric);

              const barScale = document.createElement("div");
              barScale.className = "county-bar-scale";

              // Full-width track: bar length now reflects canopy cover alone —
              // no longer shrunk further by the county's land area, which was
              // compounding with the canopy multiplier and hiding small counties.
              const barContainer = document.createElement("div");
              barContainer.className = "county-bar-container";
              barContainer.title = `County area ${landAreaLabel}; Canopy cover ${totalLabel} of county area; colour fill scaled ×${barScaleFactor.toFixed(1)} for visibility (highest county = 100%); Forest Canopy ${ftLabel}; Canopy Outside Forest ${tofLabel}`;

              const barWrap = document.createElement("div");
              barWrap.className = "county-bar-wrap";
              barWrap.style.width = `${barPct}%`;

              const ftBar = document.createElement("div");
              ftBar.className = "county-bar-ft";
              ftBar.style.width = `${ftPct}%`;
              const tofBar = document.createElement("div");
              tofBar.className = "county-bar-tof";
              tofBar.style.width = `${tofPct}%`;

              barWrap.appendChild(ftBar);
              barWrap.appendChild(tofBar);
              barContainer.appendChild(barWrap);
              barScale.appendChild(barContainer);
              item.appendChild(barScale);

              const pctSpan = document.createElement("span");
              pctSpan.className = "county-canopy-pct";
              pctSpan.textContent = metricLabel;
              pctSpan.title = barContainer.title;
              item.appendChild(pctSpan);
            }

            item.addEventListener("click", () => activateCounty(name, feature, item));
            countyList.appendChild(item);
            _countyLookup[name.toLowerCase()] = { item, feature, name };

            if (state._activeCountyName && state._activeCountyName.toLowerCase() === name.toLowerCase()) {
              item.classList.add("active");
              activeItem = item;
            }
          });

          if (countyList.applyFilter) countyList.applyFilter();
        }

        renderCountyList();
        countySortSelect.addEventListener("change", renderCountyList);

        updateViewPadding();
        setUpCountySearch();
        restoreFromUrl();
      }).catch((e) => {
        console.error("[countyList] error:", e?.message || e);
        setCountyListStatus("error", "County canopy stats could not be loaded.", loadCountyListData);
      });
      }

      loadCountyListData();

    });

    // ---------------------------------------------------------------------------
    // Crown polygon popup
    // ---------------------------------------------------------------------------
    const crownPopup       = document.getElementById("crownPopup");
    const crownPopupHeader = document.getElementById("crownPopupHeader");
    const crownPopupTitle  = document.getElementById("crownPopupTitle");
    const crownPopupBody   = document.getElementById("crownPopupBody");

    const buaChartPanel  = document.getElementById("buaChartPanel");
    const buaChartTitle  = document.getElementById("buaChartTitle");

    document.getElementById("buaChartClose").addEventListener("click", () => {
      buaChartPanel.style.display = "none";
    });

    // ---------------------------------------------------------------------------
    // Layer tabs (BUA / Municipal Districts / Local Authorities)
    // ---------------------------------------------------------------------------

    document.querySelectorAll(".chart-tab").forEach(btn => {
      btn.addEventListener("click", () => {
        if (btn.dataset.tab === state._activeChartTab) return;
        state._activeChartTab = btn.dataset.tab;
        document.querySelectorAll(".chart-tab").forEach(b => b.classList.toggle("active", b === btn));
        closeBuaPopup();
        if (state.activeBuaItem) { state.activeBuaItem.classList.remove("active"); state.activeBuaItem = null; }
        if (state.buaHighlight)  { state.buaHighlight.remove();  state.buaHighlight  = null; }
        if (state.activeFilteredItem) { state.activeFilteredItem.classList.remove("active"); state.activeFilteredItem = null; }
        if (state.filteredHighlight)  { state.filteredHighlight.remove();  state.filteredHighlight  = null; }
        refreshChartPanel();
      });
    });

    document.getElementById("crownPopupClose").addEventListener("click", clearCrownSelection);
    document.getElementById("buaPopupClose").addEventListener("click", closeBuaPopup);

    // Hover cue: show a pointer cursor over clickable boundaries (BUA/MD/LA) so viewers
    // discover they can click them — boundary lines give no other affordance, especially
    // the "other BUAs" outline which is easy to miss on the aerial basemap.
    let _hoverHitTestPending = false;
    view.on("pointer-move", (event) => {
      if (_hoverHitTestPending) return;
      _hoverHitTestPending = true;
      const activeBoundaryLayer =
        state._activeChartTab === "bua" ? state.activeBuaLayer :
        state._activeChartTab === "md"  ? state.activeMdLayer :
                                    state.activeLaLayer;
      if (!activeBoundaryLayer || !activeBoundaryLayer.visible) { _hoverHitTestPending = false; return; }
      view.hitTest(event, { include: [activeBoundaryLayer] }).then(({ results }) => {
        view.container.style.cursor = results.length ? "pointer" : "";
        _hoverHitTestPending = false;
      }).catch(() => { _hoverHitTestPending = false; });
    });

    view.on("click", async (event) => {
      try {
        // ---------------------------------------------------------------------------
        // Crown polygons — custom popup
        // ---------------------------------------------------------------------------
        if (state.activeCrownLayers.length) {
          const { results } = await view.hitTest(event, { include: state.activeCrownLayers });
          if (results.length) {
            const graphic = results[0].graphic;
            const attrs   = graphic.attributes || {};

            closeBuaPopup();
            if (state.crownHighlight) state.crownHighlight.remove();
            const layerView = await view.whenLayerView(results[0].layer);
            state.crownHighlight = layerView.highlight(graphic);

            const crownClass = (attrs.tree_class || attrs.class || attrs.Class || "").toLowerCase();
            crownPopupHeader.style.background = crownClass === "tof" ? "rgba(255,0,255,0.6)" : "rgba(0,255,0,0.6)";

            crownPopupTitle.textContent = `Tree Crown — ${attrs.county || attrs.County || ""}`;
            crownPopupBody.innerHTML = "";
            crownPopupBody.appendChild(buildPopupContent(attrs));

            const pt = view.toScreen(event.mapPoint);
            const vr = document.getElementById("viewDiv").getBoundingClientRect();
            let left = vr.left + pt.x + 14;
            let top  = vr.top  + pt.y - 40;
            crownPopup.style.display = "block";
            if (usesBottomPopupLayout()) {
              collapseMapPanelsForMobile();
              crownPopup.style.left = "";
              crownPopup.style.top = "";
              return;
            }
            const pw = crownPopup.offsetWidth, ph = crownPopup.offsetHeight;
            const sidePanel = document.getElementById("sidePanelWrapper");
            let rightBound = window.innerWidth - 8;
            if (sidePanel && !sidePanel.classList.contains("collapsed")) {
              rightBound = Math.min(rightBound, sidePanel.getBoundingClientRect().left - 8);
            }
            if (left + pw > rightBound) left = vr.left + pt.x - pw - 14;
            if (left < 8) left = 8;
            if (top  + ph > window.innerHeight - 8) top  = window.innerHeight - ph - 8;
            if (top < 60) top = 60;
            crownPopup.style.left = left + "px";
            crownPopup.style.top  = top  + "px";
            return;
          }
        }

        // ---------------------------------------------------------------------------
        // Active BUA / Municipal District / Local Authority layer — custom popup
        // ---------------------------------------------------------------------------
        clearCrownSelection();
        const activeBoundaryLayer =
          state._activeChartTab === "bua" ? state.activeBuaLayer :
          state._activeChartTab === "md"  ? state.activeMdLayer :
                                      state.activeLaLayer;
        if (activeBoundaryLayer) {
          const { results: boundaryResults } = await view.hitTest(event, { include: [activeBoundaryLayer] });
          if (boundaryResults.length) {
            const attrs = boundaryResults[0].graphic.attributes || {};
            if (state._activeChartTab === "bua") {
              openBuaPopup(attrs, event.mapPoint);
            } else {
              openFilteredPopup(attrs, event.mapPoint);
            }
            return;
          }
        }

        clearCrownSelection();
        closeBuaPopup();
      } catch (e) {
        console.error("[popup] error:", e);
      }
    });
