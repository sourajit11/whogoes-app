export interface InvoicePayment {
  razorpay_order_id: string;
  razorpay_payment_id: string | null;
  amount_usd: number;
  currency: string;
  credits: number;
  package_name: string | null;
  status: string;
  created_at: string;
  paid_at: string | null;
}

export function formatDate(dateStr: string) {
  return new Date(dateStr).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function openInvoice(payment: InvoicePayment, userEmail: string) {
  const w = window.open("", "_blank");
  if (!w) return;

  const invoiceNumber = payment.razorpay_payment_id || payment.razorpay_order_id;
  const paidDate = payment.paid_at ? formatDate(payment.paid_at) : formatDate(payment.created_at);

  w.document.write(`<!DOCTYPE html>
<html>
<head>
  <title>Invoice - ${invoiceNumber}</title>
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
    .footer { margin-top: 48px; padding-top: 24px; border-top: 1px solid #e4e4e7; font-size: 12px; color: #a1a1aa; text-align: center; }
    .badge { display: inline-block; background: #ecfdf5; color: #059669; padding: 2px 8px; border-radius: 4px; font-size: 12px; font-weight: 600; }
    @media print { body { padding: 24px; } }
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
      <span class="detail-label">Email</span>
      <span class="detail-value">${userEmail}</span>
    </div>
    <div class="detail-row">
      <span class="detail-label">Date</span>
      <span class="detail-value">${paidDate}</span>
    </div>
    <div class="detail-row">
      <span class="detail-label">Status</span>
      <span class="detail-value"><span class="badge">${payment.status.toUpperCase()}</span></span>
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
          <td>${payment.package_name ? payment.package_name.charAt(0).toUpperCase() + payment.package_name.slice(1) + " Plan" : "Credit Package"}</td>
          <td>${payment.credits.toLocaleString()}</td>
          <td class="right">$${Number(payment.amount_usd).toFixed(2)}</td>
        </tr>
        <tr class="total-row">
          <td colspan="2">Total</td>
          <td class="right">$${Number(payment.amount_usd).toFixed(2)} ${payment.currency}</td>
        </tr>
      </tbody>
    </table>
  </div>

  <div class="footer">
    <p style="font-weight: 600; font-size: 13px; color: #18181b;">AVRPIX SOLUTIONS PRIVATE LIMITED</p>
    <p style="margin-top: 4px;">S NO 635/1A, PLOT NO-20, VAIBHAV SOCIETY, Bibvewadi, Pune City, Pune- 411037, Maharashtra, India</p>
    <p style="margin-top: 2px;">GST: 27ABBCA4226B1Z9</p>
    <p style="margin-top: 8px;">WhoGoes &middot; Trade Show &amp; Event Attendee Data &middot; hello@whogoes.co</p>
    <p style="margin-top: 4px;">Thank you for your purchase!</p>
  </div>

  <script>window.onload = function() { window.print(); }</script>
</body>
</html>`);
  w.document.close();
}
