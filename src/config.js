// Static configuration for the Ireland Trees Map: ArcGIS Online item IDs for
// each boundary/crown layer, the client-side field allowlists used to trim
// attribute transfer on popups/lists, and the layer-tab display config.

export const MUNICIPAL_DISTRICT_LAYER_ITEM_ID = "44758e1d99f8472b874484b50f0dcf10";

// const BUA_LAYER_ITEM_ID = "e83eac6b7292457cbbbafbd2fa103a31";

export const BUA_LAYER_ITEM_ID = "a7b962ccd97e4ba3a1e2587cedb6dee6";

export const LOCAL_AUTHORITY_LAYER_ITEM_ID = "59581215294543f5a5edd2e2a110c191";

export const COUNTY_LAYER_ITEM_ID = "259ee297ee034edaa3d22b082ab03732";

// Client-side field allowlists reduce attribute transfer for rendering and popups.
// Download/export prevention is enforced by ArcGIS Online item/layer settings.
export const COUNTY_STATS_FIELDS = [
  "county_name", "forest_trees", "trees_outside_forests",
  "canopy_cover_pct", "ft_canopy_cover_pct", "tof_canopy_cover_pct",
  "total_canopy_area_km2", "max_height_m", "max_canopy_area_m2"
];
export const BOUNDARY_STATS_FIELDS = [
  "OBJECTID", "objectid", "id",
  "settlement", "Settlement", "settlement_name", "Settlement_Name", "county", "County", "COUNTY",
  "district_name", "District_Name", "municipal_district", "Municipal_District", "municipal_district_name", "Municipal_District_Name",
  "authority_name", "Authority_Name", "local_authority", "Local_Authority", "local_authority_name", "Local_Authority_Name",
  "eng_name_value", "Eng_Name_Value", "name", "Name", "NAME", "title", "Title",
  "LA_Name", "LA_NAME", "MD_Name", "MD_NAME", "ED_ENGLISH",
  "population", "Population",
  "canopy_cover_pct", "Canopy_cover_pct", "canopy_pct", "Canopy_pct",
  "ft_canopy_cover_pct", "Ft_canopy_cover_pct", "FT_canopy_cover_pct",
  "tof_canopy_cover_pct", "Tof_canopy_cover_pct", "TOF_canopy_cover_pct",
  "total_canopy_area_km2", "Total_canopy_area_km2", "canopy_area_km2", "Canopy_area_km2",
  "land_area_km2", "Land_area_km2", "land_area",
  "max_avg_height_m", "Max_avg_height_m", "avg_height_m", "Avg_height_m", "max_height_m", "Max_height_m",
  "height_pct_rank", "Height_pct_rank", "tallest_tree_class", "Tallest_tree_class",
  "max_canopy_area_m2", "Max_canopy_area_m2", "area_pct_rank", "Area_pct_rank",
  "largest_tree_class", "Largest_tree_class"
];
export const CROWN_POPUP_FIELDS = [
  "tree_class", "class", "Class", "height_m", "mean", "Mean",
  "max_height_m", "max", "Max_", "crown_area_m2", "area", "Area",
  "ntm_id", "NTM_ID", "perimeter", "Perimeter", "county", "County"
];

// Zoomed-in enough that individual BUA boundaries are the relevant thing to
// notice (matches the crown tile/feature-layer switch threshold elsewhere).
export const BUA_FLASH_SCALE = 25000;

// Layer tabs (BUA / Municipal Districts / Local Authorities)
export const CHART_TABS = {
  bua: { label: "Built-up Areas",       color: "#f03b20", text: "#fff" },
  md:  { label: "Municipal Districts",  color: "#ffeda0", text: "#333" },
  la:  { label: "Local Authorities",    color: "#feb24c", text: "#333" },
};
