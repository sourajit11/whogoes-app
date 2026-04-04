import { createClient } from "@supabase/supabase-js";

export function createPipelineClient(url, serviceRoleKey) {
  return createClient(url, serviceRoleKey);
}

/**
 * Paginated fetch from a Supabase table with filter support.
 * Adapted from app/scripts/extract-leads.mjs
 */
export async function fetchAll(supabase, table, query = {}, selectCols = "*", pageSize = 1000) {
  const results = [];
  let start = 0;
  while (true) {
    let q = supabase
      .from(table)
      .select(selectCols)
      .range(start, start + pageSize - 1);

    for (const [key, val] of Object.entries(query)) {
      if (Array.isArray(val)) {
        q = q.in(key, val);
      } else if (val === null) {
        q = q.is(key, null);
      } else {
        q = q.eq(key, val);
      }
    }

    const { data, error } = await q;
    if (error) throw new Error(`Query ${table} failed: ${error.message}`);
    results.push(...(data || []));
    if (!data || data.length < pageSize) break;
    start += pageSize;
  }
  return results;
}

/**
 * Batch fetch by IDs with retry logic.
 * Handles large arrays by splitting into batches of 100.
 * Adapted from app/scripts/extract-leads.mjs
 */
export async function fetchByIds(supabase, table, column, ids, selectCols = "*") {
  if (ids.length === 0) return [];
  const BATCH = 100;
  const results = [];
  for (let i = 0; i < ids.length; i += BATCH) {
    const batch = ids.slice(i, i + BATCH);
    let attempts = 0;
    while (attempts < 3) {
      try {
        const data = await fetchAll(supabase, table, { [column]: batch }, selectCols);
        results.push(...data);
        break;
      } catch (err) {
        attempts++;
        if (attempts >= 3) throw err;
        console.log(`  Retry ${attempts}/3 for ${table} batch ${Math.floor(i / BATCH) + 1}...`);
        await new Promise((r) => setTimeout(r, 1000 * attempts));
      }
    }
    if (i + BATCH < ids.length) await new Promise((r) => setTimeout(r, 200));
  }
  return results;
}
