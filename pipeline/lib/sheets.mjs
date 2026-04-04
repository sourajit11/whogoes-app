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

/**
 * Append contact rows to the correct regional tab in the Google Sheet.
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

  await sheets.spreadsheets.values.append({
    spreadsheetId: config.sheetId,
    range: `${region}!A:E`,
    valueInputOption: "RAW",
    insertDataOption: "INSERT_ROWS",
    requestBody: { values: rows },
  });

  return rows.length;
}
