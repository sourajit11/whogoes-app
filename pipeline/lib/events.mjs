import { MIN_CONTACTS_WITH_EMAIL } from "./constants.mjs";
import { classifyEventRegion } from "./regions.mjs";

/**
 * Fetch qualifying events and determine init vs incremental mode for each.
 *
 * Qualifying = is_active AND contacts_with_email >= 100
 * Init = no entry in pipeline_state (new event, pull ALL contacts)
 * Incremental = has watermark (pull only contacts added since last run)
 */
export async function getQualifyingEvents(supabase) {
  const { data: allEvents, error } = await supabase.rpc("get_all_browsable_events");
  if (error) throw new Error(`RPC get_all_browsable_events failed: ${error.message}`);

  console.log(`  Total events from RPC: ${allEvents.length}`);

  // Only target events that are at least 1 week out (gives enough lead time for outreach)
  const oneWeekOut = new Date();
  oneWeekOut.setDate(oneWeekOut.getDate() + 7);
  const oneWeekOutStr = oneWeekOut.toISOString().slice(0, 10); // YYYY-MM-DD

  // Filter: active events, 100+ contacts with email, start date 7+ days out
  const qualifying = allEvents.filter(
    (e) =>
      e.is_active &&
      e.contacts_with_email >= MIN_CONTACTS_WITH_EMAIL &&
      e.event_start_date &&
      e.event_start_date >= oneWeekOutStr
  );
  console.log(
    `  Qualifying (active, ${MIN_CONTACTS_WITH_EMAIL}+ contacts, starts on/after ${oneWeekOutStr}): ${qualifying.length}`
  );

  if (qualifying.length === 0) return [];

  // Check pipeline_state for each qualifying event
  const eventIds = qualifying.map((e) => e.event_id);
  const { data: states, error: stateErr } = await supabase
    .from("pipeline_state")
    .select("*")
    .in("event_id", eventIds);

  // If table doesn't exist yet, treat all events as init
  let stateMap = {};
  if (stateErr) {
    if (stateErr.message.includes("could not find") || stateErr.message.includes("Could not find")) {
      console.log("  pipeline_state table not found — treating all events as INIT");
    } else {
      throw new Error(`pipeline_state query failed: ${stateErr.message}`);
    }
  } else {
    stateMap = Object.fromEntries((states || []).map((s) => [s.event_id, s]));
  }

  return qualifying.map((event) => {
    const state = stateMap[event.event_id];
    return {
      ...event,
      region: classifyEventRegion(event),
      isInit: !state,
      lastContactCreatedAt: state?.last_contact_created_at || null,
      previousTotal: state?.total_contacts_extracted || 0,
    };
  });
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
