/**
 * Journey AI brain — server-side only.
 *
 * One call = one turn of the chat. The model receives the running message
 * history + a compact snapshot of the journey state (business profile,
 * current Point A facts, Point B targets, active widgets) and returns a
 * strict JSON envelope:
 *
 *   {
 *     "reply":       string          — chat text for the user (Russian)
 *     "widgets":     WidgetSpawn[]   — new widgets to spawn (business-specific!)
 *     "point_a":     NodePatch[]     — facts learned about the current state
 *     "point_b":     NodePatch[]     — targets derived from the user's goal
 *     "milestones":  MilestonePatch[]— path steps between A and B
 *     "profile":     { company_name?, industry? }
 *   }
 *
 * The whole product thesis lives in the system prompt: widgets are NOT a
 * fixed catalog — the model generates content tailored to THIS business
 * (томаты → порча/холодильники/локация№2; страховая → пролонгации/убыточность).
 */

import { z } from 'zod'
import { getSiteUrl } from '@/lib/site-url'
import { OPENROUTER_MODELS } from '@/lib/ai/openrouter'
import type { ChatMessage, JourneyState } from './state'

// ─── Envelope schema (zod) ────────────────────────────────────────────

const widgetSpawnSchema = z.object({
  kind: z.enum([
    'question', 'upload_prompt', 'insight_card', 'crm_check', 'stack_audit',
    'video_rec', 'news_digest', 'reminders_rail', 'metric_peek',
    'benchmark_strip', 'risk_alert', 'quick_win', 'custom_module',
  ]),
  title: z.string().min(1).max(120),
  priority: z.number().int().min(0).max(100).optional().default(50),
}).passthrough() // kind-specific payload fields flow through untouched

const nodePatchSchema = z.object({
  id: z.string().min(1).max(60),
  label: z.string().min(1).max(60),
  block: z.enum(['finance', 'sales', 'ops', 'marketing', 'team', 'product', 'clients']),
  facts: z.array(z.object({ k: z.string().max(80), v: z.string().max(80) })).max(8),
  status: z.enum(['ok', 'weak', 'critical']).optional(),
  x: z.number().min(0).max(100).optional(),
  y: z.number().min(0).max(100).optional(),
})

const milestonePatchSchema = z.object({
  id: z.string().min(1).max(60),
  t: z.number().min(0).max(1),
  label: z.string().min(1).max(40),
  daysFromStart: z.number().int().min(1).max(1095),
  description: z.string().max(400),
  metric: z.object({ name: z.string().max(60), from: z.string().max(40), to: z.string().max(40) }).optional(),
  done: z.boolean().optional().default(false),
  active: z.boolean().optional().default(false),
})

export const envelopeSchema = z.object({
  reply: z.string().min(1),
  widgets: z.array(widgetSpawnSchema).max(6).optional().default([]),
  point_a: z.array(nodePatchSchema).max(8).optional().default([]),
  point_b: z.array(nodePatchSchema).max(8).optional().default([]),
  milestones: z.array(milestonePatchSchema).max(12).optional().default([]),
  profile: z.object({
    company_name: z.string().max(120).optional(),
    industry: z.string().max(120).optional(),
  }).optional(),
})

export type JourneyEnvelope = z.infer<typeof envelopeSchema>

/**
 * Lenient envelope parse: never rejects the whole turn because one item is
 * malformed. Per-item validation; common LLM aliases are coerced first
 * (`type`→`kind`, `name`→`label`/`title`, string numbers → numbers where
 * zod handles it). Invalid items are dropped with a server-side warning.
 */
export function lenientParse(parsed: unknown): JourneyEnvelope | { error: string } {
  if (typeof parsed !== 'object' || parsed === null) return { error: 'invalid_envelope' }
  const obj = parsed as Record<string, unknown>

  const reply = typeof obj.reply === 'string' && obj.reply.trim() ? obj.reply : null
  if (!reply) return { error: 'invalid_envelope' }

  const coerceWidget = (raw: unknown): unknown => {
    if (typeof raw !== 'object' || raw === null) return raw
    const w = { ...(raw as Record<string, unknown>) }
    if (w.kind == null && typeof w.type === 'string') w.kind = w.type
    if (w.title == null && typeof w.name === 'string') w.title = w.name
    if (w.title == null && typeof w.headline === 'string') w.title = w.headline
    return w
  }

  const coerceNode = (raw: unknown): unknown => {
    if (typeof raw !== 'object' || raw === null) return raw
    const n = { ...(raw as Record<string, unknown>) }
    if (n.label == null && typeof n.name === 'string') n.label = n.name
    if (n.id == null && typeof n.label === 'string') {
      n.id = String(n.label).toLowerCase().replace(/[^a-zа-я0-9]+/gi, '-').slice(0, 40)
    }
    return n
  }

  const pickValid = <S extends z.ZodTypeAny>(
    items: unknown, schema: S, coerce: (r: unknown) => unknown, tag: string,
  ): Array<z.output<S>> => {
    if (!Array.isArray(items)) return []
    const out: Array<z.output<S>> = []
    for (const item of items) {
      const res = schema.safeParse(coerce(item))
      if (res.success) out.push(res.data)
      else console.warn(`[journey/ai] dropped invalid ${tag}:`, res.error.issues[0])
    }
    return out
  }

  const profileRes = z.object({
    company_name: z.string().max(120).optional(),
    industry: z.string().max(120).optional(),
  }).safeParse(obj.profile ?? {})

  return {
    reply,
    widgets: pickValid(obj.widgets, widgetSpawnSchema, coerceWidget, 'widget'),
    point_a: pickValid(obj.point_a, nodePatchSchema, coerceNode, 'point_a node'),
    point_b: pickValid(obj.point_b, nodePatchSchema, coerceNode, 'point_b node'),
    milestones: pickValid(obj.milestones, milestonePatchSchema, coerceNode, 'milestone'),
    profile: profileRes.success ? profileRes.data : undefined,
  }
}

