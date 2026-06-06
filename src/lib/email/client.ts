const RESEND_API_KEY = process.env.RESEND_API_KEY;
const RESEND_API_URL = "https://api.resend.com/emails";

// All automated mail goes out as Souraa, plain text. Sent from a subdomain to
// protect the root domain's reputation; replies (and STOP) land in the real
// hello@whogoes.co inbox so they turn into conversations and n8n can read them.
const FROM = "Souraa from WhoGoes <hello@contact.whogoes.co>";
const REPLY_TO = "hello@whogoes.co";

/**
 * Send a plain-text email via Resend. No HTML, ever.
 * No-ops (and warns) if RESEND_API_KEY is unset.
 */
export async function sendEmail({
  to,
  subject,
  text,
}: {
  to: string;
  subject: string;
  text: string;
}) {
  if (!RESEND_API_KEY) {
    console.warn("RESEND_API_KEY not set, skipping email send");
    return null;
  }

  const res = await fetch(RESEND_API_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ from: FROM, to, subject, text, reply_to: REPLY_TO }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Resend error ${res.status}: ${body}`);
  }

  return res.json();
}
