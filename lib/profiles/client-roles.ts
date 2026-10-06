/**
 * lib/profiles/client-roles.ts — `profiles.role` values of the product's
 * clients: self-registered users and business owners (the signup trigger of
 * migration 083 assigns only these two). Staff, experts and partners have
 * other roles and must not appear in client lists or counts.
 */
export const CLIENT_PROFILE_ROLES = ['client', 'owner'] as const
export type ClientProfileRole = (typeof CLIENT_PROFILE_ROLES)[number]

export function isClientProfileRole(role: unknown): role is ClientProfileRole {
  return typeof role === 'string' && (CLIENT_PROFILE_ROLES as readonly string[]).includes(role)
}
