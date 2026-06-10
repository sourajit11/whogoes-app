/**
 * Normalize an event name for use in cold email copy and subject lines.
 * When a name has alternatives separated by "/", take the shorter part.
 * e.g. "AWS Public Sector Summit/ AWS Summit" → "AWS Summit"
 */
export function normalizeEventName(name) {
  if (!name) return name;
  if (!name.includes("/")) return name.trim();
  const parts = name.split("/").map((p) => p.trim()).filter(Boolean);
  return parts.sort((a, b) => a.length - b.length)[0];
}
