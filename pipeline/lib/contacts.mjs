import { fetchByIds } from "./supabase.mjs";
import { isPersonalEmail, SETTLED_HOURS } from "./constants.mjs";

/**
 * Fetch contacts for an event.
 * - INIT mode: fetch ALL contacts for the event
 * - INCREMENTAL mode: fetch only contacts created after the watermark
 *
 * Returns array of enriched contact objects ready for personalization.
 */
export async function fetchContactsForEvent(supabase, event) {
  const settledCutoff = new Date(Date.now() - SETTLED_HOURS * 60 * 60 * 1000).toISOString();

  // 1. Fetch contact_events for this event
  const contactEvents = await fetchByIds(
    supabase, "contact_events", "event_id", [event.event_id],
    "contact_id, event_id, post_id, source_type, first_line_personalization"
  );
  console.log(`    contact_events: ${contactEvents.length}`);

  if (contactEvents.length === 0) return [];

  // 2. Get unique contact IDs
  const contactIds = [...new Set(contactEvents.map((ce) => ce.contact_id))];

  // 3. Fetch contacts
  const allContacts = await fetchByIds(
    supabase, "contacts", "id", contactIds,
    "id, first_name, last_name, current_title, created_at, current_company_id, country"
  );

  // 4. Apply date filters
  let contacts;
  if (event.isInit) {
    // INIT: all contacts, but only settled ones
    contacts = allContacts.filter((c) =>
      c.created_at && c.created_at <= settledCutoff
    );
    console.log(`    INIT mode: ${contacts.length} settled contacts (of ${allContacts.length} total)`);
  } else {
    // INCREMENTAL: only contacts created after watermark AND settled
    contacts = allContacts.filter((c) => {
      if (!c.created_at) return false;
      return c.created_at > event.lastContactCreatedAt && c.created_at <= settledCutoff;
    });
    console.log(`    INCREMENTAL mode: ${contacts.length} new contacts since ${event.lastContactCreatedAt}`);
  }

  if (contacts.length === 0) return [];

  const contactMap = Object.fromEntries(contacts.map((c) => [c.id, c]));
  const filteredContactIds = contacts.map((c) => c.id);

  // 5. Fetch primary valid emails
  const allEmails = await fetchByIds(
    supabase, "contact_emails", "contact_id", filteredContactIds,
    "contact_id, email, status, is_primary"
  );
  const emailMap = {};
  for (const e of allEmails) {
    if (e.is_primary && e.email && e.email.trim()) {
      emailMap[e.contact_id] = e.email.trim();
    }
  }

  // 6. Fetch companies
  const companyIds = [...new Set(contacts.map((c) => c.current_company_id).filter(Boolean))];
  const companies = companyIds.length > 0
    ? await fetchByIds(supabase, "companies", "id", companyIds, "id, name")
    : [];
  const companyMap = Object.fromEntries(companies.map((c) => [c.id, c.name]));

  // 7. Fetch posts (for personalization context)
  const postIds = [...new Set(contactEvents.map((ce) => ce.post_id).filter(Boolean))];
  const posts = postIds.length > 0
    ? await fetchByIds(supabase, "posts", "id", postIds, "id, content, post_url")
    : [];
  const postMap = Object.fromEntries(posts.map((p) => [p.id, p]));

  // 8. Build contact-event lookup
  const ceMap = {};
  for (const ce of contactEvents) {
    ceMap[ce.contact_id] = ce;
  }

  // 9. Build enriched rows, apply filters, dedup
  const seen = new Set();
  const skipped = { noEmail: 0, noName: 0, personal: 0, dedup: 0 };
  const rows = [];

  for (const contact of contacts) {
    const email = emailMap[contact.id];
    if (!email) { skipped.noEmail++; continue; }
    if (!contact.first_name?.trim()) { skipped.noName++; continue; }
    if (isPersonalEmail(email)) { skipped.personal++; continue; }

    const emailLower = email.toLowerCase();
    if (seen.has(emailLower)) { skipped.dedup++; continue; }
    seen.add(emailLower);

    const ce = ceMap[contact.id];
    const post = ce?.post_id ? postMap[ce.post_id] : null;

    rows.push({
      firstName: contact.first_name.trim(),
      lastName: (contact.last_name || "").trim(),
      email,
      eventName: event.event_name,
      companyName: companyMap[contact.current_company_id] || "",
      sourceType: ce?.source_type || "",
      postContent: post?.content || "",
      postUrl: post?.post_url || "",
      existingPersonalization: ce?.first_line_personalization || "",
      createdAt: contact.created_at,
    });
  }

  if (skipped.noEmail || skipped.noName || skipped.personal || skipped.dedup) {
    console.log(`    Filtered out: noEmail=${skipped.noEmail} noName=${skipped.noName} personal=${skipped.personal} dedup=${skipped.dedup}`);
  }

  return rows;
}
