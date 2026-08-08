// Small, state-free helper functions shared across the app: ArcGIS field-list
// trimming, SQL string escaping, and display-name formatting/guessing for
// layers whose schema varies (BUA/municipal district/local authority all use
// different field names for "the name of this feature").

export function existingOutFields(layer, desiredFields) {
  const available = new Set((layer.fields || []).map(field => field.name.toLowerCase()));
  const fields = desiredFields.filter(field => available.has(field.toLowerCase()));
  return fields.length ? fields : [layer.objectIdField || "OBJECTID"];
}

export function applyExistingOutFields(layer, desiredFields) {
  layer.load()
    .then(() => { layer.outFields = existingOutFields(layer, desiredFields); })
    .catch(() => {});
}

export function escapeSql(value) {
  return value.replace(/'/g, "''");
}

export function titleCase(str) {
  return str.replace(/[A-Za-z]+/g, w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());
}

// Only re-case strings that are genuinely ALL CAPS — leave already
// mixed-case names (e.g. "Municipal District of Athlone-Moate") untouched.
export function maybeTitleCase(str) {
  return str === str.toUpperCase() && str !== str.toLowerCase() ? titleCase(str) : str;
}

// Generic name-field guesser for layers whose schema isn't fully known
export function pickDisplayName(attrs) {
  const preferred = ["settlement", "Settlement", "settlement_name", "Settlement_Name",
    "name", "Name", "NAME", "title", "Title",
    "district_name", "District_Name", "municipal_district", "Municipal_District",
    "municipal_district_name", "Municipal_District_Name",
    "authority_name", "Authority_Name", "local_authority", "Local_Authority",
    "local_authority_name", "Local_Authority_Name", "LA_Name", "LA_NAME",
    "MD_Name", "MD_NAME", "eng_name_value", "Eng_Name_Value", "ED_ENGLISH"];
  for (const k of preferred) if (attrs[k]) return maybeTitleCase(String(attrs[k]));
  for (const [k, v] of Object.entries(attrs)) {
    if (typeof v === "string" && v.trim() && !/^(objectid|fid|id|county|shape)/i.test(k)) return maybeTitleCase(v);
  }
  return "—";
}
