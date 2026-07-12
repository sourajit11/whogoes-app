// LinkedIn display names often carry decorations after the real name:
// "Chris Redgrave 🔜 GDC", "Ronan Patrick ➡️ Brighton Develop ➡️ Gamescom",
// "Jane Doe (She/Her)", "Nick | Hiring SDRs". Tables and SEO prose show the
// clean name; the raw value stays untouched in the database and CSV exports.
export function cleanDisplayName(name: string | null | undefined): string | null {
  if (!name) return null;
  // Cut at the first emoji/pictograph, arrow, pipe or bullet.
  let cleaned =
    name.split(/[\p{Extended_Pictographic}←-⇿⬀-⯿➡|•]/u)[0] ?? "";
  // Drop trailing parentheticals like "(She/Her)" or "(Open to Work)".
  cleaned = cleaned.replace(/\s*\([^)]*\)\s*$/u, "");
  // Tidy leftover separators/whitespace.
  cleaned = cleaned.replace(/[\s,\-–—]+$/u, "").replace(/\s{2,}/g, " ").trim();
  // Never return an empty string; fall back to the raw value.
  return cleaned.length > 0 ? cleaned : name;
}
