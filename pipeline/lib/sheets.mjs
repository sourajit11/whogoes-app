import { google } from "googleapis";

/**
 * Build OAuth2 client from refresh token.
 * Requires: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN
 */
function getAuthClient(config) {
  const oauth2 = new google.auth.OAuth2(
    config.clientId,
    config.clientSecret
  );

  oauth2.setCredentials({
    refresh_token: config.refreshToken,
  });

  return oauth2;
}

const CHUNK_SIZE = 500;

/**
 * Append contact rows to the correct regional tab in the Google Sheet.
 * Writes in chunks of 500 rows to avoid payload limits and improve reliability.
 *
 * Columns: First Name | Last Name | Email Address | Personalization | Event Name
 * Tabs: US, EU, APAC (must already exist in the sheet with headers in row 1)
 */
export async function appendToSheet(contacts, region, config) {
  if (contacts.length === 0) return 0;

  const auth = getAuthClient(config);
  const sheets = google.sheets({ version: "v4", auth });

  const rows = contacts.map((c) => [
    c.firstName,
    c.lastName,
    c.email,
    c.personalization,
    c.eventName,
  ]);

  for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
    const chunk = rows.slice(i, i + CHUNK_SIZE);
    await sheets.spreadsheets.values.append({
      spreadsheetId: config.sheetId,
      range: `${region}!A:E`,
      valueInputOption: "RAW",
      insertDataOption: "INSERT_ROWS",
      requestBody: { values: chunk },
    });

    if (i + CHUNK_SIZE < rows.length) {
      console.log(`    ${region}: wrote ${i + chunk.length}/${rows.length} rows...`);
    }
  }

  return rows.length;
}

/**
 * Fetch all existing email addresses from a regional tab.
 * Reads column C (Email Address) starting from row 2 (skip header).
 * Returns a Set of lowercase email strings for dedup.
 */
export async function getExistingEmails(region, config) {
  const auth = getAuthClient(config);
  const sheets = google.sheets({ version: "v4", auth });

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: config.sheetId,
    range: `${region}!C2:C`,
  });

  const emails = new Set();
  for (const row of res.data.values || []) {
    if (row[0]) emails.add(row[0].trim().toLowerCase());
  }
  return emails;
}

/**
 * Append bounce rows to the "Bounces" tab.
 * Columns: Email | First Name | Last Name | Campaign | Company | Domain | Bounce Date
 * Tab must already exist in the sheet with headers in row 1.
 */
export async function appendToBouncesSheet(rows, config) {
  if (rows.length === 0) return 0;

  const auth = getAuthClient(config);
  const sheets = google.sheets({ version: "v4", auth });

  for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
    const chunk = rows.slice(i, i + CHUNK_SIZE);
    await sheets.spreadsheets.values.append({
      spreadsheetId: config.sheetId,
      range: `Bounces!A:G`,
      valueInputOption: "RAW",
      insertDataOption: "INSERT_ROWS",
      requestBody: { values: chunk },
    });

    if (i + CHUNK_SIZE < rows.length) {
      console.log(`    Bounces: wrote ${i + chunk.length}/${rows.length} rows...`);
    }
  }

  return rows.length;
}

/**
 * Fetch existing emails from the Bounces tab for dedup.
 * Reads column A (Email) starting from row 2 (skip header).
 */
export async function getExistingBounceEmails(config) {
  const auth = getAuthClient(config);
  const sheets = google.sheets({ version: "v4", auth });

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: config.sheetId,
    range: `Bounces!A2:A`,
  });

  const emails = new Set();
  for (const row of res.data.values || []) {
    if (row[0]) emails.add(row[0].trim().toLowerCase());
  }
  return emails;
}
