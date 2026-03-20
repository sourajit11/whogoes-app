import { ImageResponse } from "next/og";
import { getComparisonBySlug } from "@/lib/compare";

export const alt = "WhoGoes Comparison";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function Image({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const comparison = getComparisonBySlug(slug);

  const title = comparison?.meta.title ?? "Compare WhoGoes";
  const tagline = comparison?.meta.tagline ?? "";
  const competitor = comparison?.meta.competitor ?? "";

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "60px",
          background:
            "linear-gradient(135deg, #f0fdf4 0%, #ffffff 50%, #f0fdf4 100%)",
          fontFamily: "system-ui, sans-serif",
        }}
      >
        {/* Top: Logo */}
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: "44px",
              height: "44px",
              borderRadius: "12px",
              backgroundColor: "#059669",
            }}
          >
            <span
              style={{ color: "white", fontSize: "22px", fontWeight: 700 }}
            >
              W
            </span>
          </div>
          <span
            style={{ fontSize: "20px", fontWeight: 600, color: "#71717a" }}
          >
            WhoGoes
          </span>
        </div>

        {/* Middle: Comparison info */}
        <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "16px",
              fontSize: "24px",
              fontWeight: 500,
              color: "#059669",
            }}
          >
            <span>WhoGoes vs {competitor}</span>
          </div>
          <div
            style={{
              fontSize: title.length > 50 ? "36px" : "44px",
              fontWeight: 800,
              color: "#18181b",
              lineHeight: 1.15,
              maxWidth: "900px",
            }}
          >
            {tagline}
          </div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "20px",
              fontSize: "18px",
              color: "#71717a",
            }}
          >
            <span>1,200+ Events</span>
            <span style={{ color: "#d4d4d8" }}>|</span>
            <span>LinkedIn Proof</span>
            <span style={{ color: "#d4d4d8" }}>|</span>
            <span>From $29</span>
          </div>
        </div>

        {/* Bottom: CTA + domain */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: "12px 28px",
              borderRadius: "999px",
              backgroundColor: "#059669",
              color: "white",
              fontSize: "18px",
              fontWeight: 600,
            }}
          >
            See Full Comparison
          </div>
          <span
            style={{ fontSize: "20px", fontWeight: 600, color: "#a1a1aa" }}
          >
            whogoes.co
          </span>
        </div>
      </div>
    ),
    { ...size }
  );
}
