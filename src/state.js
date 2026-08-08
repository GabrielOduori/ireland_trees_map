// Shared mutable state for the Ireland Trees Map.
//
// This is exported as a single object (not per-variable `export let`s) so
// every module that imports `state` reads and writes the SAME object,
// regardless of which module runs first. That matters here because module
// evaluation order across files is otherwise significant for `let`
// bindings — an object sidesteps that entirely, since there's only one
// binding (the object itself), not N independent ones scattered across
// files that each need to be declared before they're read.
//
// map/view/countyLayer/countyOutlineLayer are created once in map-init.js
// and never reassigned afterwards (only mutated via their own methods, e.g.
// map.add/map.remove) — everything else here is read AND reassigned from
// multiple places (popup selection state, active layer tracking, the
// current chart tab), which is exactly the state that needs to live here
// rather than as file-local variables.
export const state = {
  map: null,
  view: null,
  countyLayer: null,
  countyOutlineLayer: null,

  _portal: null, // authenticated portal instance, reused when loading tile layers

  crownLayerMap: {},      // county -> Feature Layer item id (interactive, minScale 25k)
  crownTileLayerMap: {},  // county -> Tile layer item info { id, type } (overview, all scales)
  countyStatsMap: {},     // county name -> stats row, populated live from the county stats layer

  activeCrownLayers: [],
  activeBuaLayer: null,
  activeMdLayer: null,
  activeLaLayer: null,
  _nationalBuaLayer: null,  // unfiltered layer used for geometry queries in selectBua
  _buaTop100Promise: null,  // resolves to national top-100 BUAs by area, loaded once

  crownHighlight: null,
  buaHighlight: null,
  activeBuaItem: null,
  _buaLayer: null,

  filteredHighlight: null,
  activeFilteredItem: null,

  _activeChartTab: "bua",
  _activeCountyName: null,
  _buaPanelCollapsed: false,

  collapseCountySheetForMobile: () => {},
};
