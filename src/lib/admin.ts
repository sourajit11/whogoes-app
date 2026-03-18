import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";

function getAdminEmails(): string[] {
  return (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

export async function isAdmin(): Promise<boolean> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.email) return false;
  const adminEmails = getAdminEmails();
  return adminEmails.includes(user.email.toLowerCase());
}

// Call at the top of admin pages — redirects non-admins to /dashboard
export async function requireAdmin() {
  const admin = await isAdmin();
  if (!admin) {
    redirect("/dashboard");
  }
}
