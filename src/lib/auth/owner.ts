export function isConfiguredOwner(provider: string, providerUserId: string): boolean {
  const ownerDiscordId = process.env.NEXT_PUBLIC_OWNER_DISCORD_ID;
  const ownerXId = process.env.NEXT_PUBLIC_OWNER_X_ID;

  if (provider === "discord" && ownerDiscordId && providerUserId === ownerDiscordId) return true;
  if (provider === "x" && ownerXId && providerUserId === ownerXId) return true;
  return false;
}
