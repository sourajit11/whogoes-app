import type { Metadata } from "next";
import { getAffiliate } from "@/lib/affiliate";
import { createClient } from "@/lib/supabase/server";
import ReferView from "./refer-view";

export const metadata: Metadata = {
  title: "Refer & Earn 30% | WhoGoes",
};

export default async function ReferPage() {
  const affiliate = await getAffiliate();

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const meta = user?.user_metadata ?? {};
  const defaultName =
    (typeof meta.full_name === "string" && meta.full_name) ||
    [meta.first_name, meta.last_name].filter(Boolean).join(" ") ||
    "";

  return <ReferView affiliate={affiliate} defaultName={defaultName} />;
}
