import { ImageResponse } from "next/og";
import { getPostBySlug } from "@/lib/blog";

export const alt = "WhoGoes Blog";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function Image({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const post = getPostBySlug(slug);

  const title = post?.meta.title ?? "WhoGoes Blog";
  const category = post?.meta.category ?? "";
  const date = post?.meta.date
    ? new Date(post.meta.date).toLocaleDateString("en-US", {
        year: "numeric",
        month: "long",
        day: "numeric",
      })
    : "";

  const categoryLabels: Record<string, string> = {
    "event-guides": "Event Guides",
    "outreach-tactics": "Outreach Tactics",
    "attendee-data": "Attendee Data",
  };

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
        {/* Top: Logo + category */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
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
          {category && (
            <div
              style={{
                display: "flex",
                padding: "8px 16px",
                borderRadius: "999px",
                backgroundColor: "#ecfdf5",
                color: "#059669",
                fontSize: "16px",
                fontWeight: 600,
              }}
            >
              {categoryLabels[category] || category}
            </div>
          )}
        </div>

        {/* Middle: Title */}
        <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
          <div
            style={{
              fontSize: title.length > 50 ? "40px" : "48px",
              fontWeight: 800,
              color: "#18181b",
              lineHeight: 1.15,
              maxWidth: "1000px",
            }}
          >
            {title}
          </div>
          {date && (
            <div style={{ fontSize: "20px", color: "#71717a" }}>
              {date}
            </div>
          )}
        </div>

        {/* Bottom: domain */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div
            style={{
              fontSize: "18px",
              color: "#71717a",
              display: "flex",
              alignItems: "center",
              gap: "20px",
            }}
          >
            <span>Trade Show & Event Attendee Data</span>
          </div>
          <span style={{ fontSize: "20px", fontWeight: 600, color: "#a1a1aa" }}>
            whogoes.co/blog
          </span>
        </div>
      </div>
    ),
    { ...size }
  );
}