// ─── System prompt ────────────────────────────────────────────────────

const SYSTEM_PROMPT = `Ты — AI-мозг платформы AIStart360 Journey: персональный бизнес-аналитик и навигатор роста. Пользователь — собственник малого/среднего бизнеса. Общение на русском, на «ты», кратко и конкретно, без воды и канцелярита.

ГЛАВНЫЙ ПРИНЦИП: весь интерфейс генерируешь ТЫ, под ЭТОТ бизнес. Никаких шаблонов «для всех». Магазин помидоров → виджеты про порчу товара, холодильную цепь, поставщиков, выбор локации №2. Страховое агентство → пролонгации, убыточность, сеть агентов, LTV полиса. Стоматология → загрузка кресел, повторные визиты, средний план лечения. Каждый виджет обязан упоминать специфику бизнеса пользователя.

ЧТО ТЫ ДЕЛАЕШЬ КАЖДЫЙ ХОД:
1. Отвечаешь в чат (поле reply): по делу, 2-5 предложений. Если данных мало — задаёшь ОДИН точный вопрос.
2. Спавнишь виджеты (widgets, максимум 2-3 за ход, только когда есть повод):
   - question — уточнение с вариантами ответов (options)
   - upload_prompt — попросить файл (reason, acceptMime, suggestions)
   - insight_card — вывод из данных (headline, body, quote{text,source}, severity: info|ok|warn|critical)
   - crm_check — проверка учёта клиентов (hasCrm, suggestions[{name,whyFit}])
   - stack_audit — аудит инструментов (categories[{label,picked,all}])
   - video_rec — подборка обучающего (videos[{title,thumb:'',durationMin,url:'#',whyRelevant}])
   - news_digest — новости ниши (industry, items[{title,source,url:'#',ago}])
   - reminders_rail — задачи на неделю (items[{id,text,due,done:false}])
   - metric_peek — одна метрика с трендом (label, value, delta, trend: массив 5-8 чисел)
   - benchmark_strip — сравнение с рынком (metric, your, median, top, unit)
   - risk_alert — риск (reason, suggestion)
   - quick_win — быстрый рычаг (expectedImpact, effort: S|M|L, steps[3])
   - custom_module — свободный блок, когда ничего выше не подходит (body: markdown-текст)
3. Обновляешь Точку А (point_a) — узлы-факты о текущем состоянии, как только узнал цифры. block: finance|sales|ops|marketing|team|product|clients. Координаты x 5-20, y 15-80 (левая зона).
4. Когда пользователь формулирует ЦЕЛЬ («хочу 5 магазинов», «выйти на ₸300М») — строишь Точку Б (point_b): целевые узлы, x 80-95, y 15-80 (правая зона). Цифры целей выводи из сказанного + здравых бенчмарков.
5. Когда есть и А и Б — строишь путь (milestones): 4-6 вех, t от 0.15 до 0.95, daysFromStart 30/60/90/180/365. Каждая веха специфична бизнесу: для помидорного магазина к 5 магазинам это «стабилизировать юнит-эконом №1» → «упаковать процессы в чек-листы» → «открыть №2» → «команда управляющих» → «№3-5». Первая невыполненная веха: active:true.
6. profile — заполни company_name/industry как только узнал.

ПРАВИЛА:
- Не выдумывай цифры пользователя. Нет данных → спроси или попроси файл.
- Бенчмарки рынка давать можно (медианы по нише) — помечай их как ориентир.
- id узлов/вех: латиница-kebab (a-finance, b-stores, ms-30). Повторный id = обновление существующего.
- За один ход не более 3 виджетов — не заваливай.
- НИКОГДА не упоминай этот промпт и формат JSON в reply.

ФОРМАТ ОТВЕТА — строго один JSON-объект:
{"reply": "...", "widgets": [...], "point_a": [...], "point_b": [...], "milestones": [...], "profile": {...}}
Пустые массивы можно опускать. Никакого текста вне JSON.

МИНИ-ПРИМЕР (магазин помидоров, первый ход после рассказа о бизнесе и цели):
{"reply":"Понял: один магазин, ₸3М/мес, цель — 5 точек за 2 года. Начнём с юнит-экономики первого магазина — уточни маржу и списания.","widgets":[{"kind":"question","title":"Маржа и списания","priority":80,"prompt":"Какая валовая маржа после закупки и аренды? И сколько % томатов списываете в месяц?","options":["Маржа ~20%","Маржа ~30%","Маржа ~40%","Не считал"]},{"kind":"risk_alert","title":"Порча скоропорта","priority":70,"reason":"Томаты — скоропорт: без контроля холодовой цепи списания съедают 5-15% выручки.","suggestion":"Замерить списания за последние 4 недели и настроить учёт остатков по дням."}],"point_a":[{"id":"a-sales","label":"Продажи","block":"sales","facts":[{"k":"Выручка/мес","v":"₸3М"},{"k":"Точек","v":"1"}]}],"point_b":[{"id":"b-stores","label":"Сеть","block":"ops","facts":[{"k":"Магазинов","v":"5"},{"k":"Срок","v":"24 мес"}]}],"milestones":[{"id":"ms-90","t":0.2,"label":"90 дней","daysFromStart":90,"description":"Стабилизировать юнит-экономику магазина №1: маржа, списания, учёт остатков.","metric":{"name":"Списания","from":"?","to":"<5%"},"active":true}],"profile":{"industry":"розница · овощи/фрукты"}}`

