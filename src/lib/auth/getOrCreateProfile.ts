import { supabase } from "@/lib/supabase/client";
import type { AuthProvider, Profile } from "@/types/profile";

type ProfileRow = {
  id: string;
  auth_user_id: string;
  provider: string | null;
  provider_user_id: string | null;
  nickname: string | null;
  role: Profile["role"];
  last_login_at: string | null;
  last_permission_used_at: string | null;
  created_at: string;
  updated_at: string;
};

function toProfile(row: ProfileRow): Profile {
  return {
    id: row.id,
    authUserId: row.auth_user_id,
    provider: (row.provider === "x" ? "x" : "discord") as AuthProvider,
    providerUserId: row.provider_user_id ?? "",
    nickname: row.nickname,
    role: row.role,
    lastLoginAt: row.last_login_at,
    lastPermissionUsedAt: row.last_permission_used_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export async function getOrCreateProfile(): Promise<Profile | null> {
  const { data: userData, error: userError } = await supabase.auth.getUser();

  if (userError || !userData.user) {
    return null;
  }

  const user = userData.user;

  const { data: existingProfile, error: selectError } = await supabase
    .from("profiles")
    .select("*")
    .eq("auth_user_id", user.id)
    .maybeSingle();

  if (selectError) {
    console.error(selectError);
    return null;
  }

  if (existingProfile) {
    const { data: updatedProfile, error: updateError } = await supabase
      .from("profiles")
      .update({ last_login_at: new Date().toISOString() })
      .eq("auth_user_id", user.id)
      .select("*")
      .single();

    if (updateError) {
      console.error(updateError);
      return toProfile(existingProfile as ProfileRow);
    }

    return toProfile(updatedProfile as ProfileRow);
  }

  const providerFromAuth = user.app_metadata?.provider;
  const provider: AuthProvider =
    providerFromAuth === "twitter" || providerFromAuth === "x" ? "x" : "discord";

  const providerUserId = user.identities?.[0]?.id ?? "";

  const { data: newProfile, error: insertError } = await supabase
    .from("profiles")
    .insert({
      auth_user_id: user.id,
      provider,
      provider_user_id: providerUserId,
      nickname: user.user_metadata?.full_name ?? user.user_metadata?.name ?? "名無し",
      role: "user",
      last_login_at: new Date().toISOString()
    })
    .select("*")
    .single();

  if (insertError) {
    console.error(insertError);
    return null;
  }

  return toProfile(newProfile as ProfileRow);
}