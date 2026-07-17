/**
 * Affiliate "Event Insider" recruitment engine.
 *
 * Fully automated daily sync (called by /api/affiliate-recruit/sync via n8n,
 * or locally by app/scripts/affiliate-recruit-sync.mjs):
 *
 *  Phase 1 (T-3 weeks): qualify targets for every event starting 1..21 days
 *  out and insert them into affiliate_recruit_targets. That insert doubles as
 *  the suppression that keeps these contacts out of the customer Plusvibe
 *  pipeline (see contacts.mjs). LinkedIn-channel rows are served to the user
 *  by the /linkedin-affiliate-connect daily loop straight from the table.
 *
 *  Phase 2 (T-2 weeks): for email-channel rows still 'targeted' whose event
 *  starts within 14 days, Reoon power-verify the address. Safe -> push to the
 *  Plusvibe affiliate campaign (PLUSVIBE_AFFILIATE_CAMPAIGN_ID) and mark
 *  'emailed'. Not safe -> flip the contact to the LinkedIn track when a
 *  profile URL exists (it joins the daily connect list), else 'declined'.
 *  Reoon errors leave the row 'targeted' so the next run retries.
 */
import { fetchByIds } from "./supabase.mjs";
import { isPersonalEmail } from "./constants.mjs";

const REOON = "https://emailverifier.reoon.com/api/v1/verify";
const PV_BASE = "https://api.plusvibe.ai/api/v1";
const PV_EMAIL = /^[a-z0-9]([a-z0-9._-]*[a-z0-9])?@[a-z0-9]([a-z0-9.-]*[a-z0-9])?\.[a-z]{1,}$/i;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STUDENT_TITLE_RE = /\bstudent\b|\bundergrad|\bphd candidate\b|\bmba candidate\b/i;
const UNIVERSITY_NAME_RE = /universit|\bcollege\b|institute of technology|polytechnic|\bschool of\b/i;

export { UUID_RE };

function daysFromNow(n) {
  return new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
}

/** Events starting minDays..maxDays out. */
export async function listWindowEvents(supabase, { minDays = 1, maxDays = 21 } = {}) {
  const { data, error } = await supabase
    .from("events")
    .select("id, name, year, start_date, slug, organizer_company_id")
    .gte("start_date", daysFromNow(minDays))
    .lte("start_date", daysFromNow(maxDays))
    .order("start_date");
  if (error) throw error;
  return data ?? [];
}

/** All auth user emails (existing customers + affiliates) for exclusion. */
export async function fetchAuthUserEmails(supabase) {
  const emails = new Set();
  let page = 1;
  for (;;) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw error;
    for (const u of data.users) if (u.email) emails.add(u.email.toLowerCase());
    if (data.users.length < 1000) break;
    page += 1;
  }
  return emails;
}

/**
 * Qualify one event's confirmed contacts into affiliate recruit targets.
 * Pure read: returns { targets, skipped } without writing anything.
 * Pass a shared authEmails set when qualifying many events in one run.
 */
