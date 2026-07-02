/**
 * lib/assistant/mascot/output-filter.ts — last line of defense on LLM answers.
 *
 * Runs over every assistant answer string BEFORE it leaves the server
 * (docs/TZ-mascot-assistant.md §11.9). The model is already instructed not to
 * leak secrets or emit HTML, but instructions are not guarantees — this filter
 * is: it redacts secret-shaped substrings, strips HTML/script markup and caps
 * the length. The UI additionally renders answers as plain text (no
 * dangerouslySetInnerHTML), so this is defense-in-depth, not the only layer.
 *
 * Pure module — no imports, unit-tested in tests/unit/assistant-mascot/.
 */

const MAX_ANSWER_LENGTH = 2500

// Secret-shaped substrings that must never reach a client, whatever the model
// was tricked into echoing. Order matters only for readability.
const SECRET_PATTERNS: RegExp[] = [
  /sk-or-v1-[A-Za-z0-9]+/g, // OpenRouter API keys
  /sk-[A-Za-z0-9-_]{20,}/g, // generic sk-… provider keys
  // JWTs (Supabase anon/service tokens): three dot-joined base64url segments.
  /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}/g,
  // Connection strings with credentials.
  /postgres(?:ql)?:\/\/\S+/gi,
  /redis:\/\/\S+/gi,
  // Env-var style assignments of our known secret names.
  /\b(?:OPENROUTER_API_KEY|SUPABASE_SERVICE_ROLE_KEY|DATABASE_URL|DIRECT_URL|UPSTASH_REDIS_REST_TOKEN|RESEND_API_KEY)\b\s*[=:]?\s*\S*/g,
]

// <script>/<style> blocks die with their content; any other tag is unwrapped.
const SCRIPT_BLOCK_RE = /<(script|style|iframe)\b[\s\S]*?<\/\1>/gi
const HTML_TAG_RE = /<\/?[a-z][^>]*>/gi

export interface FilteredOutput {
  text: string
  /** true when at least one secret pattern or HTML block was removed. */
  redacted: boolean
}

/** Sanitize a model answer: redact secrets, strip markup, cap length. */
export function filterModelOutput(raw: string): FilteredOutput {
  let text = raw ?? ''
  let redacted = false

  for (const re of SECRET_PATTERNS) {
    if (re.test(text)) {
      redacted = true
      text = text.replace(re, '[скрыто]')
    }
    re.lastIndex = 0
  }

  if (SCRIPT_BLOCK_RE.test(text)) {
    redacted = true
    text = text.replace(SCRIPT_BLOCK_RE, '')
  }
  SCRIPT_BLOCK_RE.lastIndex = 0
  if (HTML_TAG_RE.test(text)) {
    redacted = true
    text = text.replace(HTML_TAG_RE, '')
  }
  HTML_TAG_RE.lastIndex = 0

  text = text.trim()
  if (text.length > MAX_ANSWER_LENGTH) {
    text = `${text.slice(0, MAX_ANSWER_LENGTH - 1).trimEnd()}…`
  }

  return { text, redacted }
}
