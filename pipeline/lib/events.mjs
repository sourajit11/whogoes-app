import { MIN_CONTACTS_WITH_EMAIL } from "./constants.mjs";
import { classifyEventRegion } from "./regions.mjs";

/**
 * Fetch qualifying events and determine init vs incremental mode for each.
 *
 * Qualifying = is_active AND contacts_with_email >= 100 AND start_date 7+ days out
 * Init = no entry in pipeline_state (new event, pull ALL contacts)
 * Incremental = has watermark (pull only contacts added since last run)
 *
 * Uses get_pipeline_qualifying_events (purpose-built RPC that pre-filters events
 * before aggregating contact counts) instead of get_all_browsable_events, which
 * aggregates across all events and exceeds Supabase's statement_timeout.
 */
export async function getQualifyingEvents(supabase) {
  // Minimum 3 days out — events in ≤2 days are too late to act on
  const threeDaysOut = new Date();
  threeDaysOut.setDate(threeDaysOut.getDate() + 3);
  const oneWeekOutStr = threeDaysOut.toISOString().slice(0, 10);

  const { data: qualifying, error } = await supabase.rpc(
    "get_pipeline_qualifying_events",
    { p_start_date: oneWeekOutStr, p_min_contacts: MIN_CONTACTS_WITH_EMAIL }
  );
  if (error) throw new Error(`RPC get_pipeline_qualifying_events failed: ${error.message}`);

  console.log(
    `  Qualifying (active, ${MIN_CONTACTS_WITH_EMAIL}+ contacts, starts on/after ${oneWeekOutStr} [3 days out]): ${qualifying.length}`
  );
  if (qualifying.length === 0) return [];

  const eventIds = qualifying.map((e) => e.event_id);
  const { data: states, error: stateErr } = await supabase
    .from("pipeline_state")
    .select("*")
    .in("event_id", eventIds);

  let stateMap = {};
  if (stateErr) {
    if (stateErr.message.toLowerCase().includes("could not find")) {
      console.log("  pipeline_state table not found — treating all events as INIT");
    } else {
      throw new Error(`pipeline_state query failed: ${stateErr.message}`);
    }
  } else {
    stateMap = Object.fromEntries((states || []).map((s) => [s.event_id, s]));
  }

  const enriched = qualifying.map((event) => {
    const state = stateMap[event.event_id];
    return {
      ...event,
      region: classifyEventRegion(event),
      isInit: !state,
      lastContactCreatedAt: state?.last_contact_created_at || null,
      previousTotal: state?.total_contacts_extracted || 0,
    };
  });

  // Process urgent events first so we never miss a short outreach window
  enriched.sort((a, b) => new Date(a.event_start_date) - new Date(b.event_start_date));
  return enriched;
}

/**
 * Update pipeline_state after successful extraction for an event.
 */
export async function updatePipelineState(supabase, eventId, contactCount, maxCreatedAt, previousTotal) {
  const { error } = await supabase.from("pipeline_state").upsert({
    event_id: eventId,
    last_extracted_at: new Date().toISOString(),
    total_contacts_extracted: previousTotal + contactCount,
    last_contact_created_at: maxCreatedAt,
  });

  if (error) throw new Error(`pipeline_state upsert failed: ${error.message}`);
}