export async function qualifyEventTargets(supabase, event, { authEmails } = {}) {
  const contactEvents = (
    await fetchByIds(supabase, "contact_events", "event_id", [event.id], "contact_id, source_type, is_speaker")
  ).filter((ce) => ce.source_type !== "repost"); // 'repost' = expected attendee, excluded
  const contactIds = [...new Set(contactEvents.map((ce) => ce.contact_id))];
  const skipped = { notSegment: 0, orgSponsor: 0, isUser: 0, alreadyRecruited: 0, alreadySent: 0, noChannel: 0 };
  if (contactIds.length === 0) return { targets: [], skipped, confirmed: 0 };

  const contacts = await fetchByIds(
    supabase, "contacts", "id", contactIds,
    "id, full_name, first_name, last_name, current_title, headline, linkedin_url, country, current_company_id, seniority_bucket, created_at"
  );
  const companyIds = [...new Set(contacts.map((c) => c.current_company_id).filter(Boolean))];
  const companies = await fetchByIds(
    supabase, "companies", "id", companyIds, "id, name, size_bucket, employee_count, industry_bucket"
  );
  const companyMap = Object.fromEntries(companies.map((c) => [c.id, c]));

  const eventRoles = (
    await fetchByIds(supabase, "company_event_roles", "event_id", [event.id], "company_id, role")
  ).reduce((acc, r) => ((acc[r.company_id] = r.role), acc), {});

  const emailRows = await fetchByIds(
    supabase, "contact_emails", "contact_id", contactIds, "contact_id, email, status, is_primary"
  );
  const emailMap = {};
  for (const e of emailRows) {
    if (e.status !== "valid" || !e.email?.trim()) continue;
    const addr = e.email.trim();
    if (isPersonalEmail(addr)) continue;
    if (e.is_primary || !emailMap[e.contact_id]) emailMap[e.contact_id] = addr;
  }

  const users = authEmails ?? (await fetchAuthUserEmails(supabase));
  const alreadyRecruited = new Set(
    (await fetchByIds(supabase, "affiliate_recruit_targets", "contact_id", contactIds, "contact_id"))
      .map((r) => r.contact_id)
  );
  const { data: stateRows } = await supabase
    .from("pipeline_state").select("last_contact_created_at").eq("event_id", event.id);
  const watermark = stateRows?.[0]?.last_contact_created_at ?? null;

  const targets = [];
  for (const c of contacts) {
    const company = c.current_company_id ? companyMap[c.current_company_id] : null;
    const companyRole = company ? eventRoles[company.id] : null;

    const titleText = `${c.current_title || ""} ${c.headline || ""}`;
    const universityCompany =
      company && (UNIVERSITY_NAME_RE.test(company.name || "") || company.industry_bucket === "Education");
    // Student = says so in title/headline, or is at a university with no title
    // to contradict it. University staff (professors, deans, ...) have titles.
    const isStudent = STUDENT_TITLE_RE.test(titleText) || (universityCompany && !titleText.trim());
    const tinyCompany =
      !company || company.size_bucket === "1-10" ||
      (company.employee_count != null && company.employee_count <= 10);
    const isFounder =
      c.seniority_bucket === "Owner/Founder" ||
      (c.seniority_bucket === "C-Suite" && tinyCompany);

    let segment = null;
    if (isStudent) segment = "student";
    else if (isFounder && tinyCompany) segment = companyRole === "exhibitor" ? "founder_exhibitor" : "founder_attendee";
    if (!segment) { skipped.notSegment++; continue; }

    if (companyRole === "organizer" || companyRole === "sponsor" ||
        (event.organizer_company_id && c.current_company_id === event.organizer_company_id)) {
      skipped.orgSponsor++; continue;
    }

    const email = emailMap[c.id] || null;
    if (email && users.has(email.toLowerCase())) { skipped.isUser++; continue; }
    if (alreadyRecruited.has(c.id)) { skipped.alreadyRecruited++; continue; }
    // Already pushed to a customer Plusvibe campaign — no double-touch.
    if (email && watermark && c.created_at && c.created_at <= watermark) { skipped.alreadySent++; continue; }

    const channel = email ? "email" : c.linkedin_url ? "linkedin" : null;
    if (!channel) { skipped.noChannel++; continue; }

    targets.push({
      contact_id: c.id,
      full_name: c.full_name || `${c.first_name || ""} ${c.last_name || ""}`.trim(),
      first_name: c.first_name || "",
      title: c.current_title || c.headline || "",
      company: company?.name || "",
      company_size: company?.size_bucket || "",
      segment,
      channel,
      email: email || "",
      linkedin_url: c.linkedin_url || "",
      country: c.country || "",
      event: event.name.endsWith(String(event.year ?? "")) ? event.name : `${event.name} ${event.year ?? ""}`.trim(),
    });
  }

  return { targets, skipped, confirmed: contactIds.length, watermark };
}

/** Insert qualified targets (idempotent: existing contact_ids are left alone). */
export async function insertTargets(supabase, event, targets) {
  const rows = targets.map((t) => ({
    contact_id: t.contact_id,
    event_id: event.id,
    channel: t.channel,
    segment: t.segment,
  }));
  for (let i = 0; i < rows.length; i += 200) {
    const { error } = await supabase
      .from("affiliate_recruit_targets")
      .upsert(rows.slice(i, i + 200), { onConflict: "contact_id", ignoreDuplicates: true });
    if (error) throw error;
  }
  return rows.length;
}

