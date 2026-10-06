/**
 * Shared limits used by several routes. Kept outside lib/rate-limit.ts so
 * route tests that mock '@/lib/rate-limit' still get the real values.
 */

/**
 * Daily per-user cap on TOTP / backup-code checks, shared by every route that
 * verifies one (2FA challenge, verify, disable, backup-code regeneration).
 * The per-route 10 / 5 min limits alone allow ~2 900 guesses a day; with this
 * cap an attacker holding a session gets at most 100 (≈0.03 % for a 6-digit
 * code with ±1 step drift).
 */
export const MFA_OTP_DAILY = { max: 100, windowMs: 24 * 60 * 60_000 } as const
