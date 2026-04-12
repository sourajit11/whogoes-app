const LOOPS_API_KEY = process.env.LOOPS_API_KEY;
const LOOPS_API_URL = "https://app.loops.so/api/v1";

interface LoopsContact {
  email: string;
  firstName?: string;
  lastName?: string;
  [key: string]: string | number | boolean | undefined;
}

interface LoopsEvent {
  email: string;
  eventName: string;
  eventProperties?: Record<string, string | number | boolean>;
}

async function loopsFetch(endpoint: string, body: object) {
  if (!LOOPS_API_KEY) {
    console.warn("LOOPS_API_KEY not set, skipping Loops call");
    return null;
  }

  const res = await fetch(`${LOOPS_API_URL}${endpoint}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${LOOPS_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    console.error(`Loops API error (${endpoint}):`, text);
    return null;
  }

  return res.json();
}

/** Create or update a contact in Loops (triggered on signup) */
export async function createLoopsContact(contact: LoopsContact) {
  return loopsFetch("/contacts/create", contact);
}

/** Send an event to Loops (e.g. first_unlock) */
export async function sendLoopsEvent(event: LoopsEvent) {
  return loopsFetch("/events/send", event);
}

/** Update contact properties in Loops */
export async function updateLoopsContact(
  email: string,
  properties: Record<string, string | number | boolean>
) {
  return loopsFetch("/contacts/update", { email, ...properties });
}
