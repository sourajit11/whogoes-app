const US_PATTERNS = ["us", "usa", "united states", "north america"];

const EU_PATTERNS = [
  "eu", "emea", "europe", "uk", "united kingdom", "great britain",
  "germany", "france", "spain", "italy", "netherlands", "belgium",
  "austria", "switzerland", "sweden", "norway", "denmark", "finland",
  "poland", "portugal", "ireland", "czech", "hungary", "romania",
  "greece", "croatia", "slovakia", "slovenia", "bulgaria", "estonia",
  "latvia", "lithuania", "luxembourg", "malta", "cyprus",
];

function matchesPatterns(event, patterns) {
  const region = (event.event_region || "").toLowerCase();
  const location = (event.event_location || "").toLowerCase();
  return patterns.some((p) => region.includes(p) || location.includes(p));
}

/**
 * Classify an event into US, EU, or APAC based on its region/location fields.
 */
export function classifyEventRegion(event) {
  if (matchesPatterns(event, US_PATTERNS)) return "US";
  if (matchesPatterns(event, EU_PATTERNS)) return "EU";
  return "APAC";
}
