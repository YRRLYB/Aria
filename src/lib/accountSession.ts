export type AccountIdentity = { connected: boolean; userId: string | null } | null;

/** Unknown profile fields can fill in later without representing a new login. */
export function accountSessionChanged(previous: AccountIdentity, next: AccountIdentity): boolean {
  if (!previous) return Boolean(next && !next.connected);
  if (!next) return previous.connected;
  if (previous.connected !== next.connected) return true;
  return Boolean(previous.connected && previous.userId && next.userId && previous.userId !== next.userId);
}