async function reoonVerify(email, env) {
  const url = `${REOON}?email=${encodeURIComponent(email)}&key=${encodeURIComponent(env.REOON_API_KEY)}&mode=power`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(30000) });
    const j = await res.json();
    const status = String(j?.status ?? j?.result ?? "unknown").trim().toLowerCase().replace(/\s+/g, "_");
    return { status, safe: j?.is_safe_to_send === true };
  } catch { return { status: "error", safe: false }; }
}

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
 * The daily sync. Idempotent; safe to run every day.
 * dryRun: report everything, write nothing, call no paid APIs.
 */
export async function syncAffiliateRecruits(supabase, { env = process.env, dryRun = false } = {}) {
  // Only recruit at big events: below this many confirmed (non-repost)
  // contacts there are too few founders/students to be worth the touches.
  const minEventContacts = Number(env.AFFILIATE_MIN_EVENT_CONTACTS || 300);
  // Email track needs runway: the recruit has to reply, get approved, receive
  // credits and actually promote. Closer than this and the affiliate ask lands
  // too late to be acted on at that show.
  const emailMinLeadDays = Number(env.AFFILIATE_EMAIL_MIN_LEAD_DAYS || 4);
  const emailMaxLeadDays = Number(env.AFFILIATE_EMAIL_MAX_LEAD_DAYS || 14);
  // Never qualify an event we cannot act on. The LinkedIn track (the dominant
  // channel) needs runway: connect -> acceptance -> DM -> apply -> approve ->
  // promote. Qualifying inside that only strands rows, which suppress the
  // contact from the customer pipeline while never being contacted by us.
  const qualifyMinLeadDays = Number(env.AFFILIATE_QUALIFY_MIN_LEAD_DAYS || 5);
  const qualifyMaxLeadDays = Number(env.AFFILIATE_QUALIFY_MAX_LEAD_DAYS || 21);
  const summary = {
    minEventContacts,
    qualifyLeadWindowDays: [qualifyMinLeadDays, qualifyMaxLeadDays],
    emailLeadWindowDays: [emailMinLeadDays, emailMaxLeadDays],
    qualified: {},
    skippedSmallEvents: 0,
    emailTrack: { verified: 0, pushed: 0, flippedToLinkedin: 0, declined: 0, retryLater: 0 },
    dryRun,
  };

  // ---- Phase 1: qualify big events with enough runway to act on ------------
  const events = await listWindowEvents(supabase, { minDays: qualifyMinLeadDays, maxDays: qualifyMaxLeadDays });
  const authEmails = await fetchAuthUserEmails(supabase);
  for (const event of events) {
    const { count } = await supabase
      .from("contact_events")
      .select("id", { count: "exact", head: true })
      .eq("event_id", event.id)
      .neq("source_type", "repost");
    if ((count ?? 0) < minEventContacts) { summary.skippedSmallEvents++; continue; }

    const { targets } = await qualifyEventTargets(supabase, event, { authEmails });
    if (targets.length === 0) continue;
    if (!dryRun) await insertTargets(supabase, event, targets);
    summary.qualified[`${event.name} (${event.start_date})`] = {
      inserted: targets.length,
      byChannel: targets.reduce((a, t) => ((a[t.channel] = (a[t.channel] || 0) + 1), a), {}),
    };
  }

  // ---- Phase 2: email track, events emailMinLeadDays..emailMaxLeadDays out --
  // Rows for events closer than the floor are simply left 'targeted': they were
  // already inside the window when qualified, so there is nothing to email them
  // about in time. Their LinkedIn-track peers are unaffected.
  const { data: emailRows, error } = await supabase
    .from("affiliate_recruit_targets")
    .select("contact_id, event_id, segment, events!inner(id, name, year, start_date)")
    .eq("channel", "email")
    .eq("status", "targeted")
    .lte("events.start_date", daysFromNow(emailMaxLeadDays))
    .gte("events.start_date", daysFromNow(emailMinLeadDays));
  if (error) throw error;

  // Reoon results are not persisted, so never verify before the push
  // destination exists: otherwise every run re-pays for the same addresses.
  const pvConfigured =
    !!env.PLUSVIBE_API_KEY && !!env.PLUSVIBE_WORKSPACE_ID && !!env.PLUSVIBE_AFFILIATE_CAMPAIGN_ID;
  if (!dryRun && !pvConfigured && emailRows?.length) {
    summary.emailTrack.note = `PLUSVIBE_AFFILIATE_CAMPAIGN_ID not set — ${emailRows.length} email-track row(s) waiting, none verified or pushed`;
  } else if (emailRows?.length) {
    const contacts = await fetchByIds(
      supabase, "contacts", "id", emailRows.map((r) => r.contact_id),
      "id, first_name, last_name, linkedin_url, current_company_id"
    );
    const contactMap = Object.fromEntries(contacts.map((c) => [c.id, c]));
    const emails = await fetchByIds(
      supabase, "contact_emails", "contact_id", emailRows.map((r) => r.contact_id),
      "contact_id, email, status, is_primary"
    );
    const emailMap = {};
    for (const e of emails) {
      if (e.status !== "valid" || !e.email?.trim() || isPersonalEmail(e.email.trim())) continue;
      if (e.is_primary || !emailMap[e.contact_id]) emailMap[e.contact_id] = e.email.trim();
    }
    const companies = await fetchByIds(
      supabase, "companies", "id",
      [...new Set(contacts.map((c) => c.current_company_id).filter(Boolean))], "id, name"
    );
    const companyName = Object.fromEntries(companies.map((c) => [c.id, c.name]));

    const setStatus = async (contactId, patch) => {
      if (dryRun) return;
      const { error: upErr } = await supabase
        .from("affiliate_recruit_targets")
        .update({ ...patch, status_updated_at: new Date().toISOString() })
        .eq("contact_id", contactId);
      if (upErr) throw upErr;
    };

    const pushable = [];
    for (const row of emailRows) {
      const c = contactMap[row.contact_id];
      const email = emailMap[row.contact_id];
      if (!c) continue;
      if (!email || !PV_EMAIL.test(email)) {
        // no usable address after all: fall back to LinkedIn or drop
        if (c.linkedin_url) { await setStatus(row.contact_id, { channel: "linkedin" }); summary.emailTrack.flippedToLinkedin++; }
        else { await setStatus(row.contact_id, { status: "declined" }); summary.emailTrack.declined++; }
        continue;
      }
      if (dryRun) { summary.emailTrack.verified++; pushable.push(null); continue; }

      const v = await reoonVerify(email, env);
      if (v.status === "error") { summary.emailTrack.retryLater++; continue; } // stays targeted, retried next run
      if (!v.safe) {
        // HARD RULE: only Reoon-safe emails reach Plusvibe. Not safe -> LinkedIn track.
        if (c.linkedin_url) { await setStatus(row.contact_id, { channel: "linkedin" }); summary.emailTrack.flippedToLinkedin++; }
        else { await setStatus(row.contact_id, { status: "declined" }); summary.emailTrack.declined++; }
        continue;
      }
      summary.emailTrack.verified++;
      const eventName = row.events.name.endsWith(String(row.events.year ?? ""))
        ? row.events.name
        : `${row.events.name} ${row.events.year ?? ""}`.trim();
      pushable.push({
        contact_id: row.contact_id,
        lead: {
          email,
          first_name: c.first_name || "",
          last_name: c.last_name || "",
          company_name: companyName[c.current_company_id] || "",
          custom_variables: { event: eventName, segment: row.segment },
        },
      });
    }

    if (!dryRun && pushable.length > 0) {
      const apiKey = env.PLUSVIBE_API_KEY;
      const workspace_id = env.PLUSVIBE_WORKSPACE_ID;
      const campaign_id = env.PLUSVIBE_AFFILIATE_CAMPAIGN_ID;
      for (let i = 0; i < pushable.length; i += 100) {
        const chunk = pushable.slice(i, i + 100);
        const res = await pvPost("/lead/add", apiKey, {
          workspace_id, campaign_id, skip_if_in_workspace: true,
          leads: chunk.map((p) => p.lead),
        });
        if (res.ok) {
          for (const p of chunk) await setStatus(p.contact_id, { status: "emailed" });
          summary.emailTrack.pushed += chunk.length;
        } else {
          console.error(`plusvibe /lead/add ${res.status}: ${JSON.stringify(res.json).slice(0, 300)}`);
        }
      }
      if (summary.emailTrack.pushed > 0) {
        await pvPost("/campaign/launch", apiKey, { workspace_id, campaign_id }).catch(() => {});
      }
    }
  }

  return summary;
}
