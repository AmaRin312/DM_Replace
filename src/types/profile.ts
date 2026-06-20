export type AdminRole = "owner" | "admin" | "editor" | "support" | "user";

export type AuthProvider = "discord" | "x";

export type Profile = {
  id: string;
  authUserId: string;
  provider: AuthProvider;
  providerUserId: string;
  nickname: string | null;
  role: AdminRole;
  lastLoginAt: string | null;
  lastPermissionUsedAt: string | null;
  createdAt: string;
  updatedAt: string;
};
