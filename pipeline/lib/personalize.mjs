import { GoogleGenerativeAI } from "@google/generative-ai";

const BATCH_SIZE = 25;
const DELAY_MS = 0;

/**
 * Generate first-line personalization for contacts using Gemini Flash.
 * Batches contacts in groups of 10. Falls back to template on failure.
 * If a contact already has personalization from the DB, uses that instead.
 */
export async function personalizeContacts(contacts, geminiApiKey) {
  if (!geminiApiKey) {
    console.log("    No GEMINI_API_KEY set, using fallback personalization for all");
    return contacts.map((c) => ({ ...c, personalization: fallbackLine(c) }));
  }

  const genAI = new GoogleGenerativeAI(geminiApiKey);
  const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

  // All contacts go through Gemini (existing DB personalizations are from
  // a different product and not usable for WhoGoes campaigns)
  const needsAI = [...contacts];
  const results = [];

  console.log(`    Personalization: ${needsAI.length} contacts need Gemini`);

  // Process in batches
  for (let i = 0; i < needsAI.length; i += BATCH_SIZE) {
    const batch = needsAI.slice(i, i + BATCH_SIZE);
    try {
      const prompt = buildPrompt(batch);
      const result = await model.generateContent(prompt);
      const text = result.response.text();
      const lines = parseResponse(text, batch.length);

      for (let j = 0; j < batch.length; j++) {
        results.push({
          ...batch[j],
          personalization: lines[j] || fallbackLine(batch[j]),
        });
      }
    } catch (err) {
      console.error(`    Gemini batch ${Math.floor(i / BATCH_SIZE) + 1} failed: ${err.message}`);
      for (const c of batch) {
        results.push({ ...c, personalization: fallbackLine(c) });
      }
    }

    if (i + BATCH_SIZE < needsAI.length) {
      await new Promise((r) => setTimeout(r, DELAY_MS));
    }
  }

  return results;
}

function buildPrompt(contacts) {
  const lines = contacts.map((c, i) => {
    const snippet = (c.postContent || "").slice(0, 150).replace(/\n/g, " ");
    return `${i + 1}. Name: ${c.firstName}, Company: ${c.companyName || "unknown"}, Event: ${c.eventName}, Source: ${c.sourceType || "unknown"}, Post: "${snippet}"`;
  });

  return `You are writing first-line personalizations for cold outreach emails about trade show attendee data.

For each contact below, write a 1-2 sentence personalized opener.

RULES:
- ALWAYS mention "LinkedIn" — say "your LinkedIn post" or "a LinkedIn post" or "on LinkedIn". This is non-negotiable.
- Start with "Saw" or "Noticed" — e.g. "Saw your LinkedIn post about..." or "Noticed on LinkedIn that..."
- Reference the specific event and what they posted about.
- End with a short question like: "Have you started reaching out to other attendees before the event?" or "Are you doing any pre-event outreach this year?" or "How are you planning your outreach for the event?"
- The question should feel natural, not forced. Vary it across contacts.

CONTEXT — the next part of the email introduces WhoGoes, a tool that finds verified event attendees from LinkedIn posts. So the personalization should flow naturally into that intro. The question at the end sets up the product intro.

TONE:
- Casual, friendly, plain English (8th grade level)
- No exclamation marks. No em dashes (-- or —).
- No filler like "hope it goes well", "sounds interesting", "caught my eye"
- No trying to impress or flatter — just be direct and curious
- Don't say "interesting", "great event", "exciting" — just state what you saw

SOURCE TYPE RULES:
- "post_author": They wrote a LinkedIn post. Say "Saw your LinkedIn post about [specific thing]..."
- "repost": They shared someone else's LinkedIn post. Say "Noticed you shared a LinkedIn post about [specific thing]..."
- "mentioned": They were tagged in a LinkedIn post. Say "Saw you were mentioned in a LinkedIn post about [specific thing]..."

BAD EXAMPLES (never write like this):
- "Your post about X caught my eye. Sounds interesting."
- "Hope it's a great event for SemChip."
- "Your mention regarding X was interesting."
- "Looking forward to seeing your team at X."
- "Are you planning to meet with vendors/attendees there?"

GOOD EXAMPLES:
- "Saw your LinkedIn post about presenting at MODEX 2026. Have you started reaching out to other attendees before the event?"
- "Noticed you shared a LinkedIn post about SemChip exhibiting at LEAP 2026. Are you doing any pre-event outreach this year?"
- "Saw you were mentioned in a LinkedIn post about the AI panel at Hannover Messe. How are you planning your outreach for the event?"

Contacts:
${lines.join("\n")}

Return ONLY numbered lines (1. 2. 3. etc) matching the input. One line per contact. Nothing else.`;
}

function parseResponse(text, expectedCount) {
  const lines = text
    .split("\n")
    .map((l) => l.replace(/^\d+[\.\)]\s*/, "").trim())
    .filter((l) => l.length > 0);

  // Pad with empty strings if we got fewer lines than expected
  while (lines.length < expectedCount) {
    lines.push("");
  }
  return lines;
}

function fallbackLine(contact) {
  const event = contact.eventName || "the event";
  if (contact.sourceType === "post_author") {
    return `Saw your LinkedIn post about attending ${event}. Have you started reaching out to other attendees before the event?`;
  }
  if (contact.sourceType === "repost") {
    return `Noticed you shared a LinkedIn post about ${event}. Are you doing any pre-event outreach this year?`;
  }
  if (contact.sourceType === "mentioned") {
    return `Saw you were mentioned in a LinkedIn post about ${event}. How are you planning your outreach for the event?`;
  }
  return `Saw you're connected to ${event} on LinkedIn. Are you doing any pre-event outreach this year?`;
}
