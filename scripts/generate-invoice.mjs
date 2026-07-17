#!/usr/bin/env node
/**
 * Usage:
 *   node generate-invoice.mjs \
 *     --company="Valutico" \
 *     --plan="Starter" \
 *     --amount=29 \
 *     --credits=200 \
 *     --paymentLink="https://rzp.io/rzp/XXXXXXXX" \
 *     [--invoiceDate="2026-05-07"] \
 *     [--invoiceNumber="INV-20260507-VALUTICO"]
 *
 * Outputs: invoices/<company>-<date>.html — open in browser and print to PDF.
 */

import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function parseArgs() {
  const args = {};
  for (const arg of process.argv.slice(2)) {
    const [key, ...rest] = arg.replace(/^--/, "").split("=");
    args[key] = rest.join("=");
  }
  return args;
}

function formatDate(dateStr) {
  return new Date(dateStr).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

const args = parseArgs();

const company = args.company;
const plan = args.plan;
const amount = parseFloat(args.amount);
const credits = parseInt(args.credits, 10);
const paymentLink = args.paymentLink;
const invoiceDate = args.invoiceDate || new Date().toISOString().slice(0, 10);
const invoiceNumber =
  args.invoiceNumber ||
  `INV-${invoiceDate.replace(/-/g, "")}-${company.toUpperCase().replace(/\s+/g, "")}`;

if (!company || !plan || isNaN(amount) || isNaN(credits) || !paymentLink) {
  console.error(
    "Missing required args: --company, --plan, --amount, --credits, --paymentLink"
  );
  process.exit(1);
}

const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8" />
  <title>Invoice ${invoiceNumber} - WhoGoes</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; color: #18181b; padding: 48px; max-width: 720px; margin: 0 auto; }
    .header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 48px; }
    .logo { display: flex; align-items: center; gap: 10px; }
    .logo-box { width: 32px; height: 32px; background: #10b981; border-radius: 8px; display: flex; align-items: center; justify-content: center; color: white; font-weight: bold; font-size: 14px; }
    .logo-text { font-size: 20px; font-weight: 700; }
    .invoice-label { text-align: right; }
    .invoice-label h2 { font-size: 24px; font-weight: 700; color: #10b981; }
    .invoice-label p { font-size: 13px; color: #71717a; margin-top: 4px; }
    .section { margin-bottom: 32px; }
    .section-title { font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; color: #a1a1aa; margin-bottom: 8px; }
    .detail-row { display: flex; justify-content: space-between; padding: 8px 0; font-size: 14px; }
    .detail-row + .detail-row { border-top: 1px solid #f4f4f5; }
    .detail-label { color: #71717a; }
    .detail-value { font-weight: 500; }
    .table { width: 100%; border-collapse: collapse; margin-top: 8px; }
    .table th { text-align: left; font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; color: #a1a1aa; padding: 10px 12px; border-bottom: 2px solid #e4e4e7; }
    .table td { padding: 12px; font-size: 14px; border-bottom: 1px solid #f4f4f5; }
    .table .right { text-align: right; }
    .total-row td { font-weight: 700; font-size: 16px; border-top: 2px solid #18181b; border-bottom: none; }
    .badge { display: inline-block; background: #fef9c3; color: #b45309; padding: 2px 8px; border-radius: 4px; font-size: 12px; font-weight: 600; }
    .pay-btn-wrap { text-align: center; margin: 36px 0 8px; }
    .pay-btn {
      display: inline-block;
      background: #10b981;
      color: white;
      font-size: 16px;
      font-weight: 700;
      padding: 14px 40px;
      border-radius: 8px;
      text-decoration: none;
      letter-spacing: 0.02em;
    }
    .pay-note { text-align: center; font-size: 12px; color: #a1a1aa; margin-top: 8px; }
    .footer { margin-top: 48px; padding-top: 24px; border-top: 1px solid #e4e4e7; font-size: 12px; color: #a1a1aa; text-align: center; }
    @media print {
      body { padding: 24px; }
      .pay-btn-wrap, .pay-note { display: none; }
    }
  </style>
</head>
<body>
  <div class="header">
    <div class="logo">
      <div class="logo-box">W</div>
      <span class="logo-text">WhoGoes</span>
    </div>
    <div class="invoice-label">
      <h2>INVOICE</h2>
      <p>${invoiceNumber}</p>
    </div>
  </div>

  <div class="section">
    <p class="section-title">Bill To</p>
    <div class="detail-row">
      <span class="detail-label">Company</span>
      <span class="detail-value">${company}</span>
    </div>
    <div class="detail-row">
      <span class="detail-label">Invoice Date</span>
      <span class="detail-value">${formatDate(invoiceDate)}</span>
    </div>
    <div class="detail-row">
      <span class="detail-label">Status</span>
      <span class="detail-value"><span class="badge">PAYMENT PENDING</span></span>
    </div>
  </div>

  <div class="section">
    <p class="section-title">Order Details</p>
    <table class="table">
      <thead>
        <tr>
          <th>Item</th>
          <th>Credits</th>
          <th class="right">Amount</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>${plan.charAt(0).toUpperCase() + plan.slice(1)} Plan</td>
          <td>${credits.toLocaleString()}</td>
          <td class="right">$${amount.toFixed(2)}</td>
        </tr>
        <tr class="total-row">
          <td colspan="2">Total Due</td>
          <td class="right">$${amount.toFixed(2)} USD</td>
        </tr>
      </tbody>
    </table>
  </div>

  <div class="pay-btn-wrap">
    <a class="pay-btn" href="${paymentLink}" target="_blank">Pay Now &rarr;</a>
  </div>
  <p class="pay-note">Secure payment via Razorpay. Click the button above to complete your purchase.</p>

  <div class="footer">
    <p style="font-weight: 600; font-size: 13px; color: #18181b;">AVRPIX SOLUTIONS PRIVATE LIMITED</p>
    <p style="margin-top: 4px;">S NO 635/1A, PLOT NO-20, VAIBHAV SOCIETY, Bibvewadi, Pune City, Pune- 411037, Maharashtra, India</p>
    <p style="margin-top: 2px;">GST: 27ABBCA4226B1Z9</p>
    <p style="margin-top: 2px;">LUT NO-AD270426027584X</p>
    <p style="margin-top: 8px;">WhoGoes &middot; Trade Show &amp; Event Attendee Data &middot; hello@whogoes.co</p>
  </div>
</body>
</html>`;

const outDir = path.join(__dirname, "invoices");
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

const slug = company.toLowerCase().replace(/\s+/g, "-");
const outFile = path.join(outDir, `${slug}-${invoiceDate}.html`);
fs.writeFileSync(outFile, html, "utf8");

console.log(`Invoice saved: ${outFile}`);
console.log(`Opening in browser — use File > Print > Save as PDF`);

// Open in default browser (macOS)
execSync(`open "${outFile}"`);
