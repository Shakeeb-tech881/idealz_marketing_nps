import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { AppRole, Profile } from "@/lib/types";

/** The signed-in user's profile (cached per request), or null. */
export const getCurrentProfile = cache(async (): Promise<Profile | null> => {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return null;
  const { data } = await supabase
    .from("profiles")
    .select("id, email, full_name, role, branch_id, employee_id, is_active")
    .eq("id", auth.user.id)
    .maybeSingle();
  return (data as Profile | null) ?? null;
});

/** For pages: redirect to login / forbidden if the user lacks a role. */
export async function requirePageRole(roles?: AppRole[]): Promise<Profile> {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  if (!profile.is_active) redirect("/login?error=inactive");
  if (roles && !roles.includes(profile.role)) redirect("/admin/forbidden");
  return profile;
}

export class AuthorisationError extends Error {}

/** For server actions / route handlers: throws instead of redirecting. */
export async function requireRole(roles?: AppRole[]): Promise<Profile> {
  const profile = await getCurrentProfile();
  if (!profile || !profile.is_active) throw new AuthorisationError("You are not signed in.");
  if (roles && !roles.includes(profile.role)) {
    throw new AuthorisationError("You do not have permission to perform this action.");
  }
  return profile;
}

export const ORG_WIDE: AppRole[] = ["super_admin", "management"];
export const MANAGERS: AppRole[] = ["super_admin", "management", "branch_manager"];
export const ALL_ROLES: AppRole[] = ["super_admin", "management", "branch_manager", "staff"];

export function isOrgWide(p: Pick<Profile, "role">) {
  return p.role === "super_admin" || p.role === "management";
}

/** Who may see full customer mobile numbers. */
export function canSeeContactDetails(p: Pick<Profile, "role">) {
  return p.role !== "staff";
}
