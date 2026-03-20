import { ImageResponse } from "next/og";
import { createClient } from "@/lib/supabase/server";

export const alt = "WhoGoes Event Attendee List";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function Image({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const supabase = await createClient();

  const { data: events } = await supabase.rpc("get_event_by_slug", {
    p_slug: slug,
  });

  const event = events?.[0];
  const eventName = event?.event_name ?? "Event";
  const totalContacts = event?.total_contacts ?? 0;
  const location = event?.event_location ?? "";

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
            <span style={{ color: "white", fontSize: "22px", fontWeight: 700 }}>W</span>
          </div>
          <span style={{ fontSize: "20px", fontWeight: 600, color: "#71717a" }}>WhoGoes</span>
        </div>

        {/* Middle: Event info */}
        <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
          <div
            style={{
              fontSize: eventName.length > 30 ? "42px" : "52px",
              fontWeight: 800,
              color: "#18181b",
              lineHeight: 1.1,
              maxWidth: "900px",
            }}
          >
            {eventName}
          </div>
          <div
            style={{
              fontSize: "22px",
              fontWeight: 500,
              color: "#52525b",
              display: "flex",
              alignItems: "center",
              gap: "16px",
            }}
          >
            {totalContacts > 0 && (
              <span>{totalContacts.toLocaleString()} Verified Contacts</span>
            )}
            {totalContacts > 0 && location && (
              <span style={{ color: "#d4d4d8" }}>|</span>
            )}
            {location && <span>{location}</span>}
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
            <span>LinkedIn Proof</span>
            <span style={{ color: "#d4d4d8" }}>|</span>
            <span>Verified Emails</span>
            <span style={{ color: "#d4d4d8" }}>|</span>
            <span>From $29</span>
          </div>
        </div>

        {/* Bottom: CTA + domain */}
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
            Get Attendee List
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
