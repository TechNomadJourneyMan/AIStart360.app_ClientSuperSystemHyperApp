/**
 * lib/whatsapp/config.ts — environment of the WhatsApp notification channel.
 *
 * Names reuse what the omnichannel inbox already reads (lib/omnichannel/meta-client.ts):
 *   WHATSAPP_TOKEN             permanent (system user) access token, Cloud API
 *   WHATSAPP_PHONE_NUMBER_ID   the sending business phone number id
 *   META_APP_SECRET            app secret: X-Hub-Signature-256 of the webhook
 *   META_WEBHOOK_VERIFY_TOKEN  hub.verify_token of the webhook subscription
 *   META_GRAPH_API_VERSION     Graph API version (one constant in meta-client.ts,
 *                              DEFAULT_META_GRAPH_API_VERSION; env overrides it)
 * New for notifications:
 *   WHATSAPP_TEMPLATE_LANG         language code of the approved templates (default 'ru')
 *   WHATSAPP_WEB_BRIDGE_FALLBACK   '1' → staff messages fall back to the
 *                                  WhatsApp Web bridge (WHATSAPP_WEB_BRIDGE_*)
 *                                  when Cloud API is not configured or fails
 *                                  permanently. Never used for clients or experts.
 *                                  Needs the direct delivery mode (the bridge
 *                                  reachable from the portal).
 *   WHATSAPP_VERIFY_SECRET         optional HMAC key of the phone verification
 *                                  codes (falls back to AUTH_SECRET, then the
 *                                  Supabase service key).
 */
import { createHash } from 'node:crypto'
import { getMetaConfigurationHealth, type MetaEnvironment } from '@/lib/omnichannel/meta-client'
import { getWhatsAppWebBridgeConfig, type WhatsAppWebBridgeEnvironment } from '@/lib/omnichannel/whatsapp-web-client'

export type WhatsAppEnv = MetaEnvironment & WhatsAppWebBridgeEnvironment

/** Cloud API can send: token + phone number id are present. */
export function cloudApiConfigured(env: WhatsAppEnv = process.env): boolean {
  return getMetaConfigurationHealth({ env }).whatsapp.configured
}

/**
 * The staff-only bridge fallback is switched on AND the bridge is configured
 * AND reachable directly (WHATSAPP_WEB_DELIVERY_MODE direct/unset — in 'pull'
 * mode the bridge has no inbound URL, so a direct send cannot work).
 */
export function bridgeFallbackEnabled(env: WhatsAppEnv = process.env): boolean {
  const mode = env.WHATSAPP_WEB_DELIVERY_MODE?.trim().toLowerCase() || 'direct'
  return /^(1|true|yes|on)$/i.test(env.WHATSAPP_WEB_BRIDGE_FALLBACK?.trim() ?? '')
    && mode === 'direct'
    && getWhatsAppWebBridgeConfig(env) !== null
}

/** Can a message for this audience leave at all? */
export function whatsappTransportAvailable(kind: 'staff' | 'expert' | 'client', env: WhatsAppEnv = process.env): boolean {
  return cloudApiConfigured(env) || (kind === 'staff' && bridgeFallbackEnabled(env))
}

export function templateLanguage(env: WhatsAppEnv = process.env): string {
  const v = env.WHATSAPP_TEMPLATE_LANG?.trim()
  return v && /^[a-z]{2,3}(?:_[A-Z]{2})?$/.test(v) ? v : 'ru'
}

/** '+77001234567' → '+7700•••4567'. Phone numbers never reach logs in full. */
export function maskPhone(phone: string | null | undefined): string {
  if (!phone) return '—'
  const s = String(phone)
  if (s.length <= 6) return '•••'
  return `${s.slice(0, 5)}•••${s.slice(-4)}`
}

/** Short stable reference for a phone in logs / keys (not reversible in practice). */
export function phoneRef(phone: string): string {
  return createHash('sha256').update(`aistart360:wa:${phone}`).digest('hex').slice(0, 16)
}

export function verifySecret(env: WhatsAppEnv = process.env): string | null {
  return env.WHATSAPP_VERIFY_SECRET?.trim() || env.AUTH_SECRET?.trim() || env.SUPABASE_SERVICE_ROLE_KEY?.trim() || null
}
