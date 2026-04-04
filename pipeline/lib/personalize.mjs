import { GoogleGenerativeAI } from "@google/generative-ai";

const BATCH_SIZE = 10;
const DELAY_MS = 1500;

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

  return `You are writing first-line personalizations for cold emails about trade show attendee data.

For each contact below, write a SHORT (max 15 words) personalized opening line.
Rules based on source type:
- "post_author": They wrote a LinkedIn post. Reference what they said about the event.
- "repost": They shared someone else's post. Assume they're attending. Reference the shared content.
- "mentioned": They were tagged in a post. Reference the context of the mention.

Keep it casual, friendly, 8th grade English. No exclamation marks. No em dashes.

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
    return `Saw your LinkedIn post about attending ${event}.`;
  }
  if (contact.sourceType === "repost") {
    return `Noticed you shared a post about ${event}.`;
  }
  if (contact.sourceType === "mentioned") {
    return `Saw you got tagged in a post about ${event}.`;
  }
  return `Saw you're connected to ${event} on LinkedIn.`;
}
