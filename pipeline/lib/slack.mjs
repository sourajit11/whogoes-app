/**
 * Send a summary notification to Slack via incoming webhook.
 */
export async function sendSlackNotification(summary, webhookUrl) {
  if (!webhookUrl) {
    console.log("  No SLACK_WEBHOOK_URL set, skipping notification");
    return;
  }

  const newEventLines = summary.newEvents.length > 0
    ? summary.newEvents.map((e) => `  - ${e.name} (${e.contacts} contacts)`).join("\n")
    : "  None";

  const errorLines = summary.errors.length > 0
    ? `\n:warning: *Errors:*\n${summary.errors.map((e) => `  - ${e}`).join("\n")}`
    : "";

  const total = summary.regions.US + summary.regions.EU + summary.regions.APAC;

  const text = [
    `:chart_with_upwards_trend: *Daily Lead Extract Complete*`,
    `Run time: ${summary.duration}s`,
    ``,
    `*New events detected:*`,
    newEventLines,
    ``,
    `*Contacts added to GSheet:*`,
    `  US: ${summary.regions.US}`,
    `  EU: ${summary.regions.EU}`,
    `  APAC: ${summary.regions.APAC}`,
    `  *Total: ${total}*`,
    errorLines,
  ].filter((l) => l !== undefined).join("\n");

  try {
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });

    if (!res.ok) {
      console.error(`  Slack webhook returned ${res.status}: ${await res.text()}`);
    }
  } catch (err) {
    console.error(`  Slack notification failed: ${err.message}`);
  }
}
