"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Sets the signed-in user's own password (after an invitation, a reset link,
 * or a temporary password) and clears the "must change password" flag.
 */
export async function setNewPasswordAction(password: unknown) {
  if (typeof password !== "string" || password.length < 10) return { ok: false as const, error: "Use at least 10 characters." };
  if (password.length > 72) return { ok: false as const, error: "Use at most 72 characters." };
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false as const, error: "Your session has expired. Go to the sign-in page and sign in again, or click “Forgot password?”." };
  const { error } = await supabase.auth.updateUser({ password });
  if (error) {
    if (/different from the old/i.test(error.message)) return { ok: false as const, error: "Choose a new password, not the temporary one." };
    return { ok: false as const, error: error.message };
  }
  if (user.app_metadata?.must_change_password === true) {
    // app_metadata can only be changed by the server; merged, so role and branch are kept.
    const { error: flagError } = await createAdminClient().auth.admin.updateUserById(user.id, { app_metadata: { must_change_password: false } });
    if (flagError) {
      console.error("[set-password] could not clear must_change_password", flagError.message);
      return { ok: false as const, error: "Your password was saved, but please try once more to finish." };
    }
  }
  return { ok: true as const };
}
