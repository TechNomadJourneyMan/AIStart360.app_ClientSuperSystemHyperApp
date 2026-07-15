import type {
  OmnichannelChannel,
  OmnichannelConversationStatus,
  OmnichannelMode,
} from './types'
import type { OmnichannelMessageType } from './types'

export type { OmnichannelChannel, OmnichannelConversationStatus } from './types'
export type OmnichannelReplyMode = OmnichannelMode
export type OmnichannelRisk = 'low' | 'medium' | 'high'

export type RiskCategory =
  | 'opt_out'
  | 'payment_or_refund'
  | 'complaint_or_fraud'
  | 'legal'
  | 'medical'
  | 'threat_or_crisis'
  | 'prompt_injection'

const RISK_PATTERNS: Array<{ category: RiskCategory; pattern: RegExp }> = [
  {
    category: 'opt_out',
    pattern:
      /(?<![\p{L}\p{N}_])(?:стоп|отпис\p{L}*|не\s+(?:пишите|звоните|беспокойте)|stop|unsubscribe|do\s+not\s+(?:message|contact)|жазба(?:ңыз)?|хабарлама\s+жіберме(?:ңіз)?|мазалама(?:ңыз)?)(?![\p{L}\p{N}_])/iu,
  },
  {
    category: 'payment_or_refund',
    pattern:
      /(?<![\p{L}\p{N}_])(?:оплат\p{L}*|плат[её]ж\p{L}*|возврат\p{L}*|верните\s+деньги|чарджбэк|chargeback|refund|payment|charged|money\s+back|төлем\p{L}*|ақша\p{L}*|қайтар\p{L}*)(?![\p{L}\p{N}_])/iu,
  },
  {
    category: 'complaint_or_fraud',
    pattern:
      /(?<![\p{L}\p{N}_])(?:жалоб\p{L}*|претензи\p{L}*|мошен\p{L}*|обман\p{L}*|полици\p{L}*|scam\p{L}*|fraud\p{L}*|complaint\p{L}*|consumer\s+protection|шағым\p{L}*|алаяқ\p{L}*)(?![\p{L}\p{N}_])/iu,
  },
  {
    category: 'legal',
    pattern:
      /(?<![\p{L}\p{N}_])(?:юрист\p{L}*|адвокат\p{L}*|суд\p{L}*|иск\p{L}*|закон\p{L}*|legal\p{L}*|lawyer\p{L}*|attorney\p{L}*|lawsuit\p{L}*|заң\p{L}*|сот\p{L}*)(?![\p{L}\p{N}_])/iu,
  },
  {
    category: 'medical',
    pattern:
      /(?<![\p{L}\p{N}_])(?:врач\p{L}*|диагноз\p{L}*|лечени\p{L}*|лекарств\p{L}*|doctor\p{L}*|diagnos\p{L}*|treatment\p{L}*|medicine\p{L}*|дәрігер\p{L}*|емдеу\p{L}*|дәрі\p{L}*)(?![\p{L}\p{N}_])/iu,
  },
  {
    category: 'threat_or_crisis',
    pattern:
      /(?<![\p{L}\p{N}_])(?:угрож\p{L}*|убью|самоубий\p{L}*|суицид\p{L}*|kill\s+(?:you|myself)|suicid\p{L}*|self[-\s]?harm\p{L}*|қорқыт\p{L}*|өлтірем\p{L}*)(?![\p{L}\p{N}_])/iu,
  },
  {
    category: 'prompt_injection',
    pattern:
      /(?:ignore\s+(?:all\s+)?(?:previous|prior)\s+instructions|system\s+prompt|developer\s+message|reveal\s+(?:your\s+)?(?:prompt|secret)|api[_\s-]?key|забудь\s+(?:все\s+)?(?:предыдущие\s+)?инструкции|покажи\s+(?:системный\s+)?промпт|раскрой\s+(?:инструкции|секрет)|алдыңғы\s+нұсқауларды\s+елеме)/iu,
  },
]

export interface DeterministicRiskResult {
  risk: OmnichannelRisk
  categories: RiskCategory[]
  optOut: boolean
  promptInjection: boolean
}

const AUTO_REPLY_CONTENT_TYPES = new Set<OmnichannelMessageType>([
  'text',
  'postback',
  'button',
  'interactive',
])

/** Media/placeholders are useful for triage, but never sufficient to auto-send. */
export function isAutoReplyContentType(messageType: OmnichannelMessageType): boolean {
  return AUTO_REPLY_CONTENT_TYPES.has(messageType)
}

/**
 * A deterministic safety pass that runs before and after the LLM. It is
 * intentionally conservative: these categories always require a person, while
 * ordinary product, booking and pricing-interest messages can still be drafted.
 */
