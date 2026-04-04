/**
 * One-time helper to get a Google OAuth2 refresh token.
 *
 * Usage:
 *   GOOGLE_CLIENT_ID=xxx GOOGLE_CLIENT_SECRET=yyy node pipeline/get-refresh-token.mjs
 *
 * Steps:
 *   1. Create OAuth2 Client ID (Desktop app) in Google Cloud Console
 *   2. Run this script with your client ID and secret
 *   3. Open the URL it prints in your browser
 *   4. Authorize and paste the code back
 *   5. Save the refresh token as GOOGLE_REFRESH_TOKEN in GitHub Secrets
 */

import { google } from "googleapis";
import { createInterface } from "readline";

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error("Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET env vars first.");
  process.exit(1);
}

const oauth2 = new google.auth.OAuth2(
  CLIENT_ID,
  CLIENT_SECRET,
  "urn:ietf:wg:oauth:2.0:oob" // out-of-band redirect for CLI
);

const authUrl = oauth2.generateAuthUrl({
  access_type: "offline",
  prompt: "consent",
  scope: ["https://www.googleapis.com/auth/spreadsheets"],
});

console.log("\n1. Open this URL in your browser:\n");
console.log(authUrl);
console.log("\n2. Authorize with your Google account");
console.log("3. Copy the authorization code and paste it below:\n");

const rl = createInterface({ input: process.stdin, output: process.stdout });

rl.question("Authorization code: ", async (code) => {
  rl.close();
  try {
    const { tokens } = await oauth2.getToken(code.trim());
    console.log("\n=== Success! ===\n");
    console.log("Your refresh token (save this as GOOGLE_REFRESH_TOKEN in GitHub Secrets):\n");
    console.log(tokens.refresh_token);
    console.log();
  } catch (err) {
    console.error("Failed to get tokens:", err.message);
    process.exit(1);
  }
});