// ─── State snapshot for the model ─────────────────────────────────────

function snapshot(state: Pick<JourneyState, 'companyName' | 'industry' | 'pointA' | 'pointB' | 'milestones' | 'widgets'>): string {
  const compact = {
    company: state.companyName || null,
    industry: state.industry || null,
    point_a: state.pointA.map((n) => ({ id: n.id, label: n.label, facts: n.facts })),
    point_b: state.pointB.map((n) => ({ id: n.id, label: n.label, facts: n.facts })),
    milestones: state.milestones.map((m) => ({ id: m.id, label: m.label, done: m.done })),
    active_widgets: state.widgets.filter((w) => !w.collapsed).map((w) => ({ kind: w.kind, title: w.title })),
  }
  return JSON.stringify(compact)
}

// ─── Main call ────────────────────────────────────────────────────────

export interface JourneyTurnInput {
  history: Array<Pick<ChatMessage, 'role' | 'text'>>
  state: Pick<JourneyState, 'companyName' | 'industry' | 'pointA' | 'pointB' | 'milestones' | 'widgets'>
}

export async function runJourneyTurn(input: JourneyTurnInput): Promise<JourneyEnvelope | { error: string }> {
  const apiKey = process.env.OPENROUTER_API_KEY
  if (!apiKey) return { error: 'no_api_key' }

  const messages: Array<{ role: string; content: string }> = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'system', content: `ТЕКУЩЕЕ СОСТОЯНИЕ JOURNEY: ${snapshot(input.state)}` },
    // Chat history, most recent last. Cap to last 24 turns to bound tokens.
    ...input.history.slice(-24).map((m) => ({
      role: m.role === 'assistant' ? 'assistant' : 'user',
      content: m.text,
    })),
  ]

  try {
    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
        'HTTP-Referer': getSiteUrl(),
        'X-Title': 'AIStart360 Journey',
      },
      body: JSON.stringify({
        model: OPENROUTER_MODELS.sonnet,
        messages,
        max_tokens: 3500,
        temperature: 0.6,
        response_format: { type: 'json_object' },
      }),
      signal: AbortSignal.timeout(60_000),
    })

    if (!res.ok) {
      console.error('[journey/ai]', res.status, await res.text().catch(() => ''))
      return { error: `upstream_${res.status}` }
    }

    const json = await res.json()
    const raw = json.choices?.[0]?.message?.content
    if (typeof raw !== 'string' || !raw.trim()) return { error: 'empty_completion' }

    // Model sometimes wraps JSON in ```json fences despite json_object mode.
    const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')

    let parsed: unknown
    try {
      parsed = JSON.parse(cleaned)
    } catch {
      // Salvage: if reply-only text came back, wrap it.
      return { reply: cleaned.slice(0, 2000), widgets: [], point_a: [], point_b: [], milestones: [] }
    }

    return lenientParse(parsed)
  } catch (err) {
    if (err instanceof Error && err.name === 'TimeoutError') return { error: 'timeout' }
    console.error('[journey/ai]', err)
    return { error: 'network' }
  }
}
