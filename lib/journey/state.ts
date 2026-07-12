/**
 * Journey — chat-first "AI-first" experimental cabinet.
 *
 * Instead of the current form-heavy anketa flow, the user talks to an AI
 * chat. The AI drives the conversation, asks for data, requests files,
 * and spawns *widgets* on the right rail as it learns things about the
 * business. The A→B canvas is a Miro-style board that grows as data
 * arrives — Point A on the left fills with facts extracted from
 * conversation + uploads, Point B on the right forms as goals are stated,
 * and a path of milestones is drawn between them.
 */

// ─── Chat ─────────────────────────────────────────────────────────────

export type Role = 'user' | 'assistant' | 'system'

export interface ChatMessage {
  id: string
  role: Role
  /** Rendered text (plain, model may include soft newlines) */
  text: string
  /** Optional widget commands the AI wants to spawn with this message */
  spawn?: WidgetSpawn[]
  /** Optional file attachments referenced by user */
  attachments?: Attachment[]
  createdAt: string
}

export interface Attachment {
  id: string
  name: string
  mime: string
  sizeBytes: number
  /** Path in Supabase Storage once uploaded */
  storagePath?: string
}

// ─── Widgets ──────────────────────────────────────────────────────────

/**
 * Widget kinds the AI can spawn. Each maps to one component in
 * `components/journey/widgets/`. Adding a new kind = one new component +
 * one entry in this union + a case in the renderer switch.
 */
export type WidgetKind =
  | 'question'
  | 'upload_prompt'
  | 'insight_card'
  | 'crm_check'
  | 'stack_audit'
  | 'video_rec'
  | 'news_digest'
  | 'reminders_rail'
  | 'metric_peek'
  | 'benchmark_strip'
  | 'risk_alert'
  | 'quick_win'

export interface WidgetBase {
  id: string
  kind: WidgetKind
  /** Free-form title used in the header + chip */
  title: string
  /** Priority — higher = closer to top of the rail */
  priority: number
  /** Collapsed → shown as a chip at top of rail */
  collapsed: boolean
  /** When AI generated this widget */
  createdAt: string
}

export interface QuestionWidget extends WidgetBase {
  kind: 'question'
  prompt: string
  options?: string[]        // if present → button choice, else → free text
  targetField?: string      // journey_state key to write the answer into
}

export interface UploadPromptWidget extends WidgetBase {
  kind: 'upload_prompt'
  reason: string            // "нужен P&L 2024"
  acceptMime: string[]      // ["application/pdf", "text/csv", ...]
  suggestions?: string[]    // ["1С выгрузка", "Excel из CRM"]
}

export interface InsightCardWidget extends WidgetBase {
  kind: 'insight_card'
  headline: string
  body: string
  /** Quote pulled from a document, with source */
  quote?: { text: string; source: string }
  severity?: 'info' | 'ok' | 'warn' | 'critical'
}

export interface CrmCheckWidget extends WidgetBase {
  kind: 'crm_check'
  /** null = not answered yet */
  hasCrm: boolean | null
  currentTool?: string      // "Excel" | "AmoCRM" | ...
  suggestions: Array<{ name: string; whyFit: string }>
}

export interface StackAuditWidget extends WidgetBase {
  kind: 'stack_audit'
  categories: Array<{
    label: string           // "CRM", "Аналитика", "Email"
    picked: string[]        // chips user selected
    all: string[]           // options list
  }>
}

export interface VideoRecWidget extends WidgetBase {
  kind: 'video_rec'
  videos: Array<{
    title: string
    thumb: string
    durationMin: number
    url: string
    whyRelevant: string
  }>
}

export interface NewsDigestWidget extends WidgetBase {
  kind: 'news_digest'
  industry: string
  items: Array<{ title: string; source: string; url: string; ago: string }>
}

export interface RemindersRailWidget extends WidgetBase {
  kind: 'reminders_rail'
  items: Array<{ id: string; text: string; due: string; done: boolean }>
}

export interface MetricPeekWidget extends WidgetBase {
  kind: 'metric_peek'
  label: string
  value: string             // formatted, e.g. "₸4.2М/мес"
  delta?: string            // "+8.2% vs пред."
  trend: number[]           // sparkline points
}

export interface BenchmarkStripWidget extends WidgetBase {
  kind: 'benchmark_strip'
  metric: string
  your: number
  median: number
  top: number
  unit: string
}

export interface RiskAlertWidget extends WidgetBase {
  kind: 'risk_alert'
  title: string
  reason: string
  suggestion: string
}

export interface QuickWinWidget extends WidgetBase {
  kind: 'quick_win'
  title: string
  expectedImpact: string    // "+3% чек за 2 недели"
  effort: 'S' | 'M' | 'L'
  steps: string[]
}

export type Widget =
  | QuestionWidget
  | UploadPromptWidget
  | InsightCardWidget
  | CrmCheckWidget
  | StackAuditWidget
  | VideoRecWidget
  | NewsDigestWidget
  | RemindersRailWidget
  | MetricPeekWidget
  | BenchmarkStripWidget
  | RiskAlertWidget
  | QuickWinWidget

/**
 * Command shape the AI streams back inside chat messages to spawn a widget.
 * Server merges this into JourneyState.widgets and pushes to the client.
 */
export type WidgetSpawn = Omit<Widget, 'id' | 'createdAt' | 'collapsed' | 'priority'> & {
  priority?: number
}

// ─── A→B Canvas ───────────────────────────────────────────────────────

export interface JourneyNode {
  id: string
  label: string
  block: 'finance' | 'sales' | 'ops' | 'marketing' | 'team' | 'product' | 'clients'
  /** For Point A — factual data. For Point B — targets. */
  facts: Array<{ k: string; v: string }>
  /** Position on canvas in % of viewport */
  x: number
  y: number
  status?: 'ok' | 'weak' | 'critical'
}

export interface JourneyMilestone {
  id: string
  /** Position along the path 0..1 */
  t: number
  label: string
  /** 30 / 60 / 90 / 180 / 365 */
  daysFromStart: number
  description: string
  metric?: { name: string; from: string; to: string }
  done: boolean
  active: boolean
}

export interface JourneyState {
  userId: string | null
  companyName: string
  industry: string
  pointA: JourneyNode[]
  pointB: JourneyNode[]
  milestones: JourneyMilestone[]
  messages: ChatMessage[]
  widgets: Widget[]
  updatedAt: string
}

// ─── Empty state factory ──────────────────────────────────────────────

export function emptyJourneyState(): JourneyState {
  return {
    userId: null,
    companyName: '',
    industry: '',
    pointA: [],
    pointB: [],
    milestones: [],
    messages: [],
    widgets: [],
    updatedAt: new Date(0).toISOString(),
  }
}
