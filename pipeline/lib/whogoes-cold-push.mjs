/**
 * Push contactable WhoGoes cold prospects into the Plusvibe campaign.
 *
 * Selects whogoes_prospects rows where is_contactable = true AND campaign_status = 'new',
 * adds them to the campaign via Plusvibe /lead/add (skip_if_in_workspace = true so a lead
 * already in the workspace is never double-added), then marks them 'sent'. Plusvibe paces
 * actual sends per mailbox, so pushing more than the daily capacity just queues safely.
 */

const PV_BASE = "https://api.plusvibe.ai/api/v1";
const CHUNK = 100;

async function pvPost(path, apiKey, body) {
  const res = await fetch(`${PV_BASE}${path}`, {
    method: "POST",
    headers: { "x-api-key": apiKey, "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(60000),
  });
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { json = { _raw: text }; }
  return { ok: res.ok, status: res.status, json };
}

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {{limit?: number, env?: object, launch?: boolean}} opts
 */
export async function pushColdToPlusvibe(supabase, { limit = 2000, env = process.env, launch = true } = {}) {
  const apiKey = env.PLUSVIBE_API_KEY;
  const workspace_id = env.PLUSVIBE_WORKSPACE_ID || "6857d4b2e833f82da2fdeb2c";
  const campaign_id = env.PLUSVIBE_CAMPAIGN_ID || "6a4aaffb18605e39f99b136b";
  if (!apiKey) throw new Error("PLUSVIBE_API_KEY missing");

  const { data: rows, error } = await supabase.from("whogoes_prospects")
    .select("id, email, first_name, last_name, company_name, company_domain, title, industry")
    .eq("is_contactable", true).eq("campaign_status", "new")
    .not("email", "is", null).limit(limit);
  if (error) throw new Error(`select prospects: ${error.message}`);
  if (!rows?.length) return { selected: 0, pushed: 0, marked: 0 };

  let pushed = 0, marked = 0;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    const leads = chunk.map((r) => ({
      email: r.email,
      first_name: r.first_name || "",
      last_name: r.last_name || "",
      company_name: r.company_name || "",
      company_website: r.company_domain || "",
      custom_variables: { title: r.title || "", industry: r.industry || "" },
    }));
    const res = await pvPost("/lead/add", apiKey, { workspace_id, campaign_id, skip_if_in_workspace: true, leads });
    if (!res.ok) throw new Error(`plusvibe /lead/add ${res.status}: ${JSON.stringify(res.json).slice(0, 300)}`);
    pushed += leads.length;

    const ids = chunk.map((r) => r.id);
    const { error: upErr } = await supabase.from("whogoes_prospects")
      .update({ campaign_status: "sent", sent_at: new Date().toISOString(), instantly_campaign_id: campaign_id, updated_at: new Date().toISOString() })
      .in("id", ids);
    if (upErr) throw new Error(`mark sent: ${upErr.message}`);
    marked += ids.length;
  }

  if (launch) {
    // reactivate so newly added leads start sending (best-effort)
    await pvPost("/campaign/launch", apiKey, { workspace_id, campaign_id }).catch(() => {});
  }
  return { selected: rows.length, pushed, marked };
}
