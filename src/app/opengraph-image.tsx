import { ImageResponse } from "next/og";

export const alt = "WhoGoes — Trade Show & Event Attendee Lists With Proof";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function Image() {
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
          background: "linear-gradient(135deg, #f0fdf4 0%, #ffffff 50%, #f0fdf4 100%)",
          fontFamily: "system-ui, sans-serif",
        }}
      >
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
            <span style={{ color: "white", fontSize: "22px", fontWeight: 700 }}>W</span>
          </div>
          <span style={{ fontSize: "20px", fontWeight: 600, color: "#71717a" }}>WhoGoes</span>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
          <div
            style={{
              fontSize: "62px",
              fontWeight: 800,
              color: "#18181b",
              lineHeight: 1.05,
              maxWidth: "1000px",
            }}
          >
            Trade Show & Event Attendee Lists.
          </div>
          <div
            style={{
              fontSize: "62px",
              fontWeight: 800,
              color: "#059669",
              lineHeight: 1.05,
            }}
          >
            With Proof.
          </div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "20px",
              fontSize: "20px",
              color: "#52525b",
              marginTop: "8px",
            }}
          >
            <span>1,200+ Events</span>
            <span style={{ color: "#d4d4d8" }}>|</span>
            <span>LinkedIn Proof</span>
            <span style={{ color: "#d4d4d8" }}>|</span>
            <span>From $29</span>
          </div>
        </div>

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
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
            Browse Events Free
          </div>
          <span style={{ fontSize: "20px", fontWeight: 600, color: "#a1a1aa" }}>
            whogoes.co
          </span>
        </div>
      </div>
    ),
    { ...size }
  );
}
