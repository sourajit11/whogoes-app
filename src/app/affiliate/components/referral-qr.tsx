"use client";

import { useRef } from "react";
import { QRCodeCanvas } from "qrcode.react";

/**
 * QR code for an affiliate's referral link, with a PNG download so it can be
 * saved to a phone and scanned in person (e.g. on a trade show floor).
 * The canvas renders at 512px for a crisp download and is scaled down for display.
 */
export default function ReferralQr({ url }: { url: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  if (!url) return null;

  const download = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const a = document.createElement("a");
    a.href = canvas.toDataURL("image/png");
    a.download = "whogoes-referral-qr.png";
    a.click();
  };

  return (
    <div className="mt-4 flex items-center gap-4 border-t border-zinc-100 pt-4 dark:border-zinc-800">
      <div className="shrink-0 rounded-lg border border-zinc-200 bg-white p-1.5 dark:border-zinc-700">
        <QRCodeCanvas
          ref={canvasRef}
          value={url}
          size={512}
          marginSize={2}
          bgColor="#ffffff"
          fgColor="#18181b"
          style={{ width: 112, height: 112 }}
        />
      </div>
      <div className="min-w-0">
        <h3 className="text-sm font-semibold text-zinc-900 dark:text-white">Your QR code</h3>
        <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
          Same referral link, scannable. Save it to your phone and let people scan it
          when you mention WhoGoes in person.
        </p>
        <button
          onClick={download}
          className="mt-2 rounded-lg border border-zinc-300 px-3 py-1.5 text-xs font-semibold text-zinc-700 transition-colors hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
        >
          Download PNG
        </button>
      </div>
    </div>
  );
}