export function detectDeterministicRisk(text: string): DeterministicRiskResult {
  const categories = RISK_PATTERNS.filter(({ pattern }) => pattern.test(text)).map(
    ({ category }) => category,
  )

  return {
    risk: categories.length > 0 ? 'high' : 'low',
    categories,
    optOut: categories.includes('opt_out'),
    promptInjection: categories.includes('prompt_injection'),
  }
}

const HOUR_MS = 60 * 60 * 1000
const STANDARD_WINDOW_MS = 24 * HOUR_MS
const INSTAGRAM_HUMAN_WINDOW_MS = 7 * 24 * HOUR_MS

export type SendWindowMode = 'standard' | 'human_agent' | 'template_required' | 'expired'

export interface SendWindowResult {
  allowed: boolean
  mode: SendWindowMode
  ageMs: number | null
  reason: string
}

function parseTime(value: string | Date | null | undefined): number | null {
  if (!value) return null
  const ms = value instanceof Date ? value.getTime() : new Date(value).getTime()
  return Number.isFinite(ms) ? ms : null
}

/** Provider-policy window check. Automated messages never use HUMAN_AGENT. */
export function getSendWindow(input: {
  channel: OmnichannelChannel
  lastInboundAt: string | Date | null | undefined
  now?: string | Date
  actor: 'automated' | 'manual'
  instagramHumanAgentEnabled?: boolean
}): SendWindowResult {
  const inboundMs = parseTime(input.lastInboundAt)
  const nowMs = parseTime(input.now ?? new Date()) ?? Date.now()
  if (inboundMs == null) {
    return { allowed: false, mode: 'expired', ageMs: null, reason: 'last_inbound_unknown' }
  }

  const ageMs = Math.max(0, nowMs - inboundMs)
  if (inboundMs > nowMs + 5 * 60 * 1000) {
    return {
      allowed: false,
      mode: 'expired',
      ageMs: 0,
      reason: 'provider_timestamp_in_future',
    }
  }
  if (ageMs <= STANDARD_WINDOW_MS) {
    return { allowed: true, mode: 'standard', ageMs, reason: 'standard_24h_window' }
  }

  if (input.channel === 'whatsapp') {
    return {
      allowed: false,
      mode: 'template_required',
      ageMs,
      reason: 'whatsapp_template_required_outside_24h',
    }
  }

  if (
    input.actor === 'manual' &&
    input.instagramHumanAgentEnabled === true &&
    ageMs <= INSTAGRAM_HUMAN_WINDOW_MS
  ) {
    return { allowed: true, mode: 'human_agent', ageMs, reason: 'instagram_human_agent_7d' }
  }

  return { allowed: false, mode: 'expired', ageMs, reason: 'standard_window_expired' }
}

export type ReplyPolicyAction = 'send' | 'draft' | 'escalate' | 'ignore'

export interface ReplyPolicyDecision {
  action: ReplyPolicyAction
  reason: string
}

/**
 * Final deterministic gate. The model proposes a reply; this function alone
 * decides whether it is allowed to leave the system automatically.
 */
export function decideReplyPolicy(input: {
  mode: OmnichannelReplyMode
  conversationStatus: OmnichannelConversationStatus
  answer: string
  confidence: number
  threshold: number
  risk: OmnichannelRisk
  needsHuman: boolean
  deterministicRisk: DeterministicRiskResult
  isNewestInbound: boolean
  sendWindow: SendWindowResult
}): ReplyPolicyDecision {
  if (input.deterministicRisk.optOut) return { action: 'ignore', reason: 'customer_opted_out' }
  if (input.mode === 'off') return { action: 'ignore', reason: 'channel_mode_off' }
  if (!input.isNewestInbound) return { action: 'ignore', reason: 'superseded_by_newer_message' }
  if (input.conversationStatus === 'muted') return { action: 'ignore', reason: 'conversation_muted' }
  if (!input.answer.trim()) return { action: 'escalate', reason: 'empty_ai_answer' }

  if (
    input.needsHuman ||
    input.risk === 'high' ||
    input.deterministicRisk.risk === 'high' ||
    input.conversationStatus === 'needs_human'
  ) {
    return { action: 'escalate', reason: 'human_review_required' }
  }

  if (!input.sendWindow.allowed) {
    return { action: 'draft', reason: input.sendWindow.reason }
  }

  if (
    input.mode === 'draft' ||
    input.risk === 'medium' ||
    input.confidence < input.threshold
  ) {
    return { action: 'draft', reason: 'draft_or_confidence_gate' }
  }

  return { action: 'send', reason: 'safe_auto_reply' }
}
