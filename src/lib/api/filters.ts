/**
 * Shared ICP filter parsing/validation for the public API.
 *
 * Both transports normalize to the exact jsonb contract of the
 * `event_filtered_contact_ids` SQL helper, so GET query params, POST bodies
 * and stored auto-pull rules all mean the same thing:
 *
 *   GET:  ?seniority=C-Suite,VP&function=Sales/BD&has_email=true
 *         (array params are repeatable AND comma-split; values that themselves
 *         contain a comma must use the raw `filters` JSON param instead)
 *   GET:  ?filters=<url-encoded JSON object>  (replaces all individual params)
 *   POST: { "filters": { "seniority": ["C-Suite"], ... } }
 */

const ARRAY_KEYS = [
  "seniority",
  "function",
  "industry",
  "size",
  "country",
  "role",
] as const;

const BOOLEAN_KEYS = ["speaker", "has_email"] as const;

const STRING_KEYS = [
  "title_keyword",
  "company_include",
  "company_exclude",
] as const;

export const VALID_FILTER_KEYS: readonly string[] = [
  ...ARRAY_KEYS,
  ...BOOLEAN_KEYS,
  ...STRING_KEYS,
];

const ROLE_VALUES = [
  "organizer",
  "sponsor",
  "exhibitor",
  "attendee",
  "expected_attendee",
];

export type Filters = Record<string, unknown>;

export type FilterParseResult = { filters: Filters } | { error: string };

function invalidKeysMessage(keys: string[]): string {
  return `Unknown filter key(s): ${keys.join(", ")}. Valid keys: ${VALID_FILTER_KEYS.join(", ")}`;
}

/**
 * Validate a filters object (POST body, `filters` JSON param, or stored rule).
 * Returns a normalized copy: empty arrays/strings dropped, so "no constraint"
 * is always expressed by an absent key, matching the SQL helper's contract.
 */
export function validateFiltersBody(input: unknown): FilterParseResult {
  if (input === undefined || input === null) return { filters: {} };
  if (typeof input !== "object" || Array.isArray(input)) {
    return { error: "filters must be a JSON object" };
  }

  const raw = input as Record<string, unknown>;
  const unknownKeys = Object.keys(raw).filter(
    (k) => !VALID_FILTER_KEYS.includes(k),
  );
  if (unknownKeys.length > 0) {
    return { error: invalidKeysMessage(unknownKeys) };
  }

  const filters: Filters = {};

  for (const key of ARRAY_KEYS) {
    if (!(key in raw)) continue;
    const value = raw[key];
    if (!Array.isArray(value) || value.some((v) => typeof v !== "string")) {
      return { error: `${key} must be an array of strings` };
    }
    const values = (value as string[]).map((v) => v.trim()).filter(Boolean);
    if (key === "role") {
      const bad = values.filter((v) => !ROLE_VALUES.includes(v));
      if (bad.length > 0) {
        return {
          error: `Invalid role value(s): ${bad.join(", ")}. Valid roles: ${ROLE_VALUES.join(", ")}`,
        };
      }
    }
    if (values.length > 0) filters[key] = values;
  }

  for (const key of BOOLEAN_KEYS) {
    if (!(key in raw)) continue;
    const value = raw[key];
    if (typeof value !== "boolean") {
      return { error: `${key} must be a boolean` };
    }
    filters[key] = value;
  }

  for (const key of STRING_KEYS) {
    if (!(key in raw)) continue;
    const value = raw[key];
    if (typeof value !== "string") {
      return { error: `${key} must be a string` };
    }
    const trimmed = value.trim();
    if (trimmed.length > 0) filters[key] = trimmed;
  }

  return { filters };
}

/**
 * Build a filters object from GET query params. A raw `filters` JSON param,
 * when present, replaces every individual filter param.
 */
export function parseFilterParams(
  searchParams: URLSearchParams,
): FilterParseResult {
  const rawJson = searchParams.get("filters");
  if (rawJson !== null) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(rawJson);
    } catch {
      return { error: "filters must be valid URL-encoded JSON" };
    }
    return validateFiltersBody(parsed);
  }

  const candidate: Record<string, unknown> = {};

  for (const key of ARRAY_KEYS) {
    const values = searchParams
      .getAll(key)
      .flatMap((v) => v.split(","))
      .map((v) => v.trim())
      .filter(Boolean);
    if (values.length > 0) candidate[key] = values;
  }

  for (const key of BOOLEAN_KEYS) {
    const value = searchParams.get(key);
    if (value === null || value === "") continue;
    if (value !== "true" && value !== "false") {
      return { error: `${key} must be true or false` };
    }
    candidate[key] = value === "true";
  }

  for (const key of STRING_KEYS) {
    const value = searchParams.get(key);
    if (value === null) continue;
    candidate[key] = value;
  }

  return validateFiltersBody(candidate);
}

/** True when the filters object carries a real ICP constraint (has_email alone does not count). */
export function isIcpFiltered(filters: Filters): boolean {
  return Object.keys(filters).some((k) => k !== "has_email");
}
